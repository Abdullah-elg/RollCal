-- ============================================================================
-- RollCal - Support tickets
-- Run after push.sql (it uses pg_cron and pg_net), before private-schema.sql.
-- Safe to re-run. Deploy supabase/functions/support-email with "Enforce JWT
-- verification" OFF; it uses the project's RESEND_API_KEY secret.
--
-- Settings → Support lets people ask for something (say, changing their
-- email) or report a problem. Each ticket is kept here and emailed to
-- support@rollcal.app with the person's email as the reply-to, so replying
-- in your inbox answers them. A cron job retries any that didn't send.
-- ============================================================================

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check (category in ('account', 'problem', 'pro', 'other')),
  message text not null check (char_length(btrim(message)) between 10 and 4000),
  -- Filled in from their sign-in account, never from what the app sends.
  contact_email text,
  -- Phone and app version, to help with problems.
  app_info jsonb not null default '{}'::jsonb
    check (jsonb_typeof(app_info) = 'object' and pg_column_size(app_info) < 2000),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  emailed_at timestamptz
);
create index if not exists support_tickets_user_idx on public.support_tickets (user_id, created_at);

alter table public.support_tickets enable row level security;

-- People file tickets as themselves and can see their own; only you (the
-- dashboard) change them.
drop policy if exists "support_tickets_insert_own" on public.support_tickets;
create policy "support_tickets_insert_own" on public.support_tickets
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "support_tickets_select_own" on public.support_tickets;
create policy "support_tickets_select_own" on public.support_tickets
  for select to authenticated using (user_id = (select auth.uid()));

-- Sets the reply-to address from their account, keeps the bookkeeping
-- columns out of their hands, and allows 5 tickets a day each.
create or replace function public.support_tickets_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from support_tickets
       where user_id = new.user_id and created_at > now() - interval '1 day') >= 5 then
    raise exception 'You’ve sent 5 messages today. We’ll get back to you on those first.'
      using errcode = '42501';
  end if;
  new.contact_email := (select email from auth.users where id = new.user_id);
  new.status := 'open';
  new.emailed_at := null;
  new.created_at := now();
  return new;
end;
$$;

revoke execute on function public.support_tickets_before_insert() from public, anon, authenticated;

drop trigger if exists support_tickets_before_insert on public.support_tickets;
create trigger support_tickets_before_insert
  before insert on public.support_tickets
  for each row execute function public.support_tickets_before_insert();


-- ----------------------------------------------------------------------------
-- EMAILING (same pattern as report-email.sql)
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'support_email_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'support_email_key');
  end if;
end $$;

create or replace function public.support_email_key_ok(key text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from vault.decrypted_secrets where name = 'support_email_key' and decrypted_secret = key
  );
$$;

revoke execute on function public.support_email_key_ok(text) from public, anon, authenticated;
grant execute on function public.support_email_key_ok(text) to service_role;

-- The next tickets to email, marked taken so none goes twice.
create or replace function public.claim_support_emails(max_rows integer default 20)
returns setof public.support_tickets
language sql security definer set search_path = public as $$
  update support_tickets t
     set emailed_at = now()
   where t.id in (
     select id from support_tickets
      where emailed_at is null and created_at > now() - interval '7 days'
      order by created_at
      limit max_rows
      for update skip locked
   )
  returning t.*;
$$;

revoke execute on function public.claim_support_emails(integer) from public, anon, authenticated;
grant execute on function public.claim_support_emails(integer) to service_role;

create or replace function public.poke_support_email()
returns void language sql security definer set search_path = public, extensions as $$
  select net.http_post(
    url := 'https://qwtvpmrxmlfuwmnyawcq.supabase.co/functions/v1/support-email',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-support-key', (select decrypted_secret from vault.decrypted_secrets where name = 'support_email_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$$;

create or replace function public.support_tickets_poke()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.poke_support_email();
  return null;
end;
$$;

revoke execute on function public.poke_support_email() from public, anon, authenticated;
revoke execute on function public.support_tickets_poke() from public, anon, authenticated;

drop trigger if exists support_tickets_poke on public.support_tickets;
create trigger support_tickets_poke
  after insert on public.support_tickets
  for each statement execute function public.support_tickets_poke();

select cron.unschedule('support-email')
 where exists (select 1 from cron.job where jobname = 'support-email');

select cron.schedule(
  'support-email',
  '*/10 * * * *',
  $job$
    select public.poke_support_email()
     where exists (select 1 from public.support_tickets
                    where emailed_at is null
                      and created_at < now() - interval '5 minutes'
                      and created_at > now() - interval '7 days');
  $job$
);
