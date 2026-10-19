// The currencies RollCal works in, and converting between them. No React
// Native imports, so `npm test` can run it.
//
// Only currencies with cents (two decimal places) are offered: amounts are
// stored as whole cents everywhere, which doesn't fit yen or won.

export type CurrencyInfo = { code: string; name: string };

export const CURRENCIES: CurrencyInfo[] = [
  { code: 'CAD', name: 'Canadian dollar' },
  { code: 'USD', name: 'US dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British pound' },
  { code: 'AUD', name: 'Australian dollar' },
  { code: 'NZD', name: 'New Zealand dollar' },
  { code: 'MXN', name: 'Mexican peso' },
  { code: 'BRL', name: 'Brazilian real' },
  { code: 'CHF', name: 'Swiss franc' },
  { code: 'SEK', name: 'Swedish krona' },
  { code: 'NOK', name: 'Norwegian krone' },
  { code: 'DKK', name: 'Danish krone' },
  { code: 'PLN', name: 'Polish złoty' },
  { code: 'TRY', name: 'Turkish lira' },
  { code: 'INR', name: 'Indian rupee' },
  { code: 'PKR', name: 'Pakistani rupee' },
  { code: 'PHP', name: 'Philippine peso' },
  { code: 'SGD', name: 'Singapore dollar' },
  { code: 'HKD', name: 'Hong Kong dollar' },
  { code: 'CNY', name: 'Chinese yuan' },
  { code: 'MYR', name: 'Malaysian ringgit' },
  { code: 'THB', name: 'Thai baht' },
  { code: 'AED', name: 'UAE dirham' },
  { code: 'SAR', name: 'Saudi riyal' },
  { code: 'QAR', name: 'Qatari riyal' },
  { code: 'EGP', name: 'Egyptian pound' },
  { code: 'MAD', name: 'Moroccan dirham' },
  { code: 'ILS', name: 'Israeli shekel' },
  { code: 'ZAR', name: 'South African rand' },
  { code: 'NGN', name: 'Nigerian naira' },
  { code: 'KES', name: 'Kenyan shilling' },
];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export const isSupportedCurrency = (code: string | null | undefined): code is string =>
  !!code && BY_CODE.has(code);

export const currencyName = (code: string): string => BY_CODE.get(code)?.name ?? code;

// "CAD · Canadian dollar"
export const currencyLabel = (code: string): string => `${code} · ${currencyName(code)}`;

// Exchange rates as "how many of this currency one US dollar buys", which is
// how fx_rates stores them.
export type Rates = Record<string, number>;

// 1 `from` = this many `to`, or null if either rate is missing.
export function rateBetween(from: string, to: string, rates: Rates): number | null {
  if (from === to) return 1;
  const a = rates[from];
  const b = rates[to];
  if (!(a > 0) || !(b > 0)) return null;
  return b / a;
}

// Converts whole cents, rounding to the nearest cent (halves up). null if a
// rate is missing.
export function convertCents(cents: number, from: string, to: string, rates: Rates): number | null {
  const rate = rateBetween(from, to, rates);
  if (rate === null) return null;
  return Math.round(cents * rate + Number.EPSILON * Math.sign(cents));
}

// "1 USD = 1.4132 CAD", with enough digits to be useful for any pair.
export function describeRate(from: string, to: string, rate: number): string {
  const digits = rate >= 100 ? 2 : rate >= 1 ? 4 : 6;
  return `1 ${from} = ${rate.toFixed(digits)} ${to}`;
}

// A bill's amounts, converted at one rate. Unit prices are converted (bills
// store a price per unit), so each line still equals price × quantity.
export type BillAmounts<I extends { priceCents: number }> = {
  items: I[];
  taxCents: number;
  tipCents: number;
  feesCents: number;
};

export function convertBill<I extends { priceCents: number }>(
  bill: BillAmounts<I>,
  rate: number
): BillAmounts<I> {
  const at = (cents: number) => Math.round(cents * rate + Number.EPSILON * Math.sign(cents));
  return {
    items: bill.items.map((item) => ({ ...item, priceCents: at(item.priceCents) })),
    taxCents: at(bill.taxCents),
    tipCents: at(bill.tipCents),
    feesCents: at(bill.feesCents),
  };
}
