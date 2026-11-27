-- Security fixes before the beta build (review of 2026-11-27).
--
-- 1. Recap uploads now count against storage like any other upload, and
--    each person can only have a few unsaved recap files per event a day.
--    (Before, finished recap files stopped counting toward any limit.)
-- 2. A recap file can't be added to the roll as a normal video, so it
--    can't get around the storage pool or the 50 MB video limit.
-- 3. Only the host, or the person who made it, can replace an event's
--    saved recap. Anyone allowed can still make the first one, and a
--    refused save doesn't stop them sharing their own copy.
--
-- Safe to run more than once.

-- 1. Reserve a recap upload, with the storage check and a daily cap.
create or replace function public.reserve_recap_upload(p_event uuid, p_mode text, p_size bigint)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  new_name text;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_mode not in ('highlights', 'all') then
    raise exception 'Bad recap' using errcode = '22023';
  end if;
  if not public.recap_video_allowed(p_event) then
    raise exception 'Video recaps come with Plus or an Event Pass' using errcode = '42501', hint = 'recap_locked';
  end if;
  if p_size is null or p_size <= 0 or p_size > 150 * 1024 * 1024 then
    raise exception 'That file is too big' using errcode = '22023', hint = 'too_big';
  end if;
  perform pg_advisory_xact_lock(hashtext('media-user:' || uid::text));
  if (select count(*) from public.media_objects
       where owner = uid and stored_at is null and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many uploads at once' using errcode = '42501', hint = 'busy';
  end if;
  -- Recap files you made for this event in the last day that aren't the
  -- event's saved recap: at most 3 (one per try, with room for a retry).
  if (select count(*) from public.media_objects m
       where m.owner = uid and m.event_id = p_event
         and m.name like p_event::text || '/recap-%'
         and m.created_at > now() - interval '1 day'
         and not exists (select 1 from public.event_recaps r where r.storage_path = m.name)) >= 3 then
    raise exception 'Too many recaps today' using errcode = '42501', hint = 'busy';
  end if;
  -- The same storage check as photo and video uploads, one at a time per pool.
  perform pg_advisory_xact_lock(hashtext('media-pool:' || coalesce(
    (select case when private.event_tier(p_event) is not null
                 then (select e.creator_id::text from public.events e where e.id = p_event)
                 else uid::text end), uid::text)));
  perform pg_advisory_xact_lock(hashtext('media-event:' || p_event::text));
  if exists (
    select 1 from private.upload_pool_for(p_event, uid) p
     where p.stored + p_size > p.stored_limit
        or (p.guest_limit is not null and p.guest_stored + p_size > p.guest_limit)
  ) then
    raise exception 'Storage is full' using errcode = '42501', hint = 'limit';
  end if;
  new_name := p_event::text || '/recap-' || p_mode || '-'
    || (extract(epoch from clock_timestamp()) * 1000)::bigint::text || '-'
    || substr(md5(random()::text), 1, 8) || '.mp4';
  insert into public.media_objects (bucket, name, owner, event_id, size_bytes, thumb_bytes, content_type)
  values ('event-photos', new_name, uid, p_event, p_size, 0, 'video/mp4');
  return new_name;
end;
$$;

revoke execute on function public.reserve_recap_upload(uuid, text, bigint) from public, anon;
grant execute on function public.reserve_recap_upload(uuid, text, bigint) to authenticated;

-- 2. Recap files never become roll photos.
create or replace function private.photos_no_recap_files()
returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.storage_path like '%/recap-%' then
    raise exception 'That file isn''t yours to add' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function private.photos_no_recap_files() from public, anon, authenticated;

drop trigger if exists photos_no_recap_files on public.photos;
create trigger photos_no_recap_files
  before insert or update of storage_path on public.photos
  for each row execute function private.photos_no_recap_files();

-- 3. Save a finished recap; replacing one needs the host or its maker.
create or replace function public.save_event_recap(p_event uuid, p_mode text, p_signature text, p_name text)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  obj public.media_objects%rowtype;
  old public.event_recaps%rowtype;
begin
  if uid is null or not public.recap_video_allowed(p_event) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into obj from public.media_objects m
   where m.bucket = 'event-photos' and m.name = p_name and m.owner = uid
     and m.event_id = p_event and m.stored_at is not null and m.content_type = 'video/mp4'
     and m.name like p_event::text || '/recap-' || p_mode || '-%';
  if not found then
    raise exception 'No such recap upload' using errcode = '22023';
  end if;
  select * into old from public.event_recaps r
   where r.event_id = p_event and r.mode = p_mode;
  if found and old.created_by is distinct from uid
     and not exists (select 1 from public.events e where e.id = p_event and e.creator_id = uid) then
    raise exception 'Only the host can replace this recap' using errcode = '42501';
  end if;
  insert into public.event_recaps (event_id, mode, signature, storage_path, size_bytes, created_by)
  values (p_event, p_mode, p_signature, p_name, obj.size_bytes, uid)
  on conflict (event_id, mode) do update
    set signature = excluded.signature, storage_path = excluded.storage_path,
        size_bytes = excluded.size_bytes, created_by = excluded.created_by, created_at = now();
  if old.storage_path is not null and old.storage_path <> p_name then
    delete from public.media_objects where bucket = 'event-photos' and name = old.storage_path;
  end if;
end;
$$;

revoke execute on function public.save_event_recap(uuid, text, text, text) from public, anon;
grant execute on function public.save_event_recap(uuid, text, text, text) to authenticated;

