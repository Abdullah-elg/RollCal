-- ============================================================================
-- RollCal - Who can join, private profile photos, length limits
-- Run after push.sql, private-schema.sql and events-guard.sql. Safe to re-run.
--
--   1. Length limits on names and event fields (the same numbers as
--      src/lib/limits.ts). They apply to new and edited rows only, so older
--      rows that are longer stay as they are until someone edits them.
--   2. Profile photos become private: you can load your own and your
--      friends' photos, nobody else's.
--   3. Each event has a "who can join" setting:
--        open      anyone with the link, QR or code joins straight away
--        approval  joining from the link sends the host a request
--        invite    only people the host invites; the link, QR and code stop
--                  working
--      events.is_link_enabled stays and is kept in step, because app builds
--      from before this still read and write it.
--   4. Pushes for a new join request (to the host) and an approval (to the
--      person who asked).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. LENGTH LIMITS
-- ----------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_name_length;
alter table public.profiles add constraint profiles_name_length check (
  (first_name is null or char_length(first_name) <= 30)
  and (last_name is null or char_length(last_name) <= 30)
) not valid;

alter table public.events drop constraint if exists events_field_length;
alter table public.events add constraint events_field_length check (
  char_length(title) <= 60
  and (location is null or char_length(location) <= 120)
  and (description is null or char_length(description) <= 1000)
) not valid;


-- ----------------------------------------------------------------------------
-- 2. PRIVATE PROFILE PHOTOS
-- Files live at avatars/{user id}/... . The app asks for a temporary link,
-- which storage only gives out if this policy lets the person read the file.
-- ----------------------------------------------------------------------------
create or replace function private.are_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from friendships
     where status = 'accepted'
       and ((requester_id = a and addressee_id = b) or (requester_id = b and addressee_id = a))
  );
$$;

revoke execute on function private.are_friends(uuid, uuid) from public, anon;
grant execute on function private.are_friends(uuid, uuid) to authenticated;

update storage.buckets set public = false where id = 'avatars';

drop policy if exists "avatars_read" on storage.objects;
create policy "avatars_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or private.are_friends((select auth.uid()), ((storage.foldername(name))[1])::uuid)
    )
  );


-- ----------------------------------------------------------------------------
-- 3. WHO CAN JOIN
-- ----------------------------------------------------------------------------
alter table public.events add column if not exists join_mode text not null default 'open';
alter table public.events drop constraint if exists events_join_mode_check;
alter table public.events add constraint events_join_mode_check
  check (join_mode in ('open', 'approval', 'invite'));

-- Existing events with the link turned off become invite only; the rest
-- keep today's behaviour (open).
update public.events set join_mode = 'invite' where join_mode = 'open' and not is_link_enabled;

-- Keeps is_link_enabled and join_mode saying the same thing, whichever one
-- the app changed (older builds only know is_link_enabled).
create or replace function public.events_join_mode_sync()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.join_mode = 'open' and new.is_link_enabled is false then
      new.join_mode := 'invite';
    end if;
  elsif new.join_mode is distinct from old.join_mode then
    null; -- join_mode leads; is_link_enabled follows below
  elsif new.is_link_enabled is distinct from old.is_link_enabled then
    new.join_mode := case
      when not new.is_link_enabled then 'invite'
      when old.join_mode = 'invite' then 'open'
      else old.join_mode
    end;
  end if;
  new.is_link_enabled := new.join_mode <> 'invite';
  return new;
end;
$$;

revoke execute on function public.events_join_mode_sync() from public, anon, authenticated;

drop trigger if exists events_join_mode_sync on public.events;
create trigger events_join_mode_sync
  before insert or update on public.events
  for each row execute function public.events_join_mode_sync();

-- Who may add themselves to an event: the host, anyone invited, and anyone
-- at all on an open event. Approval events let people in through
-- approve_join_request instead. (get_event_by_code already hides events whose
-- link is off, which now means invite-only ones.)
create or replace function private.can_join(eid uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not private.is_banned(eid, uid)
     and (
       private.is_leader(eid, uid)
       or exists (select 1 from events where id = eid and join_mode = 'open')
       or exists (select 1 from invitations where event_id = eid and invited_user_id = uid)
     );
$$;

-- Requests to join an approval event.
create table if not exists public.event_join_requests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- The answer they picked (going / maybe), used when they're let in.
  rsvp_status public.rsvp_status not null default 'going',
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);

create index if not exists event_join_requests_event on public.event_join_requests (event_id);

alter table public.event_join_requests enable row level security;

-- The person who asked and the host can see a request; either can delete it
-- (cancel, or decline). Requests are only made through join_event.
drop policy if exists "event_join_requests_select" on public.event_join_requests;
create policy "event_join_requests_select" on public.event_join_requests
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_leader(event_id, (select auth.uid())));

drop policy if exists "event_join_requests_delete" on public.event_join_requests;
create policy "event_join_requests_delete" on public.event_join_requests
  for delete to authenticated
  using (user_id = (select auth.uid()) or private.is_leader(event_id, (select auth.uid())));

grant select, delete on public.event_join_requests to authenticated;

-- Joining from a link, QR or code: joins straight away where allowed, sends
-- the host a request on an approval event. Returns 'joined' or 'requested'.
create or replace function public.join_event(p_event uuid, p_status public.rsvp_status default 'going')
returns text language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  mode text;
begin
  select join_mode into mode from events where id = p_event;
  if me is null or mode is null or private.is_banned(p_event, me) then
    raise exception 'This event isn''t available' using errcode = '42501';
  end if;

  if private.can_join(p_event, me) then
    insert into rsvps (event_id, user_id, status) values (p_event, me, p_status)
    on conflict (event_id, user_id) do update set status = excluded.status;
    delete from event_join_requests where event_id = p_event and user_id = me;
    return 'joined';
  end if;

  if mode = 'approval' then
    insert into event_join_requests (event_id, user_id, rsvp_status)
    values (p_event, me, p_status)
    on conflict (event_id, user_id) do update set rsvp_status = excluded.rsvp_status;
    return 'requested';
  end if;

  raise exception 'Only people the host invites can join this event' using errcode = '42501';
end;
$$;

-- The host lets someone in, or turns them down.
create or replace function public.approve_join_request(p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  req event_join_requests%rowtype;
begin
  select * into req from event_join_requests where id = p_request;
  if not found or not private.is_leader(req.event_id, auth.uid()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not private.is_banned(req.event_id, req.user_id) then
    insert into rsvps (event_id, user_id, status) values (req.event_id, req.user_id, req.rsvp_status)
    on conflict (event_id, user_id) do nothing;
    insert into push_outbox (user_id, kind, event_id, title, body, data)
    select req.user_id, 'joinApproved', e.id, e.title, 'You’re in. The host accepted your request.',
           jsonb_build_object('type', 'event', 'eventId', e.id)
      from events e where e.id = req.event_id;
  end if;
  delete from event_join_requests where id = p_request;
end;
$$;

create or replace function public.decline_join_request(p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from event_join_requests r
   where r.id = p_request and private.is_leader(r.event_id, auth.uid());
  if not found then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public.join_event(uuid, public.rsvp_status) from public, anon;
revoke execute on function public.approve_join_request(uuid) from public, anon;
revoke execute on function public.decline_join_request(uuid) from public, anon;
grant execute on function public.join_event(uuid, public.rsvp_status) to authenticated;
grant execute on function public.approve_join_request(uuid) to authenticated;
grant execute on function public.decline_join_request(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 4. PUSHES
-- ----------------------------------------------------------------------------
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.push_outbox'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute format('alter table public.push_outbox drop constraint %I', c);
  end loop;
end $$;
alter table public.push_outbox add constraint push_outbox_kind_check check (kind in (
  'friendRequest', 'friendAccepted', 'chatMessage', 'albumOpen', 'joinRequest', 'joinApproved'
));

-- A new request tells the host. (Quiet mode is about friend requests from
-- strangers, so it doesn't apply here.)
create or replace function public.push_join_requests()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into push_outbox (user_id, kind, event_id, title, body, data)
  select e.creator_id, 'joinRequest', e.id, e.title,
         public.push_name(new.user_id) || ' wants to join.',
         jsonb_build_object('type', 'event', 'eventId', e.id)
    from events e
   where e.id = new.event_id;
  return null;
end;
$$;

revoke execute on function public.push_join_requests() from public, anon, authenticated;

drop trigger if exists push_join_requests on public.event_join_requests;
create trigger push_join_requests
  after insert on public.event_join_requests
  for each row execute function public.push_join_requests();
