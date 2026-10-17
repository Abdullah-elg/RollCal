-- ============================================================================
-- RollCal - Photos expire on free events
-- Run after media.sql and security.sql. Safe to re-run.
--
-- How it works:
--   * An event's photos and videos are kept for 30 days after it ends,
--     unless its host has Pro, in which case they're kept for good.
--   * If a host's Pro ends, their events get at least 30 more days from then
--     (the grace period), so nobody loses photos the day a subscription lapses.
--   * Every night the expire-photos edge function deletes what's due, files
--     first, and marks the event so the app can say what happened.
--   * photos_expire_at() is the one place the rule lives. The app reads it
--     for the countdown and warnings; the nightly job uses it to decide.
-- ============================================================================


-- When a host's Pro ended (null while they have it, or never had it).
alter table public.profiles add column if not exists pro_ended_at timestamptz;

-- When the nightly job deleted an event's photos.
alter table public.events add column if not exists photos_expired_at timestamptz;

-- Keeps pro_ended_at in step with is_pro, so the grace period can't be
-- skipped or extended from the app (is_pro itself is admin-only).
create or replace function public.track_pro_ended()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.is_pro then
    new.pro_ended_at := null;
  elsif tg_op = 'UPDATE' and old.is_pro and not new.is_pro then
    new.pro_ended_at := now();
  elsif tg_op = 'UPDATE' then
    new.pro_ended_at := old.pro_ended_at;
  else
    new.pro_ended_at := null;
  end if;
  return new;
end;
$$;

revoke execute on function public.track_pro_ended() from public, anon, authenticated;

drop trigger if exists profiles_track_pro_ended on public.profiles;
create trigger profiles_track_pro_ended
  before insert or update on public.profiles
  for each row execute function public.track_pro_ended();


-- ----------------------------------------------------------------------------
-- THE RULE
-- ----------------------------------------------------------------------------

-- When an event's photos expire, or null if they're kept for good.
create or replace function public.event_photos_expire_at(e public.events)
returns timestamptz language sql stable security definer set search_path = public as $$
  select case
    when p.is_pro then null
    else greatest(e.ends_at, coalesce(p.pro_ended_at, e.ends_at)) + interval '30 days'
  end
  from public.profiles p
  where p.id = e.creator_id;
$$;

-- For the app: expiry dates for events the signed-in user can see.
-- Events they can't see are left out rather than revealed.
create or replace function public.photos_expire_at(event_ids uuid[])
returns table (event_id uuid, expires_at timestamptz, expired_at timestamptz)
language sql stable security definer set search_path = public as $$
  select e.id, public.event_photos_expire_at(e), e.photos_expired_at
    from public.events e
   where e.id = any(event_ids)
     and (e.creator_id = auth.uid() or public.can_see_event(e.id, auth.uid()));
$$;

revoke execute on function public.event_photos_expire_at(public.events) from public, anon, authenticated;
revoke execute on function public.photos_expire_at(uuid[]) from public, anon;
grant execute on function public.photos_expire_at(uuid[]) to authenticated;


-- ----------------------------------------------------------------------------
-- THE NIGHTLY JOB
-- pg_cron runs it at 09:00 UTC (early morning in North America); pg_net
-- calls the expire-photos edge function, which deletes the files through the
-- Storage API (deleting storage rows in SQL would leave the files behind).
-- The function checks a key kept in Vault, generated here, so only this job
-- can trigger it.
-- ----------------------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'expire_photos_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'expire_photos_key');
  end if;
end $$;

-- Only the edge function (service role) may check the key.
create or replace function public.expire_photos_key_ok(key text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from vault.decrypted_secrets
     where name = 'expire_photos_key' and decrypted_secret = key
  );
$$;

revoke execute on function public.expire_photos_key_ok(text) from public, anon, authenticated;
grant execute on function public.expire_photos_key_ok(text) to service_role;

-- Events whose photos are due, oldest first, for the edge function.
create or replace function public.events_to_expire(max_events integer default 50)
returns table (event_id uuid)
language sql stable security definer set search_path = public as $$
  select e.id
    from public.events e
   where e.photos_expired_at is null
     and public.event_photos_expire_at(e) <= now()
   order by e.ends_at
   limit max_events;
$$;

revoke execute on function public.events_to_expire(integer) from public, anon, authenticated;
grant execute on function public.events_to_expire(integer) to service_role;

select cron.unschedule('expire-photos')
 where exists (select 1 from cron.job where jobname = 'expire-photos');

select cron.schedule(
  'expire-photos',
  '0 9 * * *',
  $job$
    select net.http_post(
      url := 'https://qwtvpmrxmlfuwmnyawcq.supabase.co/functions/v1/expire-photos',
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-expire-key', (select decrypted_secret from vault.decrypted_secrets where name = 'expire_photos_key')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $job$
);
