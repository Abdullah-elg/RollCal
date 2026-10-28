// Combining "seen" marks from the phone and the server (seenMarks.ts).
// Pure, so it's unit-tested.

export type Marks = Record<string, string>;

// Read-up-to marks: the later of the two wins, so reading on either phone
// counts.
export function latestOf(a: Marks, b: Marks): Marks {
  const out: Marks = { ...a };
  for (const [key, at] of Object.entries(b)) {
    if (!out[key] || new Date(at).getTime() > new Date(out[key]).getTime()) out[key] = at;
  }
  return out;
}

// First-seen marks: the earlier of the two wins, so a notification seen
// yesterday on one phone isn't new today on another.
export function earliestOf(a: Marks, b: Marks): Marks {
  const out: Marks = { ...a };
  for (const [key, at] of Object.entries(b)) {
    if (!out[key] || new Date(at).getTime() < new Date(out[key]).getTime()) out[key] = at;
  }
  return out;
}
