// Plan limits per event (supabase/plan-limits.sql): people "going" (the
// host counts as one) and photos in the roll. null means no limit. The
// database refuses with "This event is full" / "The photo roll is full";
// these turn that into words for the person who hit it. Guests are never
// asked to pay: they're told the host knows. Hosts are shown how to make
// room.

import type { EventLimits } from './planLimitsText';
import { supabase } from './supabase';

export * from './planLimitsText';

// Someone couldn't join because it's full: let the host know (the server
// sends at most one push a day per event, and only when it really is full).
export function notifyHostFull(eventId: string): void {
  supabase.rpc('notify_event_full', { eid: eventId }).then(
    () => {},
    () => {}
  );
}

export async function loadEventLimits(eventId: string): Promise<EventLimits | null> {
  const { data, error } = await supabase.rpc('event_limits', { eid: eventId });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) return null;
  return {
    peopleLimit: row.people_limit ?? null,
    photosLimit: row.photos_limit ?? null,
    going: row.going ?? 0,
    photos: row.photos ?? 0,
  };
}

