// Pure helpers for photo reactions (no network), so they can be tested alone.

export const REACTIONS = ['❤️', '😂', '🔥'] as const;
export type Reaction = (typeof REACTIONS)[number];

export type ReactionRow = { photo_id: string; user_id: string; emoji: string };

export type ReactionSummary = {
  counts: Record<string, number>;
  mine: Set<string>;
};

export function emptySummary(): ReactionSummary {
  return { counts: { '❤️': 0, '😂': 0, '🔥': 0 }, mine: new Set() };
}

// Groups rows by photo: a count per emoji and which ones are the user's.
export function summarize(rows: ReactionRow[], userId: string): Map<string, ReactionSummary> {
  const out = new Map<string, ReactionSummary>();
  for (const r of rows) {
    if (!(REACTIONS as readonly string[]).includes(r.emoji)) continue;
    let s = out.get(r.photo_id);
    if (!s) {
      s = emptySummary();
      out.set(r.photo_id, s);
    }
    s.counts[r.emoji] = (s.counts[r.emoji] ?? 0) + 1;
    if (r.user_id === userId) s.mine.add(r.emoji);
  }
  return out;
}

// The tile badge: the most-used emoji and the total across all of them.
export function badgeFor(s: ReactionSummary | undefined): { emoji: string; total: number } | null {
  if (!s) return null;
  let total = 0;
  let top: string | null = null;
  let topCount = 0;
  for (const e of REACTIONS) {
    const n = s.counts[e] ?? 0;
    total += n;
    if (n > topCount) {
      topCount = n;
      top = e;
    }
  }
  return top ? { emoji: top, total } : null;
}

export const REACTION_NAMES: Record<string, string> = { '❤️': 'heart', '😂': 'laugh', '🔥': 'fire' };
