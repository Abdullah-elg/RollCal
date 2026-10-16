-- ============================================================================
-- One-off migration, 2026-10-15: shared claims and creator-sent shares become
-- private picks and payments (see the header of bills.sql).
--
-- Run this first, then run all of bills.sql again. Existing claims and shares
-- are test data and are removed; bills, items and payment methods are kept.
-- ============================================================================
begin;

drop table if exists public.item_claims cascade;
drop table if exists public.bill_shares cascade;

drop function if exists public.can_claim_item(uuid, uuid);
drop function if exists public.can_see_bill_item(uuid, uuid);
drop function if exists public.bill_shares_guard();
drop function if exists public.bill_shares_new();

alter table public.bills drop column if exists split_rest_evenly;
alter table public.bills add column if not exists last_reminded_at timestamptz;

-- Shares no longer exist, so any bill settled by them is open again until
-- payments cover it.
update public.bills set status = 'open' where status = 'settled';

commit;
