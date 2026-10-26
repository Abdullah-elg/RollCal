-- ============================================================================
-- RollCal - RollCal's own mailboxes can't be account emails
-- Safe to re-run.
--
-- support@, confirm@ and no-reply@rollcal.app are ours. An account made with
-- one could be mistaken for RollCal, or catch mail meant for it. The app
-- refuses them at sign-up (src/lib/reservedEmails.ts); this refuses them for
-- every way an account gets an email: sign-up, Apple or Google sign-in, and
-- changing the address later.
-- ============================================================================

create or replace function private.refuse_reserved_email()
returns trigger language plpgsql set search_path = '' as $$
begin
  if lower(btrim(new.email)) in ('support@rollcal.app', 'confirm@rollcal.app', 'no-reply@rollcal.app') then
    raise exception 'That address belongs to RollCal' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function private.refuse_reserved_email() from public, anon, authenticated;

drop trigger if exists refuse_reserved_email on auth.users;
create trigger refuse_reserved_email
  before insert or update of email on auth.users
  for each row execute function private.refuse_reserved_email();
