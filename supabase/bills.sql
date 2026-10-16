-- ============================================================================
-- SociaLink - Bill splitting: tables, RLS, triggers and the receipts bucket
-- Run in the Supabase SQL editor after policies.sql. Safe to re-run.
--
-- No money moves through the app. A bill records what was bought and who has
-- paid the person who paid. Amounts are integer cents.
--
-- How a bill works:
--   * The person who paid shares the bill with the event.
--   * Each person picks what they had on their own phone. Picks are private
--     and never stored until they send a payment: "I'm paying $X for these".
--   * A sent payment is visible to the sender and the bill's creator. Once
--     the creator marks it received, everyone in the event sees it and it
--     comes off what's left to pay.
--   * The creator adds their own part the same way; it counts as received
--     straight away. When received payments cover the total, the bill settles.
--
-- Who can do what (enforced here, not just in the app):
--   * Anyone in an event can create a bill for it; members see shared ones.
--   * Scanning a receipt is Pro, apart from a few free scans a month,
--     counted in receipt_scans (see RECEIPT SCANS below).
--   * Only the creator edits a bill, marks payments received and reminds.
--   * Payments are sent through send_payment(), never inserted directly, and
--     can't be edited afterwards. The sender can take one back until it's
--     received; the creator can turn down one that never arrived.
--   * Payment methods are private to their owner, except the ones a creator
--     chose to show on a shared bill, which members of that event can read.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- PRO FLAG
-- In-app purchases aren't live yet, so profiles.is_pro is flipped by hand in
-- the dashboard (Table editor or SQL). Users can update their own profile
-- row, so a trigger stops them changing this column from the app.
-- ----------------------------------------------------------------------------
alter table public.profiles add column if not exists is_pro boolean not null default false;

create or replace function public.protect_is_pro()
returns trigger language plpgsql set search_path = public as $$
begin
  -- auth.role() is 'authenticated' or 'anon' for app requests, and empty for
  -- the dashboard and service role, which are allowed to change it.
  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.is_pro := false;
    elsif new.is_pro is distinct from old.is_pro then
      raise exception 'is_pro can only be changed by an admin';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_is_pro on public.profiles;
create trigger profiles_protect_is_pro
  before insert or update on public.profiles
  for each row execute function public.protect_is_pro();


-- ----------------------------------------------------------------------------
-- TABLES
-- ----------------------------------------------------------------------------

-- How someone gets paid back. handle is an email or phone for Interac, a
-- username or $cashtag for the others.
create table if not exists public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('interac', 'venmo', 'paypal', 'cashapp')),
  handle text not null check (char_length(btrim(handle)) between 1 and 100),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
-- At most one default per person.
create unique index if not exists payment_methods_one_default
  on public.payment_methods (user_id) where is_default;
create index if not exists payment_methods_user_id_idx on public.payment_methods (user_id);

-- One bill per receipt. created_by is the person who paid.
-- Total = sum of item lines + tax + tip + other fees. subtotal_cents is what
-- the receipt printed; the app compares it with the item lines to flag a
-- mismatch.
create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  title text check (title is null or char_length(title) <= 80),
  receipt_path text,
  currency text not null default 'CAD' check (currency ~ '^[A-Z]{3}$'),
  subtotal_cents integer not null default 0 check (subtotal_cents >= 0),
  tax_cents integer not null default 0 check (tax_cents >= 0),
  tip_cents integer not null default 0 check (tip_cents >= 0),
  other_fees_cents integer not null default 0 check (other_fees_cents >= 0),
  -- open while money is still owed; settled once received payments cover the
  -- total (see bill_settle_check).
  status text not null default 'draft' check (status in ('draft', 'open', 'settled')),
  -- Set when the creator taps Remind; everyone's app turns it into a
  -- notification next time it checks.
  last_reminded_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists bills_event_id_idx on public.bills (event_id);
create index if not exists bills_created_by_idx on public.bills (created_by);

-- price_cents is per unit; a line costs price_cents * quantity. Discounts
-- are entered by lowering a line's price, so nothing here goes negative.
create table if not exists public.bill_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  price_cents integer not null check (price_cents >= 0),
  quantity integer not null default 1 check (quantity between 1 and 999),
  position integer not null default 0
);
create index if not exists bill_items_bill_id_idx on public.bill_items (bill_id, position);

-- Money someone says they've sent the creator. The amount is whatever they
-- chose to pay; it doesn't have to match what they picked. sent -> received
-- when the creator says it arrived.
create table if not exists public.bill_payments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'sent' check (status in ('sent', 'received')),
  created_at timestamptz not null default now(),
  received_at timestamptz
);
create index if not exists bill_payments_bill_id_idx on public.bill_payments (bill_id);
create index if not exists bill_payments_user_id_idx on public.bill_payments (user_id);

-- What a payment was for: a fraction of an item's whole line (1/1, 1/2...)
-- or an exact amount of it. "Split evenly" is sent as 1/(people going).
create table if not exists public.bill_payment_items (
  payment_id uuid not null references public.bill_payments(id) on delete cascade,
  item_id uuid not null references public.bill_items(id) on delete cascade,
  mode text not null check (mode in ('fraction', 'amount')),
  share_numerator integer not null default 1,
  share_denominator integer not null default 1,
  amount_cents integer,
  primary key (payment_id, item_id),
  check (
    (mode = 'fraction' and amount_cents is null
       and share_numerator > 0 and share_denominator between 1 and 100
       and share_numerator <= share_denominator)
    or (mode = 'amount' and amount_cents > 0
       and share_numerator = 1 and share_denominator = 1)
  )
);
create index if not exists bill_payment_items_item_id_idx on public.bill_payment_items (item_id);

-- Which of the creator's payment methods appear on a bill.
create table if not exists public.bill_payment_methods (
  bill_id uuid not null references public.bills(id) on delete cascade,
  payment_method_id uuid not null references public.payment_methods(id) on delete cascade,
  primary key (bill_id, payment_method_id)
);
create index if not exists bill_payment_methods_method_idx
  on public.bill_payment_methods (payment_method_id);


-- ----------------------------------------------------------------------------
-- HELPER FUNCTIONS (SECURITY DEFINER, like the ones in policies.sql)
-- They read across tables without tripping each table's own RLS, which would
-- otherwise recurse. Signed-in users only.
-- ----------------------------------------------------------------------------

-- The creator always; event members once it's no longer a draft.
create or replace function public.can_see_bill(bid uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from bills b
    where b.id = bid
      and (b.created_by = uid or (b.status <> 'draft' and public.is_member(b.event_id, uid)))
  );
$$;

create or replace function public.is_bill_creator(bid uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from bills where id = bid and created_by = uid);
$$;

-- The sender and the creator see a payment from the start; the rest of the
-- event only once it's received.
create or replace function public.can_see_payment(pid uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from bill_payments p join bills b on b.id = p.bill_id
    where p.id = pid
      and (
        p.user_id = uid
        or b.created_by = uid
        or (p.status = 'received' and b.status <> 'draft' and public.is_member(b.event_id, uid))
      )
  );
$$;

-- A payment method is visible to others only while it's attached to a
-- shared bill in an event they belong to.
create or replace function public.can_see_payment_method(pmid uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from bill_payment_methods bpm join bills b on b.id = bpm.bill_id
    where bpm.payment_method_id = pmid
      and b.status <> 'draft'
      and public.is_member(b.event_id, uid)
  );
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.can_see_bill(uuid, uuid)',
    'public.is_bill_creator(uuid, uuid)',
    'public.can_see_payment(uuid, uuid)',
    'public.can_see_payment_method(uuid, uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;


-- ----------------------------------------------------------------------------
-- SENDING A PAYMENT
-- The only way to create one, so the payment and what it was for land
-- together or not at all, and nobody can send for someone else. p_items is a
-- JSON array of {item_id, mode, numerator, denominator, amount_cents}; it can
-- be empty when someone just pays an amount. The creator's own part counts as
-- received at once. Returns the new payment's id.
-- ----------------------------------------------------------------------------
create or replace function public.send_payment(p_bill uuid, p_amount integer, p_items jsonb default '[]')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  bill bills%rowtype;
  mine boolean;
  pid uuid;
begin
  select * into bill from bills where id = p_bill;
  if me is null or not found or bill.status = 'draft' or not public.is_member(bill.event_id, me) then
    raise exception 'This bill isn''t available' using errcode = '42501';
  end if;
  if bill.status <> 'open' then
    raise exception 'This bill is already paid up';
  end if;

  mine := bill.created_by = me;
  insert into bill_payments (bill_id, user_id, amount_cents, status, received_at)
  values (p_bill, me, p_amount,
          case when mine then 'received' else 'sent' end,
          case when mine then now() end)
  returning id into pid;

  insert into bill_payment_items
    (payment_id, item_id, mode, share_numerator, share_denominator, amount_cents)
  select pid,
         (x->>'item_id')::uuid,
         x->>'mode',
         coalesce((x->>'numerator')::integer, 1),
         coalesce((x->>'denominator')::integer, 1),
         (x->>'amount_cents')::integer
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x;

  if exists (
    select 1 from bill_payment_items pi join bill_items i on i.id = pi.item_id
    where pi.payment_id = pid and i.bill_id <> p_bill
  ) then
    raise exception 'That item isn''t on this bill';
  end if;

  return pid;
end;
$$;

revoke execute on function public.send_payment(uuid, integer, jsonb) from public, anon;
grant execute on function public.send_payment(uuid, integer, jsonb) to authenticated;


-- ----------------------------------------------------------------------------
-- RLS
-- With RLS on and no matching policy, access is denied. Policies use
-- (select auth.uid()) so Postgres evaluates it once per query, not per row.
-- ----------------------------------------------------------------------------
alter table public.payment_methods      enable row level security;
alter table public.bills                enable row level security;
alter table public.bill_items           enable row level security;
alter table public.bill_payments        enable row level security;
alter table public.bill_payment_items   enable row level security;
alter table public.bill_payment_methods enable row level security;

-- PAYMENT METHODS
-- Read: your own, plus methods a creator attached to a shared bill in one of
--       your events (so you can see where to send money).
-- Add / change / remove: your own only.
drop policy if exists "payment_methods_select" on public.payment_methods;
create policy "payment_methods_select" on public.payment_methods
  for select to authenticated
  using (user_id = (select auth.uid()) or public.can_see_payment_method(id, (select auth.uid())));

drop policy if exists "payment_methods_insert_own" on public.payment_methods;
create policy "payment_methods_insert_own" on public.payment_methods
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "payment_methods_update_own" on public.payment_methods;
create policy "payment_methods_update_own" on public.payment_methods
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "payment_methods_delete_own" on public.payment_methods;
create policy "payment_methods_delete_own" on public.payment_methods
  for delete to authenticated using (user_id = (select auth.uid()));

-- BILLS
-- Read: the creator always; event members once it's shared (drafts stay
--       private). The direct created_by check also lets the creator read
--       back a row they just inserted (see the RETURNING note in policies.sql).
-- Create: anyone, as themselves, in an event they belong to, and it starts
--         as a draft.
-- Edit / delete: the creator only.
drop policy if exists "bills_select" on public.bills;
create policy "bills_select" on public.bills
  for select to authenticated
  using (
    created_by = (select auth.uid())
    or (status <> 'draft' and public.is_member(event_id, (select auth.uid())))
  );

drop policy if exists "bills_insert_pro" on public.bills;
drop function if exists public.is_pro(uuid);
drop policy if exists "bills_insert_member" on public.bills;
create policy "bills_insert_member" on public.bills
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and status = 'draft'
    and public.is_member(event_id, (select auth.uid()))
  );

drop policy if exists "bills_update_creator" on public.bills;
create policy "bills_update_creator" on public.bills
  for update to authenticated
  using (created_by = (select auth.uid()))
  with check (
    created_by = (select auth.uid())
    and public.is_member(event_id, (select auth.uid()))
  );

drop policy if exists "bills_delete_creator" on public.bills;
create policy "bills_delete_creator" on public.bills
  for delete to authenticated using (created_by = (select auth.uid()));

-- BILL ITEMS
-- Read: anyone who can see the bill.
-- Add / edit / remove: the bill's creator only.
drop policy if exists "bill_items_select" on public.bill_items;
create policy "bill_items_select" on public.bill_items
  for select to authenticated using (public.can_see_bill(bill_id, (select auth.uid())));

drop policy if exists "bill_items_insert_creator" on public.bill_items;
create policy "bill_items_insert_creator" on public.bill_items
  for insert to authenticated with check (public.is_bill_creator(bill_id, (select auth.uid())));

drop policy if exists "bill_items_update_creator" on public.bill_items;
create policy "bill_items_update_creator" on public.bill_items
  for update to authenticated
  using (public.is_bill_creator(bill_id, (select auth.uid())))
  with check (public.is_bill_creator(bill_id, (select auth.uid())));

drop policy if exists "bill_items_delete_creator" on public.bill_items;
create policy "bill_items_delete_creator" on public.bill_items
  for delete to authenticated using (public.is_bill_creator(bill_id, (select auth.uid())));

-- BILL PAYMENTS
-- Read: see can_see_payment. The direct user_id check lets the sender read
--       back the row send_payment just made.
-- Create: send_payment() only, so there's no insert policy.
-- Update: the creator, to mark received or undo it. bill_payments_guard
--         keeps everything but the status fixed.
-- Delete: the sender takes back one that isn't received yet, or their own at
--         any time if they're the creator; the creator turns down one that
--         never arrived.
drop policy if exists "bill_payments_select" on public.bill_payments;
create policy "bill_payments_select" on public.bill_payments
  for select to authenticated
  using (user_id = (select auth.uid()) or public.can_see_payment(id, (select auth.uid())));

drop policy if exists "bill_payments_update_creator" on public.bill_payments;
create policy "bill_payments_update_creator" on public.bill_payments
  for update to authenticated
  using (public.is_bill_creator(bill_id, (select auth.uid())))
  with check (public.is_bill_creator(bill_id, (select auth.uid())));

drop policy if exists "bill_payments_delete" on public.bill_payments;
create policy "bill_payments_delete" on public.bill_payments
  for delete to authenticated
  using (
    (status = 'sent' and user_id = (select auth.uid()))
    or (
      public.is_bill_creator(bill_id, (select auth.uid()))
      and (status = 'sent' or user_id = (select auth.uid()))
    )
  );

-- BILL PAYMENT ITEMS
-- Read: whoever can see the payment. Written only by send_payment() and
--       removed with their payment.
drop policy if exists "bill_payment_items_select" on public.bill_payment_items;
create policy "bill_payment_items_select" on public.bill_payment_items
  for select to authenticated using (public.can_see_payment(payment_id, (select auth.uid())));

-- BILL PAYMENT METHODS
-- Read: anyone who can see the bill.
-- Attach / detach: the creator, and only their own payment methods.
drop policy if exists "bill_payment_methods_select" on public.bill_payment_methods;
create policy "bill_payment_methods_select" on public.bill_payment_methods
  for select to authenticated using (public.can_see_bill(bill_id, (select auth.uid())));

drop policy if exists "bill_payment_methods_insert_creator" on public.bill_payment_methods;
create policy "bill_payment_methods_insert_creator" on public.bill_payment_methods
  for insert to authenticated
  with check (
    public.is_bill_creator(bill_id, (select auth.uid()))
    and exists (
      select 1 from public.payment_methods pm
      where pm.id = payment_method_id and pm.user_id = (select auth.uid())
    )
  );

drop policy if exists "bill_payment_methods_delete_creator" on public.bill_payment_methods;
create policy "bill_payment_methods_delete_creator" on public.bill_payment_methods
  for delete to authenticated using (public.is_bill_creator(bill_id, (select auth.uid())));


-- ----------------------------------------------------------------------------
-- TRIGGERS
-- ----------------------------------------------------------------------------

-- RLS can't limit which columns change, so this does: only a payment's status
-- moves. received_at is set here so nobody can backdate it.
create or replace function public.bill_payments_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.bill_id <> old.bill_id or new.user_id <> old.user_id
     or new.amount_cents <> old.amount_cents or new.created_at <> old.created_at then
    raise exception 'Only a payment''s status can change';
  end if;
  if new.status = 'received' then
    if old.status <> 'received' then
      new.received_at := now();
    end if;
  else
    new.received_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists bill_payments_guard on public.bill_payments;
create trigger bill_payments_guard
  before update on public.bill_payments
  for each row execute function public.bill_payments_guard();

-- A shared bill settles itself once received payments cover its total, and
-- goes back to open if one is undone or removed.
create or replace function public.bill_settle_check()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  bid uuid := coalesce(new.bill_id, old.bill_id);
  total bigint;
  paid bigint;
  done boolean;
begin
  select b.tax_cents + b.tip_cents + b.other_fees_cents
         + coalesce((select sum(i.price_cents::bigint * i.quantity)
                       from bill_items i where i.bill_id = b.id), 0)
    into total
    from bills b where b.id = bid;
  select coalesce(sum(amount_cents), 0) into paid
    from bill_payments where bill_id = bid and status = 'received';
  done := total > 0 and paid >= total;

  update bills
     set status = case when done then 'settled' else 'open' end
   where id = bid
     and status in ('open', 'settled')
     and status <> case when done then 'settled' else 'open' end;
  return null;
end;
$$;

drop trigger if exists bill_settle_check on public.bill_payments;
create trigger bill_settle_check
  after insert or update or delete on public.bill_payments
  for each row execute function public.bill_settle_check();

-- Reminders: the time is set here, at most one every 12 hours per bill, and
-- only while money is still owed. Dashboard edits (no signed-in user) skip it.
create or replace function public.bills_remind_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.last_reminded_at is distinct from old.last_reminded_at and auth.uid() is not null then
    if old.status <> 'open' then
      raise exception 'Everyone''s paid up';
    end if;
    if old.last_reminded_at > now() - interval '12 hours' then
      raise exception 'You reminded everyone recently';
    end if;
    new.last_reminded_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists bills_remind_guard on public.bills;
create trigger bills_remind_guard
  before update on public.bills
  for each row execute function public.bills_remind_guard();

-- Trigger functions are never called directly over the API.
revoke execute on function public.protect_is_pro() from public, anon, authenticated;
revoke execute on function public.bill_payments_guard() from public, anon, authenticated;
revoke execute on function public.bill_settle_check() from public, anon, authenticated;
revoke execute on function public.bills_remind_guard() from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- RECEIPT SCANS
-- One row per successful scan, written by the scan-receipt edge function with
-- the service role. People can read their own rows (to see what's left) but
-- never add or remove any, so the free allowance can't be reset from the app.
-- ----------------------------------------------------------------------------
create table if not exists public.receipt_scans (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  scanned_at timestamptz not null default now()
);
create index if not exists receipt_scans_user_id_idx on public.receipt_scans (user_id, scanned_at);

alter table public.receipt_scans enable row level security;
drop policy if exists "receipt_scans_select_own" on public.receipt_scans;
create policy "receipt_scans_select_own" on public.receipt_scans
  for select to authenticated using (user_id = (select auth.uid()));

-- Free scans left this calendar month (UTC) for the signed-in user, or null
-- for Pro (no limit). The one place the allowance is set: the app shows it
-- and the edge function enforces it.
create or replace function public.receipt_scans_left()
returns integer language sql stable security invoker set search_path = public as $$
  select case
    when coalesce((select is_pro from profiles where id = auth.uid()), false) then null
    else greatest(0, 3 - (
      select count(*)::integer from receipt_scans
      where user_id = auth.uid() and scanned_at >= date_trunc('month', now())
    ))
  end;
$$;

revoke execute on function public.receipt_scans_left() from public, anon;
grant execute on function public.receipt_scans_left() to authenticated;


-- ----------------------------------------------------------------------------
-- REALTIME
-- Bill screens update live as payments are sent and received. Realtime
-- applies the select policies, so people only hear about rows they can see.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bill_payments'
  ) then
    alter publication supabase_realtime add table public.bill_payments;
  end if;
end $$;


-- ----------------------------------------------------------------------------
-- STORAGE: the receipts bucket
-- Private. Files live at {event_id}/{bill_id}.jpg and the policies read the
-- event id from the first folder.
-- Read: event members (and the uploader, so uploads can read their row back).
-- Upload / replace / delete: the uploader, inside an event they belong to.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "receipts_read_member" on storage.objects;
create policy "receipts_read_member" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'receipts'
    and (
      owner = (select auth.uid())
      or public.is_member(((storage.foldername(name))[1])::uuid, (select auth.uid()))
    )
  );

drop policy if exists "receipts_upload_member" on storage.objects;
create policy "receipts_upload_member" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and public.is_member(((storage.foldername(name))[1])::uuid, (select auth.uid()))
  );

drop policy if exists "receipts_update_owner" on storage.objects;
create policy "receipts_update_owner" on storage.objects
  for update to authenticated
  using (bucket_id = 'receipts' and owner = (select auth.uid()))
  with check (bucket_id = 'receipts' and owner = (select auth.uid()));

drop policy if exists "receipts_delete_owner" on storage.objects;
create policy "receipts_delete_owner" on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipts' and owner = (select auth.uid()));
