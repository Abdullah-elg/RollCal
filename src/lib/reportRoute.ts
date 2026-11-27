// Where a report goes: RollCal support, or the event's host. Pure, so it's
// unit-tested; supabase/host-reports.sql applies the same rules on the
// server, which has the final say.
//
//   * Only photos and videos in an album can go to the host.
//   * Not when you are the host, or the host uploaded it: then it's support.
//   * Some reasons always reach support too, even when sent to the host.
//     Harassment is one: it's often aimed at the person reporting, and
//     support can act on the account, not just this one photo. Anything
//     involving a child always does.

import type { ReportReason, ReportTarget } from './safety';

export type ReportRoute = 'support' | 'host';

// Keep in step with private.report_is_serious in supabase/host-reports.sql.
export const SUPPORT_ALWAYS: readonly ReportReason[] = [
  'harassment',
  'hate',
  'nudity',
  'violence',
  'child_safety',
];

// Whether to offer "The host" at all.
export function canSendToHost(r: {
  target: ReportTarget;
  reporterId: string;
  uploaderId: string | null;
  hostId: string | null | undefined;
}): boolean {
  if (r.target !== 'photo' || !r.hostId) return false;
  return r.reporterId !== r.hostId && r.uploaderId !== r.hostId;
}

// True when a report sent to the host is also seen by support.
export function alsoToSupport(route: ReportRoute, reason: ReportReason | null): boolean {
  return route === 'host' && reason != null && SUPPORT_ALWAYS.includes(reason);
}

// What the reporter reads once it's sent. route is where the server put it;
// asked is what they chose. Never says what the host did.
export function sentMessage(
  route: ReportRoute,
  reason: ReportReason,
  asked: ReportRoute = route
): string {
  if (route === 'support' && asked === 'host') {
    return 'Thanks. This went to RollCal support instead, and we’ll look at it within 24 hours.';
  }
  if (route === 'support') return 'Thanks. We’ll look at this within 24 hours.';
  return alsoToSupport(route, reason)
    ? 'Thanks. We sent it to the host, and RollCal support will look at it within 24 hours.'
    : 'Thanks. We sent it to the host. They won’t see who reported it.';
}
