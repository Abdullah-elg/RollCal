-- ============================================================================
-- RollCal - Currencies
-- Run after push.sql (it uses pg_cron and pg_net), before private-schema.sql.
-- Safe to re-run.
--
-- * Each person picks a preferred currency (asked at sign-up, changeable in
--   Settings). New bills are in it, and Pro prices are shown in it.
-- * A scanned receipt in another currency is converted when it's shared;
--   the bill remembers the receipt's currency and the rate used.
-- * Exchange rates come from open.er-api.com (ExchangeRate-API's free
--   feed: no key, updated daily) and are cached in fx_rates. Nothing about
--   anyone is sent; it's one request for the day's rates, twice a day.
-- ============================================================================

-- null until the person chooses; the app asks.
alter table public.profiles add column if not exists currency text;
alter table public.profiles drop constraint if exists profiles_currency_format;
alter table public.profiles add constraint profiles_currency_format
  check (currency is null or currency ~ '^[A-Z]{3}$');

-- A converted receipt: what it was in, and 1 of that = rate of the bill's
-- currency.
alter table public.bills add column if not exists scanned_currency text;
alter table public.bills add column if not exists scanned_rate numeric;
alter table public.bills drop constraint if exists bills_scanned_currency_format;
-- Both or neither (coalesce, because a null check would otherwise pass).
alter table public.bills add constraint bills_scanned_currency_format check (
  (scanned_currency is null and scanned_rate is null)
  or coalesce(scanned_currency ~ '^[A-Z]{3}$' and scanned_rate > 0, false)
);


-- ----------------------------------------------------------------------------
-- EXCHANGE RATES
-- ----------------------------------------------------------------------------
create table if not exists public.fx_rates (
  currency text primary key check (currency ~ '^[A-Z]{3}$'),
  -- How many of this currency one US dollar buys.
  per_usd numeric not null check (per_usd > 0),
  updated_at timestamptz not null default now()
);

alter table public.fx_rates enable row level security;

-- Public information: anyone signed in can read it; only the jobs below write.
drop policy if exists "fx_rates_select" on public.fx_rates;
create policy "fx_rates_select" on public.fx_rates
  for select to authenticated using (true);

-- The one request in flight, if any.
create table if not exists public.fx_fetch (
  id boolean primary key default true check (id),
  request_id bigint,
  requested_at timestamptz
);
alter table public.fx_fetch enable row level security;

-- Asks for fresh rates if ours are over 12 hours old. pg_net sends it after
-- the transaction commits; fx_ingest picks up the answer.
create or replace function public.fx_refresh()
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  rid bigint;
begin
  if exists (select 1 from fx_rates where updated_at > now() - interval '12 hours') then
    return;
  end if;
  -- One at a time; give an unanswered request 30 minutes before retrying.
  if exists (select 1 from fx_fetch where request_id is not null
                                     and requested_at > now() - interval '30 minutes') then
    return;
  end if;
  rid := net.http_get(url := 'https://open.er-api.com/v6/latest/USD', timeout_milliseconds := 20000);
  insert into fx_fetch (id, request_id, requested_at) values (true, rid, now())
  on conflict (id) do update set request_id = excluded.request_id, requested_at = excluded.requested_at;
end;
$$;

-- Saves the rates once the answer is in. Bad or partial answers are ignored
-- and the old rates kept.
create or replace function public.fx_ingest()
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  rid bigint;
  body jsonb;
  n integer := 0;
begin
  select request_id into rid from fx_fetch where id;
  if rid is null then
    return 0;
  end if;
  select case when status_code = 200 then content::jsonb end into body
    from net._http_response where id = rid;
  if not found then
    return 0; -- still waiting
  end if;
  update fx_fetch set request_id = null where id;
  if body is null or body->>'result' <> 'success' or jsonb_typeof(body->'rates') <> 'object' then
    return 0;
  end if;
  insert into fx_rates (currency, per_usd, updated_at)
  select key, value::text::numeric, now()
    from jsonb_each(body->'rates')
   where key ~ '^[A-Z]{3}$' and jsonb_typeof(value) = 'number' and value::text::numeric > 0
  on conflict (currency) do update set per_usd = excluded.per_usd, updated_at = excluded.updated_at;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.fx_refresh() from public, anon, authenticated;
revoke execute on function public.fx_ingest() from public, anon, authenticated;

-- Every 10 minutes: save any answer that came in, then ask again if the
-- rates are getting old (so about twice a day in practice).
select cron.unschedule('fx-rates')
 where exists (select 1 from cron.job where jobname = 'fx-rates');

select cron.schedule(
  'fx-rates',
  '*/10 * * * *',
  $job$
    select public.fx_ingest();
    select public.fx_refresh();
  $job$
);

-- Ask for the first rates now.
select public.fx_refresh();
