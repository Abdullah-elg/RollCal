-- ============================================================================
-- RollCal - The roll opens when the event starts
-- Run after push.sql. Safe to re-run.
--
-- The shared roll used to open when an event ended. It now opens when the
-- event starts and still closes 48 hours after it ends (the app works out the
-- window; see src/lib/roll.ts). This moves the "The roll is open" push to the
-- start: the cron job announces events that started in the last few hours,
-- once each, and moving an event's start later lets it be announced again.
-- ============================================================================

create or replace function public.events_reset_roll_push()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.starts_at is distinct from old.starts_at and new.starts_at > now() then
    new.roll_open_pushed_at := null;
  end if;
  return new;
end;
$$;

revoke execute on function public.events_reset_roll_push() from public, anon, authenticated;

drop trigger if exists events_reset_roll_push on public.events;
create trigger events_reset_roll_push
  before update of starts_at on public.events
  for each row execute function public.events_reset_roll_push();

-- Everyone but the people who said they can't go.
create or replace function public.push_roll_openings()
returns integer language plpgsql security definer set search_path = public as $$
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
    select p.user_id, 'albumOpen', ev.id, ev.title, 'It’s started. The roll is open - add your photos.',
           jsonb_build_object('type', 'event', 'eventId', ev.id)
      from public.event_people(ev.id) p
     where p.rsvp is distinct from 'not_going';
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke execute on function public.push_roll_openings() from public, anon, authenticated;
