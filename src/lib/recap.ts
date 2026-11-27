// The shareable recap: a 1080×1920 story-sized picture of an event, with
// its name, up to six photos and the RollCal mark. This file is the maths
// (which photos, where they go); RecapScreen draws it.

export const RECAP_WIDTH = 1080;
export const RECAP_HEIGHT = 1920;
export const RECAP_MAX_PHOTOS = 6;

// Where the photos go, in recap pixels, inside the photo area.
export const PHOTO_AREA = { x: 72, y: 400, width: 936, height: 1240 };
const GAP = 16;

export type Rect = { x: number; y: number; width: number; height: number };

// Rows of tiles, each row a list of relative widths, each row a relative
// height. One photo fills the area; six make a 2×3 grid.
const PATTERNS: Record<number, { rows: number[][]; heights: number[] }> = {
  1: { rows: [[1]], heights: [1] },
  2: { rows: [[1], [1]], heights: [1, 1] },
  3: { rows: [[1], [1, 1]], heights: [1.3, 1] },
  4: { rows: [[1, 1], [1, 1]], heights: [1, 1] },
  5: { rows: [[1], [1, 1], [1, 1]], heights: [1.2, 1, 1] },
  6: { rows: [[1, 1], [1, 1], [1, 1]], heights: [1, 1, 1] },
};

export function recapLayout(count: number, area: Rect = PHOTO_AREA): Rect[] {
  const n = Math.max(1, Math.min(RECAP_MAX_PHOTOS, Math.floor(count)));
  const { rows, heights } = PATTERNS[n];
  const totalWeight = heights.reduce((a, b) => a + b, 0);
  const usableHeight = area.height - GAP * (rows.length - 1);
  const rects: Rect[] = [];
  let y = area.y;
  rows.forEach((row, r) => {
    const h = Math.round((usableHeight * heights[r]) / totalWeight);
    const usableWidth = area.width - GAP * (row.length - 1);
    const rowWeight = row.reduce((a, b) => a + b, 0);
    let x = area.x;
    row.forEach((w, i) => {
      // The last tile takes what's left, so rounding never leaves a gap.
      const width =
        i === row.length - 1 ? area.x + area.width - x : Math.round((usableWidth * w) / rowWeight);
      rects.push({ x, y, width, height: h });
      x += width + GAP;
    });
    y += h + GAP;
  });
  return rects;
}

export type RecapPhoto = { id: string; kind: 'photo' | 'video'; hasPicture: boolean };

// Which photos go in: the event photo first, then the rest spread evenly
// across the roll (start, middle, end) so it tells the whole night. Videos
// count only with a still. random (0..1) picks a different spread for
// "Shuffle"; leave it out for the default.
export function pickRecapPhotos<T extends RecapPhoto>(
  photos: T[],
  coverId: string | null,
  random?: () => number,
  max: number = RECAP_MAX_PHOTOS
): T[] {
  const usable = photos.filter((p) => p.hasPicture);
  const cover = usable.find((p) => p.id === coverId);
  const rest = usable.filter((p) => p !== cover);
  const room = max - (cover ? 1 : 0);
  let chosen: T[];
  if (rest.length <= room) {
    chosen = rest;
  } else if (random) {
    const pool = [...rest];
    chosen = [];
    while (chosen.length < room) chosen.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
    // Keep roll order, so it still reads start to end.
    chosen.sort((a, b) => rest.indexOf(a) - rest.indexOf(b));
  } else {
    chosen = Array.from({ length: room }, (_, i) =>
      rest[Math.round((i * (rest.length - 1)) / Math.max(1, room - 1))]
    );
  }
  return cover ? [cover, ...chosen] : chosen;
}

// ---- Highlights -------------------------------------------------------
// A photo's pull for the recap: reactions count most (people loved it),
// then the AI's "looks great" score (1-10, 5 when there isn't one yet).
export type Rated = RecapPhoto & { reactions?: number; score?: number | null };

export function highlightScore(p: Rated): number {
  return Math.min(p.reactions ?? 0, 10) * 3 + (p.score ?? 5);
}

// The best `count` photos, back in roll order so they still tell the night
// from start to end. Ties go to the earlier photo.
export function pickHighlights<T extends Rated>(photos: T[], count: number): T[] {
  const usable = photos.filter((p) => p.hasPicture);
  if (usable.length <= count) return usable;
  const ranked = usable
    .map((p, i) => ({ p, i, s: highlightScore(p) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, count)
    .sort((a, b) => a.i - b.i);
  return ranked.map((r) => r.p);
}

// The picture recap's photos: the event photo, then the best of the rest.
// "Shuffle" (random given) still picks a fresh spread.
export function pickPicturePhotos<T extends Rated>(
  photos: T[],
  coverId: string | null,
  random?: () => number
): T[] {
  if (random) return pickRecapPhotos(photos, coverId, random);
  const usable = photos.filter((p) => p.hasPicture);
  const cover = usable.find((p) => p.id === coverId);
  const rest = usable.filter((p) => p !== cover);
  const best = pickHighlights(rest, RECAP_MAX_PHOTOS - (cover ? 1 : 0));
  return cover ? [cover, ...best] : best;
}
