// Small pure helpers for the Home tab's stories row and memories strip.

export function isLiveNow(startsAt: string, endsAt: string, now: number = Date.now()): boolean {
  return new Date(startsAt).getTime() <= now && now <= new Date(endsAt).getTime();
}

// The letter shown in a story circle that has no photo.
export function eventInitial(title: string): string {
  const first = Array.from(title.trim())[0];
  return first ? first.toUpperCase() : '•';
}

// Recent memories that have a picture, newest first, at most `max`.
export function pickMemoryStrip<T extends { startsAt: string; coverPath: string | null }>(
  memories: T[],
  max = 6
): T[] {
  return memories
    .filter((m) => !!m.coverPath)
    .sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime())
    .slice(0, max);
}
