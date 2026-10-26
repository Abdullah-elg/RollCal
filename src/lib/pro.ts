import { convertCents, Rates } from './currency';
import { formatCents } from './money';
import { supabase } from './supabase';

// RollCal Pro: what it costs, what it adds, and the one Pro limit that's
// live so far (receipt scans). In-app purchases aren't set up yet, so the
// upgrade screen shows Pro as coming soon and profiles.is_pro is set by hand.

// Pro is priced in US dollars and shown in each person's currency at the
// day's exchange rate (see proPriceText). The stores charge their own local
// price; once purchases are live, show the store's price instead.
// Off until in-app purchases are set up (RevenueCat). While off, the upgrade
// screen says Pro is free during the beta and leaves out the billing terms.
export const PURCHASES_LIVE = false;

export const PRO_PRICES = {
  monthlyUsdCents: 499,
  yearlyUsdCents: 4999,
  // Yearly against twelve months of monthly.
  // $49.99 against 12 × $4.99 = $59.88 is 16.5%; rounded down, never up.
  yearlySaving: '16%',
  trialDays: 7,
};

export type ProPriceText = {
  monthly: string;
  yearly: string;
  // Shown converted from US dollars, so approximate.
  converted: boolean;
  // The US dollar prices, for the note under a converted price.
  usd: { monthly: string; yearly: string };
};

export function proPriceText(currency: string, rates: Rates | null): ProPriceText {
  const usd = {
    monthly: formatCents(PRO_PRICES.monthlyUsdCents, 'USD', { explicit: true }),
    yearly: formatCents(PRO_PRICES.yearlyUsdCents, 'USD', { explicit: true }),
  };
  const monthly = rates ? convertCents(PRO_PRICES.monthlyUsdCents, 'USD', currency, rates) : null;
  const yearly = rates ? convertCents(PRO_PRICES.yearlyUsdCents, 'USD', currency, rates) : null;
  if (currency === 'USD' || monthly === null || yearly === null) {
    return { monthly: usd.monthly, yearly: usd.yearly, converted: false, usd };
  }
  return {
    monthly: formatCents(monthly, currency, { explicit: true }),
    yearly: formatCents(yearly, currency, { explicit: true }),
    converted: true,
    usd,
  };
}

// Why someone landed on the upgrade screen, so it can open on that perk.
export type UpgradeReason = 'scan' | 'video' | 'storage' | 'expiry' | 'quiet' | 'settings';

// What the small Pro pop-up says when a free account reaches for a Pro
// feature: what they can't do, then what Pro would give them.
export type ProPromptReason = Exclude<UpgradeReason, 'settings'>;

export const PRO_PROMPTS: Record<ProPromptReason, { title: string; body: string }> = {
  video: {
    title: 'You can’t upload videos on a free account.',
    body: 'Get Pro to share videos up to a minute long.',
  },
  storage: {
    title: 'You’ve used your 2 GB of storage.',
    body: 'Remove some uploads to make room, or get Pro for 200 GB.',
  },
  expiry: {
    title: 'This event’s photos will be deleted soon.',
    body: 'Free events keep photos for 30 days. Get Pro and every event you host keeps them for good.',
  },
  quiet: {
    title: 'Quiet mode is part of Pro.',
    body: 'Stop friend requests from people you don’t know. You can still add anyone yourself.',
  },
  scan: {
    title: 'You’ve used this month’s free scans.',
    body: 'Type the lines in yourself, or get Pro to scan every receipt.',
  },
};

export type ProPerk = { title: string; detail: string };

export const PRO_PERKS: ProPerk[] = [
  { title: 'Scan every receipt', detail: 'Free accounts get 2 scans a month.' },
  { title: 'Keep your events’ photos for good', detail: 'On free accounts they’re kept for 30 days.' },
  { title: 'Upload videos', detail: 'Up to 1 minute each.' },
  { title: '200 GB of storage', detail: 'For photos and videos across all your events. Free accounts get 2 GB.' },
  { title: 'Full-resolution photos', detail: 'Free uploads are compressed.' },
  { title: 'Quiet mode', detail: 'Stop friend requests from people you don’t know.' },
];

// Free scans left this calendar month; null for Pro (no limit) or when it
// couldn't be checked, which only hides the count, since the scan function
// enforces the allowance itself (receipt_scans_left in bills.sql).
export async function loadScansLeft(): Promise<number | null> {
  const { data, error } = await supabase.rpc('receipt_scans_left');
  return error ? null : (data as number | null);
}
