// Which events become Memories and which picture each shows; see memories.ts.
// Kept apart from it so tests can run without Supabase.

export type Memory = {
  eventId: string;
  title: string;
  startsAt: string;
  photoCount: number;
  // The picture for the tile: the event photo if there is one, else its
  // first photo (a video's still if it only has videos).
  coverPath: string | null;
  coverIsVideo: boolean;
};

export type EventRow = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  cover_photo_id: string | null;
};
export type PhotoRow = {
  id: string;
  event_id: string;
  uploader_id: string;
  storage_path: string;
  kind: 'photo' | 'video';
};

// Photos come in oldest first.
export function arrangeMemories(
  events: EventRow[],
  photos: PhotoRow[],
  blocked: Set<string>,
  now: Date = new Date()
): Memory[] {
  const byEvent = new Map<string, PhotoRow[]>();
  for (const p of photos) {
    if (blocked.has(p.uploader_id)) continue;
    const list = byEvent.get(p.event_id) ?? [];
    list.push(p);
    byEvent.set(p.event_id, list);
  }
  return events
    .filter((e) => new Date(e.ends_at).getTime() <= now.getTime() && byEvent.has(e.id))
    .map((e) => {
      const list = byEvent.get(e.id)!;
      const cover =
        list.find((p) => p.id === e.cover_photo_id) ??
        list.find((p) => p.kind === 'photo') ??
        list[0];
      return {
        eventId: e.id,
        title: e.title,
        startsAt: e.starts_at,
        photoCount: list.length,
        coverPath: cover?.storage_path ?? null,
        coverIsVideo: cover?.kind === 'video',
      };
    })
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
}

// Memories that come back on the day: 1, 3 and 6 months after, then every
// year up to 100. "From 1 month ago", "From 2 years ago", or null. Dates are
// the phone's own; an event on the 31st comes back on the last day of a
// shorter month (and Feb 29 on Feb 28).
export function anniversaryLabel(startsAt: string, today: Date = new Date()): string | null {
  const then = new Date(startsAt);
  if (Number.isNaN(then.getTime())) return null;
  const months =
    (today.getFullYear() - then.getFullYear()) * 12 + (today.getMonth() - then.getMonth());
  const marks = months === 1 || months === 3 || months === 6 || (months % 12 === 0 && months >= 12 && months <= 1200);
  if (!marks) return null;
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  if (today.getDate() !== Math.min(then.getDate(), lastDay)) return null;
  if (months < 12) return `From ${months} ${months === 1 ? 'month' : 'months'} ago`;
  const years = months / 12;
  return `From ${years} ${years === 1 ? 'year' : 'years'} ago`;
}
