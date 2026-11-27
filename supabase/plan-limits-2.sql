-- Plan limits, phase 2 (docs/MONETIZATION.md, docs/PLANS.md):
--   * storage for an event that's premium only through an Event Pass, by
--     tier: Party 10 GB, Big Day 30 GB, Unlimited 60 GB (fair use). An event
--     kept forever without a pass keeps its 20 GB. Plus and Pro hosts use
--     their own pools, as before.
--   * free accounts can add short videos: up to 15 seconds (and 25 MB).
--     Longer ones still need Plus or an Event Pass.
--   * "your event is full": the host gets one push a day per event when
--     someone tries to join a full event (guests are never asked to pay).
-- Run after plans.sql, media-r2.sql and plan-limits.sql. Safe to re-run.

-- 1. The event's own pool, by pass tier.
create or replace function private.event_pool_limit(eid uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select (case (select p.tier from public.event_passes p where p.event_id = eid)
            when 'unlimited' then 60
            when 'big_day' then 30
            when 'party' then 10
            else 20
          end * 1024::bigint ^ 3)::bigint;
$$;

revoke execute on function private.event_pool_limit(uuid) from public, anon, authenticated;

create or replace function private.upload_pool(eid uuid, uid uuid)
returns table (pool text, stored bigint, stored_limit bigint)
language sql stable security definer set search_path = '' as $$
  with ev as (
    select private.event_tier(eid) as tier,
           (select e.creator_id from public.events e where e.id = eid) as host
  ), h as (
    select ev.*, private.effective_plan(ev.host) as host_plan from ev
  )
  select 'host'::text, private.pool_bytes(h.host), private.plan_storage_limit(h.host_plan)
    from h where h.tier is not null and h.host_plan <> 'free'
  union all
  select 'event'::text, private.event_bytes(eid), private.event_pool_limit(eid)
    from h where h.tier is not null and h.host_plan = 'free'
  union all
  select 'you'::text, private.pool_bytes(uid), private.plan_storage_limit(private.effective_plan(uid))
    from h where h.tier is null;
$$;

-- 2. Short videos on free accounts.
create or replace function private.free_video_ok(p_size bigint, p_duration_ms integer)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_size, 0) > 0 and p_size <= 25 * 1024 * 1024
     and (p_duration_ms is null or p_duration_ms <= 15500);
$$;

revoke execute on function private.free_video_ok(bigint, integer) from public, anon, authenticated;

-- Same as media-r2.sql's, with the video check allowing short free videos.
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
    -- Free: short videos only (the length is checked again when it's added).
    if p_content_type like 'video/%' and private.upload_tier(p_event, uid) = 'free'
       and not private.free_video_ok(p_size, null) then
      raise exception 'Videos over 15 seconds need Plus or an Event Pass' using errcode = '42501', hint = 'video_pro';
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

-- Same as the live one, with free videos allowed when short. A free video
-- must say how long it is.
create or replace function public.photos_from_file()
returns trigger language plpgsql security definer set search_path = '' as $$
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
  if new.kind = 'video' and private.upload_tier(new.event_id, new.uploader_id) = 'free'
     and (new.duration_ms is null or not private.free_video_ok(new.size_bytes, new.duration_ms)) then
    raise exception 'Videos over 15 seconds need Plus or an Event Pass' using errcode = '42501', hint = 'video_pro';
  end if;
  return new;
end;
$$;

-- 3a. The push outbox learns the new kind.
alter table public.push_outbox drop constraint if exists push_outbox_kind_check;
alter table public.push_outbox add constraint push_outbox_kind_check check (kind = any (array[
  'friendRequest', 'friendAccepted', 'chatMessage', 'albumOpen', 'joinRequest',
  'joinApproved', 'eventDeleting', 'hostReport', 'eventFull'
]::text[]));

-- 3. "Your event is full": someone just couldn't join. One push a day per
--    event to the host, and only when the event really is full.
create or replace function public.notify_event_full(eid uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  host uuid;
  title text;
  lim record;
begin
  if auth.uid() is null then
    return;
  end if;
  select e.creator_id, e.title into host, title from public.events e where e.id = eid;
  if host is null or host = auth.uid() or private.is_banned(eid, auth.uid()) then
    return;
  end if;
  select l.people into lim from private.event_limits(eid) l;
  if lim.people is null or (
       select count(*) + 1 from public.rsvps r
        where r.event_id = eid and r.status = 'going' and r.user_id <> host
     ) < lim.people then
    return;
  end if;
  if not private.push_once(host, host, 'eventFull', eid) then
    return;
  end if;
  insert into public.push_outbox (user_id, kind, event_id, title, body, data)
  values (host, 'eventFull', eid, title,
          'Your event is full and someone wants in. Make room for more with an Event Pass.',
          jsonb_build_object('type', 'event', 'eventId', eid));
end;
$$;

revoke execute on function public.notify_event_full(uuid) from public, anon;
grant execute on function public.notify_event_full(uuid) to authenticated;
