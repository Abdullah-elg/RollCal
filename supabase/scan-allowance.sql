-- ============================================================================
-- RollCal - Two free receipt scans a month
-- Run after bills.sql. Safe to re-run.
--
-- Free accounts get two scans each calendar month (UTC); Pro has no limit.
-- The scan-receipt edge function now counts every photo it reads, receipt
-- or not, so this number is the whole allowance. The app shows it and the
-- edge function enforces it, both through this one function.
-- ============================================================================

create or replace function public.receipt_scans_left()
returns integer language sql stable security invoker set search_path = public as $$
  select case
    when coalesce((select is_pro from profiles where id = auth.uid()), false) then null
    else greatest(0, 2 - (
      select count(*)::integer from receipt_scans
      where user_id = auth.uid() and scanned_at >= date_trunc('month', now())
    ))
  end;
$$;

revoke execute on function public.receipt_scans_left() from public, anon;
grant execute on function public.receipt_scans_left() to authenticated;
