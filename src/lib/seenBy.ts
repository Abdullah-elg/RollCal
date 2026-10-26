// "Seen by" arithmetic for event chat. Pure, so it's unit-tested; the
// database side is in chatReads.ts.

// user id -> when they last read this event's chat
export type ChatReads = Record<string, string>;

// Who has read up to a message: everyone whose read time is at or after it,
// apart from whoever sent it and the person looking.
export function seenBy(
  reads: ChatReads,
  message: { sender_id: string; created_at: string },
  myId: string
): string[] {
  const sent = new Date(message.created_at).getTime();
  return Object.entries(reads)
    .filter(
      ([id, at]) =>
        id !== myId && id !== message.sender_id && new Date(at).getTime() >= sent
    )
    .sort(([, a], [, b]) => a.localeCompare(b))
    .map(([id]) => id);
}

// Where each person's "seen" mark goes: under the newest message they've
// read up to (their read time is at or after it), skipping their own
// messages, since seeing your own message says nothing. Like seenBy, never
// the person looking. message id -> reader ids, earliest reader first.
export function seenPositions(
  reads: ChatReads,
  messages: { id: string; sender_id: string; created_at: string }[],
  myId: string
): Map<string, string[]> {
  // Newest first, so the first match is the latest message they've seen.
  const newestFirst = [...messages].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const placed = new Map<string, string[]>();
  const readers = Object.entries(reads)
    .filter(([id]) => id !== myId)
    .sort(([, a], [, b]) => a.localeCompare(b));
  for (const [id, at] of readers) {
    const readAt = new Date(at).getTime();
    const last = newestFirst.find(
      (m) => m.sender_id !== id && new Date(m.created_at).getTime() <= readAt
    );
    if (!last) continue;
    placed.set(last.id, [...(placed.get(last.id) ?? []), id]);
  }
  return placed;
}
