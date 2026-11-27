import { convertCents, Rates } from './currency';
import { formatCents } from './money';
import { yearlySavingPercent } from './planPrices';
export { yearlySavingPercent };
import { supabase } from './supabase';
import type { Plan, Profile } from '../types';

// RollCal's plans (Basic, Plus, Pro, Event Pass): what they cost, what they add, and the one Pro limit that's
// live so far (receipt scans). In-app purchases aren't set up yet, so the
// upgrade screen shows Pro as coming soon and profiles.is_pro is set by hand.

// Pro is priced in US dollars and shown in each person's currency at the
// day's exchange rate (see proPriceText). The stores charge their own local
// price; once purchases are live, show the store's price instead.
// Off until in-app purchases are set up (RevenueCat). While off, the upgrade
// screen says Pro is free during the beta and leaves out the billing terms.
export const PURCHASES_LIVE = false;

// Prices in US cents (docs/MONETIZATION.md). Event Passes are one-offs, for
// one event and everyone in it, priced by how big the event is.
export const PLAN_PRICES = {
  plus: { monthlyUsdCents: 499, yearlyUsdCents: 3499 },
  // Pro is no longer sold; people already on it keep it.
  pro: { monthlyUsdCents: 699, yearlyUsdCents: 5999 },
  passes: { party: 599, bigday: 1999, unlimited: 2999 },
};

export type PassId = 'party' | 'bigday' | 'unlimited';
export type PlanId = 'free' | 'plus' | 'pro' | PassId;
export const PASS_IDS: PassId[] = ['party', 'bigday', 'unlimited'];
export const isPass = (id: PlanId): id is PassId => (PASS_IDS as PlanId[]).includes(id);
// The plans screen's cards, in order. Pro isn't sold any more.
export const PLAN_IDS: PlanId[] = ['free', 'plus', 'party', 'bigday', 'unlimited'];
export const PLAN_NAMES: Record<PlanId, string> = {
  free: 'Free',
  plus: 'Plus',
  pro: 'Pro',
  party: 'Party Pass',
  bigday: 'Big Day Pass',
  unlimited: 'Unlimited Pass',
};
// The plans screen's two groups: a subscription that covers every event you
// host, or a one-off pass for a single event.
export type PlanGroup = 'every' | 'one';
export const PLAN_GROUPS: Record<PlanGroup, PlanId[]> = {
  every: ['free', 'plus'],
  one: ['party', 'bigday', 'unlimited'],
};
export const PLAN_GROUP_NAMES: Record<PlanGroup, string> = {
  every: 'Every event',
  one: 'One event',
};
export const PLAN_GROUP_BLURBS: Record<PlanGroup, string> = {
  every: 'A subscription for people who host often. Covers every event you make.',
  one: 'Pay once for one big night. Everyone in the event gets the upgrade.',
};
// A pass's one line under its name.
export const PASS_BLURBS: Record<PassId, string> = {
  party: 'One event, up to 75 people. Everyone in it gets the upgrade.',
  bigday: 'For weddings and milestones: up to 300 people.',
  unlimited: 'No limit on people, for the biggest nights.',
};

export type Billing = 'monthly' | 'yearly';

// One price in the person's currency at the day's rate, or in US dollars
// when the rates haven't loaded (or they're already in dollars).
export function priceText(
  usdCents: number,
  currency: string,
  rates: Rates | null,
): { text: string; converted: boolean } {
  const local = rates && currency !== 'USD' ? convertCents(usdCents, 'USD', currency, rates) : null;
  if (local === null) return { text: formatCents(usdCents, 'USD', { explicit: true }), converted: false };
  // A straight conversion lands on prices like CA$42.04; round up to .99
  // the way store prices look, in currencies that have cents.
  const hasCents =
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits === 2;
  const shown = hasCents && local > 0 ? Math.ceil(local / 100) * 100 - 1 : local;
  return { text: formatCents(shown, currency, { explicit: true }), converted: true };
}

// Why someone landed on the upgrade screen, so it can open on that perk.
export type UpgradeReason = 'scan' | 'video' | 'storage' | 'expiry' | 'recap' | 'people' | 'photos' | 'settings';

// What the small Pro pop-up says when a free account reaches for a Pro
// feature: what they can't do, then what Pro would give them.
export type ProPromptReason = Exclude<UpgradeReason, 'settings'>;

export const PRO_PROMPTS: Record<ProPromptReason, { title: string; body: string }> = {
  video: {
    title: 'Free videos can be up to 15 seconds.',
    body: 'Get Plus or an Event Pass to share videos up to a minute long.',
  },
  storage: {
    title: 'You’ve used your 2 GB of storage.',
    body: 'Remove some uploads to make room, or get a paid plan for more room.',
  },
  expiry: {
    title: 'This event’s photos will be deleted soon.',
    body: 'On Basic, event photos are kept for a year. Get Plus and every event you host keeps them for good.',
  },
  people: {
    title: 'Your event is filling up.',
    body: 'Free events hold 10 people. An Event Pass makes room for 75, 300 or everyone, and Plus gives every event you host 100.',
  },
  photos: {
    title: 'The photo roll is full.',
    body: 'Free events hold 200 photos. An Event Pass or Plus makes the roll unlimited, in full size, kept forever.',
  },
  recap: {
    title: 'Video recaps come with Plus.',
    body: 'Turn the night into a 15-second to 1-minute video with captions, ready to share. Get Plus, or an Event Pass for this event.',
  },
  scan: {
    title: 'You’ve used this month’s receipt scans.',
    body: 'Type the lines in yourself, or move up a plan for more scans.',
  },
};

// The plan comparison: every card shows these rows in this order. true is
// included, false isn't, and text says how much. Keep in step with the
// limits the server enforces (plans.sql, expiry.sql).
export type PlanRow = { feature: string } & Record<PlanId, string | boolean>;

// One row per feature, the same rows on every card (docs/PLANS.md). Pro is
// kept for the people already on it.
const P = (party: string | boolean, bigday: string | boolean = party, unlimited: string | boolean = bigday) => ({
  party,
  bigday,
  unlimited,
});
export const PLAN_COMPARISON: PlanRow[] = [
  { feature: 'Events, RSVPs, invites, chat', free: true, plus: true, pro: true, ...P(true) },
  { feature: 'People per event', free: '10', plus: '100', pro: 'Unlimited', ...P('75', '300', 'Unlimited') },
  { feature: 'Photos per event', free: '200', plus: 'Unlimited', pro: 'Unlimited', ...P('Unlimited') },
  { feature: 'Photo quality', free: 'Compressed', plus: 'Full size', pro: 'Full size', ...P('Full size') },
  { feature: 'Videos', free: 'Up to 15 s', plus: 'Up to 1 min', pro: 'Up to 5 min', ...P('Up to 1 min') },
  { feature: 'Video recaps', free: '5-second preview', plus: true, pro: true, ...P(true) },
  { feature: 'Photos kept', free: '30 days', plus: 'Forever', pro: 'Forever', ...P('Forever') },
  { feature: 'Receipt scans', free: '1 / month', plus: '15 / month', pro: 'Unlimited', ...P(false) },
  { feature: 'Storage', free: '2 GB', plus: '50 GB', pro: '250 GB', ...P('10 GB', '30 GB', '60 GB') },
  { feature: 'Quiet mode', free: true, plus: true, pro: true, ...P(true) },
];

// Free scans left this calendar month; null for Pro (no limit) or when it
// couldn't be checked, which only hides the count, since the scan function
// enforces the allowance itself (receipt_scans_left in plans.sql).
export async function loadScansLeft(): Promise<number | null> {
  const { data, error } = await supabase.rpc('receipt_scans_left');
  return error ? null : (data as number | null);
}

// The plan that counts right now: the profile's plan, or Free once its end
// date has passed (the server's private.effective_plan in plans.sql; a daily
// job then sets it back to 'free'). Profiles loaded from before plans existed
// have no plan, so is_pro stands in.
export function planOf(
  profile: Pick<Profile, 'is_pro'> & Partial<Pick<Profile, 'plan' | 'plan_expires_at'>> | null | undefined,
  now: Date = new Date(),
): Plan {
  if (!profile) return 'free';
  const plan: Plan = profile.plan ?? (profile.is_pro ? 'pro' : 'free');
  if (plan !== 'free' && profile.plan_expires_at) {
    const ends = new Date(profile.plan_expires_at).getTime();
    if (!Number.isNaN(ends) && ends <= now.getTime()) return 'free';
  }
  return plan;
}
