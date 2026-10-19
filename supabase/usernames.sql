-- ============================================================================
-- RollCal - Usernames
-- Run after policies.sql. Safe to re-run.
--
-- People choose their username at sign-up instead of getting their email's
-- local part. This enforces the same rule as src/lib/username.ts and lets
-- the sign-up screen check a name is free before the account exists.
-- ============================================================================

-- Usernames that don't fit the rule (old test accounts with "+" in them)
-- get a neutral one the person can change in Edit profile.
update public.profiles
   set username = 'member' || substr(replace(id::text, '-', ''), 1, 8)
 where username is null
    or username !~ '^[a-z0-9][a-z0-9._-]{2,29}$'
    or username in ('admin', 'administrator', 'help', 'moderator', 'official',
                    'rollcal', 'root', 'staff', 'support', 'system');

alter table public.profiles alter column username set not null;

alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format check (
  username ~ '^[a-z0-9][a-z0-9._-]{2,29}$'
  and username not in ('admin', 'administrator', 'help', 'moderator', 'official',
                       'rollcal', 'root', 'staff', 'support', 'system')
);

-- Whether a username can be taken. Callable before sign-in (the sign-up
-- screen), so it answers yes or no and nothing else. The unique index on
-- lower(username) is still what actually stops two people sharing one.
create or replace function public.username_available(name text)
returns boolean language sql stable security definer set search_path = public as $$
  select name ~ '^[a-z0-9][a-z0-9._-]{2,29}$'
     and name not in ('admin', 'administrator', 'help', 'moderator', 'official',
                      'rollcal', 'root', 'staff', 'support', 'system')
     and not exists (select 1 from profiles where lower(username) = lower(name));
$$;

revoke execute on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;
