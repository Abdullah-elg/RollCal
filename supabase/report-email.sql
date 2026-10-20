-- ============================================================================
-- RollCal - Email every report to support
-- Run after safety.sql and push.sql (it uses pg_cron and pg_net). Safe to
-- re-run. Deploy supabase/functions/report-email with "Enforce JWT
-- verification" OFF and set its RESEND_API_KEY secret.
--
-- When someone files a report, the report-email function emails the details
-- to support@rollcal.app: the reason, who reported whom, and the reported
-- message, photo link or event. A cron job retries any that didn't send.
-- ============================================================================

-- Set when the email has gone (or is being sent).
alter table public.reports add column if not exists emailed_at timestamptz;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'report_email_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'report_email_key');
  end if;
end $$;

-- Only the edge function (service role) may check the key.
create or replace function public.report_email_key_ok(key text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from vault.decrypted_secrets where name = 'report_email_key' and decrypted_secret = key
  );
$$;

revoke execute on function public.report_email_key_ok(text) from public, anon, authenticated;
grant execute on function public.report_email_key_ok(text) to service_role;

-- Hands the function the next reports to email and marks them taken, so two
-- runs at once never email the same report twice. Reports over a week old
-- that never sent are left for the dashboard.
create or replace function public.claim_report_emails(max_rows integer default 20)
returns setof public.reports
language sql security definer set search_path = public as $$
  update reports r
     set emailed_at = now()
   where r.id in (
     select id from reports
      where emailed_at is null and created_at > now() - interval '7 days'
      order by created_at
      limit max_rows
      for update skip locked
   )
  returning r.*;
$$;

revoke execute on function public.claim_report_emails(integer) from public, anon, authenticated;
grant execute on function public.claim_report_emails(integer) to service_role;

-- Asks report-email to run. pg_net sends it after the transaction commits.
create or replace function public.poke_report_email()
returns void language sql security definer set search_path = public, extensions as $$
  select net.http_post(
    url := 'https://qwtvpmrxmlfuwmnyawcq.supabase.co/functions/v1/report-email',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-report-key', (select decrypted_secret from vault.decrypted_secrets where name = 'report_email_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$$;

create or replace function public.reports_email_poke()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.poke_report_email();
  return null;
end;
$$;

revoke execute on function public.poke_report_email() from public, anon, authenticated;
revoke execute on function public.reports_email_poke() from public, anon, authenticated;

drop trigger if exists reports_email_poke on public.reports;
create trigger reports_email_poke
  after insert on public.reports
  for each statement execute function public.reports_email_poke();

-- Every 10 minutes, retry reports that should have gone by now.
select cron.unschedule('report-email')
 where exists (select 1 from cron.job where jobname = 'report-email');

select cron.schedule(
  'report-email',
  '*/10 * * * *',
  $job$
    select public.poke_report_email()
     where exists (select 1 from public.reports
                    where emailed_at is null
                      and created_at < now() - interval '5 minutes'
                      and created_at > now() - interval '7 days');
  $job$
);
