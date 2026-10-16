// Money in, money out. Amounts are always whole cents; these helpers are the
// only places text becomes cents or cents become text.

// "12", "12.5", "$12.50", "1,234.56", ".99" -> cents. Anything else (more
// than two decimals, letters, negatives) -> null. Parsed as text, never as a
// float, so 0.1 + 0.2 problems can't creep in.
export function parseCents(text: string): number | null {
  const clean = text.trim().replace(/^\$/, '').replace(/,/g, '').trim();
  const match = /^(\d*)(?:\.(\d{0,2}))?$/.exec(clean);
  if (!match || (match[1] === '' && !match[2])) return null;
  const dollars = match[1] === '' ? 0 : Number(match[1]);
  const cents = Number((match[2] ?? '').padEnd(2, '0'));
  const total = dollars * 100 + cents;
  return Number.isSafeInteger(total) ? total : null;
}

// Cents -> "$23.40" in the bill's currency, with the phone's digit grouping.
// The symbol is added here rather than by Intl: Android's Intl ignores
// currencyDisplay: 'narrowSymbol' and prints "CA$" on phones set to another
// region. Dividing by 100 is display only; nothing is calculated from it.
const SYMBOLS: Record<string, string> = {
  CAD: '$',
  USD: '$',
  AUD: '$',
  NZD: '$',
  EUR: '€',
  GBP: '£',
};

export function formatCents(cents: number, currency = 'CAD'): string {
  const amount = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(cents) / 100);
  const sign = cents < 0 ? '-' : '';
  const symbol = SYMBOLS[currency];
  return symbol ? `${sign}${symbol}${amount}` : `${sign}${amount} ${currency}`;
}

// Cents -> "23.40" for a text field the person can edit.
export function centsToInput(cents: number): string {
  const whole = Math.floor(cents / 100);
  const part = String(cents % 100).padStart(2, '0');
  return `${whole}.${part}`;
}
