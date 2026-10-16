// Turns what Gemini read off a receipt into the app's bill draft. Pure, so
// it's unit-tested in Node alongside the app (npm test).
//
// Gemini only copies what's printed; all the arithmetic happens here, the
// same way every time. Amounts arrive as printed strings and become whole
// cents without ever being floats.

export type ScannedLine = { name: string; quantity: number; line_total: string };

export type Scan = {
  is_receipt: boolean;
  merchant?: string | null;
  currency?: string | null;
  items: ScannedLine[];
  subtotal?: string | null;
  tax?: string | null;
  tip?: string | null;
  fees?: string | null;
  total?: string | null;
};

export type DraftLine = { name: string; priceCents: number; quantity: number };

export type ScannedDraft = {
  title: string;
  currency: string | null;
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  feesCents: number;
  items: DraftLine[];
};

export const MAX_ITEMS = 100;

// "12", "$12.5", "1,234.56" -> cents; "-2.00", "(2.00)", "2.00-" -> negative
// cents for credits. Anything else (more than two decimals, letters) -> null.
export function signedCents(text: string | null | undefined): number | null {
  if (typeof text !== 'string') return null;
  let clean = text.trim().replace(/,/g, '').replace(/\s/g, '');
  let negative = false;
  if (/^\(.*\)$/.test(clean)) {
    negative = true;
    clean = clean.slice(1, -1);
  }
  if (clean.endsWith('-')) {
    negative = true;
    clean = clean.slice(0, -1);
  }
  clean = clean.replace(/^[^\d.-]+/, '');
  if (clean.startsWith('-')) {
    negative = true;
    clean = clean.slice(1).replace(/^[^\d.]+/, '');
  }
  const match = /^(\d*)(?:\.(\d{0,2}))?$/.exec(clean);
  if (!match || (match[1] === '' && !match[2])) return null;
  const value = Number(match[1] || '0') * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(value)) return null;
  return negative ? -value : value;
}

// For tax, tip, fees and totals: a charge, never a credit.
export function cents(text: string | null | undefined): number | null {
  const value = signedCents(text);
  return value === null || value < 0 ? null : value;
}

export function toDraft(scan: Scan): ScannedDraft {
  // Lines as printed, each with its whole line total.
  const lines: { name: string; quantity: number; totalCents: number }[] = [];
  for (const line of scan.items ?? []) {
    const name = String(line.name ?? '').trim().slice(0, 80);
    const amount = signedCents(line.line_total);
    if (!name || amount === null || amount === 0) continue;
    if (amount > 0) {
      const quantity =
        Number.isInteger(line.quantity) && line.quantity >= 1 && line.quantity <= 999 ? line.quantity : 1;
      lines.push({ name, quantity, totalCents: amount });
      continue;
    }
    // A discount comes off the lines above it, nearest first, the way
    // receipts print them under the item they apply to. One with nothing
    // above it has nothing to come off.
    let credit = -amount;
    for (let i = lines.length - 1; i >= 0 && credit > 0; i--) {
      const taken = Math.min(credit, lines[i].totalCents);
      lines[i].totalCents -= taken;
      credit -= taken;
    }
  }

  const items: DraftLine[] = [];
  for (const { name, quantity, totalCents } of lines) {
    if (totalCents <= 0) continue;
    // Prices are stored per unit. When a line doesn't split into whole cents
    // per unit (often after a discount), it stays one line so the total is
    // exact and the quantity moves into the name.
    if (quantity > 1 && totalCents % quantity === 0) {
      items.push({ name, priceCents: totalCents / quantity, quantity });
    } else {
      items.push({ name: quantity > 1 ? `${quantity} × ${name}` : name, priceCents: totalCents, quantity: 1 });
    }
    if (items.length === MAX_ITEMS) break;
  }

  const itemsCents = items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0);
  const currency =
    typeof scan.currency === 'string' && /^[A-Z]{3}$/.test(scan.currency) ? scan.currency : null;
  return {
    title: String(scan.merchant ?? '').trim().slice(0, 80),
    currency,
    // The printed subtotal lets the review screen flag a missed line.
    subtotalCents: cents(scan.subtotal) ?? itemsCents,
    taxCents: cents(scan.tax) ?? 0,
    tipCents: cents(scan.tip) ?? 0,
    feesCents: cents(scan.fees) ?? 0,
    items,
  };
}
