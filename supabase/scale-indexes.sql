-- Database speed at scale (2026-11-27). Safe to run more than once; changes
-- no rules, only how fast they run.
--
-- 1. Row access rules that call auth.uid() directly run it once per row;
--    wrapped as (select auth.uid()) it runs once per query. Same meaning,
--    much faster on big tables (Supabase's "auth_rls_initplan" advice).
-- 2. Indexes on foreign keys that had none, so deletes and lookups by
--    person don't scan whole tables.
--
-- It takes every table lock it needs at the start, all at once, so it
-- can't deadlock with the app reading those tables halfway through (the
-- first try did). If the app is busy it waits up to 10 seconds, then stops
-- without changing anything; just run it again.

set lock_timeout = '10s';

do $$
declare
  p record;
  q text;
  c text;
  stmt text;
  tables text;
begin
  -- Lock all the tables whose rules change, in one statement, first.
  select string_agg(distinct format('%I.%I', schemaname, tablename), ', ')
    into tables
    from pg_policies
   where schemaname = 'public'
     and (coalesce(qual, '') ~* '(?<!select )auth\.(uid|jwt|role)\(\)'
          or coalesce(with_check, '') ~* '(?<!select )auth\.(uid|jwt|role)\(\)');
  if tables is not null then
    execute 'lock table ' || tables || ' in access exclusive mode';
  end if;

  for p in
    select schemaname, tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and (coalesce(qual, '') ~ 'auth\.(uid|jwt|role)\(\)' or coalesce(with_check, '') ~ 'auth\.(uid|jwt|role)\(\)')
  loop
    -- Wrap bare calls; leave ones already inside (select ...) alone.
    q := regexp_replace(p.qual, '(?<!select )auth\.(uid|jwt|role)\(\)', '(select auth.\1())', 'gi');
    c := regexp_replace(p.with_check, '(?<!select )auth\.(uid|jwt|role)\(\)', '(select auth.\1())', 'gi');
    if q is not distinct from p.qual and c is not distinct from p.with_check then
      continue;
    end if;
    stmt := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if q is not null then stmt := stmt || format(' using (%s)', q); end if;
    if c is not null then stmt := stmt || format(' with check (%s)', c); end if;
    execute stmt;
  end loop;
end $$;

create index if not exists chat_reads_user_id_idx on public.chat_reads (user_id);
create index if not exists event_join_requests_user_id_idx on public.event_join_requests (user_id);
create index if not exists event_passes_granted_to_idx on public.event_passes (granted_to);
create index if not exists event_recaps_created_by_idx on public.event_recaps (created_by);
create index if not exists host_reports_event_id_idx on public.host_reports (event_id);
create index if not exists host_reports_uploader_id_idx on public.host_reports (uploader_id);
create index if not exists push_outbox_user_id_idx on public.push_outbox (user_id);
create index if not exists reports_target_user_id_idx on public.reports (target_user_id);
