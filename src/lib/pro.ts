import { supabase } from './supabase';

// SociaLink Pro: what it costs, what it adds, and the one Pro limit that's
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
export type UpgradeReason = 'scan' | 'settings';

export type ProPerk = { title: string; detail: string };

export const PRO_PERKS: ProPerk[] = [
  { title: 'Scan every receipt', detail: 'Free accounts get 3 scans a month.' },
  { title: 'Keep your events’ photos for good', detail: 'On free accounts they’re kept for 30 days.' },
  { title: 'Upload videos', detail: 'Up to 3 minutes each.' },
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
