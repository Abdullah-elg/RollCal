-- ============================================================================
-- RollCal - Plans: Free, Plus and Pro, Event Passes, and a minimum app version
-- Run after launch-hardening.sql and storage-total.sql (it replaces things
-- both own), and after private-schema.sql. Safe to re-run. Re-run it after
-- re-running media.sql, safety.sql, bills.sql, scan-allowance.sql,
-- storage-total.sql, launch-hardening.sql or private-schema.sql.
--
-- Plans are still given by hand (no in-app purchases yet). profiles.is_pro
-- stays and always equals "has a paid plan", so app builds already on
-- people's phones, and every older rule that reads is_pro, keep working.
--
-- WHAT THIS ADDS OR CHANGES
--   Columns and tables
--   * profiles.plan ('free', 'plus' or 'pro') and profiles.plan_expires_at
--     (empty = no end). Everyone with is_pro today becomes 'pro'.
--   * events.keep_forever: an admin-only switch that makes one event premium.
--   * receipt_scans.succeeded: whether a scan actually read a receipt.
--   * event_passes: one row per event that has an Event Pass. Members of the
--     event can see it; nobody can add, change or remove one from the app.
--   * app_config: settings the app reads before sign-in (min_version). Anyone
--     can read it; nobody can write it from the app.
--
--   Triggers
--   * profiles_plan_sync: people can't change their own plan or end date
--     (a new profile always starts on 'free'). When an admin changes plan,
--     is_pro follows (plan <> 'free'); when an admin flips is_pro the old
--     way, plan follows ('pro' or 'free'). It runs before
--     profiles_track_pro_ended, so pro_ended_at is set exactly as before.
--   * events_protect_keep_forever: the app can't set keep_forever, not even
--     the event's host. Admin changes go through.
--
--   Functions (private: only used inside rules and other functions)
--   * effective_plan(uid): the person's plan, or 'free' once it's expired.
--   * event_tier(eid): 'pro' if the host is on Pro; 'plus' if the host is on
--     Plus, the event has an Event Pass, or keep_forever is on; else null.
--   * upload_tier(eid, uid): the higher of the event's tier and the person's
--     own plan. Decides videos and full-size photos.
--   * upload_pool(eid, uid): whose storage an upload to that event uses and
--     how full it is. Normally the uploader's own (Free 2 GB, Plus 50 GB,
--     Pro 250 GB). In a premium event it's the host's when the host is on
--     Plus or Pro, or a 20 GB pool of the event's own when the event is
--     premium only through a pass or keep_forever.
--   * can_upload_to(eid): the upload rule's room check, by that pool. Members
--     only; a guest (not the host) may use at most 5 GB of a host's or an
--     event's pool per event, so one guest can't fill it for everyone.
--   * media_allowed(name, metadata): videos only where the upload tier
--     isn't free (was: Pro only).
--   * is_quiet(uid): Quiet mode works for everyone (was: Pro only).
--
--   Functions the app calls
--   * event_plan(eid): the event's tier and keep_forever. Members only.
--   * my_upload_rules(eid): tier, full-size photos, videos, longest video,
--     and the storage pool. Members only.
--   * upload_allowance_for(eid): the storage pool an upload there uses, and
--     the guest's 5 GB share of it when it isn't theirs. Members only.
--   * my_upload_allowance(): unchanged columns for older builds; now the
--     person's own pool and their plan's limit.
--   * claim_receipt_scan(): same answer as before. Each calendar month (UTC),
--     Basic (free) gets 1 scan that reads a receipt (at most 4 tries), Plus
--     gets 15 (at most 40 tries), Pro has no limit.
--   * receipt_scans_left(): scans left this month (null = no limit, Pro).
--
--   Rules
--   * event_photos_upload_member (storage): a lowercase event-id folder,
--     members, room in the pool above,
--     roll open, videos per upload tier.
--   * photos_from_file: a video row needs a non-free upload tier.
--   * event_passes_select_member, app_config_read.
--
--   Scheduled job
--   * plans-expire (daily 03:17 UTC): plans past their end date go back to
--     'free' (is_pro and pro_ended_at follow).
--
-- OWNER HOW-TO (run in the SQL editor; replace the email and ids)
--
--   -- Give someone Plus (or 'pro'), with no end date:
--   update public.profiles set plan = 'plus', plan_expires_at = null
--    where id = (select id from auth.users where email = 'person@example.com');
--
--   -- Give someone Pro until a date (it goes back to Free after that):
--   update public.profiles set plan = 'pro', plan_expires_at = '2027-01-31 23:59:59+00'
--    where id = (select id from auth.users where email = 'person@example.com');
--
--   -- Take it away now:
--   update public.profiles set plan = 'free'
--    where id = (select id from auth.users where email = 'person@example.com');
--
--   -- Give an event an Event Pass (granted_to is optional):
--   insert into public.event_passes (event_id, granted_to, source)
--   values ('<event uuid>', (select id from auth.users where email = 'person@example.com'), 'admin')
--   on conflict (event_id) do nothing;
--
--   -- Take an Event Pass away:
--   delete from public.event_passes where event_id = '<event uuid>';
--
--   -- Keep one event's photos for good, whoever hosts it:
--   update public.events set keep_forever = true where id = '<event uuid>';
--
--   -- Check someone's plan and storage (their own pool):
--   select p.plan, p.plan_expires_at, private.effective_plan(p.id) as plan_now,
--          pg_size_pretty(a.stored) as stored, pg_size_pretty(a.stored_limit) as stored_limit
--     from public.profiles p, public.upload_allowance(p.id) a
--    where p.id = (select id from auth.users where email = 'person@example.com');
--
--   -- Check an event's tier and its own pool (used when it has a pass):
--   select private.event_tier('<event uuid>'),
--          pg_size_pretty(private.event_bytes('<event uuid>'));
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. PLAN COLUMNS
-- ----------------------------------------------------------------------------
alter table public.profiles add column if not exists plan text not null default 'free';
alter table public.profiles add column if not exists plan_expires_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'profiles_plan_check' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_plan_check check (plan in ('free', 'plus', 'pro'));
  end if;
end $$;


-- ----------------------------------------------------------------------------
-- 2 + 3. PLAN IS ADMIN-ONLY, AND is_pro FOLLOWS IT
-- Named so it runs before profiles_protect_is_pro and profiles_track_pro_ended
-- (triggers of the same kind run in name order): the is_pro it sets is what
-- track_pro_ended sees, so pro_ended_at is set when a plan ends.
-- ----------------------------------------------------------------------------
create or replace function private.profiles_plan_sync()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- auth.role() is 'authenticated' or 'anon' for app requests, and empty for
  -- the dashboard, the service role and pg_cron.
  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      -- protect_is_pro clears is_pro on the same insert.
      new.plan := 'free';
      new.plan_expires_at := null;
    elsif new.plan is distinct from old.plan
       or new.plan_expires_at is distinct from old.plan_expires_at then
      raise exception 'plan can only be changed by an admin' using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.plan <> 'free' then
      new.is_pro := true;
    elsif new.is_pro then
      new.plan := 'pro';
    end if;
  elsif new.plan is distinct from old.plan
     or new.plan_expires_at is distinct from old.plan_expires_at then
    new.is_pro := new.plan <> 'free';
  elsif new.is_pro is distinct from old.is_pro then
    -- Someone flipped is_pro by hand, the old way.
    new.plan := case when new.is_pro then 'pro' else 'free' end;
    new.plan_expires_at := null;
  end if;

  if new.plan = 'free' then
    new.plan_expires_at := null;
  end if;
  return new;
end;
$$;

revoke execute on function private.profiles_plan_sync() from public, anon, authenticated;

drop trigger if exists profiles_plan_sync on public.profiles;
create trigger profiles_plan_sync
  before insert or update on public.profiles
  for each row execute function private.profiles_plan_sync();

-- Everyone with Pro today keeps it, with no end date.
update public.profiles set plan = 'pro', plan_expires_at = null
 where is_pro and plan = 'free';


-- ----------------------------------------------------------------------------
-- 4. THE PLAN THAT COUNTS RIGHT NOW, AND THE DAILY CLEAN-UP
-- ----------------------------------------------------------------------------
create or replace function private.effective_plan(uid uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case
      when p.plan_expires_at is not null and p.plan_expires_at <= now() then 'free'
      else p.plan
    end
      from public.profiles p
     where p.id = uid
  ), 'free');
$$;

revoke execute on function private.effective_plan(uuid) from public, anon, authenticated;

-- free < plus < pro
create or replace function private.plan_rank(p text)
returns integer language sql immutable set search_path = '' as $$
  select case p when 'pro' then 2 when 'plus' then 1 else 0 end;
$$;

revoke execute on function private.plan_rank(text) from public, anon, authenticated;

-- Each plan's own storage pool.
create or replace function private.plan_storage_limit(p text)
returns bigint language sql immutable set search_path = '' as $$
  select (case p when 'pro' then 250 when 'plus' then 50 else 2 end * 1024::bigint ^ 3)::bigint;
$$;

revoke execute on function private.plan_storage_limit(text) from public, anon, authenticated;

select cron.unschedule('plans-expire')
 where exists (select 1 from cron.job where jobname = 'plans-expire');

select cron.schedule(
  'plans-expire',
  '17 3 * * *',
  $job$
    update public.profiles
       set plan = 'free', plan_expires_at = null
     where plan <> 'free' and plan_expires_at <= now();
  $job$
);


-- ----------------------------------------------------------------------------
-- 5. PREMIUM EVENTS: keep_forever and Event Passes
-- ----------------------------------------------------------------------------
alter table public.events add column if not exists keep_forever boolean not null default false;

-- The app can't set it, not even the host; the dashboard, the service role
-- and pg_cron can.
create or replace function private.events_protect_keep_forever()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.keep_forever := false;
    else
      new.keep_forever := old.keep_forever;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.events_protect_keep_forever() from public, anon, authenticated;

drop trigger if exists events_protect_keep_forever on public.events;
create trigger events_protect_keep_forever
  before insert or update on public.events
  for each row execute function private.events_protect_keep_forever();

create table if not exists public.event_passes (
  event_id uuid primary key references public.events (id) on delete cascade,
  -- Who it was given to or bought by. Kept if they delete their account.
  granted_to uuid references auth.users (id) on delete set null,
  source text not null check (source in ('admin', 'purchase')),
  store_transaction_id text unique,
  created_at timestamptz not null default now()
);

alter table public.event_passes enable row level security;
revoke insert, update, delete, truncate on public.event_passes from anon, authenticated;
revoke all on public.event_passes from anon;
grant select on public.event_passes to authenticated;

drop policy if exists "event_passes_select_member" on public.event_passes;
create policy "event_passes_select_member" on public.event_passes
  for select to authenticated
  using (private.is_member(event_id, (select auth.uid())));


-- ----------------------------------------------------------------------------
-- 6. AN EVENT'S TIER
-- ----------------------------------------------------------------------------
create or replace function private.event_tier(eid uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when h.plan = 'pro' then 'pro'
    when h.plan = 'plus'
      or h.keep_forever
      or exists (select 1 from public.event_passes ep where ep.event_id = h.id) then 'plus'
  end
  from (
    select e.id, e.keep_forever, private.effective_plan(e.creator_id) as plan
      from public.events e
     where e.id = eid
  ) h;
$$;

revoke execute on function private.event_tier(uuid) from public, anon, authenticated;

create or replace function public.event_plan(eid uuid)
returns table (tier text, keep_forever boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_member(eid, auth.uid()) then
    raise exception 'Not a member of this event' using errcode = '42501';
  end if;
  return query
    select private.event_tier(e.id), e.keep_forever
      from public.events e
     where e.id = eid;
end;
$$;

revoke execute on function public.event_plan(uuid) from public, anon;
grant execute on function public.event_plan(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 7. UPLOAD TIER: the better of the event's and the person's own
-- ----------------------------------------------------------------------------
create or replace function private.upload_tier(eid uuid, uid uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when private.plan_rank(t.event_tier) >= private.plan_rank(t.own) then coalesce(t.event_tier, 'free')
    else t.own
  end
  from (select private.event_tier(eid) as event_tier, private.effective_plan(uid) as own) t;
$$;

revoke execute on function private.upload_tier(uuid, uuid) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 8. STORAGE POOLS
-- File names in event-photos are "<event id>/<file>". An event's files are
-- summed by that prefix, which the (bucket_id, name) index on storage.objects
-- answers directly.
-- ----------------------------------------------------------------------------

-- Every file stored for one event.
create or replace function private.event_bytes(eid uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint
    from storage.objects o
   where o.bucket_id = 'event-photos'
     and o.name collate "C" >= eid::text || '/'
     and o.name collate "C" < eid::text || '0';
$$;

revoke execute on function private.event_bytes(uuid) from public, anon, authenticated;

-- Everything counted against one person's own pool: their files in events
-- that aren't premium, plus every file in the events they host while on
-- Plus or Pro (those events are all premium, so nothing counts twice).
create or replace function private.pool_bytes(uid uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  with mine as (
    select (storage.foldername(o.name))[1] as folder,
           sum((o.metadata->>'size')::bigint) as bytes
      from storage.objects o
     where o.bucket_id = 'event-photos' and o.owner = uid
     group by 1
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

-- Whose pool an upload by uid to event eid uses, and how full it is.
--   'you'   the uploader's own pool (the event isn't premium)
--   'host'  the host's pool (the host is on Plus or Pro)
--   'event' the event's own 20 GB (premium only through a pass or keep_forever)
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
  select 'event'::text, private.event_bytes(eid), (20 * 1024::bigint ^ 3)::bigint
    from h where h.tier is not null and h.host_plan = 'free'
  union all
  select 'you'::text, private.pool_bytes(uid), private.plan_storage_limit(private.effective_plan(uid))
    from h where h.tier is null;
$$;

revoke execute on function private.upload_pool(uuid, uuid) from public, anon, authenticated;

-- One guest's files in one event, and how much each guest may put in a
-- pool that isn't theirs (the host's, or the event's own): 5 GB per event,
-- so one guest can't fill it and stop everyone else uploading.
create or replace function private.guest_event_bytes(eid uuid, uid uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint
    from storage.objects o
   where o.bucket_id = 'event-photos'
     and o.name collate "C" >= eid::text || '/'
     and o.name collate "C" < eid::text || '0'
     and o.owner = uid;
$$;

revoke execute on function private.guest_event_bytes(uuid, uuid) from public, anon, authenticated;

create or replace function private.guest_limit()
returns bigint language sql immutable set search_path = '' as $$
  select (5 * 1024::bigint ^ 3)::bigint;
$$;

revoke execute on function private.guest_limit() from public, anon, authenticated;

-- The pool, plus the guest's share when the pool isn't the uploader's own
-- (null when it is: their own pool, or they're the host).
create or replace function private.upload_pool_for(eid uuid, uid uuid)
returns table (pool text, stored bigint, stored_limit bigint, guest_stored bigint, guest_limit bigint)
language sql stable security definer set search_path = '' as $$
  select p.pool, p.stored, p.stored_limit,
         case when g.guest then private.guest_event_bytes(eid, uid) end,
         case when g.guest then private.guest_limit() end
    from private.upload_pool(eid, uid) p
    cross join lateral (
      select p.pool <> 'you'
         and uid is distinct from (select e.creator_id from public.events e where e.id = eid) as guest
    ) g;
$$;

revoke execute on function private.upload_pool_for(uuid, uuid) from public, anon, authenticated;

-- The storage upload rule's room check. Called by the rule as the uploader.
-- Members only; the pool has room; and a guest is under their 5 GB share.
create or replace function private.can_upload_to(eid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select private.is_member(eid, auth.uid())
       and p.stored < p.stored_limit
       and (p.guest_limit is null or p.guest_stored < p.guest_limit)
      from private.upload_pool_for(eid, auth.uid()) p
  ), false);
$$;

revoke execute on function private.can_upload_to(uuid) from public, anon;
grant execute on function private.can_upload_to(uuid) to authenticated, service_role;

-- For the app: the pool an upload to this event would use, and the guest's
-- share of it (null when the pool is their own or they host the event).
-- The result's shape grew, so the old function goes first.
drop function if exists public.upload_allowance_for(uuid);
create function public.upload_allowance_for(eid uuid)
returns table (pool text, stored bigint, stored_limit bigint, guest_stored bigint, guest_limit bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_member(eid, auth.uid()) then
    raise exception 'Not a member of this event' using errcode = '42501';
  end if;
  return query select * from private.upload_pool_for(eid, auth.uid());
end;
$$;

revoke execute on function public.upload_allowance_for(uuid) from public, anon;
grant execute on function public.upload_allowance_for(uuid) to authenticated;

-- For the app: everything about uploading to one event.
create or replace function public.my_upload_rules(eid uuid)
returns table (
  tier text,
  full_res boolean,
  videos boolean,
  video_max_seconds integer,
  pool text,
  stored bigint,
  stored_limit bigint
)
language plpgsql stable security definer set search_path = '' as $$
declare
  t text;
begin
  if auth.uid() is null or not private.is_member(eid, auth.uid()) then
    raise exception 'Not a member of this event' using errcode = '42501';
  end if;
  t := private.upload_tier(eid, auth.uid());
  return query
    select t, t <> 'free', t <> 'free',
           case t when 'pro' then 300 when 'plus' then 60 else 0 end,
           p.pool, p.stored, p.stored_limit
      from private.upload_pool(eid, auth.uid()) p;
end;
$$;

revoke execute on function public.my_upload_rules(uuid) from public, anon;
grant execute on function public.my_upload_rules(uuid) to authenticated;

-- Older builds: same columns as before. stored is the person's own pool;
-- the limit is their plan's. Not callable from the app directly.
create or replace function public.upload_allowance(uid uuid)
returns table (is_pro boolean, stored bigint, stored_limit bigint)
language sql stable security definer set search_path = '' as $$
  select pl <> 'free', private.pool_bytes(uid), private.plan_storage_limit(pl)
    from (select private.effective_plan(uid) as pl) x;
$$;

create or replace function public.my_upload_allowance()
returns table (is_pro boolean, stored bigint, stored_limit bigint)
language sql stable security definer set search_path = '' as $$
  select * from public.upload_allowance(auth.uid());
$$;

revoke execute on function public.upload_allowance(uuid) from public, anon, authenticated;
revoke execute on function public.my_upload_allowance() from public, anon;
grant execute on function public.my_upload_allowance() to authenticated;


-- ----------------------------------------------------------------------------
-- 9. VIDEOS: wherever the upload tier isn't free
-- Same file-name and type check as launch-hardening.sql; the event comes
-- from the file's folder.
-- ----------------------------------------------------------------------------
create or replace function private.media_allowed(p_name text, p_metadata jsonb)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when coalesce(lower(substring(p_name from '\.([^./]+)$')), '') not in
           ('mp4', 'mov', 'm4v', 'qt', '3gp', '3g2', 'webm', 'mkv', 'avi', 'hevc', 'mpg', 'mpeg')
         and coalesce(p_metadata->>'mimetype', '') not like 'video/%' then true
    else private.upload_tier(
           case when (storage.foldername(p_name))[1]
                     ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then ((storage.foldername(p_name))[1])::uuid end,
           auth.uid()
         ) <> 'free'
  end;
$$;

revoke execute on function private.media_allowed(text, jsonb) from public, anon;
grant execute on function private.media_allowed(text, jsonb) to authenticated, service_role;

drop policy if exists "event_photos_upload_member" on storage.objects;
create policy "event_photos_upload_member" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'event-photos'
    -- The folder must be the event id exactly as the database writes it
    -- (lowercase), or the file would escape every storage count.
    and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and private.is_member(((storage.foldername(name))[1])::uuid, (select auth.uid()))
    and private.can_upload_to(((storage.foldername(name))[1])::uuid)
    and private.roll_open(((storage.foldername(name))[1])::uuid)
    and private.media_allowed(name, metadata)
  );

-- Same as media.sql, with the video check by upload tier.
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

  if new.kind = 'video' and private.upload_tier(new.event_id, new.uploader_id) = 'free' then
    raise exception 'Videos need RollCal Plus' using errcode = '42501', hint = 'video_pro';
  end if;
  return new;
end;
$$;

revoke execute on function public.photos_from_file() from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 10. RECEIPT SCANS: count the ones that worked
-- A scan is recorded as a try when it's claimed; the scan-receipt function
-- marks it succeeded (with the service role) once it has read a receipt.
-- Existing scans all counted before, so they're marked succeeded once, when
-- the column is added.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'receipt_scans' and column_name = 'succeeded'
  ) then
    alter table public.receipt_scans add column succeeded boolean not null default false;
    update public.receipt_scans set succeeded = true;
  end if;
end $$;

-- Scans left this calendar month (UTC), or null for Pro (no limit).
-- Basic (free): 1 that reads a receipt, at most 4 tries.
-- Plus: 15 that read a receipt, at most 40 tries.
create or replace function public.receipt_scans_left()
returns integer language sql stable security definer set search_path = '' as $$
  with lim as (
    select case private.effective_plan(auth.uid())
             when 'free' then 1 when 'plus' then 15 end as ok,
           case private.effective_plan(auth.uid())
             when 'free' then 4 when 'plus' then 40 end as tries
  )
  select case
    when lim.ok is null then null
    else (
      select greatest(0, least(lim.ok - count(*) filter (where s.succeeded), lim.tries - count(*)))::integer
        from public.receipt_scans s
       where s.user_id = auth.uid()
         and s.scanned_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'
    )
  end
  from lim;
$$;

revoke execute on function public.receipt_scans_left() from public, anon;
grant execute on function public.receipt_scans_left() to authenticated;

-- Same as launch-hardening.sql; scans_left is what's left if this one works.
create or replace function public.claim_receipt_scan()
returns table (allowed boolean, scan_id bigint, scans_left integer)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  left_now integer;
  new_id bigint;
begin
  if me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('receipt_scan:' || me::text, 0));

  left_now := public.receipt_scans_left();
  if left_now is null then
    return query select true, null::bigint, null::integer;
    return;
  end if;
  if left_now <= 0 then
    return query select false, null::bigint, 0;
    return;
  end if;

  insert into public.receipt_scans (user_id) values (me) returning id into new_id;
  return query select true, new_id, left_now - 1;
end;
$$;

revoke execute on function public.claim_receipt_scan() from public, anon;
grant execute on function public.claim_receipt_scan() to authenticated;


-- ----------------------------------------------------------------------------
-- 11. QUIET MODE FOR EVERYONE
-- ----------------------------------------------------------------------------
create or replace function private.is_quiet(uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.quiet_mode from public.profiles p where p.id = uid), false);
$$;

revoke execute on function private.is_quiet(uuid) from public, anon;
grant execute on function private.is_quiet(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 12. MINIMUM APP VERSION
-- The app reads min_version when it starts and asks people on an older
-- version to update. 0.0.0 blocks nobody; raise it to retire old builds.
-- ----------------------------------------------------------------------------
create table if not exists public.app_config (
  key text primary key,
  value jsonb not null
);

alter table public.app_config enable row level security;
revoke insert, update, delete, truncate on public.app_config from anon, authenticated;
grant select on public.app_config to anon, authenticated;

drop policy if exists "app_config_read" on public.app_config;
create policy "app_config_read" on public.app_config
  for select to anon, authenticated using (true);

insert into public.app_config (key, value)
values ('min_version', '{"ios": "0.0.0", "android": "0.0.0"}')
on conflict (key) do nothing;
