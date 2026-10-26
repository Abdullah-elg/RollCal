-- ============================================================================
-- RollCal - RSVPs are final once an event is over
-- Run after join-modes.sql. Safe to re-run.
--
-- After an event ends, nobody can change their answer: the app shows it in
-- the past tense ("Went", "Didn't go") with the buttons locked
-- (src/lib/rsvpLabels.ts), and this holds to it for older app versions and
-- direct requests too. It covers every way an answer changes: the app's own
-- update and join_event's "already in, switch answer".
--
-- Only people are held to it (auth.uid() is set). The service role and the
-- dashboard can still fix an answer by hand. Leaving the event, and the host
-- removing someone, still work: those delete the row rather than change it.
-- ============================================================================

create or replace function private.rsvps_final_after_end()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and new.status is distinct from old.status
     and exists (select 1 from events e where e.id = old.event_id and e.ends_at <= now()) then
    raise exception 'This event is over, so RSVPs can''t change' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function private.rsvps_final_after_end() from public, anon, authenticated;

drop trigger if exists rsvps_final_after_end on public.rsvps;
create trigger rsvps_final_after_end
  before update of status on public.rsvps
  for each row execute function private.rsvps_final_after_end();
