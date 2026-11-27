-- Membership, people limits, photo keeping and an AI caption cap
-- (beta prep, 2026-11-27). Safe to run more than once.
--
-- 1. "Can't go" is no longer membership. Only the host and people going or
--    maybe can see and add photos, read and send chat, see bills and
--    recaps. People who said "can't go" (or were only invited) still see
--    the event itself, so they can change their answer.
-- 2. A bill stays visible to anyone who has already paid or claimed on it,
--    even after they switch to "can't go".
-- 3. The people limit (Free 10, passes 75/300) counts going AND maybe.
-- 4. Events with an Event Pass, or marked keep_forever, keep their photos.
--    (Was in security-beta.sql after it had been run.)
-- 5. AI captions: at most 300 photos per person per day. A full "all
--    photos" recap is 39 at most, so nobody should ever reach it.

-- 1. Who's a member, and who can see the event.
create or replace function private.is_member(eid uuid, uid uuid)
returns boolean
language sql stable security definer set search_path to 'public' as $$
  select not private.is_banned(eid, uid) and (
    private.is_leader(eid, uid)
    or exists (select 1 from rsvps where event_id = eid and user_id = uid
                and status in ('going', 'maybe'))
    -- Accepted an invite but hasn't answered yet.
    or (exists (select 1 from invitations where event_id = eid and invited_user_id = uid
                 and status = 'accepted')
        and not exists (select 1 from rsvps where event_id = eid and user_id = uid))
  );
$$;

create or replace function private.can_see_event(eid uuid, uid uuid)
returns boolean
language sql stable security definer set search_path to 'public' as $$
  select not private.is_banned(eid, uid) and (
    private.is_member(eid, uid)
    or exists (select 1 from rsvps where event_id = eid and user_id = uid)
    or exists (select 1 from invitations where event_id = eid and invited_user_id = uid)
  );
$$;

-- 2. Bills: members, the bill's creator, or anyone with a payment on it.
create or replace function private.can_see_bill(bid uuid, uid uuid)
returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from bills b
     where b.id = bid
       and (b.created_by = uid
            or (b.status <> 'draft'
                and (private.is_member(b.event_id, uid)
                     or exists (select 1 from bill_payments p
                                 where p.bill_id = b.id and p.user_id = uid))))
  );
$$;

drop policy if exists bills_select on public.bills;
create policy bills_select on public.bills
  for select to authenticated
  using (private.can_see_bill(id, (select auth.uid())));

-- 3. People limit: going and maybe both take a spot.
create or replace function public.event_limits(eid uuid)
returns table (people_limit integer, photos_limit integer, going integer, photos integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  -- Anyone who can see the event, so "can't go" people see when it's full.
  if auth.uid() is null or not private.can_see_event(eid, auth.uid()) then
    raise exception 'Not a member of this event' using errcode = '42501';
  end if;
  return query
    select l.people, l.photos,
           (select count(*)::integer from public.rsvps r
             where r.event_id = eid and r.status in ('going', 'maybe')
               and r.user_id <> (select ev.creator_id from public.events ev where ev.id = eid)) + 1,
           (select count(*)::integer from public.photos p where p.event_id = eid)
      from private.event_limits(eid) l;
end;
$$;

revoke execute on function public.event_limits(uuid) from public, anon;
grant execute on function public.event_limits(uuid) to authenticated;

create or replace function private.rsvps_people_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  cap integer;
  host uuid;
  taken integer;
begin
  -- Only taking a spot is checked: becoming going or maybe from nothing or
  -- from "can't go". Switching between going and maybe keeps your spot.
  if new.status not in ('going', 'maybe')
     or (tg_op = 'UPDATE' and old.status in ('going', 'maybe')) then
    return new;
  end if;
  select ev.creator_id into host from public.events ev where ev.id = new.event_id;
  if new.user_id = host then
    return new;
  end if;
  select l.people into cap from private.event_limits(new.event_id) l;
  if cap is null then
    return new;
  end if;
  -- One at a time per event, so two people can't take the last spot.
  perform pg_advisory_xact_lock(hashtext('event-people:' || new.event_id::text));
  select count(*) into taken from public.rsvps r
   where r.event_id = new.event_id and r.status in ('going', 'maybe')
     and r.user_id <> host and r.user_id <> new.user_id;
  if taken + 1 >= cap then
    raise exception 'This event is full' using errcode = '42501', hint = 'event_full';
  end if;
  return new;
end;
$$;

revoke execute on function private.rsvps_people_limit() from public, anon, authenticated;

-- 4. Photos are kept for Plus/Pro hosts, Event Passes and keep_forever.
create or replace function public.event_photos_expire_at(e public.events)
returns timestamptz
language sql stable security definer set search_path to 'public' as $$
  select case
    when p.is_pro or e.keep_forever
      or exists (select 1 from public.event_passes ep where ep.event_id = e.id) then null
    else greatest(e.ends_at, coalesce(p.pro_ended_at, e.ends_at)) + interval '30 days'
  end
  from public.profiles p where p.id = e.creator_id;
$$;

-- 5. AI caption cap. The caption-photos function (service role) asks for
--    room before calling the model and gets back how many it may caption.
create table if not exists private.caption_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default (now() at time zone 'utc')::date,
  photos integer not null default 0,
  primary key (user_id, day)
);
alter table private.caption_usage enable row level security;

create or replace function public.claim_caption_quota(p_user uuid, p_count integer)
returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  daily constant integer := 300;
  used integer;
  granted integer;
begin
  if p_user is null or p_count is null or p_count <= 0 then
    return 0;
  end if;
  insert into private.caption_usage (user_id) values (p_user)
  on conflict (user_id, day) do nothing;
  select photos into used from private.caption_usage
   where user_id = p_user and day = (now() at time zone 'utc')::date
   for update;
  granted := greatest(0, least(p_count, daily - used));
  update private.caption_usage set photos = photos + granted
   where user_id = p_user and day = (now() at time zone 'utc')::date;
  delete from private.caption_usage where day < (now() at time zone 'utc')::date - 7;
  return granted;
end;
$$;

revoke execute on function public.claim_caption_quota(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_caption_quota(uuid, integer) to service_role;
