-- Who can add photos and who can chat, per event. The host picks Everyone
-- (how it has always worked) or Only the host, and can then let chosen
-- members in. Run after policies.sql, launch-hardening.sql, plans.sql and
-- media-r2.sql. Safe to re-run.
--
-- The checks are restrictive policies and a trigger: they only ever take
-- access away from what the existing rules allow, so membership, the roll
-- window and plan limits all still apply on top.


-- ----------------------------------------------------------------------------
-- 1. THE TWO SETTINGS
-- ----------------------------------------------------------------------------
alter table public.events add column if not exists photos_by text not null default 'everyone';
alter table public.events add column if not exists chat_by text not null default 'everyone';

do $$
begin
  alter table public.events add constraint events_photos_by_check check (photos_by in ('everyone', 'host'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.events add constraint events_chat_by_check check (chat_by in ('everyone', 'host'));
exception when duplicate_object then null;
end $$;


-- ----------------------------------------------------------------------------
-- 2. PEOPLE THE HOST LET IN
-- ----------------------------------------------------------------------------
create table if not exists public.event_allowed (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  photos boolean not null default false,
  chat boolean not null default false,
  primary key (event_id, user_id)
);

create index if not exists event_allowed_user_idx on public.event_allowed (user_id);

alter table public.event_allowed enable row level security;
revoke all on public.event_allowed from anon;
grant select, insert, update, delete on public.event_allowed to authenticated;

-- Members can see who's allowed (so the app can tell them); only the host
-- changes it, and only for people in the event.
drop policy if exists "event_allowed_select_member" on public.event_allowed;
create policy "event_allowed_select_member" on public.event_allowed
  for select to authenticated
  using (private.is_member(event_id, (select auth.uid())));

drop policy if exists "event_allowed_insert_host" on public.event_allowed;
create policy "event_allowed_insert_host" on public.event_allowed
  for insert to authenticated
  with check (
    private.is_leader(event_id, (select auth.uid()))
    and private.is_member(event_id, user_id)
  );

drop policy if exists "event_allowed_update_host" on public.event_allowed;
create policy "event_allowed_update_host" on public.event_allowed
  for update to authenticated
  using (private.is_leader(event_id, (select auth.uid())))
  with check (
    private.is_leader(event_id, (select auth.uid()))
    and private.is_member(event_id, user_id)
  );

drop policy if exists "event_allowed_delete_host" on public.event_allowed;
create policy "event_allowed_delete_host" on public.event_allowed
  for delete to authenticated
  using (private.is_leader(event_id, (select auth.uid())));


-- ----------------------------------------------------------------------------
-- 3. THE CHECK: may this person add photos / chat in this event?
-- what is 'photos' or 'chat'. The host always may.
-- ----------------------------------------------------------------------------
create or replace function private.may_post(eid uuid, uid uuid, what text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.events e
     where e.id = eid
       and (
         e.creator_id = uid
         or (case what when 'photos' then e.photos_by when 'chat' then e.chat_by end) = 'everyone'
         or exists (
           select 1 from public.event_allowed a
            where a.event_id = eid and a.user_id = uid
              and (case what when 'photos' then a.photos when 'chat' then a.chat else false end))
       )
  );
$$;

revoke execute on function private.may_post(uuid, uuid, text) from public, anon;
grant execute on function private.may_post(uuid, uuid, text) to authenticated, service_role;

-- Storage paths are '<event id>/<file>'; anything that isn't an event id
-- is left to the existing rules (which refuse it).
create or replace function private.may_post_path(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  folder text := (storage.foldername(p_name))[1];
begin
  if folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return true;
  end if;
  return private.may_post(folder::uuid, auth.uid(), 'photos');
end;
$$;

revoke execute on function private.may_post_path(text) from public, anon;
grant execute on function private.may_post_path(text) to authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 4. WHERE IT APPLIES
-- ----------------------------------------------------------------------------
-- Photo rows added by the app (the Supabase Storage path).
drop policy if exists "photos_insert_allowed" on public.photos;
create policy "photos_insert_allowed" on public.photos
  as restrictive for insert to authenticated
  with check (private.may_post(event_id, (select auth.uid()), 'photos'));

-- Files put straight into Supabase Storage.
drop policy if exists "event_photos_upload_allowed" on storage.objects;
create policy "event_photos_upload_allowed" on storage.objects
  as restrictive for insert to authenticated
  with check (bucket_id <> 'event-photos' or private.may_post_path(name));

-- Chat messages.
drop policy if exists "messages_insert_allowed" on public.messages;
create policy "messages_insert_allowed" on public.messages
  as restrictive for insert to authenticated
  with check (private.may_post(event_id, (select auth.uid()), 'chat'));

-- R2 uploads: reserve_media_upload writes the reservation as the owner, past
-- the policies above, so the same check runs on the reservation itself.
create or replace function private.media_post_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.bucket = 'event-photos' and not private.may_post(new.event_id, new.owner, 'photos') then
    raise exception 'Only the host and people they pick can add photos here'
      using errcode = '42501', hint = 'host_only';
  end if;
  return new;
end;
$$;

revoke execute on function private.media_post_guard() from public, anon, authenticated;

drop trigger if exists media_objects_post_guard on public.media_objects;
create trigger media_objects_post_guard
  before insert on public.media_objects
  for each row execute function private.media_post_guard();


-- ----------------------------------------------------------------------------
-- 5. LOOSE ENDS
-- ----------------------------------------------------------------------------
-- Editing a message (message-edits.sql) follows the same rule, so switching
-- chat to host-only also stops the 10-minute edits.
create or replace function public.edit_message(p_message uuid, p_body text)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  new_body text := btrim(p_body);
  stamped timestamptz := now();
begin
  if char_length(new_body) < 1 or char_length(new_body) > 1000 then
    raise exception 'Messages are 1 to 1000 characters' using errcode = '23514';
  end if;
  update messages
     set body = new_body, edited_at = stamped
   where id = p_message
     and sender_id = auth.uid()
     and created_at > now() - interval '10 minutes'
     and private.is_member(event_id, auth.uid())
     and private.may_post(event_id, auth.uid(), 'chat');
  if not found then
    raise exception 'This message can''t be edited any more' using errcode = '42501';
  end if;
  return stamped;
end;
$$;

revoke execute on function public.edit_message(uuid, text) from public, anon;
grant execute on function public.edit_message(uuid, text) to authenticated;

-- Someone who leaves or is removed loses what the host let them do, so it
-- doesn't come back if they rejoin later.
create or replace function private.drop_allowed_on_leave()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.event_allowed a
   where a.event_id = old.event_id and a.user_id = old.user_id;
  return old;
end;
$$;

revoke execute on function private.drop_allowed_on_leave() from public, anon, authenticated;

drop trigger if exists rsvps_drop_allowed on public.rsvps;
create trigger rsvps_drop_allowed
  after delete on public.rsvps
  for each row execute function private.drop_allowed_on_leave();
