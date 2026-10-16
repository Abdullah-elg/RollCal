// The bill-splitting maths. Pure: no React, no Supabase, no floats for money.
//
// People pay for their own picks at their own pace, so each person's amount
// is worked out on its own: the share of each item's line (price x quantity)
// they picked, plus tax, tip and fees in proportion to that share of the
// items. Everything is an exact fraction (BigInt numerator/denominator) until
// the very end.
//
// The total is rounded up to the cent. Rounding to nearest could leave a bill
// a cent short forever (three people each paying a third of $10.00 would pay
// $9.99); rounding up means the payments always cover the bill, and nobody
// pays more than a cent over their exact share.

// One person's pick on one item. 'even' is the "Split evenly" chip: an equal
// share between everyone going to the event.
export type ItemPick =
  | { mode: 'fraction'; numerator: number; denominator: number }
  // An exact amount of the item's line, e.g. "$7.50 of the nachos".
  | { mode: 'amount'; amountCents: number }
  | { mode: 'even' };

// A pick as it's stored with a payment (a bill_payment_items row).
export type PaidPick =
  | { mode: 'fraction'; numerator: number; denominator: number }
  | { mode: 'amount'; amountCents: number };

export type Line = { id: string; priceCents: number; quantity: number };

export type Extras = { taxCents: number; tipCents: number; feesCents: number };

export type Quote = {
  subtotalCents: number;
  // Their share of tax, tip and fees together.
  extrasCents: number;
  totalCents: number;
};

// How much of an item the people who've paid have covered.
export type ItemState = 'unpaid' | 'partial' | 'full' | 'over';

export type Coverage = {
  itemId: string;
  lineCents: number;
  state: ItemState;
  // 1 is exactly all of it. For display only (it's a float).
  covered: number;
};

// The database allows shares down to 1/100.
export const MAX_SPLIT = 100;

// ---------------------------------------------------------------------------
// Exact fractions
// ---------------------------------------------------------------------------

type Q = { n: bigint; d: bigint }; // d > 0, reduced

const ZERO: Q = { n: 0n, d: 1n };
const ONE: Q = { n: 1n, d: 1n };

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a === 0n ? 1n : a;
}

function q(n: bigint, d: bigint = 1n): Q {
  if (d === 0n) throw new RangeError('Division by zero');
  if (d < 0n) [n, d] = [-n, -d];
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

const add = (a: Q, b: Q) => q(a.n * b.d + b.n * a.d, a.d * b.d);
const mul = (a: Q, b: Q) => q(a.n * b.n, a.d * b.d);
const cmp = (a: Q, b: Q) => {
  const l = a.n * b.d;
  const r = b.n * a.d;
  return l < r ? -1 : l > r ? 1 : 0;
};

// Only used on non-negative values.
const roundHalfUp = (a: Q) => (2n * a.n + a.d) / (2n * a.d);
const roundUp = (a: Q) => (a.n + a.d - 1n) / a.d;

function cents(value: number, name: string): bigint {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a whole, non-negative number of cents`);
  }
  return BigInt(value);
}

function lineOf(item: Line): bigint {
  if (!Number.isInteger(item.quantity) || item.quantity < 1) {
    throw new RangeError('quantity must be a whole number of at least 1');
  }
  return cents(item.priceCents, 'priceCents') * BigInt(item.quantity);
}

// ---------------------------------------------------------------------------
// Picks
// ---------------------------------------------------------------------------

// What gets stored: "Split evenly" becomes 1/(people going), kept within
// what the database allows.
export function resolvePick(pick: ItemPick, goingCount: number): PaidPick {
  if (pick.mode !== 'even') return pick;
  const people = Math.min(Math.max(Math.floor(goingCount), 1), MAX_SPLIT);
  return { mode: 'fraction', numerator: 1, denominator: people };
}

// The exact share of an item's line a pick stands for. An amount is capped
// at the line, so a stale pick on a cheaper line can't overcharge.
function shareOf(pick: PaidPick, line: bigint): Q {
  if (pick.mode === 'amount') {
    const amount = cents(pick.amountCents, 'amountCents');
    if (line === 0n) return ZERO;
    return q(amount < line ? amount : line, line);
  }
  const { numerator, denominator } = pick;
  if (
    !Number.isInteger(numerator) ||
    !Number.isInteger(denominator) ||
    numerator < 1 ||
    denominator < 1 ||
    numerator > denominator
  ) {
    throw new RangeError('A pick must be a whole-number fraction between 0 and 1');
  }
  return q(BigInt(numerator), BigInt(denominator));
}

// What one person owes for their picks. picks is keyed by item id; picks on
// items that aren't on the bill are ignored.
export function quotePicks(
  items: Line[],
  extras: Extras,
  picks: Record<string, ItemPick>,
  goingCount: number
): Quote {
  const fees =
    cents(extras.taxCents, 'taxCents') +
    cents(extras.tipCents, 'tipCents') +
    cents(extras.feesCents, 'feesCents');

  let itemsTotal = 0n;
  let spend = ZERO;
  for (const item of items) {
    const line = lineOf(item);
    itemsTotal += line;
    const pick = picks[item.id];
    if (pick) spend = add(spend, mul(q(line), shareOf(resolvePick(pick, goingCount), line)));
  }

  // Extras follow the share of the items. A bill of free items has no share
  // to follow, so nobody is charged extras through it.
  const total = itemsTotal > 0n ? add(spend, mul(spend, q(fees, itemsTotal))) : spend;
  const totalCents = roundUp(total);
  const subtotal = roundHalfUp(spend);
  const subtotalCents = subtotal < totalCents ? subtotal : totalCents;
  return {
    subtotalCents: Number(subtotalCents),
    extrasCents: Number(totalCents - subtotalCents),
    totalCents: Number(totalCents),
  };
}

// How much of each item the given payments cover, from their stored picks.
export function itemCoverage(
  items: Line[],
  paid: { itemId: string; pick: PaidPick }[]
): Coverage[] {
  return items.map((item) => {
    const line = lineOf(item);
    const covered = paid
      .filter((p) => p.itemId === item.id)
      .reduce((sum, p) => add(sum, shareOf(p.pick, line)), ZERO);
    const vsAll = cmp(covered, ONE);
    return {
      itemId: item.id,
      lineCents: Number(line),
      covered: Number(covered.n) / Number(covered.d),
      state: vsAll > 0 ? 'over' : vsAll === 0 ? 'full' : covered.n > 0n ? 'partial' : 'unpaid',
    };
  });
}

// ---------------------------------------------------------------------------
// Small helpers for the review screen
// ---------------------------------------------------------------------------

// A percentage of an amount, e.g. an 18% tip. The percentage is typed by a
// person, so it's turned into whole basis points (18.5% -> 1850) before any
// maths. Halves round up.
export function percentOf(amountCents: number, percent: number): number {
  const base = cents(amountCents, 'amountCents');
  if (!Number.isFinite(percent) || percent < 0) throw new RangeError('percent must be 0 or more');
  const basisPoints = BigInt(Math.round(percent * 100));
  return Number(roundHalfUp(q(base * basisPoints, 10000n)));
}

// Difference between the item lines and the subtotal printed on the receipt.
// Zero means they match.
export function subtotalMismatch(items: Pick<Line, 'priceCents' | 'quantity'>[], receiptSubtotalCents: number): number {
  const lines = items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0);
  return lines - receiptSubtotalCents;
}
