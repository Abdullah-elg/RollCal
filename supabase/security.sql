-- ============================================================================
-- RollCal - Security fixes from the October 2026 audit
-- Run after policies.sql, schema-updates.sql, bills.sql and media.sql.
-- Safe to re-run.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. ROWS CAN'T BE MOVED TO ANOTHER EVENT OR PERSON
-- Update policies check who is updating, but not which columns change. Without
-- this, someone could edit one of their own RSVPs to point at any event and
-- become a member, even with the invite link off or while banned. The same
-- goes for invitations, friendships and invite requests.
-- ----------------------------------------------------------------------------
create or replace function public.keep_columns()
returns trigger language plpgsql set search_path = public as $$
declare col text;
begin
  -- Dashboard and service role (no signed-in user) may still fix data.
  if auth.uid() is null then
    return new;
  end if;
  foreach col in array tg_argv loop
    if to_jsonb(new) -> col is distinct from to_jsonb(old) -> col then
      raise exception '% can''t be changed', col using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;

revoke execute on function public.keep_columns() from public, anon, authenticated;

drop trigger if exists rsvps_keep on public.rsvps;
create trigger rsvps_keep before update on public.rsvps
  for each row execute function public.keep_columns('event_id', 'user_id');

drop trigger if exists invitations_keep on public.invitations;
create trigger invitations_keep before update on public.invitations
  for each row execute function public.keep_columns('event_id', 'invited_user_id', 'invited_by');

drop trigger if exists friendships_keep on public.friendships;
create trigger friendships_keep before update on public.friendships
  for each row execute function public.keep_columns('requester_id', 'addressee_id');

drop trigger if exists event_invite_requests_keep on public.event_invite_requests;
create trigger event_invite_requests_keep before update on public.event_invite_requests
  for each row execute function public.keep_columns('event_id', 'requested_by', 'suggested_user_id');

drop trigger if exists bills_keep on public.bills;
create trigger bills_keep before update on public.bills
  for each row execute function public.keep_columns('event_id', 'created_by');

drop trigger if exists bill_items_keep on public.bill_items;
create trigger bill_items_keep before update on public.bill_items
  for each row execute function public.keep_columns('bill_id');

-- An event's cover must be one of its own photos.
create or replace function public.events_cover_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cover_photo_id is not null
     and new.cover_photo_id is distinct from old.cover_photo_id
     and not exists (select 1 from photos where id = new.cover_photo_id and event_id = new.id) then
    raise exception 'The cover has to be a photo from this event' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.events_cover_check() from public, anon, authenticated;

drop trigger if exists events_cover_check on public.events;
create trigger events_cover_check before update on public.events
  for each row execute function public.events_cover_check();


-- ----------------------------------------------------------------------------
-- 2. SENSIBLE LENGTHS FOR TEXT PEOPLE TYPE
-- Stops anyone storing huge strings through the API, which would bloat the
-- database and break other people's screens. Limits match the app's inputs.
-- ----------------------------------------------------------------------------
alter table public.messages drop constraint if exists messages_body_length;
alter table public.messages add constraint messages_body_length
  check (char_length(body) between 1 and 1000);

alter table public.events drop constraint if exists events_text_lengths;
alter table public.events add constraint events_text_lengths check (
  char_length(title) between 1 and 120
  and (description is null or char_length(description) <= 2000)
  and (location is null or char_length(location) <= 300)
);

alter table public.profiles drop constraint if exists profiles_text_lengths;
alter table public.profiles add constraint profiles_text_lengths check (
  char_length(display_name) <= 80
  and (first_name is null or char_length(first_name) <= 40)
  and (last_name is null or char_length(last_name) <= 40)
  and (username is null or char_length(username) <= 40)
);


-- ----------------------------------------------------------------------------
-- 3. INVITE REQUESTS: signed-in users only
-- These policies were open to the "public" role. auth.uid() kept signed-out
-- requests out anyway; now the role says so too.
-- ----------------------------------------------------------------------------
alter policy "Attendees can submit invite requests" on public.event_invite_requests to authenticated;
alter policy "Event hosts can update invite requests" on public.event_invite_requests to authenticated;
alter policy "Requesters and event hosts can delete invite requests" on public.event_invite_requests to authenticated;
alter policy "Users can view invite requests for events they are part of or r" on public.event_invite_requests to authenticated;


-- ----------------------------------------------------------------------------
-- 4. STORAGE BUCKETS
-- ----------------------------------------------------------------------------

-- app-links: left over from an early invite-page experiment. It was public
-- and any signed-in user could upload or overwrite files in it, so anyone
-- could have hosted files on the project's address. The app doesn't use it.
drop policy if exists "app_links_read" on storage.objects;
drop policy if exists "app_links_write" on storage.objects;
drop policy if exists "app_links_update" on storage.objects;

-- receipts: receipt photos are read and thrown away by the scan function,
-- never stored, so nobody needs to upload here.
drop policy if exists "receipts_read_member" on storage.objects;
drop policy if exists "receipts_upload_member" on storage.objects;
drop policy if exists "receipts_update_owner" on storage.objects;
drop policy if exists "receipts_delete_owner" on storage.objects;

-- Both buckets go, with the one leftover file. Supabase blocks deleting
-- storage rows from SQL unless this switch is on for the transaction.
do $$
begin
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id in ('app-links', 'receipts');
  delete from storage.buckets where id in ('app-links', 'receipts');
end $$;

-- Profile photos: public to read, so keep them small and images only.
update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
 where id = 'avatars';

-- Event rolls: real photo and video types only. "image/*" also allowed SVG,
-- which can carry scripts.
update storage.buckets
   set allowed_mime_types = array[
     'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif',
     'video/mp4', 'video/quicktime'
   ]
 where id = 'event-photos';


-- ----------------------------------------------------------------------------
-- 5. SUPABASE'S OWN HELPER
-- rls_auto_enable() is Supabase's event trigger that switches RLS on for new
-- tables. It was callable over the API by anyone; event triggers don't need
-- that permission to run.
-- ----------------------------------------------------------------------------
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
