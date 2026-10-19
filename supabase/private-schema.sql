-- ============================================================================
-- RollCal - Keep the access-rule helpers out of the API
-- Run LAST, after every other file. Safe to re-run, and re-run it whenever
-- you re-run an earlier file (they recreate these helpers in public).
--
-- The row-level security rules lean on small helper functions (is_member,
-- can_see_event, is_blocked_between, ...). Anything in the public schema
-- that signed-in people may execute is also callable straight from the API,
-- so anyone could ask "is this person in that event?" or "has X blocked Y?"
-- about other people. Moving the helpers into a schema the API doesn't
-- serve keeps the rules working and the questions unanswerable.
--
-- What this does, for each helper:
--   1. moves it to the "private" schema (policies follow it automatically);
--   2. rewrites any rule or function that still names the public copy;
--   3. drops any public copy left over from re-running an older file.
-- Functions the app itself calls (request_friend, send_payment, ...) stay in
-- public.
-- ============================================================================

create schema if not exists private;
revoke all on schema private from public;
-- Policies run these as the signed-in user, and edit_bill (which runs as the
-- caller) calls one, so they need to reach the schema; the API still can't.
grant usage on schema private to authenticated, service_role;

do $$
declare
  helpers text[] := array[
    'can_join', 'can_see_bill', 'can_see_event', 'can_see_payment',
    'can_see_payment_method', 'can_upload', 'is_banned', 'is_bill_creator',
    'is_blocked_between', 'is_leader', 'is_member', 'is_quiet'
  ];
  h text;
  f record;
  pol record;
  def text;
  new_def text;
  q text;
  wc text;
  new_q text;
  new_wc text;
  pattern text;
begin
  -- 1. Move each helper, or refresh the private copy from a newer public one.
  for f in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any (helpers)
  loop
    if exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private' and p.proname = f.proname
         and pg_get_function_identity_arguments(p.oid) = f.args
    ) then
      def := pg_get_functiondef(f.oid);
      def := regexp_replace(def, 'FUNCTION public\.' || f.proname || '\(',
                            'FUNCTION private.' || f.proname || '(');
      execute def;
    else
      execute format('alter function public.%I(%s) set schema private', f.proname, f.args);
    end if;
  end loop;

  -- 2a. Rules that still name a public copy (only after re-running an older
  -- file; moved functions are followed automatically).
  for pol in select * from pg_policies loop
    q := pol.qual;
    wc := pol.with_check;
    new_q := q;
    new_wc := wc;
    foreach h in array helpers loop
      pattern := '(^|[^.\w])(public\.)?' || h || '\(';
      new_q := regexp_replace(new_q, pattern, '\1private.' || h || '(', 'g');
      new_wc := regexp_replace(new_wc, pattern, '\1private.' || h || '(', 'g');
    end loop;
    if new_q is distinct from q then
      execute format('alter policy %I on %I.%I using (%s)', pol.policyname, pol.schemaname, pol.tablename, new_q);
    end if;
    if new_wc is distinct from wc then
      execute format('alter policy %I on %I.%I with check (%s)', pol.policyname, pol.schemaname, pol.tablename, new_wc);
    end if;
  end loop;

  -- 2b. Functions that call a helper by its old name.
  for f in
    select p.oid, p.prosrc
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and p.prokind = 'f'
  loop
    def := pg_get_functiondef(f.oid);
    new_def := def;
    foreach h in array helpers loop
      if f.prosrc ~ ('\m' || h || '\(') then
        new_def := regexp_replace(new_def, '(^|[^.\w])(public\.)?' || h || '\(', '\1private.' || h || '(', 'g');
      end if;
    end loop;
    if new_def is distinct from def then
      execute new_def;
    end if;
  end loop;

  -- 3. Public copies left over from re-running an older file.
  for f in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any (helpers)
  loop
    execute format('drop function public.%I(%s)', f.proname, f.args);
  end loop;

  -- Same access as before: the rules need signed-in people to run them.
  for f in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and p.proname = any (helpers)
  loop
    execute format('revoke execute on function private.%I(%s) from public, anon', f.proname, f.args);
    execute format('grant execute on function private.%I(%s) to authenticated, service_role', f.proname, f.args);
  end loop;
end $$;
