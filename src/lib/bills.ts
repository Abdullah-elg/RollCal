import { PaymentMethod } from './paymentHandles';
import { supabase } from './supabase';

// Bills record what was bought and who has paid the person who paid. Nothing
// here moves money. See supabase/bills.sql for the tables and who may do what.

export type BillStatus = 'draft' | 'open' | 'settled';

export type Bill = {
  id: string;
  event_id: string;
  created_by: string;
  title: string | null;
  receipt_path: string | null;
  currency: string;
  subtotal_cents: number;
  tax_cents: number;
  tip_cents: number;
  other_fees_cents: number;
  status: BillStatus;
  last_reminded_at: string | null;
  // Set when a receipt in another currency was converted on sharing:
  // what it was in, and 1 of that = scanned_rate of the bill's currency.
  scanned_currency: string | null;
  scanned_rate: number | null;
  created_at: string;
};

export type BillItem = {
  id: string;
  bill_id: string;
  name: string;
  price_cents: number;
  quantity: number;
  position: number;
};

// A line on the review screen. id is set for a line already saved on a
// bill being edited, so payments made for it stay linked.
export type DraftItem = { id?: string; name: string; priceCents: number; quantity: number };

export type BillDraft = {
  eventId: string;
  title: string;
  currency: string;
  // What the receipt printed. For a bill typed in by hand it's the item total.
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  feesCents: number;
  items: DraftItem[];
  paymentMethodIds: string[];
  // A converted receipt (see Bill.scanned_currency).
  scannedCurrency?: string;
  scannedRate?: number;
};

export const itemsTotal = (items: { priceCents?: number; price_cents?: number; quantity: number }[]) =>
  items.reduce((sum, i) => sum + (i.priceCents ?? i.price_cents ?? 0) * i.quantity, 0);

// What everyone owes together: the lines plus tax, tip and fees.
export const billTotal = (bill: Bill, items: BillItem[]) =>
  itemsTotal(items) + bill.tax_cents + bill.tip_cents + bill.other_fees_cents;

export type BillSummary = {
  bill: Bill;
  totalCents: number;
  creatorName: string;
  // Received payments only; sent ones aren't visible to everyone.
  paidCents: number;
};

// The bills on an event: shared ones, plus the viewer's own drafts.
export async function listEventBills(eventId: string): Promise<BillSummary[]> {
  const { data: bills } = await supabase
    .from('bills')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false });
  if (!bills || bills.length === 0) return [];

  const ids = bills.map((b) => b.id);
  const [{ data: items }, { data: payments }, { data: people }] = await Promise.all([
    supabase.from('bill_items').select('bill_id, price_cents, quantity').in('bill_id', ids),
    supabase
      .from('bill_payments')
      .select('bill_id, amount_cents')
      .in('bill_id', ids)
      .eq('status', 'received'),
    supabase
      .from('profiles')
      .select('id, display_name, first_name')
      .in('id', [...new Set(bills.map((b) => b.created_by))]),
  ]);

  return (bills as Bill[]).map((bill) => {
    const lines = (items ?? []).filter((i) => i.bill_id === bill.id);
    const person = people?.find((p) => p.id === bill.created_by);
    return {
      bill,
      totalCents: itemsTotal(lines) + bill.tax_cents + bill.tip_cents + bill.other_fees_cents,
      creatorName: person?.first_name || person?.display_name || 'Someone',
      paidCents: (payments ?? [])
        .filter((p) => p.bill_id === bill.id)
        .reduce((sum, p) => sum + p.amount_cents, 0),
    };
  });
}

export type BillDetail = {
  bill: Bill;
  items: BillItem[];
  paymentMethods: PaymentMethod[];
  creatorName: string;
  eventTitle: string;
};

export async function loadBill(billId: string): Promise<BillDetail | null> {
  const { data: bill } = await supabase.from('bills').select('*').eq('id', billId).maybeSingle();
  if (!bill) return null;

  const [{ data: items }, { data: links }, { data: creator }, { data: event }] = await Promise.all([
    supabase.from('bill_items').select('*').eq('bill_id', billId).order('position'),
    supabase.from('bill_payment_methods').select('payment_method_id').eq('bill_id', billId),
    supabase
      .from('profiles')
      .select('display_name, first_name')
      .eq('id', bill.created_by)
      .maybeSingle(),
    supabase.from('events').select('title').eq('id', bill.event_id).maybeSingle(),
  ]);

  const methodIds = (links ?? []).map((l) => l.payment_method_id);
  const { data: methods } = methodIds.length
    ? await supabase.from('payment_methods').select('*').in('id', methodIds)
    : { data: [] };

  return {
    bill: bill as Bill,
    items: (items ?? []) as BillItem[],
    paymentMethods: (methods ?? []) as PaymentMethod[],
    creatorName: creator?.first_name || creator?.display_name || 'Someone',
    eventTitle: event?.title ?? '',
  };
}

// Saves the bill and shares it with the event in one go. The database only
// lets a bill start as a draft, so it's created as one, filled in, then
// opened. If any step fails, the half-made bill is deleted.
export async function createAndShareBill(
  userId: string,
  draft: BillDraft
): Promise<{ billId: string | null; error: string | null }> {
  const { data: bill, error: billError } = await supabase
    .from('bills')
    .insert({
      event_id: draft.eventId,
      created_by: userId,
      title: draft.title.trim() || null,
      currency: draft.currency,
      subtotal_cents: draft.subtotalCents,
      tax_cents: draft.taxCents,
      tip_cents: draft.tipCents,
      other_fees_cents: draft.feesCents,
      scanned_currency: draft.scannedCurrency ?? null,
      scanned_rate: draft.scannedRate ?? null,
    })
    .select('id')
    .single();
  if (billError || !bill) {
    // 42501 = row-level security said no: they're no longer in the event.
    return {
      billId: null,
      error:
        billError?.code === '42501'
          ? 'Only people in this event can add a bill to it.'
          : 'Could not save the bill. Please try again.',
    };
  }

  const fail = async () => {
    await supabase.from('bills').delete().eq('id', bill.id);
    return { billId: null, error: 'Could not share the bill. Please try again.' };
  };

  const { error: itemsError } = await supabase.from('bill_items').insert(
    draft.items.map((item, position) => ({
      bill_id: bill.id,
      name: item.name.trim(),
      price_cents: item.priceCents,
      quantity: item.quantity,
      position,
    }))
  );
  if (itemsError) return fail();

  if (draft.paymentMethodIds.length > 0) {
    const { error: methodsError } = await supabase
      .from('bill_payment_methods')
      .insert(draft.paymentMethodIds.map((id) => ({ bill_id: bill.id, payment_method_id: id })));
    if (methodsError) return fail();
  }

  const { error: openError } = await supabase
    .from('bills')
    .update({ status: 'open' })
    .eq('id', bill.id);
  if (openError) return fail();

  return { billId: bill.id, error: null };
}

// Saves changes to a shared bill in one go (see edit_bill in
// supabase/bill-edits.sql). Payments already made stay as they are.
export async function editBill(billId: string, draft: BillDraft): Promise<string | null> {
  const { error } = await supabase.rpc('edit_bill', {
    p_bill: billId,
    p_title: draft.title.trim(),
    p_tax: draft.taxCents,
    p_tip: draft.tipCents,
    p_fees: draft.feesCents,
    p_items: draft.items.map((item) => ({
      id: item.id ?? null,
      name: item.name.trim(),
      price_cents: item.priceCents,
      quantity: item.quantity,
    })),
  });
  return error ? 'Could not save your changes. Please try again.' : null;
}

// Deletes a bill with its lines and every payment recorded on it.
export async function deleteBill(billId: string): Promise<string | null> {
  const { error, count } = await supabase
    .from('bills')
    .delete({ count: 'exact' })
    .eq('id', billId);
  if (error || count === 0) return 'Could not delete the bill. Please try again.';
  return null;
}

// A saved bill as a draft for the review screen, to edit it.
export function draftFromBill(detail: BillDetail): BillDraft {
  const { bill, items } = detail;
  return {
    eventId: bill.event_id,
    title: bill.title ?? '',
    currency: bill.currency,
    subtotalCents: itemsTotal(items),
    taxCents: bill.tax_cents,
    tipCents: bill.tip_cents,
    feesCents: bill.other_fees_cents,
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      priceCents: i.price_cents,
      quantity: i.quantity,
    })),
    paymentMethodIds: detail.paymentMethods.map((m) => m.id),
  };
}
