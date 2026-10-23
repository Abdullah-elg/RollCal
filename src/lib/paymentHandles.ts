// Payment method types and handle rules. Pure, so it's unit-tested in Node;
// the database calls live in paymentMethods.ts.
import type { KeyboardTypeOptions } from 'react-native';

export type PaymentMethodType = 'interac' | 'venmo' | 'paypal' | 'cashapp' | 'zelle' | 'other';

export type PaymentMethod = {
  id: string;
  user_id: string;
  type: PaymentMethodType;
  handle: string;
  // The name they gave an "Other" method ("Wise"); null for the rest.
  label: string | null;
  is_default: boolean;
  created_at: string;
};

type TypeInfo = {
  label: string;
  shortLabel: string;
  fieldLabel: string;
  placeholder: string;
  keyboard: KeyboardTypeOptions;
  // Handles are usernames, emails and phones, except "other", which is a
  // sentence like "Wise: alex@example.com".
  capitalize?: boolean;
};

export const PAYMENT_TYPES: Record<PaymentMethodType, TypeInfo> = {
  interac: {
    label: 'Interac e-Transfer',
    shortLabel: 'Interac',
    fieldLabel: 'Email or phone',
    placeholder: 'you@example.com',
    keyboard: 'email-address',
  },
  venmo: {
    label: 'Venmo',
    shortLabel: 'Venmo',
    fieldLabel: 'Venmo username',
    placeholder: '@username',
    keyboard: 'default',
  },
  paypal: {
    label: 'PayPal',
    shortLabel: 'PayPal',
    fieldLabel: 'PayPal.Me username',
    placeholder: 'username',
    keyboard: 'default',
  },
  cashapp: {
    label: 'Cash App',
    shortLabel: 'Cash App',
    fieldLabel: '$Cashtag',
    placeholder: '$cashtag',
    keyboard: 'default',
  },
  zelle: {
    label: 'Zelle',
    shortLabel: 'Zelle',
    fieldLabel: 'Email or phone',
    placeholder: 'you@example.com',
    keyboard: 'email-address',
  },
  other: {
    label: 'Other',
    shortLabel: 'Other',
    fieldLabel: 'How to pay you',
    placeholder: 'Email, username or account details',
    keyboard: 'default',
    capitalize: true,
  },
};

// What a saved method is called on screen: the name they gave an "Other"
// method, or the service's name.
export function methodName(m: Pick<PaymentMethod, 'type' | 'label'>): string {
  return (m.type === 'other' && m.label?.trim()) || PAYMENT_TYPES[m.type].label;
}

// Tidies the optional name for an "Other" method: spaces collapsed, and
// empty means no name.
export function normalizeMethodName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ');
  return name || null;
}

export const PAYMENT_TYPE_ORDER: PaymentMethodType[] = [
  'interac',
  'venmo',
  'zelle',
  'cashapp',
  'paypal',
  'other',
];

// The ways people usually pay each other in a country (an ISO region code,
// like "CA"), shown first when adding a method; the rest sit behind "Show
// more". "Other" is always there for anything not listed.
const MAIN_TYPES: Record<string, PaymentMethodType[]> = {
  CA: ['interac', 'paypal', 'other'],
  US: ['venmo', 'zelle', 'cashapp', 'paypal', 'other'],
};
const MAIN_TYPES_ELSEWHERE: PaymentMethodType[] = ['paypal', 'other'];

export function paymentTypesFor(region: string | null | undefined): {
  main: PaymentMethodType[];
  more: PaymentMethodType[];
} {
  const main = MAIN_TYPES[(region ?? '').toUpperCase()] ?? MAIN_TYPES_ELSEWHERE;
  return { main, more: PAYMENT_TYPE_ORDER.filter((t) => !main.includes(t)) };
}

const EMAIL_RULE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VENMO_RULE = /^[A-Za-z0-9_-]{5,30}$/;
const PAYPAL_RULE = /^[A-Za-z0-9]{1,20}$/;
const CASHTAG_RULE = /^[A-Za-z][A-Za-z0-9]{0,19}$/;
const PAYPAL_LINK = /(?:paypal\.me|paypal\.com\/paypalme)\/([^/?#\s]+)/i;

export type NormalizeResult = { handle: string } | { error: string };

export function normalizeHandle(type: PaymentMethodType, raw: string): NormalizeResult {
  const text = raw.trim();

  if (type === 'other') {
    const note = text.replace(/\s+/g, ' ');
    return note.length >= 2 && note.length <= 100
      ? { handle: note }
      : { error: 'Say how to pay you, in up to 100 characters.' };
  }

  // Interac and Zelle both take an email or a North American phone number.
  if (type === 'interac' || type === 'zelle') {
    const error = 'Enter an email or a 10-digit phone number.';
    if (text.includes('@')) {
      return EMAIL_RULE.test(text) ? { handle: text.toLowerCase() } : { error };
    }
    const digits = text.replace(/[\s\-.()]/g, '');
    const match = /^\+?(1?)(\d{10})$/.exec(digits);
    // An 11-digit number only counts when it starts with the country code 1.
    if (!match || (digits.replace('+', '').length === 11 && match[1] !== '1')) {
      return { error };
    }
    return { handle: `+1${match[2]}` };
  }

  if (type === 'venmo') {
    const name = text.replace(/^@/, '');
    return VENMO_RULE.test(name)
      ? { handle: name }
      : { error: 'Venmo usernames are 5–30 letters, numbers, - or _.' };
  }

  if (type === 'paypal') {
    const link = PAYPAL_LINK.exec(text);
    const name = link ? link[1] : text;
    return PAYPAL_RULE.test(name)
      ? { handle: name }
      : { error: 'Enter your PayPal.Me username.' };
  }

  const tag = text.replace(/^\$/, '');
  return CASHTAG_RULE.test(tag)
    ? { handle: `$${tag}` }
    : { error: 'Cashtags start with a letter, like $alex.' };
}

export function formatHandle(type: PaymentMethodType, handle: string): string {
  if (type === 'venmo') return `@${handle}`;
  if (type === 'cashapp') return handle.startsWith('$') ? handle : `$${handle}`;
  if (type === 'paypal') return `paypal.me/${handle}`;
  if (type === 'other') return handle;
  const phone = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(handle);
  return phone ? `(${phone[1]}) ${phone[2]}-${phone[3]}` : handle;
}

// What the Pay button copies: what you'd paste into that app's "send to"
// box. Phones go as 10 plain digits, which Canadian and US bank apps accept.
export function copyableHandle(type: PaymentMethodType, handle: string): string {
  if (type === 'interac' || type === 'zelle') {
    const phone = /^\+1(\d{10})$/.exec(handle);
    return phone ? phone[1] : handle;
  }
  if (type === 'venmo') return `@${handle}`;
  if (type === 'cashapp') return handle.startsWith('$') ? handle : `$${handle}`;
  return handle;
}
