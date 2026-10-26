import { supabase } from './supabase';

// The shared roll opens when an event starts and takes uploads until 48
// hours after it ends. The host can close it early, and reopen it for 24
// hours at a time, as many times as they like, even after that.

const HOUR = 60 * 60 * 1000;
const UPLOAD_WINDOW_MS = 48 * HOUR;
const REOPEN_MS = 24 * HOUR;

type RollEvent = { starts_at: string; ends_at: string; uploads_reopened_until?: string | null };

export function rollClosesAt(event: RollEvent): number {
  const window = new Date(event.ends_at).getTime() + UPLOAD_WINDOW_MS;
  const reopened = event.uploads_reopened_until
    ? new Date(event.uploads_reopened_until).getTime()
    : 0;
  return Math.max(window, reopened);
}

export function rollState(event: RollEvent, uploadsClosed: boolean, now = Date.now()) {
  const opensAt = new Date(event.starts_at).getTime();
  const closesAt = rollClosesAt(event);
  const beforeOpen = now < opensAt;
  // Inside the window the host can still toggle uploads off and on.
  const withinWindow = !beforeOpen && now <= closesAt;
  return {
    beforeOpen,
    withinWindow,
    uploadOpen: withinWindow && !uploadsClosed,
    closesAt,
    msLeft: closesAt - now,
  };
}

// Opens the roll for the next 24 hours. Returns the new close time.
export async function reopenRoll(
  eventId: string
): Promise<{ until: string | null; error: string | null }> {
  const until = new Date(Date.now() + REOPEN_MS).toISOString();
  const { error } = await supabase
    .from('events')
    .update({ uploads_closed: false, uploads_reopened_until: until })
    .eq('id', eventId);
  return error ? { until: null, error: error.message } : { until, error: null };
}
