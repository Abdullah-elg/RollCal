-- Photos, videos and profile photos in Cloudflare R2 (stage 3).
-- Run after plans.sql and host-reports.sql. Safe to re-run; re-run plans.sql
-- first if you re-run it, then this (this replaces some of its functions).
--
-- How it fits together:
--   * The media Worker (workers/media) is the only way into R2. It asks
--     reserve_media_upload, as the person uploading, for a file name; that
--     runs the same checks as the storage upload rule did (member, roll open,
--     room in the pool, videos on a paid tier). The file then goes through
--     the Worker, which checks its size and type and confirms it here.
--   * media_objects is the list of files in R2 with their sizes; storage
--     counts read it alongside storage.objects, so files still in Supabase
--     Storage (older builds, before the copy) keep counting.
--   * Deleting a photo, an event or an account deletes its media_objects
--     rows, which queues the files; the Worker deletes them from R2.
-- Older builds keep working against Supabase Storage until min_version is
-- raised.


-- ----------------------------------------------------------------------------
-- 1. THE FILES IN R2
-- ----------------------------------------------------------------------------
create table if not exists public.media_objects (
  bucket text not null check (bucket in ('event-photos', 'avatars')),
  -- "<event id>/<file>" or "<user id>/<file>", the same names as in Storage.
  name text not null,
  owner uuid not null references auth.users (id) on delete cascade,
  event_id uuid references public.events (id) on delete cascade,
  size_bytes bigint not null check (size_bytes > 0),
  -- The small preview at thumbs/<bucket>/<name>.jpg; 0 when there's none.
  thumb_bytes bigint not null default 0 check (thumb_bytes >= 0),
  content_type text not null,
  -- Set by the Worker once the file is really in R2; until then it's a
  -- reservation, which counts toward storage so uploads at once can't
  -- overshoot, and is cleared after an hour if never finished.
  stored_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (bucket, name),
  check ((bucket = 'event-photos') = (event_id is not null))
);

create index if not exists media_objects_event on public.media_objects (event_id);
create index if not exists media_objects_owner on public.media_objects (owner, bucket);
create index if not exists media_objects_pending on public.media_objects (created_at) where stored_at is null;

-- Nobody reads or writes it directly; only the functions below and the
-- Worker (service role).
alter table public.media_objects enable row level security;
revoke all on public.media_objects from anon, authenticated;


-- ----------------------------------------------------------------------------
-- 2. DELETION QUEUE: R2 files whose rows are gone
-- ----------------------------------------------------------------------------
create table if not exists private.media_deletions (
  id bigint generated always as identity primary key,
  bucket text not null,
  name text not null,
  has_thumb boolean not null,
  queued_at timestamptz not null default now(),
  claimed_at timestamptz
);

revoke all on private.media_deletions from public, anon, authenticated;

create or replace function private.queue_media_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.media_deletions (bucket, name, has_thumb)
  values (old.bucket, old.name, old.thumb_bytes > 0);
  return old;
end;
$$;

revoke execute on function private.queue_media_deletion() from public, anon, authenticated;

drop trigger if exists media_objects_queue_delete on public.media_objects;
create trigger media_objects_queue_delete
  after delete on public.media_objects
  for each row execute function private.queue_media_deletion();

-- A photo row going (its uploader, the host, a report, expiry, the event or
-- account being deleted) takes its R2 file with it. Hidden photos keep their
-- rows, so a file support is holding stays.
create or replace function private.photo_row_gone()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Only once no other row uses the file (a second row must never be a way
  -- to delete a file a hidden photo is holding).
  delete from public.media_objects m
   where m.bucket = 'event-photos' and m.name = old.storage_path
     and not exists (select 1 from public.photos p where p.storage_path = old.storage_path);
  return old;
end;
$$;

revoke execute on function private.photo_row_gone() from public, anon, authenticated;

drop trigger if exists photos_remove_media on public.photos;
create trigger photos_remove_media
  after delete on public.photos
  for each row execute function private.photo_row_gone();


-- ----------------------------------------------------------------------------
-- 3. STORAGE COUNTS: R2 files plus anything still only in Supabase Storage
-- Replaces the versions in plans.sql; same results while nothing is in R2.
-- ----------------------------------------------------------------------------
create or replace function private.event_bytes(eid uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select (
    coalesce((select sum(m.size_bytes + m.thumb_bytes) from public.media_objects m
               where m.event_id = eid), 0)
    + coalesce((select sum((o.metadata->>'size')::bigint) from storage.objects o
                 where o.bucket_id = 'event-photos'
                   and o.name collate "C" >= eid::text || '/'
                   and o.name collate "C" < eid::text || '0'
                   and not exists (select 1 from public.media_objects m
                                    where m.bucket = 'event-photos' and m.name = o.name)), 0)
  )::bigint;
$$;

revoke execute on function private.event_bytes(uuid) from public, anon, authenticated;

create or replace function private.pool_bytes(uid uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  with files as (
    select m.event_id::text as folder, m.size_bytes + m.thumb_bytes as bytes
      from public.media_objects m
     where m.owner = uid and m.bucket = 'event-photos'
    union all
    select (storage.foldername(o.name))[1], (o.metadata->>'size')::bigint
      from storage.objects o
     where o.bucket_id = 'event-photos' and o.owner = uid
       and not exists (select 1 from public.media_objects m
                        where m.bucket = 'event-photos' and m.name = o.name)
  ), mine as (
    select folder, sum(bytes) as bytes from files group by folder
  )
  select (
    coalesce((
      select sum(m.bytes) from mine m
       where case
               when m.folder ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               then private.event_tier(m.folder::uuid) is null
               else true
             end
    ), 0)
    + case when private.effective_plan(uid) <> 'free' then coalesce((
        select sum(private.event_bytes(e.id)) from public.events e where e.creator_id = uid
      ), 0) else 0 end
  )::bigint;
$$;

revoke execute on function private.pool_bytes(uuid) from public, anon, authenticated;

create or replace function private.guest_event_bytes(eid uuid, uid uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select (
    coalesce((select sum(m.size_bytes + m.thumb_bytes) from public.media_objects m
               where m.event_id = eid and m.owner = uid), 0)
    + coalesce((select sum((o.metadata->>'size')::bigint) from storage.objects o
                 where o.bucket_id = 'event-photos'
                   and o.name collate "C" >= eid::text || '/'
                   and o.name collate "C" < eid::text || '0'
                   and o.owner = uid
                   and not exists (select 1 from public.media_objects m
                                    where m.bucket = 'event-photos' and m.name = o.name)), 0)
  )::bigint;
$$;

revoke execute on function private.guest_event_bytes(uuid, uuid) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 4. ADDING A PHOTO ROW: the file can be in R2 or (older builds) Storage
-- Same as plans.sql otherwise.
-- ----------------------------------------------------------------------------
create or replace function public.photos_from_file()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  m public.media_objects%rowtype;
  f storage.objects%rowtype;
begin
  -- One row per file.
  if exists (select 1 from public.photos p where p.storage_path = new.storage_path) then
    raise exception 'That file is already in the roll' using errcode = '23505';
  end if;
  select * into m from public.media_objects
   where bucket = 'event-photos' and name = new.storage_path;
  if found then
    if m.owner is distinct from new.uploader_id or m.event_id is distinct from new.event_id
       or m.stored_at is null then
      raise exception 'That file isn''t yours to add' using errcode = '42501';
    end if;
    new.size_bytes := m.size_bytes;
    new.kind := case when m.content_type like 'video/%' then 'video' else 'photo' end;
  else
    select * into f from storage.objects
     where bucket_id = 'event-photos' and name = new.storage_path;
    if not found or f.owner is distinct from new.uploader_id then
      raise exception 'That file isn''t yours to add' using errcode = '42501';
    end if;
    new.size_bytes := (f.metadata->>'size')::bigint;
    new.kind := case when f.metadata->>'mimetype' like 'video/%' then 'video' else 'photo' end;
  end if;

  if new.kind <> 'video' then
    new.duration_ms := null;
  end if;
  if new.kind = 'video' and private.upload_tier(new.event_id, new.uploader_id) = 'free' then
    raise exception 'Videos need RollCal Plus' using errcode = '42501', hint = 'video_pro';
  end if;
  return new;
end;
$$;

revoke execute on function public.photos_from_file() from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 5. RESERVING AN UPLOAD (the Worker calls this as the person uploading)
-- Returns the file name to upload to. The name is made here, never taken
-- from the app, so it can't land in another event's folder or overwrite
-- someone's file.
-- ----------------------------------------------------------------------------
create or replace function public.reserve_media_upload(
  p_bucket text,
  p_event uuid,
  p_content_type text,
  p_size bigint,
  p_thumb_size bigint default 0
)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  ext text;
  max_bytes bigint;
  new_name text;
  stamp text := (extract(epoch from clock_timestamp()) * 1000)::bigint::text;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;

  ext := case p_content_type
    when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
    when 'image/heic' then 'heic' when 'image/heif' then 'heif' when 'image/gif' then 'gif'
    when 'video/mp4' then 'mp4' when 'video/quicktime' then 'mov'
  end;
  if ext is null
     or (p_bucket = 'avatars' and p_content_type not in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'))
     or p_bucket not in ('event-photos', 'avatars') then
    raise exception 'That kind of file can''t be uploaded' using errcode = '22023';
  end if;

  max_bytes := case p_bucket when 'avatars' then 5 * 1024 * 1024 else 50 * 1024 * 1024 end;
  if p_size is null or p_size <= 0 or p_size > max_bytes
     or coalesce(p_thumb_size, 0) < 0 or coalesce(p_thumb_size, 0) > 1024 * 1024 then
    raise exception 'That file is too big' using errcode = '22023', hint = 'too_big';
  end if;

  -- A few uploads at once is normal; hundreds unfinished is not.
  perform pg_advisory_xact_lock(hashtext('media-user:' || uid::text));
  if (select count(*) from public.media_objects
       where owner = uid and stored_at is null and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many uploads at once' using errcode = '42501', hint = 'busy';
  end if;

  if p_bucket = 'event-photos' then
    if p_event is null or not private.is_member(p_event, uid) or not private.roll_open(p_event) then
      raise exception 'You can''t add to this roll' using errcode = '42501';
    end if;
    -- One reservation at a time per pool, so uploads at once can't all
    -- see the same room left.
    perform pg_advisory_xact_lock(hashtext('media-pool:' || coalesce(
      (select case when private.event_tier(p_event) is not null
                   then (select e.creator_id::text from public.events e where e.id = p_event)
                   else uid::text end), uid::text)));
    perform pg_advisory_xact_lock(hashtext('media-event:' || p_event::text));
    if not private.can_upload_to(p_event) or exists (
      select 1 from private.upload_pool_for(p_event, uid) p
       where p.stored + p_size + coalesce(p_thumb_size, 0) > p.stored_limit
          or (p.guest_limit is not null
              and p.guest_stored + p_size + coalesce(p_thumb_size, 0) > p.guest_limit)
    ) then
      raise exception 'Storage is full' using errcode = '42501', hint = 'limit';
    end if;
    if p_content_type like 'video/%' and private.upload_tier(p_event, uid) = 'free' then
      raise exception 'Videos need RollCal Plus' using errcode = '42501', hint = 'video_pro';
    end if;
    new_name := p_event::text || '/' || stamp || '-' || substr(md5(random()::text), 1, 8) || '.' || ext;
  else
    if p_event is not null then
      raise exception 'Profile photos don''t belong to an event' using errcode = '22023';
    end if;
    if (select count(*) from public.media_objects where owner = uid and bucket = 'avatars') >= 5 then
      raise exception 'Too many profile photos' using errcode = '42501', hint = 'limit';
    end if;
    new_name := uid::text || '/' || stamp || '-' || substr(md5(random()::text), 1, 8) || '.' || ext;
  end if;

  insert into public.media_objects (bucket, name, owner, event_id, size_bytes, thumb_bytes, content_type)
  values (p_bucket, new_name, uid, case when p_bucket = 'event-photos' then p_event end,
          p_size, coalesce(p_thumb_size, 0), p_content_type);
  return new_name;
end;
$$;

revoke execute on function public.reserve_media_upload(text, uuid, text, bigint, bigint) from public, anon;
grant execute on function public.reserve_media_upload(text, uuid, text, bigint, bigint) to authenticated;


-- ----------------------------------------------------------------------------
-- 6. WORKER ONLY (service role): confirm, read the reservation, clean up
-- ----------------------------------------------------------------------------

-- The reservation the Worker is about to fill: who made it and what it allows.
create or replace function public.media_reservation(p_bucket text, p_name text)
returns table (owner uuid, size_bytes bigint, thumb_bytes bigint, content_type text, stored boolean)
language sql stable security definer set search_path = '' as $$
  select m.owner, m.size_bytes, m.thumb_bytes, m.content_type, m.stored_at is not null
    from public.media_objects m
   where m.bucket = p_bucket and m.name = p_name;
$$;

-- The file (and its preview, if any) is in R2 at these sizes.
create or replace function public.confirm_media_upload(
  p_bucket text, p_name text, p_size bigint, p_thumb_size bigint
)
returns boolean
language sql volatile security definer set search_path = '' as $$
  update public.media_objects
     set stored_at = now(), size_bytes = p_size, thumb_bytes = coalesce(p_thumb_size, 0)
   where bucket = p_bucket and name = p_name and stored_at is null
  returning true;
$$;

-- Up to n queued deletions, each handed out once (again after 10 minutes if
-- the Worker never finished it).
create or replace function public.claim_media_deletions(n integer default 200)
returns table (id bigint, bucket text, name text, has_thumb boolean)
language sql volatile security definer set search_path = '' as $$
  update private.media_deletions d
     set claimed_at = now()
   where d.id in (
     select x.id from private.media_deletions x
      where x.claimed_at is null or x.claimed_at < now() - interval '10 minutes'
      order by x.id
      limit greatest(1, least(n, 1000))
      for update skip locked
   )
  returning d.id, d.bucket, d.name, d.has_thumb;
$$;

create or replace function public.finish_media_deletions(ids bigint[])
returns void language sql volatile security definer set search_path = '' as $$
  delete from private.media_deletions where id = any (ids);
$$;

-- Reservations never finished within the hour, and files nothing uses a day
-- after they arrived (the app stopped between uploading and saving the photo
-- or profile): drop them, which queues them for deletion from R2.
create or replace function public.expire_media_reservations()
returns integer language sql volatile security definer set search_path = '' as $$
  with gone as (
    delete from public.media_objects m
     where (m.stored_at is null and m.created_at < now() - interval '1 hour')
        or (m.stored_at < now() - interval '1 day'
            and case m.bucket
                  when 'event-photos' then
                    not exists (select 1 from public.photos p where p.storage_path = m.name)
                  else
                    -- avatar_url is the name, or (older rows) a full address ending in it.
                    not exists (select 1 from public.profiles p
                                 where p.id = m.owner
                                   and (p.avatar_url = m.name
                                        or strpos(p.avatar_url, '/avatars/' || m.name) > 0))
                end)
    returning 1
  )
  select count(*)::integer from gone;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.media_reservation(text, text)',
    'public.confirm_media_upload(text, text, bigint, bigint)',
    'public.claim_media_deletions(integer)',
    'public.finish_media_deletions(bigint[])',
    'public.expire_media_reservations()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;


-- ----------------------------------------------------------------------------
-- 7. VIEWING: which of these files may this person see (the Worker asks as
-- them). The same rules as Storage: event photos for the event's members,
-- except hidden ones; profile photos for yourself and your friends.
-- in_r2 false: not copied to R2 yet, so the app asks Storage instead.
-- ----------------------------------------------------------------------------
create or replace function public.readable_media(p_bucket text, p_names text[])
returns table (name text, has_thumb boolean, in_r2 boolean)
language sql stable security definer set search_path = '' as $$
  select n.name, coalesce(m.thumb_bytes > 0, false), m.stored_at is not null
    from (select distinct unnest(p_names[1:200]) as name) n
    left join public.media_objects m on m.bucket = p_bucket and m.name = n.name
   where auth.uid() is not null
     and split_part(n.name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and case p_bucket
           when 'event-photos' then
             private.is_member(split_part(n.name, '/', 1)::uuid, auth.uid())
             and not private.photo_file_held(n.name)
           when 'avatars' then
             split_part(n.name, '/', 1) = auth.uid()::text
             or private.are_friends(auth.uid(), split_part(n.name, '/', 1)::uuid)
           else false
         end;
$$;

revoke execute on function public.readable_media(text, text[]) from public, anon;
grant execute on function public.readable_media(text, text[]) to authenticated;


-- ----------------------------------------------------------------------------
-- 8. PROFILE PHOTOS: drop your older ones once a new one is saved
-- ----------------------------------------------------------------------------
create or replace function public.remove_old_avatars(p_keep text)
returns void language sql volatile security definer set search_path = '' as $$
  delete from public.media_objects
   where bucket = 'avatars' and owner = auth.uid() and name is distinct from p_keep;
$$;

revoke execute on function public.remove_old_avatars(text) from public, anon;
grant execute on function public.remove_old_avatars(text) to authenticated;

-- An upload whose photo row was refused (a video on Basic, say): the app
-- throws the file away so it stops counting. Only your own, and only while
-- no photo uses it.
create or replace function public.discard_media(p_bucket text, p_name text)
returns void language sql volatile security definer set search_path = '' as $$
  delete from public.media_objects m
   where m.bucket = p_bucket and m.name = p_name and m.owner = auth.uid()
     and not exists (select 1 from public.photos p where p.storage_path = m.name);
$$;

revoke execute on function public.discard_media(text, text) from public, anon;
grant execute on function public.discard_media(text, text) to authenticated;
