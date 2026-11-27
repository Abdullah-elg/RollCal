-- Wording only: the last three places the database says "roll" to people
-- now say "photos" / "event", matching the app. Each function below is its
-- live definition (taken from the database on 2026-11-24) with just that
-- text changed; nothing else differs. Safe to re-run.
--   photos_from_file      duplicate upload error
--   push_roll_openings    the "it's started" push
--   reserve_media_upload  "can't add" upload error

CREATE OR REPLACE FUNCTION public.photos_from_file()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  m public.media_objects%rowtype;
  f storage.objects%rowtype;
begin
  -- One row per file.
  if exists (select 1 from public.photos p where p.storage_path = new.storage_path) then
    raise exception 'That file is already in this event' using errcode = '23505';
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
$function$;

CREATE OR REPLACE FUNCTION public.push_roll_openings()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ev record;
  n integer := 0;
begin
  for ev in
    update events
       set roll_open_pushed_at = now()
     where roll_open_pushed_at is null
       and starts_at <= now()
       and starts_at > now() - interval '6 hours'
       and not coalesce(uploads_closed, false)
    returning id, title
  loop
    insert into push_outbox (user_id, kind, event_id, title, body, data)
    select p.user_id, 'albumOpen', ev.id, ev.title, 'It’s started. Add your photos.',
           jsonb_build_object('type', 'event', 'eventId', ev.id)
      from public.event_people(ev.id) p
     where p.rsvp is distinct from 'not_going';
    n := n + 1;
  end loop;
  return n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reserve_media_upload(p_bucket text, p_event uuid, p_content_type text, p_size bigint, p_thumb_size bigint DEFAULT 0)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      raise exception 'You can''t add photos to this event' using errcode = '42501';
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
$function$;
