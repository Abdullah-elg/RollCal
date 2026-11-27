// Plan-limit wording and the meter (no network), so it can be tested alone.
// See planLimits.ts.

export type EventLimits = {
  peopleLimit: number | null;
  photosLimit: number | null;
  going: number;
  photos: number;
};

export const EVENT_FULL = 'This event is full';
export const ROLL_FULL = 'The photo roll is full';

export const isEventFull = (message: string | null | undefined) => !!message && message.includes(EVENT_FULL);
export const isRollFull = (message: string | null | undefined) => !!message && message.includes(ROLL_FULL);

// For someone trying to join or RSVP "going".
export const GUEST_FULL_MESSAGE = 'This event is full. We’ve let the host know.';
// For the host approving someone into a full event.
export const HOST_FULL_MESSAGE = 'Your event is full. Make room for more people with an Event Pass or Plus.';

// Swaps the database's words for the guest-facing ones; other errors pass through.
export function guestFacing(message: string | null): string | null {
  return isEventFull(message) ? GUEST_FULL_MESSAGE : message;
}

// "8 of 10 going" style meter text, or null when there's no limit.
export function peopleMeter(l: EventLimits | null): { text: string; nearlyFull: boolean } | null {
  if (!l || l.peopleLimit === null) return null;
  return {
    text: `${Math.min(l.going, l.peopleLimit)} of ${l.peopleLimit} spots taken`,
    nearlyFull: l.going >= Math.ceil(l.peopleLimit * 0.8),
  };
}
