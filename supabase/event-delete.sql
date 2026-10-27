-- ============================================================================
-- RollCal - Deleting an event that already happened
-- Run after join-modes.sql, events-guard.sql and expiry.sql. Safe to re-run.
--
-- An upcoming event is still cancelled on the spot. An event that's over
-- holds photos and chat people may want, so the host deletes it with a
-- 48-hour warning instead:
--   * schedule_event_deletion sets delete_at to 48 hours from now and pushes
--     everyone else in the event to save what they want;
--   * keep_event lets the host change their mind before then;
--   * the hourly expire-photos job removes the files and then the event
--     (supabase/functions/expire-photos), once delete_at has passed.
-- delete_at only changes through these two functions; hosts can't set it
-- with a plain update.
-- ============================================================================

alter table public.events add column if not exists delete_at timestamptz;
create index if not exists events_delete_at_idx on public.events (delete_at) where delete_at is not null;


-- ----------------------------------------------------------------------------
-- 1. ONLY THROUGH THE FUNCTIONS
-- ----------------------------------------------------------------------------
create or replace function private.events_guard_delete_at()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon')
     and coalesce(current_setting('rollcal.event_delete', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      new.delete_at := null;
    else
      new.delete_at := old.delete_at;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.events_guard_delete_at() from public, anon, authenticated;

drop trigger if exists events_guard_delete_at on public.events;
create trigger events_guard_delete_at
  before insert or update on public.events
  for each row execute function private.events_guard_delete_at();


-- ----------------------------------------------------------------------------
-- 2. PUSH KIND
-- ----------------------------------------------------------------------------
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.push_outbox'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute format('alter table public.push_outbox drop constraint %I', c);
  end loop;
end $$;
alter table public.push_outbox add constraint push_outbox_kind_check check (kind in (
  'friendRequest', 'friendAccepted', 'chatMessage', 'albumOpen', 'joinRequest', 'joinApproved',
  'eventDeleting'
));


-- ----------------------------------------------------------------------------
-- 3. SCHEDULE AND UNDO
-- ----------------------------------------------------------------------------
create or replace function public.schedule_event_deletion(p_event uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  ev record;
  when_at timestamptz := now() + interval '48 hours';
begin
  select id, title, creator_id, ends_at, delete_at into ev from events where id = p_event;
  if ev.id is null or ev.creator_id is distinct from auth.uid() then
    raise exception 'Only the host can delete this event' using errcode = '42501';
  end if;
  if ev.ends_at > now() then
    raise exception 'This event hasn''t ended yet, so cancel it instead' using errcode = '22023';
  end if;
  if ev.delete_at is not null then
    return ev.delete_at;
  end if;

  perform set_config('rollcal.event_delete', 'on', true);
  update events set delete_at = when_at where id = p_event;
  perform set_config('rollcal.event_delete', '', true);

  insert into push_outbox (user_id, kind, event_id, title, body, data)
  select p.user_id, 'eventDeleting', ev.id, ev.title,
         'This event will be deleted in 48 hours. Save any photos you want to keep.',
         jsonb_build_object('type', 'event', 'eventId', ev.id)
    from public.event_people(ev.id) p
   where p.user_id <> ev.creator_id;
  return when_at;
end;
$$;

create or replace function public.keep_event(p_event uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  perform set_config('rollcal.event_delete', 'on', true);
  update events set delete_at = null where id = p_event and creator_id = auth.uid();
  get diagnostics n = row_count;
  perform set_config('rollcal.event_delete', '', true);
  if n = 0 then
    raise exception 'Only the host can keep this event' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public.schedule_event_deletion(uuid) from public, anon;
grant execute on function public.schedule_event_deletion(uuid) to authenticated;
revoke execute on function public.keep_event(uuid) from public, anon;
grant execute on function public.keep_event(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 4. THE CLEANUP JOB
-- expire-photos asks for events whose 48 hours are up, removes their files
-- and deletes them. It now runs hourly so nothing lingers much past the
-- time people were told; the photo expiry it also does doesn't mind.
-- ----------------------------------------------------------------------------
create or replace function public.events_to_delete(max_events integer default 50)
returns table (event_id uuid)
language sql stable security definer set search_path = public as $$
  select e.id from public.events e
   where e.delete_at is not null and e.delete_at <= now()
   order by e.delete_at
   limit max_events;
$$;

revoke execute on function public.events_to_delete(integer) from public, anon, authenticated;
grant execute on function public.events_to_delete(integer) to service_role;

select cron.unschedule('expire-photos')
 where exists (select 1 from cron.job where jobname = 'expire-photos');

select cron.schedule(
  'expire-photos',
  '7 * * * *',
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
