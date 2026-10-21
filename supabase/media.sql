-- ============================================================================
-- RollCal - Upload limits and videos
-- Run after policies.sql and bills.sql (it needs profiles.is_pro). Safe to
-- re-run, before or after private-schema.sql. It owns the upload policy on
-- the event-photos bucket.
--
-- How it works:
--   * What counts is what's in storage: every file you've uploaded to event
--     rolls that's still there. Deleting a file, or photos expiring, gives
--     its space back.
--   * Free: 2 GB in total. Pro: 200 GB in total.
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

-- Everything about one person's storage in one place: the app shows it,
-- the storage policy enforces it. Sizes in bytes. The result's shape changed
-- from the monthly version, so the old functions are dropped first.
drop function if exists public.my_upload_allowance();
drop function if exists public.upload_allowance(uuid);

create function public.upload_allowance(uid uuid)
returns table (
  is_pro boolean,
  stored bigint,
  stored_limit bigint
)
language sql stable security definer set search_path = public, storage as $$
  with me as (
    select coalesce((select p.is_pro from public.profiles p where p.id = uid), false) as pro
  )
  select
    me.pro,
    coalesce((select sum((o.metadata->>'size')::bigint)
                from storage.objects o
               where o.bucket_id = 'event-photos' and o.owner = uid), 0)::bigint,
    case when me.pro then 200 * 1024^3 else 2 * 1024^3 end::bigint
  from me;
$$;

-- The signed-in user's own allowance, for the app. Only ever their own.
create function public.my_upload_allowance()
returns table (
  is_pro boolean,
  stored bigint,
  stored_limit bigint
)
language sql stable security definer set search_path = public as $$
  select * from public.upload_allowance(auth.uid());
$$;

revoke execute on function public.upload_allowance(uuid) from public, anon, authenticated;
revoke execute on function public.my_upload_allowance() from public, anon;
grant execute on function public.my_upload_allowance() to authenticated;


-- ----------------------------------------------------------------------------
-- UPLOAD POLICY (replaces the one in policies.sql)
-- Members, into their own events, while they have room. The 48-hour roll
-- window is app logic. The helpers live in public on a fresh setup and in
-- private once private-schema.sql has run, so this uses whichever is there.
-- ----------------------------------------------------------------------------
do $$
declare
  sch text := case when to_regprocedure('private.is_member(uuid, uuid)') is not null
                   then 'private' else 'public' end;
begin
  if sch = 'public' then
    drop function if exists public.can_upload(uuid);
  end if;
  -- Whether the signed-in user still has room.
  execute format($f$
    create or replace function %I.can_upload()
    returns boolean language sql stable security definer set search_path = public as $b$
      select a.stored < a.stored_limit
        from public.upload_allowance(auth.uid()) a;
    $b$
  $f$, sch);
  execute format('revoke execute on function %I.can_upload() from public, anon', sch);
  execute format('grant execute on function %I.can_upload() to authenticated', sch);

  drop policy if exists "event_photos_upload_member" on storage.objects;
  execute format($p$
    create policy "event_photos_upload_member" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'event-photos'
        and %1$I.is_member(((storage.foldername(name))[1])::uuid, (select auth.uid()))
        and (select %1$I.can_upload())
      )$p$, sch);
end $$;


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
