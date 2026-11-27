-- "Something changed" on an event (2026-11-27). Safe to run more than once.
--
-- When the host changes an event's name, place, start or end time, or
-- description, the database notes when and by whom. The app lights the
-- event's ring on Home for everyone else in it until they open the event.
-- Only the database sets these two columns: anything the app sends for them
-- is ignored.

alter table public.events add column if not exists details_changed_at timestamptz;
alter table public.events add column if not exists details_changed_by uuid
  references public.profiles (id) on delete set null;

create or replace function private.events_note_change()
returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.details_changed_at := null;
    new.details_changed_by := null;
    return new;
  end if;
  if new.title is distinct from old.title
     or new.location is distinct from old.location
     or new.location_lat is distinct from old.location_lat
     or new.location_lng is distinct from old.location_lng
     or new.starts_at is distinct from old.starts_at
     or new.ends_at is distinct from old.ends_at
     or new.description is distinct from old.description then
    new.details_changed_at := now();
    new.details_changed_by := auth.uid();
  else
    new.details_changed_at := old.details_changed_at;
    new.details_changed_by := old.details_changed_by;
  end if;
  return new;
end;
$$;
revoke execute on function private.events_note_change() from public, anon, authenticated;

drop trigger if exists events_note_change on public.events;
create trigger events_note_change
  before insert or update on public.events
  for each row execute function private.events_note_change();
