-- ============================================================================
-- RollCal - Upload limits and videos
-- Run after policies.sql and bills.sql (it needs profiles.is_pro). Safe to
-- re-run. It owns the upload policy on the event-photos bucket.
--
-- How it works:
--   * What counts is what's in storage: the files you uploaded to event rolls
--     this calendar month (UTC). Deleting a file gives its space back.
--   * Free: 2 GB a month. Pro: 200 GB a month, and 1 TB stored in total.
--   * Once you're at your limit, storage refuses new uploads. The file that
--     takes you over is allowed, so nobody loses a half-finished upload.
--   * Videos are Pro only. A photos row takes its size and type from the
--     stored file itself, so the app can't under-report them.
--   * Each file is capped by the bucket's size limit (50 MB: the most the
--     Supabase Free plan allows; raise it with the plan).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- PHOTOS: what kind of file, and how big
-- ----------------------------------------------------------------------------
alter table public.photos add column if not exists kind text not null default 'photo';
alter table public.photos drop constraint if exists photos_kind_check;
alter table public.photos add constraint photos_kind_check check (kind in ('photo', 'video'));
alter table public.photos add column if not exists size_bytes bigint;
-- From the phone's picker; only used to show "0:42" on the tile.
alter table public.photos add column if not exists duration_ms integer
  check (duration_ms is null or duration_ms >= 0);

-- Older rows: fill in sizes from their files.
update public.photos p
   set size_bytes = (o.metadata->>'size')::bigint
  from storage.objects o
 where p.size_bytes is null
   and o.bucket_id = 'event-photos'
   and o.name = p.storage_path;


-- ----------------------------------------------------------------------------
-- THE BUCKET: images and the two video formats phones record, 50 MB each
-- ----------------------------------------------------------------------------
update storage.buckets
   set file_size_limit = 52428800,
       allowed_mime_types = array['image/*', 'video/mp4', 'video/quicktime']
 where id = 'event-photos';


-- ----------------------------------------------------------------------------
-- ALLOWANCE
-- ----------------------------------------------------------------------------

-- Everything about one person's uploads in one place: the app shows it,
-- the storage policy enforces it. Sizes in bytes.
create or replace function public.upload_allowance(uid uuid)
returns table (
  is_pro boolean,
  month_used bigint,
  month_limit bigint,
  stored bigint,
  stored_limit bigint
)
language sql stable security definer set search_path = public, storage as $$
  with me as (
    select coalesce((select p.is_pro from public.profiles p where p.id = uid), false) as pro
  ), files as (
    select (o.metadata->>'size')::bigint as size, o.created_at
      from storage.objects o
     where o.bucket_id = 'event-photos' and o.owner = uid
  )
  select
    me.pro,
    coalesce((select sum(size) from files where created_at >= date_trunc('month', now())), 0)::bigint,
    case when me.pro then 200 * 1024^3 else 2 * 1024^3 end::bigint,
    coalesce((select sum(size) from files), 0)::bigint,
    -- Free accounts have no total cap: their photos expire.
    case when me.pro then 1024^4 else null end::bigint
  from me;
$$;

-- The signed-in user's own allowance, for the app. Only ever their own.
create or replace function public.my_upload_allowance()
returns table (
  is_pro boolean,
  month_used bigint,
  month_limit bigint,
  stored bigint,
  stored_limit bigint
)
language sql stable security definer set search_path = public as $$
  select * from public.upload_allowance(auth.uid());
$$;

-- Whether the signed-in user is still under their allowance.
drop function if exists public.can_upload(uuid);
create or replace function public.can_upload()
returns boolean language sql stable security definer set search_path = public as $$
  select a.month_used < a.month_limit
     and (a.stored_limit is null or a.stored < a.stored_limit)
    from public.upload_allowance(auth.uid()) a;
$$;

revoke execute on function public.upload_allowance(uuid) from public, anon, authenticated;
revoke execute on function public.my_upload_allowance() from public, anon;
grant execute on function public.my_upload_allowance() to authenticated;
revoke execute on function public.can_upload() from public, anon;
grant execute on function public.can_upload() to authenticated;


-- ----------------------------------------------------------------------------
-- UPLOAD POLICY (replaces the one in policies.sql)
-- Members, into their own events, while they're under their allowance.
-- The 48-hour roll window is app logic.
-- ----------------------------------------------------------------------------
drop policy if exists "event_photos_upload_member" on storage.objects;
create policy "event_photos_upload_member" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'event-photos'
    and public.is_member(((storage.foldername(name))[1])::uuid, (select auth.uid()))
    and (select public.can_upload())
  );


-- ----------------------------------------------------------------------------
-- PHOTO ROWS: sized and typed from the stored file
-- A row must point at a file its uploader actually stored. Its size and kind
-- are read from that file, and a video needs Pro.
-- ----------------------------------------------------------------------------
create or replace function public.photos_from_file()
returns trigger language plpgsql security definer set search_path = public, storage as $$
declare
  f storage.objects%rowtype;
begin
  select * into f from storage.objects
   where bucket_id = 'event-photos' and name = new.storage_path;
  if not found or f.owner is distinct from new.uploader_id then
    raise exception 'That file isn''t yours to add' using errcode = '42501';
  end if;

  new.size_bytes := (f.metadata->>'size')::bigint;
  new.kind := case when f.metadata->>'mimetype' like 'video/%' then 'video' else 'photo' end;
  if new.kind <> 'video' then
    new.duration_ms := null;
  end if;

  if new.kind = 'video'
     and not coalesce((select is_pro from profiles where id = new.uploader_id), false) then
    raise exception 'Videos need RollCal Pro' using errcode = '42501', hint = 'video_pro';
  end if;
  return new;
end;
$$;

drop trigger if exists photos_from_file on public.photos;
create trigger photos_from_file
  before insert on public.photos
  for each row execute function public.photos_from_file();

revoke execute on function public.photos_from_file() from public, anon, authenticated;
