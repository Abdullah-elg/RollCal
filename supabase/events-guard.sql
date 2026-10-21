-- ============================================================================
-- RollCal - Server-only event columns
-- Run after expiry.sql and push.sql. Safe to re-run, any time.
--
-- Hosts can update their own events, but a few columns belong to the server:
--   * photos_expired_at: set by the nightly expiry job. If a host could fill
--     it in, the job would skip their event and free photos would never
--     expire.
--   * roll_open_pushed_at: set when the "roll is open" push goes out.
--   * uploads_reopened_until: the app sets it to 24 hours from now when the
--     host reopens the roll. Anything later is cut back to that.
-- The dashboard, the service role and the scheduled jobs aren't affected.
-- ============================================================================

create or replace function public.events_guard_server_fields()
returns trigger language plpgsql set search_path = public as $$
begin
  -- 'authenticated' or 'anon' for app requests; empty for the dashboard,
  -- the service role and pg_cron.
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.photos_expired_at := null;
    new.roll_open_pushed_at := null;
    new.uploads_reopened_until := null;
    -- A new event has no photos of its own to be a cover yet.
    new.cover_photo_id := null;
  else
    new.photos_expired_at := old.photos_expired_at;
    -- events_reset_roll_push (which runs after this) still clears it when
    -- the end time moves.
    new.roll_open_pushed_at := old.roll_open_pushed_at;
  end if;

  if new.uploads_reopened_until is not null
     and new.uploads_reopened_until > now() + interval '24 hours 10 minutes' then
    new.uploads_reopened_until := now() + interval '24 hours';
  end if;
  return new;
end;
$$;

revoke execute on function public.events_guard_server_fields() from public, anon, authenticated;

-- Named so it runs before events_reset_roll_push (triggers fire by name).
drop trigger if exists events_guard_server_fields on public.events;
create trigger events_guard_server_fields
  before insert or update on public.events
  for each row execute function public.events_guard_server_fields();
