-- Plan limits, phase 1 (docs/MONETIZATION.md, docs/PLANS.md):
--   * people per event: "going" RSVPs plus the host. Free 10, Party Pass 75,
--     Big Day Pass 300, Unlimited Pass and Pro no limit, a Plus host 100.
--   * photos per event: free 200; any paid event unlimited.
--   * Event Pass tiers: party / big_day / unlimited.
-- Events that exist when this first runs keep working with no limits
-- (events.capped = false); new events are capped. "Maybe" and "can't go"
-- never count, and nobody already going is ever removed.
-- Guests are never asked to pay: the database only says the event is full
-- (hint event_full / photos_full); the app tells the host, not the guest.
-- Run after plans.sql. Safe to re-run.

-- 1. Pass tiers (existing passes stay Party, the tier they were sold as).
alter table public.event_passes add column if not exists tier text not null default 'party';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'event_passes_tier_check') then
    alter table public.event_passes
      add constraint event_passes_tier_check check (tier in ('party', 'big_day', 'unlimited'));
  end if;
end $$;

-- 2. Which events are capped: every event made from now on. The column is
--    added once with false (so today's events stay uncapped), then new rows
--    default to true.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'events' and column_name = 'capped') then
    alter table public.events add column capped boolean not null default false;
    alter table public.events alter column capped set default true;
  end if;
end $$;

-- The app can't change capped (or anything else the server owns).
create or replace function private.events_protect_capped()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Same guard as keep_forever: people in the app can't set it.
  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.capped := true;
    else
      new.capped := old.capped;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.events_protect_capped() from public, anon, authenticated;

drop trigger if exists events_protect_capped on public.events;
create trigger events_protect_capped
  before insert or update on public.events
  for each row execute function private.events_protect_capped();

-- 3. An event's limits: null means no limit.
create or replace function private.event_limits(eid uuid)
returns table (people integer, photos integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  e record;
  host_plan text;
  pass_tier text;
begin
  select ev.id, ev.creator_id, ev.capped, ev.keep_forever into e from public.events ev where ev.id = eid;
  if not found or not e.capped then
    return query select null::integer, null::integer;
    return;
  end if;
  host_plan := private.effective_plan(e.creator_id);
  select p.tier into pass_tier from public.event_passes p where p.event_id = eid;
  if pass_tier = 'unlimited' or host_plan = 'pro' then
    return query select null::integer, null::integer;
  elsif pass_tier = 'big_day' then
    return query select 300, null::integer;
  elsif host_plan = 'plus' then
    return query select 100, null::integer;
  elsif pass_tier = 'party' or e.keep_forever then
    return query select 75, null::integer;
  else
    return query select 10, 200;
  end if;
end;
$$;

revoke execute on function private.event_limits(uuid) from public, anon, authenticated;

-- For the app's meters ("8 of 10 going", "180 of 200 photos"): members only.
create or replace function public.event_limits(eid uuid)
returns table (people_limit integer, photos_limit integer, going integer, photos integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_member(eid, auth.uid()) then
    raise exception 'Not a member of this event' using errcode = '42501';
  end if;
  return query
    select l.people, l.photos,
           (select count(*)::integer from public.rsvps r
             where r.event_id = eid and r.status = 'going'
               and r.user_id <> (select ev.creator_id from public.events ev where ev.id = eid)) + 1,
           (select count(*)::integer from public.photos p where p.event_id = eid)
      from private.event_limits(eid) l;
end;
$$;

revoke execute on function public.event_limits(uuid) from public, anon;
grant execute on function public.event_limits(uuid) to authenticated;

-- 4. People: becoming "going" checks there's room (the host counts as one).
create or replace function private.rsvps_people_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  cap integer;
  host uuid;
  going integer;
begin
  if new.status <> 'going' or (tg_op = 'UPDATE' and old.status = 'going') then
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
  select count(*) into going from public.rsvps r
   where r.event_id = new.event_id and r.status = 'going'
     and r.user_id <> host and r.user_id <> new.user_id;
  if going + 1 >= cap then
    raise exception 'This event is full' using errcode = '42501', hint = 'event_full';
  end if;
  return new;
end;
$$;

revoke execute on function private.rsvps_people_limit() from public, anon, authenticated;

drop trigger if exists rsvps_people_limit on public.rsvps;
create trigger rsvps_people_limit
  before insert or update of status on public.rsvps
  for each row execute function private.rsvps_people_limit();

-- 5. Photos: a new photo or video checks the roll has room.
create or replace function private.photos_count_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  cap integer;
begin
  select l.photos into cap from private.event_limits(new.event_id) l;
  if cap is null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('event-photos:' || new.event_id::text));
  if (select count(*) from public.photos p where p.event_id = new.event_id) >= cap then
    raise exception 'The photo roll is full' using errcode = '42501', hint = 'photos_full';
  end if;
  return new;
end;
$$;

revoke execute on function private.photos_count_limit() from public, anon, authenticated;

drop trigger if exists photos_count_limit on public.photos;
create trigger photos_count_limit
  before insert on public.photos
  for each row execute function private.photos_count_limit();
