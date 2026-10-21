import AsyncStorage from '@react-native-async-storage/async-storage';
import { type ItemPick, type PaidPick, resolvePick } from './billSplit';
import { supabase } from './supabase';

// Paying back the person who paid. Each person picks what they had on their
// own phone (kept here, never shared), then sends a payment: an amount plus
// the picks it covers. The creator marks it received, which is when the rest
// of the event sees it. See supabase/bills.sql for who may do what.

export type PaymentStatus = 'sent' | 'received';

export type Payment = {
  id: string;
  bill_id: string;
  user_id: string;
  amount_cents: number;
  status: PaymentStatus;
  created_at: string;
  received_at: string | null;
  items: { itemId: string; pick: PaidPick }[];
};

type PaymentItemRow = {
  item_id: string;
  mode: 'fraction' | 'amount';
  share_numerator: number;
  share_denominator: number;
  amount_cents: number | null;
};

const toPick = (row: PaymentItemRow): PaidPick =>
  row.mode === 'amount'
    ? { mode: 'amount', amountCents: row.amount_cents ?? 0 }
    : { mode: 'fraction', numerator: row.share_numerator, denominator: row.share_denominator };

// Every payment on the bill this person may see: their own, everyone's
// received ones, and, for the creator, the ones still waiting. Oldest first.
export async function loadPayments(billId: string): Promise<Payment[]> {
  const { data } = await supabase
    .from('bill_payments')
    .select(
      'id, bill_id, user_id, amount_cents, status, created_at, received_at, ' +
        'bill_payment_items(item_id, mode, share_numerator, share_denominator, amount_cents)'
    )
    .eq('bill_id', billId)
    .order('created_at');
  type Row = Omit<Payment, 'items'> & { bill_payment_items: PaymentItemRow[] };
  return ((data ?? []) as unknown as Row[]).map(({ bill_payment_items, ...payment }) => ({
    ...payment,
    items: bill_payment_items.map((row) => ({ itemId: row.item_id, pick: toPick(row) })),
  }));
}

export const receivedCents = (payments: Payment[]) =>
  payments.reduce((sum, p) => sum + (p.status === 'received' ? p.amount_cents : 0), 0);

// What's still owed on the bill. Never below zero: the last payments can
// overshoot by a cent or two (see billSplit.ts).
export const leftToPay = (totalCents: number, payments: Payment[]) =>
  Math.max(0, totalCents - receivedCents(payments));

// Sends a payment for these picks. The creator's own part counts as received
// straight away.
export async function sendPayment(
  billId: string,
  amountCents: number,
  picks: Record<string, ItemPick>,
  goingCount: number
): Promise<string | null> {
  const items = Object.entries(picks).map(([itemId, pick]) => {
    const stored = resolvePick(pick, goingCount);
    return stored.mode === 'amount'
      ? { item_id: itemId, mode: 'amount', amount_cents: stored.amountCents }
      : {
          item_id: itemId,
          mode: 'fraction',
          numerator: stored.numerator,
          denominator: stored.denominator,
        };
  });
  const { error } = await supabase.rpc('send_payment', {
    p_bill: billId,
    p_amount: amountCents,
    p_items: items,
  });
  if (!error) return null;
  if (error.message.includes('paid up')) return 'This bill is already paid up.';
  if (error.code === '42501') return "This bill isn't available any more.";
  return 'Could not send that. Please try again.';
}

// The creator says the money arrived, or takes that back.
export async function markReceived(paymentId: string, received: boolean): Promise<string | null> {
  const { data, error } = await supabase
    .from('bill_payments')
    .update({ status: received ? 'received' : 'sent' })
    .eq('id', paymentId)
    .select('id');
  // Row-level security turns a change you can't make into zero rows.
  return error || !data?.length ? 'Could not save that. Please try again.' : null;
}

// The sender takes back a payment that hasn't been received, or the creator
// turns down one that never arrived (or removes their own part).
export async function removePayment(paymentId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('bill_payments')
    .delete()
    .eq('id', paymentId)
    .select('id');
  if (error) return 'Could not remove that. Please try again.';
  return data?.length ? null : "That's already been received, so it can't be taken back.";
}

// Reminds everyone in the event. The database sets the time and allows one
// reminder per bill every 12 hours.
export async function remindEveryone(billId: string): Promise<string | null> {
  const { error } = await supabase
    .from('bills')
    .update({ last_reminded_at: new Date().toISOString() })
    .eq('id', billId);
  if (!error) return null;
  if (error.message.includes('recently')) return 'You already reminded everyone today.';
  if (error.message.includes('paid up')) return "Everyone's paid up.";
  return 'Could not send the reminder. Please try again.';
}

export const REMIND_GAP_MS = 12 * 60 * 60 * 1000;

// How many people "Split evenly" divides between: the host plus everyone
// who said they're going.
export async function countGoing(eventId: string): Promise<number> {
  const [{ data: event }, { data: rsvps }] = await Promise.all([
    supabase.from('events').select('creator_id').eq('id', eventId).maybeSingle(),
    supabase.from('rsvps').select('user_id').eq('event_id', eventId).eq('status', 'going'),
  ]);
  const people = new Set((rsvps ?? []).map((r) => r.user_id));
  if (event?.creator_id) people.add(event.creator_id);
  return Math.max(people.size, 1);
}

// name is the first name for captions; fullName feeds avatar initials so
// they match the rest of the app.
export type Person = { id: string; name: string; fullName: string; avatarUrl: string | null };

// Names and avatars for the people on a bill.
export async function loadPeople(userIds: string[]): Promise<Record<string, Person>> {
  if (userIds.length === 0) return {};
  const { data } = await supabase
    .from('profiles')
    .select('id, display_name, first_name, avatar_url')
    .in('id', userIds);
  const out: Record<string, Person> = {};
  for (const p of data ?? []) {
    out[p.id] = {
      id: p.id,
      name: p.first_name || p.display_name || 'Someone',
      fullName: p.display_name || p.first_name || 'Someone',
      avatarUrl: p.avatar_url ?? null,
    };
  }
  return out;
}

// Calls back whenever a payment on this bill is sent, received or removed.
// Removals only carry the payment id, so they're matched with isMine, which
// says whether an id belongs to this bill.
export function subscribeToPayments(
  billId: string,
  isMine: (paymentId: string) => boolean,
  onChange: () => void
): () => void {
  const channel = supabase
    .channel(`bill-payments-${billId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bill_payments' }, (payload) => {
      const row = payload.new as { bill_id?: string } | undefined;
      const gone = payload.old as { id?: string } | undefined;
      if (row?.bill_id === billId || (gone?.id && isMine(gone.id))) onChange();
    })
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

// ---------------------------------------------------------------------------
// Picks in progress
// Kept on this phone only, so nobody sees them until they're sent.
// ---------------------------------------------------------------------------

const picksKey = (userId: string, billId: string) => `rollcal.billPicks.${userId}.${billId}`;

export async function loadPicks(userId: string, billId: string): Promise<Record<string, ItemPick>> {
  try {
    const raw = await AsyncStorage.getItem(picksKey(userId, billId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function savePicks(
  userId: string,
  billId: string,
  picks: Record<string, ItemPick>
): Promise<void> {
  const key = picksKey(userId, billId);
  try {
    if (Object.keys(picks).length === 0) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, JSON.stringify(picks));
  } catch {
    // Losing a half-made selection isn't worth interrupting anyone for.
  }
}
