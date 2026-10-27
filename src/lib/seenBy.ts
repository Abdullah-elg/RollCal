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
// read up to (their read time is at or after it). If that newest message is
// their own, they get no mark at all: sending it says they're caught up.
// Like seenBy, never the person looking. message id -> reader ids, earliest
// reader first.
export function seenPositions(
  reads: ChatReads,
  messages: { id: string; sender_id: string; created_at: string }[],
  myId: string
): Map<string, string[]> {
  // Newest first, so the first match is the latest message they've seen.
  const newestFirst = [...messages].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const placed = new Map<string, string[]>();
  // Sending a message means you've seen everything before it, even if your
  // read time was saved before you sent it.
  const effective: ChatReads = { ...reads };
  for (const m of messages) {
    const at = effective[m.sender_id];
    if (!at || new Date(m.created_at).getTime() > new Date(at).getTime()) {
      effective[m.sender_id] = m.created_at;
    }
  }
  const readers = Object.entries(effective)
    .filter(([id]) => id !== myId)
    .sort(([, a], [, b]) => a.localeCompare(b));
  for (const [id, at] of readers) {
    const readAt = new Date(at).getTime();
    const last = newestFirst.find((m) => new Date(m.created_at).getTime() <= readAt);
    if (!last || last.sender_id === id) continue;
    placed.set(last.id, [...(placed.get(last.id) ?? []), id]);
  }
  return placed;
}
