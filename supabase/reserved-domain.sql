-- ============================================================================
-- RollCal - No new accounts on rollcal.app addresses
-- Run after reserved-emails.sql (it replaces that file's function). Safe to
-- re-run.
--
-- Every @rollcal.app address lands in the support inbox, so an account made
-- with any of them fills it with confirmation and password-reset emails.
-- App review robots did exactly that (testuser99@rollcal.app), and the
-- unconfirmed Google review account kept asking for new codes.
--
-- 1. Refuses every rollcal.app address (and its subdomains) for new accounts
--    and email changes. The two app-review accounts are allowed, and an
--    account keeping the email it already has is never touched.
-- 2. Confirms the Google review account, so reviewers sign straight in
--    instead of landing on "check your email".
-- 3. Deletes the account the review robot made.
-- ============================================================================

create or replace function private.refuse_reserved_email()
returns trigger language plpgsql set search_path = '' as $$
declare
  addr text := lower(btrim(new.email));
begin
  -- Only a new address is checked: sign-ins and confirmations update the
  -- row too, and must keep working for the review accounts.
  if tg_op = 'UPDATE' and new.email is not distinct from old.email then
    return new;
  end if;
  if addr ~ '@([a-z0-9-]+\.)*rollcal\.app$'
     and addr not in ('apple-test@rollcal.app', 'google-test@rollcal.app') then
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

update auth.users
   set email_confirmed_at = coalesce(email_confirmed_at, now())
 where email = 'google-test@rollcal.app';

delete from auth.users where email = 'testuser99@rollcal.app';
