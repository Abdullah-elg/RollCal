-- Cover photos for events that haven't started (2026-11-27). Safe to run
-- more than once.
--
-- A cover photo is uploaded like a roll photo, and roll uploads were only
-- allowed from an hour before the event to 48 hours after it ends. So a host
-- setting a cover photo on an upcoming event always got "Upload failed".
--
-- Now the host (and co-hosts) can add photos at any time while the event
-- exists and its photos haven't expired. Guests still wait for the roll to
-- open. roll_open is only used by the three upload checks
-- (reserve_media_upload, the photos insert policy and the old storage
-- policy), so nothing else changes.

create or replace function private.roll_open(eid uuid)
returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from events e
     where e.id = eid
       and e.photos_expired_at is null
       and e.delete_at is null
       and (
         -- Hosts: any time, so they can set the cover photo before the night.
         private.is_leader(e.id, auth.uid())
         or (
           not coalesce(e.uploads_closed, false)
           and now() >= e.starts_at - interval '1 hour'
           and now() <= greatest(e.ends_at + interval '48 hours',
                                 coalesce(e.uploads_reopened_until, e.ends_at + interval '48 hours'))
                        + interval '1 hour'
         )
       )
  );
$$;

-- 2. The text-length rule on events only checks text that changes.
--    events_field_length was added NOT VALID, so older events with a long
--    description still exist; any later update to such an event (even the
--    hourly photo-expiry job setting photos_expired_at) failed the check, so
--    that event's photos were never cleaned up. Same limits, as a trigger
--    that only looks at new or changed text.
alter table public.events drop constraint if exists events_field_length;

create or replace function private.events_field_length()
returns trigger
language plpgsql set search_path = '' as $$
begin
  if (tg_op = 'INSERT' or new.title is distinct from old.title) and char_length(new.title) > 60
     or (tg_op = 'INSERT' or new.location is distinct from old.location) and char_length(new.location) > 120
     or (tg_op = 'INSERT' or new.description is distinct from old.description) and char_length(new.description) > 1000
  then
    raise exception 'That text is too long' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function private.events_field_length() from public, anon, authenticated;

drop trigger if exists events_field_length on public.events;
create trigger events_field_length
  before insert or update of title, location, description on public.events
  for each row execute function private.events_field_length();
