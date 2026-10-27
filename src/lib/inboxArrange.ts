// How the notifications inbox sorts what it shows. Pure, so it's
// unit-tested; loading is in inbox.ts.
//
//   * New: anything you haven't seen yet.
//   * Earlier: things you've seen, kept for 2 days after you saw them.
//     Requests still waiting on your answer (pending) stay until answered.

export const KEEP_SEEN_MS = 48 * 60 * 60 * 1000;

// item key -> when you first saw it
export type SeenMap = Record<string, string>;

export type Arrangeable = { key: string; at: string; pending?: boolean };

export function arrangeInbox<T extends Arrangeable>(
  items: T[],
  seen: SeenMap,
  now = Date.now()
): { fresh: T[]; earlier: T[] } {
  const newestFirst = [...items].sort((a, b) => b.at.localeCompare(a.at));
  const fresh: T[] = [];
  const earlier: T[] = [];
  for (const item of newestFirst) {
    const seenAt = seen[item.key];
    if (!seenAt) fresh.push(item);
    else if (item.pending || now - new Date(seenAt).getTime() < KEEP_SEEN_MS) earlier.push(item);
  }
  return { fresh, earlier };
}

// The seen map after looking at these items: each gets its first-seen time,
// and marks for items that are long gone are dropped so it doesn't grow.
export function markSeen(
  seen: SeenMap,
  keys: string[],
  now = Date.now()
): SeenMap {
  const stamp = new Date(now).toISOString();
  const next: SeenMap = {};
  for (const [key, at] of Object.entries(seen)) {
    if (now - new Date(at).getTime() < 30 * 24 * 60 * 60 * 1000) next[key] = at;
  }
  for (const key of keys) if (!next[key]) next[key] = stamp;
  return next;
}
