// Public links point at the RollCal website, never at a hosting provider's
// address, so they keep working if the backend ever moves. On a phone with
// the app, rollcal.app/join/... opens the app directly (iOS universal links,
// Android app links); otherwise the page offers the code and the stores.
// The site lives in web/ in this repo.

export const WEB_ORIGIN = 'https://rollcal.app';

export const joinUrl = (inviteCode: string) => `${WEB_ORIGIN}/join/${inviteCode}`;
