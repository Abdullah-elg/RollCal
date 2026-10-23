-- ============================================================================
-- RollCal - Zelle and "Other" payment methods
-- Run after bills.sql. Safe to re-run.
--
-- Adds two kinds of payment method to the four bills.sql allows:
--   zelle  an email or US phone number, like Interac
--   other  a short note in the person's own words, with an optional name
--          ("Wise") that shows in place of "Other"
-- The handle length check (1 to 100 characters) stays as it is. The name
-- limit matches PAYMENT_NAME_MAX in src/lib/limits.ts.
-- ============================================================================

alter table public.payment_methods drop constraint if exists payment_methods_type_check;
alter table public.payment_methods add constraint payment_methods_type_check
  check (type in ('interac', 'venmo', 'paypal', 'cashapp', 'zelle', 'other'));

alter table public.payment_methods add column if not exists label text;
alter table public.payment_methods drop constraint if exists payment_methods_label_check;
alter table public.payment_methods add constraint payment_methods_label_check
  check (label is null or (type = 'other' and char_length(btrim(label)) between 1 and 30));
