// Where a Pay button sends someone. Pure, so it's unit-tested in Node.
//
// Link formats, checked October 2026:
//   PayPal.Me  paypal.me/{name}/{amount}{CUR}           (PayPal help: "What is PayPal.Me?")
//   Venmo      venmo.com/{user}?txn=pay&amount=&note=   (venmo.com/paymentlinks)
//   Cash App   cash.app/${tag}/{amount}                 (amount only, no note)
// All three are https links, so they open the app when it's installed and the
// website when it isn't. Interac has no link: it's sent from a bank app, so
// the caller copies the handle instead (copyableHandle).
import type { PaymentMethodType } from './paymentHandles';

// 2340 -> "23.40". No symbol or grouping, which is what the links expect.
function plainAmount(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export function paymentLink(
  type: PaymentMethodType,
  handle: string,
  amountCents: number,
  currency: string,
  billTitle: string
): string | null {
  const amount = plainAmount(amountCents);
  if (type === 'paypal') {
    return `https://paypal.me/${encodeURIComponent(handle)}/${amount}${currency}`;
  }
  if (type === 'venmo') {
    const note = encodeURIComponent(`SociaLink: ${billTitle.trim() || 'Bill'}`);
    return `https://venmo.com/${encodeURIComponent(handle)}?txn=pay&amount=${amount}&note=${note}`;
  }
  if (type === 'cashapp') {
    return `https://cash.app/$${encodeURIComponent(handle.replace(/^\$/, ''))}/${amount}`;
  }
  return null;
}
