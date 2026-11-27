-- Web guests (feature D): people who open an invite link in a browser and
-- join without the app, as a Supabase anonymous user. They may only see the
-- events they joined and see and add photos there. Run after media-r2.sql.
-- Safe to re-run; re-run it after adding a table to public.
--
-- Three layers, so one mistake isn't enough:
--   1. guest_gate runs before every Data API request and refuses anything a
--      guest isn't on the allowlist for (new tables and functions included).
--   2. Blocking policies on every public table, and on Storage, for what the
--      gate doesn't cover (Realtime, Storage, functions run as the guest).
--   3. Limits where guests do write: photos per event, their profile fields.
-- A guest is a signed-in user whose token says is_anonymous; Supabase sets
-- that and it can't be changed by the guest.


-- ----------------------------------------------------------------------------
-- 1. WHO IS A GUEST
-- ----------------------------------------------------------------------------
create or replace function private.is_guest()
returns boolean language sql stable set search_path = '' as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;

revoke execute on function private.is_guest() from public;
grant execute on function private.is_guest() to anon, authenticated, service_role;

-- Profiles say who's a guest, so the app can show "(guest)". Set from the
-- account itself, never from what the app sends.
alter table public.profiles add column if not exists is_guest boolean not null default false;

create or replace function private.profile_guest_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.is_guest := coalesce(
    (select u.is_anonymous from auth.users u where u.id = new.id), false);
  -- A guest has a name and nothing else: a made-up username (usernames are
  -- required) they can't change, and no photo.
  if new.is_guest then
    new.username := case when tg_op = 'UPDATE' then old.username
                         else 'guest-' || substr(md5(new.id::text), 1, 10) end;
    new.avatar_url := case when tg_op = 'UPDATE' then old.avatar_url end;
    if char_length(trim(coalesce(new.display_name, ''))) not between 1 and 40 then
      raise exception 'Add your name (up to 40 letters)' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.profile_guest_rules() from public, anon, authenticated;

drop trigger if exists profiles_guest_rules on public.profiles;
create trigger profiles_guest_rules
  before insert or update on public.profiles
  for each row execute function private.profile_guest_rules();


-- ----------------------------------------------------------------------------
-- 2. THE GATE: every Data API request from a guest must be on this list
-- ----------------------------------------------------------------------------
create or replace function public.guest_gate()
returns void language plpgsql stable set search_path = '' as $$
declare
  path text := regexp_replace(coalesce(current_setting('request.path', true), ''), '^/rest/v1', '');
  method text := upper(coalesce(current_setting('request.method', true), ''));
  allowed boolean;
begin
  -- Read straight from the token: this runs for signed-out requests too, and
  -- they have no access to the private schema.
  if not coalesce(
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean,
    false
  ) then
    return;
  end if;
  if method = 'HEAD' then
    method := 'GET';
  end if;
  allowed := case
    when path like '/rpc/%' then
      method in ('GET', 'POST') and substr(path, 6) = any (array[
        'get_event_by_code', 'join_event', 'event_plan', 'photos_expire_at',
        'my_upload_rules', 'upload_allowance_for', 'hidden_people',
        'reserve_media_upload', 'readable_media', 'discard_media'
      ])
    when path = '/events' then method = 'GET'
    when path = '/photos' then method in ('GET', 'POST', 'DELETE')
    when path = '/profiles' then method in ('GET', 'POST', 'PATCH')
    when path = '/rsvps' then method = 'GET'
    when path = '/reports' then method = 'POST'
    when path = '/app_config' then method = 'GET'
    else false
  end;
  if not allowed then
    raise exception 'Guests can only see and add photos. Get the app to do more.'
      using errcode = '42501', hint = 'guest';
  end if;
end;
$$;

revoke execute on function public.guest_gate() from public;
grant execute on function public.guest_gate() to anon, authenticated, service_role;

alter role authenticator set pgrst.db_pre_request = 'public.guest_gate';
notify pgrst, 'reload config';


-- ----------------------------------------------------------------------------
-- 3. BLOCKING POLICIES: on every public table, everything a guest isn't
-- allowed, as restrictive policies (they only ever take access away).
-- ----------------------------------------------------------------------------
do $$
declare
  allowed jsonb := '{
    "events":     ["select"],
    "photos":     ["select", "insert", "delete"],
    "profiles":   ["select", "insert", "update"],
    "rsvps":      ["select"],
    "reports":    ["insert"],
    "app_config": ["select"]
  }';
  t text;
  cmd text;
  name text;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    foreach cmd in array array['select', 'insert', 'update', 'delete'] loop
      name := 'guests_no_' || cmd;
      execute format('drop policy if exists %I on public.%I', name, t);
      if not coalesce((allowed -> t) ? cmd, false) then
        if cmd = 'insert' then
          execute format(
            'create policy %I on public.%I as restrictive for insert to authenticated with check (not (select private.is_guest()))',
            name, t);
        else
          execute format(
            'create policy %I on public.%I as restrictive for %s to authenticated using (not (select private.is_guest()))',
            name, t, cmd);
        end if;
      end if;
    end loop;
  end loop;
end $$;

-- Profiles are readable by everyone signed in; a guest sees only their own
-- and the people they share an event with.
create or replace function private.guest_can_see_profile(p uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p = auth.uid()
      or exists (
        select 1 from public.rsvps mine
          join public.rsvps theirs on theirs.event_id = mine.event_id
         where mine.user_id = auth.uid() and theirs.user_id = p)
      or exists (
        select 1 from public.rsvps mine
          join public.events e on e.id = mine.event_id
         where mine.user_id = auth.uid() and e.creator_id = p);
$$;

revoke execute on function private.guest_can_see_profile(uuid) from public, anon;
grant execute on function private.guest_can_see_profile(uuid) to authenticated;

drop policy if exists "guests_profiles_select" on public.profiles;
create policy "guests_profiles_select" on public.profiles
  as restrictive for select to authenticated
  using (not (select private.is_guest()) or private.guest_can_see_profile(id));

-- Storage (older files, and builds that still upload there): guests read
-- what members read, but never write.
drop policy if exists "guests_no_storage_insert" on storage.objects;
create policy "guests_no_storage_insert" on storage.objects
  as restrictive for insert to authenticated with check (not (select private.is_guest()));
drop policy if exists "guests_no_storage_update" on storage.objects;
create policy "guests_no_storage_update" on storage.objects
  as restrictive for update to authenticated using (not (select private.is_guest()));
drop policy if exists "guests_no_storage_delete" on storage.objects;
create policy "guests_no_storage_delete" on storage.objects
  as restrictive for delete to authenticated using (not (select private.is_guest()));


-- ----------------------------------------------------------------------------
-- 4. GUEST UPLOADS: event photos only, at most 100 (and 500 MB) per event
-- reserve_media_upload runs as the guest, so this sees their token.
-- ----------------------------------------------------------------------------
create or replace function private.media_guest_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.is_guest() then
    if new.bucket <> 'event-photos' or new.content_type not like 'image/%' then
      raise exception 'Guests can only add photos' using errcode = '42501', hint = 'guest';
    end if;
    -- 100 photos and 500 MB per event, so a guest can't fill the host's room.
    if (select count(*) >= 100 or coalesce(sum(m.size_bytes + m.thumb_bytes), 0) + new.size_bytes > 500 * 1024 * 1024
          from public.media_objects m
         where m.owner = new.owner and m.event_id = new.event_id) then
      raise exception 'You''ve added as many photos to this event as a guest can'
        using errcode = '42501', hint = 'limit';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.media_guest_guard() from public, anon, authenticated;

drop trigger if exists media_objects_guest_guard on public.media_objects;
create trigger media_objects_guest_guard
  before insert on public.media_objects
  for each row execute function private.media_guest_guard();


-- ----------------------------------------------------------------------------
-- 4b. GUEST REPORTS: only photos in their events, and the daily cap counts
-- them (it counted with the guest's own view, which can't see their reports).
-- ----------------------------------------------------------------------------
drop policy if exists "guests_reports_insert" on public.reports;
create policy "guests_reports_insert" on public.reports
  as restrictive for insert to authenticated
  with check (
    not (select private.is_guest())
    or (target_type = 'photo' and exists (
      select 1 from public.photos p
       where p.id::text = target_id::text and private.is_member(p.event_id, auth.uid())))
  );

-- Same as safety.sql, run as the owner so the count sees every report.
create or replace function public.reports_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from reports
       where reporter_id = new.reporter_id and created_at > now() - interval '1 day') >= 20 then
    raise exception 'Too many reports today' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.reports_limit() from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 4c. NO EMAIL FOR GUESTS: adding an email to a guest account would make
-- sign-in send mail to any address someone types. Guests stay guests.
-- ----------------------------------------------------------------------------
create or replace function private.guest_no_email()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.is_anonymous and (
       new.email is distinct from old.email
       or new.email_change is distinct from old.email_change
       or new.phone is distinct from old.phone
       or new.phone_change is distinct from old.phone_change) then
    raise exception 'Guests can’t add an email. Get the app to make an account.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function private.guest_no_email() from public, anon, authenticated;

drop trigger if exists guest_no_email on auth.users;
create trigger guest_no_email
  before update on auth.users
  for each row execute function private.guest_no_email();


-- ----------------------------------------------------------------------------
-- 5. TIDYING UP: a guest account goes once it's a week old, has no photos,
-- and isn't in (or waiting for) an event that's still on or ended within the
-- week. Ones with photos stay while their photos do.
-- ----------------------------------------------------------------------------
create or replace function private.prune_guests()
returns integer language sql volatile security definer set search_path = '' as $$
  with gone as (
    delete from auth.users u
     where u.is_anonymous
       and u.created_at < now() - interval '7 days'
       and not exists (select 1 from public.photos p where p.uploader_id = u.id)
       and not exists (select 1 from public.media_objects m where m.owner = u.id)
       and not exists (
         select 1 from public.rsvps r join public.events e on e.id = r.event_id
          where r.user_id = u.id and e.ends_at > now() - interval '7 days')
       and not exists (
         select 1 from public.event_join_requests j join public.events e on e.id = j.event_id
          where j.user_id = u.id and e.ends_at > now() - interval '7 days')
    returning 1
  )
  select count(*)::integer from gone;
$$;

revoke execute on function private.prune_guests() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'guests-prune';
select cron.schedule('guests-prune', '53 4 * * *', 'select private.prune_guests()');
