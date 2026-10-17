import { supabase } from './supabase';

// When an event's photos and videos are deleted. Free hosts' events keep them
// for 30 days after the event; a Pro host's are kept for good. The rule
// lives in the database (photos_expire_at in supabase/expiry.sql), so the app,
// the warnings and the nightly cleanup always agree.

export type PhotoExpiry = {
  // null: kept for good (the host has Pro).
  expiresAt: string | null;
  // Set once the nightly cleanup has deleted them.
  expiredAt: string | null;
};

export async function loadPhotoExpiry(eventIds: string[]): Promise<Record<string, PhotoExpiry>> {
  if (eventIds.length === 0) return {};
  const { data, error } = await supabase.rpc('photos_expire_at', { event_ids: eventIds });
  if (error || !data) return {};
  const out: Record<string, PhotoExpiry> = {};
  for (const row of data as { event_id: string; expires_at: string | null; expired_at: string | null }[]) {
    out[row.event_id] = { expiresAt: row.expires_at, expiredAt: row.expired_at };
  }
  return out;
}

const DAY = 24 * 60 * 60 * 1000;

// Whole days left, rounded up: "3 days" until the last day, then "1 day".
export const daysLeft = (expiresAt: string, now = Date.now()) =>
  Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / DAY));

// From a week out, people should be told to save what they want.
export const WARN_DAYS = 7;
