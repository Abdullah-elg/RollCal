-- ============================================================================
-- RollCal - Editing and deleting a shared bill
-- Run after bills.sql and security.sql. Safe to re-run; re-run it after
-- bills.sql, which defines an older bill_settle_check.
--
-- The person who paid can fix a bill after sharing it: rename it, change,
-- add or remove lines, and change tax, tip and fees. They can also delete it
-- (bills_delete_creator in bills.sql already allows that, and everything on
-- the bill goes with it).
--
-- Payments are never changed by an edit. They're money people say they sent,
-- so they stay; only what's left to pay moves. A payment for a line that's
-- removed stays too, it just no longer says what it was for.
--
-- Whether a bill is open or settled is worked out here from its payments and
-- total, every time either changes. Nobody can set it by hand.
-- ============================================================================


-- Whether received payments cover a bill's total.
create or replace function public.bill_paid_up(bid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select t.total > 0
           and coalesce((select sum(p.amount_cents) from bill_payments p
                          where p.bill_id = bid and p.status = 'received'), 0) >= t.total
      from (
        select b.tax_cents + b.tip_cents + b.other_fees_cents
               + coalesce((select sum(i.price_cents::bigint * i.quantity)
                             from bill_items i where i.bill_id = b.id), 0) as total
          from bills b where b.id = bid
      ) t
  ), false);
$$;

-- Moves a shared bill between open and settled to match. Drafts stay drafts.
create or replace function public.bill_resettle(bid uuid)
returns void language sql security definer set search_path = public as $$
  update bills
     set status = case when public.bill_paid_up(bid) then 'settled' else 'open' end
   where id = bid
     and status in ('open', 'settled')
     and status <> case when public.bill_paid_up(bid) then 'settled' else 'open' end;
$$;

revoke execute on function public.bill_paid_up(uuid) from public, anon, authenticated;
revoke execute on function public.bill_resettle(uuid) from public, anon, authenticated;


-- After a payment or a line changes (bill_payments and bill_items both have
-- bill_id).
create or replace function public.bill_settle_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.bill_resettle(coalesce(new.bill_id, old.bill_id));
  return null;
end;
$$;

-- After tax, tip or fees change.
create or replace function public.bills_amounts_settle()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.bill_resettle(new.id);
  return null;
end;
$$;

revoke execute on function public.bill_settle_check() from public, anon, authenticated;
revoke execute on function public.bills_amounts_settle() from public, anon, authenticated;

drop trigger if exists bill_settle_check on public.bill_payments;
create trigger bill_settle_check
  after insert or update or delete on public.bill_payments
  for each row execute function public.bill_settle_check();

drop trigger if exists bill_items_settle on public.bill_items;
create trigger bill_items_settle
  after insert or update or delete on public.bill_items
  for each row execute function public.bill_settle_check();

-- Only fires when one of these is in the update, so bill_resettle setting
-- the status doesn't loop back here.
drop trigger if exists bills_amounts_settle on public.bills;
create trigger bills_amounts_settle
  after update of tax_cents, tip_cents, other_fees_cents on public.bills
  for each row execute function public.bills_amounts_settle();


-- The status moves only two ways: draft to open when the bill is shared,
-- and between open and settled when that matches the payments. So a bill
-- can't be marked paid up early, or pulled back into a hidden draft once
-- people have seen it. Dashboard edits (no signed-in user) aren't limited.
create or replace function public.bills_status_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  expected text;
begin
  if new.status is distinct from old.status and auth.uid() is not null then
    if old.status = 'draft' and new.status = 'open' then
      return new;
    end if;
    expected := case when public.bill_paid_up(old.id) then 'settled' else 'open' end;
    if old.status in ('open', 'settled') and new.status = expected then
      return new;
    end if;
    raise exception 'A bill''s status follows its payments' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.bills_status_guard() from public, anon, authenticated;

drop trigger if exists bills_status_guard on public.bills;
create trigger bills_status_guard
  before update on public.bills
  for each row execute function public.bills_status_guard();


-- Saves an edit in one go, so nobody sees half of it. Runs as the caller,
-- so the creator-only policies in bills.sql still decide who can.
-- p_items is the whole new list in order: [{id?, name, price_cents,
-- quantity}]. Lines with an id are kept and updated, lines without one are
-- added, and lines left out are removed.
create or replace function public.edit_bill(
  p_bill uuid,
  p_title text,
  p_tax integer,
  p_tip integer,
  p_fees integer,
  p_items jsonb
)
returns void language plpgsql security invoker set search_path = public as $$
declare
  n integer := jsonb_array_length(coalesce(p_items, '[]'::jsonb));
begin
  if not public.is_bill_creator(p_bill, auth.uid()) then
    raise exception 'Only the person who paid can change this bill' using errcode = '42501';
  end if;
  if n < 1 or n > 200 then
    raise exception 'A bill needs between 1 and 200 lines';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) x
     where x->>'id' is not null
       and not exists (select 1 from bill_items i
                        where i.id = (x->>'id')::uuid and i.bill_id = p_bill)
  ) then
    raise exception 'That line isn''t on this bill';
  end if;

  delete from bill_items
   where bill_id = p_bill
     and id not in (select (x->>'id')::uuid from jsonb_array_elements(p_items) x
                     where x->>'id' is not null);

  update bill_items i
     set name = btrim(x.v->>'name'),
         price_cents = (x.v->>'price_cents')::integer,
         quantity = (x.v->>'quantity')::integer,
         position = x.ord - 1
    from jsonb_array_elements(p_items) with ordinality as x(v, ord)
   where x.v->>'id' is not null
     and i.id = (x.v->>'id')::uuid
     and i.bill_id = p_bill;

  insert into bill_items (bill_id, name, price_cents, quantity, position)
  select p_bill, btrim(x.v->>'name'), (x.v->>'price_cents')::integer,
         (x.v->>'quantity')::integer, x.ord - 1
    from jsonb_array_elements(p_items) with ordinality as x(v, ord)
   where x.v->>'id' is null;

  -- The receipt's printed subtotal no longer applies once lines change.
  update bills
     set title = nullif(btrim(p_title), ''),
         tax_cents = p_tax,
         tip_cents = p_tip,
         other_fees_cents = p_fees,
         subtotal_cents = (select coalesce(sum(price_cents * quantity), 0)
                             from bill_items where bill_id = p_bill)
   where id = p_bill;
end;
$$;

revoke execute on function public.edit_bill(uuid, text, integer, integer, integer, jsonb) from public, anon;
grant execute on function public.edit_bill(uuid, text, integer, integer, integer, jsonb) to authenticated;
