-- ============================================================================
-- RollCal - Row Level Security policies + Storage setup
-- Run this ONCE in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- It is idempotent: safe to re-run (drops and recreates its own objects).
--
-- The one definition everything hangs off:
--   "member of an event" = the creator, OR anyone with an RSVP row (any
--   status), OR anyone with an ACCEPTED invitation - MINUS anyone in
--   event_bans. Banned always wins.
--
-- Note on the photo 48h upload window: per the app spec that is enforced in
-- app logic, not here. These policies enforce WHO can act, the app enforces
-- WHEN.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER)
--
-- Why these exist: a policy on rsvps that peeks at events, while events has a
-- policy that peeks at rsvps, sends Postgres into infinite recursion. SECURITY
-- DEFINER functions run as the table owner, bypassing RLS *inside the
-- function only*, which breaks the loop. They are the single source of truth
-- for "who is what" - every policy below calls them.
-- ----------------------------------------------------------------------------

-- Is this user banned from this event? Banned trumps everything else.
create or replace function public.is_banned(eid uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from event_bans where event_id = eid and user_id = uid);
$$;

-- Is this user the event's creator (the "leader")?
create or replace function public.is_leader(eid uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from events where id = eid and creator_id = uid);
$$;

-- Full member: creator, any RSVP, or accepted invite - and not banned.
create or replace function public.is_member(eid uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not public.is_banned(eid, uid)
     and (
       public.is_leader(eid, uid)
       or exists (select 1 from rsvps where event_id = eid and user_id = uid)
       or exists (select 1 from invitations
                  where event_id = eid and invited_user_id = uid and status = 'accepted')
     );
$$;

-- Can this user SEE the event at all? Members, plus people with a pending
-- invite (they need to read the title/time to decide), never banned users.
create or replace function public.can_see_event(eid uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not public.is_banned(eid, uid)
     and (
       public.is_member(eid, uid)
       or exists (select 1 from invitations where event_id = eid and invited_user_id = uid)
     );
$$;

-- Can this user JOIN (create an RSVP)? Not banned, AND either the open link
-- is enabled, or they hold an invitation, or they are the creator.
create or replace function public.can_join(eid uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not public.is_banned(eid, uid)
     and (
       public.is_leader(eid, uid)
       or exists (select 1 from events where id = eid and is_link_enabled)
       or exists (select 1 from invitations where event_id = eid and invited_user_id = uid)
     );
$$;

-- Open-link lookup. Events are NOT selectable by strangers (see events
-- policy below), so "open event by code" goes through this function instead:
-- it returns the event row only if the code matches, the link is enabled,
-- and the caller is not banned. Call from the app with
--   supabase.rpc('get_event_by_code', { code: '...' })
create or replace function public.get_event_by_code(code text)
returns setof events language sql stable security definer set search_path = public as $$
  select * from events e
  where e.invite_code = code
    and e.is_link_enabled
    and not public.is_banned(e.id, auth.uid());
$$;

grant execute on function
  public.is_banned(uuid, uuid),
  public.is_leader(uuid, uuid),
  public.is_member(uuid, uuid),
  public.can_see_event(uuid, uuid),
  public.can_join(uuid, uuid),
  public.get_event_by_code(text)
to authenticated;


-- ----------------------------------------------------------------------------
-- Enable RLS everywhere. With RLS on and no matching policy, access is denied
-- by default - so anything not explicitly allowed below is forbidden.
-- ----------------------------------------------------------------------------
alter table public.profiles     enable row level security;
alter table public.events       enable row level security;
alter table public.rsvps        enable row level security;
alter table public.photos       enable row level security;
alter table public.friendships  enable row level security;
alter table public.invitations  enable row level security;
alter table public.messages     enable row level security;
alter table public.event_bans   enable row level security;


-- ----------------------------------------------------------------------------
-- PROFILES
-- Read: any signed-in user (needed for friend search by display name and for
--       showing names on RSVPs, chat, photos). Display names are public
--       within the app - that is the tradeoff for searchable friends.
-- Write: only your own row.
-- ----------------------------------------------------------------------------
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated using (true);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());


-- ----------------------------------------------------------------------------
-- EVENTS
-- Read: members and invitees only. Strangers cannot browse events - the open
--       link goes through get_event_by_code() above, which checks the code,
--       the link toggle, and bans.
-- Create: anyone, but only as themselves (creator_id must be you).
-- Update/Delete: leader only. Update covers title edits AND the link
--       toggle/regenerate, which is why it stays leader-only.
-- ----------------------------------------------------------------------------
-- The direct creator_id check (not just the helper function) matters: Postgres
-- runs the SELECT policy on INSERT ... RETURNING rows, and the helper's
-- subquery against events uses a snapshot that cannot see the row being
-- inserted in that same statement. Checking the row's own column works.
drop policy if exists "events_select_visible" on public.events;
create policy "events_select_visible" on public.events
  for select to authenticated
  using (creator_id = auth.uid() or public.can_see_event(id, auth.uid()));

drop policy if exists "events_insert_own" on public.events;
create policy "events_insert_own" on public.events
  for insert to authenticated with check (creator_id = auth.uid());

drop policy if exists "events_update_leader" on public.events;
create policy "events_update_leader" on public.events
  for update to authenticated
  using (creator_id = auth.uid()) with check (creator_id = auth.uid());

drop policy if exists "events_delete_leader" on public.events;
create policy "events_delete_leader" on public.events
  for delete to authenticated using (creator_id = auth.uid());


-- ----------------------------------------------------------------------------
-- RSVPS
-- Read: anyone who can see the event (members + invitees) can see who's going.
-- Create: only for yourself, only if you're allowed to join (link enabled, or
--         invited, or you're the leader) and not banned. This is the rule
--         that makes "kicked users can't rejoin, even with the link" real.
-- Update: your own RSVP (switch going/maybe/not_going), unless banned.
-- Delete: yourself (leave), or the leader (kick removes the RSVP).
-- ----------------------------------------------------------------------------
-- Same RETURNING rule as events: the direct user_id check lets a fresh
-- "join via link" INSERT return its own row (the helper can't see a row
-- inserted in the same statement).
drop policy if exists "rsvps_select_visible" on public.rsvps;
create policy "rsvps_select_visible" on public.rsvps
  for select to authenticated
  using (user_id = auth.uid() or public.can_see_event(event_id, auth.uid()));

drop policy if exists "rsvps_insert_join" on public.rsvps;
create policy "rsvps_insert_join" on public.rsvps
  for insert to authenticated
  with check (user_id = auth.uid() and public.can_join(event_id, auth.uid()));

drop policy if exists "rsvps_update_own" on public.rsvps;
create policy "rsvps_update_own" on public.rsvps
  for update to authenticated
  using (user_id = auth.uid() and not public.is_banned(event_id, auth.uid()))
  with check (user_id = auth.uid());

drop policy if exists "rsvps_delete_own_or_leader" on public.rsvps;
create policy "rsvps_delete_own_or_leader" on public.rsvps
  for delete to authenticated
  using (user_id = auth.uid() or public.is_leader(event_id, auth.uid()));


-- ----------------------------------------------------------------------------
-- PHOTOS (rows; the files themselves are covered by storage policies below)
-- Read: members only - but forever. Downloads never expire.
-- Create: members only, as themselves. The 48h window is app logic.
-- Delete: the uploader or the leader.
-- ----------------------------------------------------------------------------
drop policy if exists "photos_select_member" on public.photos;
create policy "photos_select_member" on public.photos
  for select to authenticated using (public.is_member(event_id, auth.uid()));

drop policy if exists "photos_insert_member" on public.photos;
create policy "photos_insert_member" on public.photos
  for insert to authenticated
  with check (uploader_id = auth.uid() and public.is_member(event_id, auth.uid()));

drop policy if exists "photos_delete_uploader_or_leader" on public.photos;
create policy "photos_delete_uploader_or_leader" on public.photos
  for delete to authenticated
  using (uploader_id = auth.uid() or public.is_leader(event_id, auth.uid()));


-- ----------------------------------------------------------------------------
-- FRIENDSHIPS
-- Read: only the two people involved.
-- Create: you can send a request as yourself, to someone else, and it must
--         start as 'pending' (you can't insert an already-accepted row).
-- Update: only the ADDRESSEE can change status, and only to 'accepted'  - 
--         the sender can't accept their own request.
-- Delete: either side (cancel a pending request, or unfriend).
-- ----------------------------------------------------------------------------
drop policy if exists "friendships_select_involved" on public.friendships;
create policy "friendships_select_involved" on public.friendships
  for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

drop policy if exists "friendships_insert_request" on public.friendships;
create policy "friendships_insert_request" on public.friendships
  for insert to authenticated
  with check (
    requester_id = auth.uid()
    and addressee_id <> auth.uid()
    and status = 'pending'
  );

drop policy if exists "friendships_update_accept" on public.friendships;
create policy "friendships_update_accept" on public.friendships
  for update to authenticated
  using (addressee_id = auth.uid())
  with check (addressee_id = auth.uid() and status = 'accepted');

drop policy if exists "friendships_delete_involved" on public.friendships;
create policy "friendships_delete_involved" on public.friendships
  for delete to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());


-- ----------------------------------------------------------------------------
-- INVITATIONS
-- Read: the invited person (to see their pending invites) and the leader
--       (to see who they've invited).
-- Create: leader only, as themselves, targeting someone who is not banned,
--         and always starting as 'pending'.
-- Update: the invited person accepts/declines their own invite (leaders
--         don't answer for people).
-- Delete: leader (revoke an invite) or the invited person (dismiss it).
-- ----------------------------------------------------------------------------
drop policy if exists "invitations_select_involved" on public.invitations;
create policy "invitations_select_involved" on public.invitations
  for select to authenticated
  using (invited_user_id = auth.uid() or public.is_leader(event_id, auth.uid()));

drop policy if exists "invitations_insert_leader" on public.invitations;
create policy "invitations_insert_leader" on public.invitations
  for insert to authenticated
  with check (
    invited_by = auth.uid()
    and public.is_leader(event_id, auth.uid())
    and not public.is_banned(event_id, invited_user_id)
    and status = 'pending'
  );

drop policy if exists "invitations_update_respond" on public.invitations;
create policy "invitations_update_respond" on public.invitations
  for update to authenticated
  using (invited_user_id = auth.uid() and not public.is_banned(event_id, auth.uid()))
  with check (invited_user_id = auth.uid() and status in ('accepted', 'declined'));

drop policy if exists "invitations_delete_leader_or_invitee" on public.invitations;
create policy "invitations_delete_leader_or_invitee" on public.invitations
  for delete to authenticated
  using (invited_user_id = auth.uid() or public.is_leader(event_id, auth.uid()));


-- ----------------------------------------------------------------------------
-- MESSAGES (event chat, realtime)
-- Read: members only. Realtime subscriptions respect this same policy, so a
--       kicked user's live subscription stops delivering too.
-- Create: members only, as themselves.
-- Delete: your own message, or the leader (moderation). No edits.
-- ----------------------------------------------------------------------------
drop policy if exists "messages_select_member" on public.messages;
create policy "messages_select_member" on public.messages
  for select to authenticated using (public.is_member(event_id, auth.uid()));

drop policy if exists "messages_insert_member" on public.messages;
create policy "messages_insert_member" on public.messages
  for insert to authenticated
  with check (sender_id = auth.uid() and public.is_member(event_id, auth.uid()));

drop policy if exists "messages_delete_own_or_leader" on public.messages;
create policy "messages_delete_own_or_leader" on public.messages
  for delete to authenticated
  using (sender_id = auth.uid() or public.is_leader(event_id, auth.uid()));


-- ----------------------------------------------------------------------------
-- EVENT_BANS
-- Read: the leader (to manage the list) and the banned person themselves
--       (so the app can show "you were removed" instead of a cryptic error).
-- Create: leader only, and the leader cannot ban themselves.
-- Delete: leader only (unban).
-- ----------------------------------------------------------------------------
drop policy if exists "event_bans_select" on public.event_bans;
create policy "event_bans_select" on public.event_bans
  for select to authenticated
  using (user_id = auth.uid() or public.is_leader(event_id, auth.uid()));

drop policy if exists "event_bans_insert_leader" on public.event_bans;
create policy "event_bans_insert_leader" on public.event_bans
  for insert to authenticated
  with check (public.is_leader(event_id, auth.uid()) and user_id <> auth.uid());

drop policy if exists "event_bans_delete_leader" on public.event_bans;
create policy "event_bans_delete_leader" on public.event_bans
  for delete to authenticated
  using (public.is_leader(event_id, auth.uid()));


-- ----------------------------------------------------------------------------
-- STORAGE: the event-photos bucket
-- Private bucket (the app fetches images with the user's auth, so these
-- policies actually apply). Files are stored under the path convention
--   {event_id}/{filename}
-- and the policies parse the event id out of the first path segment.
--
-- Read: event members - forever.
-- Upload: event members, into their events only, within their upload
--         allowance (see media.sql). (48h window = app logic.)
-- Delete: the file's uploader (owner) or the event leader.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('event-photos', 'event-photos', false)
on conflict (id) do nothing;

drop policy if exists "event_photos_read_member" on storage.objects;
create policy "event_photos_read_member" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'event-photos'
    and public.is_member(((storage.foldername(name))[1])::uuid, auth.uid())
  );

-- Upload: the policy lives in media.sql, which adds the monthly upload
-- allowance. Run media.sql after this file.

-- (The invite landing page is served by the "join" Edge Function, not
-- Storage - Supabase deliberately refuses to render HTML from the storage
-- endpoint. See supabase/functions/join/index.ts.)

drop policy if exists "event_photos_delete_owner_or_leader" on storage.objects;
create policy "event_photos_delete_owner_or_leader" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'event-photos'
    and (
      owner = auth.uid()
      or public.is_leader(((storage.foldername(name))[1])::uuid, auth.uid())
    )
  );


-- ----------------------------------------------------------------------------
-- STORAGE: the avatars bucket
-- Public bucket: profile photos are readable by any authenticated user.
-- Upload/Update/Delete: restricted to the user's own folder ({user_id}/{filename}).
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars_read" on storage.objects;
create policy "avatars_read" on storage.objects
  for select
  using (bucket_id = 'avatars');

drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

