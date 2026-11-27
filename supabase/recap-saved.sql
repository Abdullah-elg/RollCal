-- Saved video recaps: the first person to make an event's video recap
-- uploads the finished .mp4, and everyone in the event plays and shares
-- that same file after, with no re-rendering. One per event per mode
-- ('highlights', 'all'). The file lives in R2 next to the event's photos
-- (<event>/recap-<mode>-<stamp>.mp4).
--
-- Stays honest with the photos: if any photo in the event is deleted or
-- hidden, or the event's photos expire, its saved recaps go too (a removed
-- photo must never live on inside a video), and the next person makes a
-- fresh one. A recap also records the photos it was made from
-- (signature), so the app remakes it when photos are added.
--
-- Run after media-r2.sql, plans.sql and recap-video.sql. Safe to re-run.

create table if not exists public.event_recaps (
  event_id uuid not null references public.events (id) on delete cascade,
  mode text not null check (mode in ('highlights', 'all')),
  signature text not null check (char_length(signature) between 1 and 200),
  storage_path text not null unique,
  size_bytes bigint not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (event_id, mode)
);

alter table public.event_recaps enable row level security;
revoke all on public.event_recaps from anon;
revoke all on public.event_recaps from authenticated;
grant select on public.event_recaps to authenticated;

drop policy if exists "event_recaps_select_member" on public.event_recaps;
create policy "event_recaps_select_member" on public.event_recaps
  for select to authenticated
  using (private.is_member(event_id, (select auth.uid())));

-- 1. Reserve the upload. Like reserve_media_upload, but for a recap: the
--    person must be allowed to make the event's video, it's always an mp4,
--    and the roll doesn't need to be open (recaps come after the event).
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

-- 2. Save it once the file has arrived (the media Worker confirmed it):
--    only your own finished recap upload for this event, and it replaces
--    the one before (whose file is then deleted).
create or replace function public.save_event_recap(p_event uuid, p_mode text, p_signature text, p_name text)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  obj public.media_objects%rowtype;
  old_path text;
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
  select r.storage_path into old_path from public.event_recaps r
   where r.event_id = p_event and r.mode = p_mode;
  insert into public.event_recaps (event_id, mode, signature, storage_path, size_bytes, created_by)
  values (p_event, p_mode, p_signature, p_name, obj.size_bytes, uid)
  on conflict (event_id, mode) do update
    set signature = excluded.signature, storage_path = excluded.storage_path,
        size_bytes = excluded.size_bytes, created_by = excluded.created_by, created_at = now();
  if old_path is not null and old_path <> p_name then
    delete from public.media_objects where bucket = 'event-photos' and name = old_path;
  end if;
end;
$$;

revoke execute on function public.save_event_recap(uuid, text, text, text) from public, anon;
grant execute on function public.save_event_recap(uuid, text, text, text) to authenticated;

-- 3. A recap row going takes its file with it (queued for R2 by the
--    media_objects delete trigger).
create or replace function private.event_recap_gone()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.media_objects m
   where m.bucket = 'event-photos' and m.name = old.storage_path;
  return old;
end;
$$;

revoke execute on function private.event_recap_gone() from public, anon, authenticated;

drop trigger if exists event_recaps_remove_media on public.event_recaps;
create trigger event_recaps_remove_media
  after delete on public.event_recaps
  for each row execute function private.event_recap_gone();

-- 4. A photo deleted or hidden (by its owner, the host, a report or
--    expiry) drops the event's saved recaps, so it never lives on in one.
create or replace function private.photo_drops_recaps()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    delete from public.event_recaps where event_id = old.event_id;
    return old;
  end if;
  if new.hidden_at is not null and old.hidden_at is null then
    delete from public.event_recaps where event_id = new.event_id;
  end if;
  return new;
end;
$$;

revoke execute on function private.photo_drops_recaps() from public, anon, authenticated;

drop trigger if exists photos_drop_recaps on public.photos;
create trigger photos_drop_recaps
  after delete or update of hidden_at on public.photos
  for each row execute function private.photo_drops_recaps();

-- 5. The daily clean-up of unused files must keep saved recaps.
create or replace function public.expire_media_reservations()
returns integer language sql volatile security definer set search_path = '' as $$
  with gone as (
    delete from public.media_objects m
     where (m.stored_at is null and m.created_at < now() - interval '1 hour')
        or (m.stored_at < now() - interval '1 day'
            and case m.bucket
                  when 'event-photos' then
                    not exists (select 1 from public.photos p where p.storage_path = m.name)
                    and not exists (select 1 from public.event_recaps r where r.storage_path = m.name)
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
