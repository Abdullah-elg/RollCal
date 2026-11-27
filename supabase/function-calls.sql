-- One place for the database's calls to RollCal's server functions
-- (supabase/functions). Pushes, report and support emails, and the hourly
-- expiry job all go through private.call_function, so moving the functions
-- elsewhere (docs/MIGRATION-AWS.md) changes these two functions, not every
-- caller. Run after push.sql, report-email.sql, support.sql and
-- event-delete.sql; safe to re-run. Behaviour is unchanged.
--
-- The calls use pg_net, which queues the request and sends it only once the
-- transaction commits, so rolled-back work never sends anything.

-- Where the server functions live.
create or replace function private.functions_base_url()
returns text language sql immutable set search_path = '' as $$
  select 'https://qwtvpmrxmlfuwmnyawcq.supabase.co/functions/v1';
$$;

-- POST {} to a server function, with its key from the vault in a header.
-- Returns pg_net's request id.
create or replace function private.call_function(
  p_function text,
  p_key_header text,
  p_vault_secret text,
  p_timeout_ms integer default 30000
)
returns bigint language sql volatile security definer set search_path = '' as $$
  select net.http_post(
    url := private.functions_base_url() || '/' || p_function,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      p_key_header, (select s.decrypted_secret from vault.decrypted_secrets s where s.name = p_vault_secret)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := p_timeout_ms
  );
$$;

revoke execute on function private.functions_base_url() from public, anon, authenticated;
revoke execute on function private.call_function(text, text, text, integer) from public, anon, authenticated;

-- The same three pokes as push.sql, report-email.sql and support.sql.
create or replace function public.poke_send_push()
returns void language sql security definer set search_path = '' as $$
  select private.call_function('send-push', 'x-push-key', 'push_key');
$$;

create or replace function public.poke_report_email()
returns void language sql security definer set search_path = '' as $$
  select private.call_function('report-email', 'x-report-key', 'report_email_key');
$$;

create or replace function public.poke_support_email()
returns void language sql security definer set search_path = '' as $$
  select private.call_function('support-email', 'x-support-key', 'support_email_key');
$$;

revoke execute on function public.poke_send_push() from public, anon, authenticated;
revoke execute on function public.poke_report_email() from public, anon, authenticated;
revoke execute on function public.poke_support_email() from public, anon, authenticated;

-- The hourly expiry job (event-delete.sql), same schedule and timeout.
select cron.unschedule('expire-photos')
 where exists (select 1 from cron.job where jobname = 'expire-photos');

select cron.schedule(
  'expire-photos',
  '7 * * * *',
  $job$ select private.call_function('expire-photos', 'x-expire-key', 'expire_photos_key', 60000) $job$
);
