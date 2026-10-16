-- Schema additions made after the original data model. Run once each.

-- 2026-08-31: optional pin coordinates for an event's location. The text
-- `location` column stays the human-readable label; these carry the exact
-- pin so navigation apps open the right spot.
alter table public.events add column if not exists location_lat double precision;
alter table public.events add column if not exists location_lng double precision;

-- 2026-08-31: lets the host close the photo-upload window early (and reopen
-- it, while still inside the 48h window). Only the leader can update events,
-- so the existing RLS already protects this flag.
alter table public.events add column if not exists uploads_closed boolean not null default false;

-- 2026-09-01: split names + a username derived from the email's local part
-- (the bit before the @). display_name stays the rendered "First Last".
-- The username is unique (case-insensitive) so it can identify people for
-- friend search; the app handles collisions by appending digits.
alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;
alter table public.profiles add column if not exists username text;
create unique index if not exists profiles_username_key
  on public.profiles (lower(username));

-- Backfill existing accounts: username from the auth email, names split out
-- of the current display_name (best effort).
update public.profiles p
set
  username = split_part(u.email, '@', 1),
  first_name = coalesce(p.first_name, split_part(p.display_name, ' ', 1)),
  last_name = coalesce(
    p.last_name,
    nullif(substr(p.display_name, length(split_part(p.display_name, ' ', 1)) + 2), '')
  )
from auth.users u
where u.id = p.id and p.username is null;

-- 2026-09-13: event chat needs the messages table in Supabase's realtime
-- publication. Harmless to run if it's already there.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- 2026-09-10: the existing friendships unique constraint is directional, so
-- A→B and B→A could both exist as separate rows (verified against the live
-- project). This index makes the pair unique regardless of direction, so a
-- second request between the same two people is rejected by the database.
create unique index if not exists friendships_pair_key
  on public.friendships (
    least(requester_id, addressee_id),
    greatest(requester_id, addressee_id)
  );

-- 2026-10-09: optional cover photo chosen by the host for an event.
-- Defaults to null (no cover photo until explicitly chosen by the host).
alter table public.events add column if not exists cover_photo_id uuid references public.photos(id) on delete set null;

-- 2026-10-10: user profile photo URL
alter table public.profiles add column if not exists avatar_url text;

-- 2026-10-11: event invite requests for attendees
create table if not exists public.event_invite_requests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  suggested_user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  constraint event_invite_requests_unique unique (event_id, suggested_user_id)
);

alter table public.event_invite_requests enable row level security;

drop policy if exists "Users can view invite requests for events they are part of or requested" on public.event_invite_requests;
create policy "Users can view invite requests for events they are part of or requested"
  on public.event_invite_requests
  for select
  using (
    auth.uid() = requested_by
    or exists (
      select 1 from public.events e
      where e.id = event_invite_requests.event_id and e.creator_id = auth.uid()
    )
  );

drop policy if exists "Attendees can submit invite requests" on public.event_invite_requests;
create policy "Attendees can submit invite requests"
  on public.event_invite_requests
  for insert
  with check (
    auth.uid() = requested_by
    and (
      exists (
        select 1 from public.rsvps r
        where r.event_id = event_invite_requests.event_id and r.user_id = auth.uid()
      )
      or exists (
        select 1 from public.events e
        where e.id = event_invite_requests.event_id and e.creator_id = auth.uid()
      )
      or exists (
        select 1 from public.invitations i
        where i.event_id = event_invite_requests.event_id and i.invited_user_id = auth.uid() and i.status = 'accepted'
      )
    )
  );

drop policy if exists "Requesters and event hosts can delete invite requests" on public.event_invite_requests;
create policy "Requesters and event hosts can delete invite requests"
  on public.event_invite_requests
  for delete
  using (
    auth.uid() = requested_by
    or exists (
      select 1 from public.events e
      where e.id = event_invite_requests.event_id and e.creator_id = auth.uid()
    )
  );

drop policy if exists "Event hosts can update invite requests" on public.event_invite_requests;
create policy "Event hosts can update invite requests"
  on public.event_invite_requests
  for update
  using (
    exists (
      select 1 from public.events e
      where e.id = event_invite_requests.event_id and e.creator_id = auth.uid()
    )
  );

-- RPC for host approving an invite request
create or replace function public.approve_invite_request(p_request_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_req public.event_invite_requests%rowtype;
begin
  select * into v_req
  from public.event_invite_requests
  where id = p_request_id;

  if not found then
    raise exception 'Invite request not found';
  end if;

  if not exists (
    select 1 from public.events
    where id = v_req.event_id and creator_id = auth.uid()
  ) then
    raise exception 'Not authorized';
  end if;

  insert into public.invitations (event_id, invited_user_id, invited_by, status)
  values (v_req.event_id, v_req.suggested_user_id, v_req.requested_by, 'pending')
  on conflict (event_id, invited_user_id) do nothing;

  delete from public.event_invite_requests where id = p_request_id;
end;
$$;

-- RPC for host declining an invite request
create or replace function public.decline_invite_request(p_request_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_req public.event_invite_requests%rowtype;
begin
  select * into v_req
  from public.event_invite_requests
  where id = p_request_id;

  if not found then
    return;
  end if;

  if not exists (
    select 1 from public.events
    where id = v_req.event_id and creator_id = auth.uid()
  ) then
    raise exception 'Not authorized';
  end if;

  delete from public.event_invite_requests where id = p_request_id;
end;
$$;



-- 2026-10-14: security advisor fixes. Pin search_path on the invite-request
-- RPCs, and stop signed-out (anon) callers reaching the helpers and RPCs.
-- Postgres grants EXECUTE to PUBLIC by default, which includes anon.
alter function public.approve_invite_request(uuid) set search_path = public;
alter function public.decline_invite_request(uuid) set search_path = public;
do $$
declare f text;
begin
  foreach f in array array[
    'public.approve_invite_request(uuid)',
    'public.decline_invite_request(uuid)',
    'public.get_event_by_code(text)',
    'public.can_join(uuid, uuid)',
    'public.can_see_event(uuid, uuid)',
    'public.is_banned(uuid, uuid)',
    'public.is_leader(uuid, uuid)',
    'public.is_member(uuid, uuid)'
  ] loop
    -- The helpers live in policies.sql; skip any that aren't created yet.
    continue when to_regprocedure(f) is null;
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- 2026-10-14: cover every foreign key with an index (performance advisor).
create index if not exists event_bans_user_id_idx on public.event_bans (user_id);
create index if not exists event_invite_requests_requested_by_idx on public.event_invite_requests (requested_by);
create index if not exists event_invite_requests_suggested_user_id_idx on public.event_invite_requests (suggested_user_id);
create index if not exists events_creator_id_idx on public.events (creator_id);
create index if not exists friendships_addressee_id_idx on public.friendships (addressee_id);
create index if not exists invitations_invited_by_idx on public.invitations (invited_by);
create index if not exists invitations_invited_user_id_idx on public.invitations (invited_user_id);
create index if not exists messages_event_id_idx on public.messages (event_id);
create index if not exists messages_sender_id_idx on public.messages (sender_id);
create index if not exists photos_event_id_idx on public.photos (event_id);
create index if not exists photos_uploader_id_idx on public.photos (uploader_id);
create index if not exists rsvps_user_id_idx on public.rsvps (user_id);

-- 2026-10-14: account deletion (App Store guideline 5.1.1(v)). No SQL needed:
-- it is the "delete-account" Edge Function (supabase/functions/delete-account),
-- deployed with JWT verification ON. It uses the service role to remove the
-- caller's files via the Storage API (avatars/{uid}/*, every file in events
-- they created, their uploads elsewhere), then auth.admin.deleteUser(uid).
-- Every public table cascades from auth.users -> profiles (or events), so that
-- one call removes all their rows. Their events are deleted, not handed off.
-- An edge function rather than a SECURITY DEFINER RPC because deleting
-- storage.objects rows in SQL orphans the stored blobs, and a definer RPC
-- granted to authenticated would add another security-advisor warning.

-- 2026-10-14: the cover_photo_id column above had never been applied, so the
-- app had been hiding the cover id in the description as <!--cover:ID-->.
-- Move any such ids into the column and strip the tags.
create index if not exists events_cover_photo_id_idx on public.events (cover_photo_id);
update public.events e
set cover_photo_id = p.id
from public.photos p
where e.cover_photo_id is null
  and p.id::text = substring(e.description from '<!--cover:([a-zA-Z0-9_-]+)-->');
update public.events
set description = nullif(btrim(regexp_replace(description, '\r?\n?<!--cover:[a-zA-Z0-9_-]+-->', '', 'g')), '')
where description like '%<!--cover:%';

-- 2026-10-15: the host can reopen a closed roll for 24 hours, as often as
-- they like. The roll closes at whichever is later: 48h after the event ends,
-- or this timestamp.
alter table public.events add column if not exists uploads_reopened_until timestamptz;
