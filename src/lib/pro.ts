import { supabase } from './supabase';

// RollCal Pro: what it costs, what it adds, and the one Pro limit that's
// live so far (receipt scans). In-app purchases aren't set up yet, so the
// upgrade screen shows Pro as coming soon and profiles.is_pro is set by hand.

export const PRO_PRICES = {
  monthly: '$6.99',
  yearly: '$49.99',
  // Yearly against twelve months of monthly.
  yearlySaving: '40%',
  trialDays: 7,
};

// Why someone landed on the upgrade screen, so it can open on that perk.
export type UpgradeReason = 'scan' | 'video' | 'storage' | 'expiry' | 'settings';

// What the small Pro pop-up says when a free account reaches for a Pro
// feature: what they can't do, then what Pro would give them.
export type ProPromptReason = Exclude<UpgradeReason, 'settings'>;

export const PRO_PROMPTS: Record<ProPromptReason, { title: string; body: string }> = {
  video: {
    title: 'You can’t upload videos on a free account.',
    body: 'Get Pro to share videos up to a minute long.',
  },
  storage: {
    title: 'You’ve used this month’s 2 GB of uploads.',
    body: 'Uploads open again on the 1st, or get Pro for 200 GB a month.',
  },
  expiry: {
    title: 'This event’s photos will be deleted soon.',
    body: 'Free events keep photos for 30 days. Get Pro and every event you host keeps them for good.',
  },
  scan: {
    title: 'You’ve used this month’s free scan.',
    body: 'Type the lines in yourself, or get Pro to scan every receipt.',
  },
};

export type ProPerk = { title: string; detail: string };

export const PRO_PERKS: ProPerk[] = [
  { title: 'Scan every receipt', detail: 'Free accounts get 1 scan a month.' },
  { title: 'Keep your events’ photos for good', detail: 'On free accounts they’re kept for 30 days.' },
  { title: 'Upload videos', detail: 'Up to 1 minute each.' },
  { title: 'Upload 200 GB a month', detail: 'Photos and videos across all your events, up to 1 TB stored in total. Free accounts get 2 GB a month.' },
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
