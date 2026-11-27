// The video recap's running order, as plain data (no React), so it can be
// tested alone: a title card, then the photos with a slow zoom and drift
// each ("Ken Burns"), then the end card. The player (VideoRecapScreen)
// just plays these scenes in turn.
import { pickHighlights, pickRecapPhotos, type Rated } from './recap.ts';

export const TITLE_MS = 2600;
export const PHOTO_MS = 2400;
export const END_MS = 2400;

// Where a photo's slow move starts and ends: scale, and a drift as a share
// of the frame (so it never shows an edge: drift <= (scale - 1) / 2).
export type Motion = { fromScale: number; toScale: number; fromX: number; toX: number; fromY: number; toY: number };

export type Scene<T> =
  | { kind: 'title'; ms: number; photo: T | null }
  | { kind: 'photo'; ms: number; photo: T; motion: Motion }
  | { kind: 'end'; ms: number };

// Four gentle moves that take turns: each starts centred and slowly pushes
// in with a small drift, so consecutive photos never move against each
// other (zooming out or big drifts looked jumpy in a cross-fade).
const MOVES: Motion[] = [
  { fromScale: 1.02, toScale: 1.1, fromX: 0, toX: -0.02, fromY: 0, toY: -0.01 },
  { fromScale: 1.02, toScale: 1.1, fromX: 0, toX: 0.02, fromY: 0, toY: 0.01 },
  { fromScale: 1.02, toScale: 1.1, fromX: 0, toX: -0.015, fromY: 0, toY: 0.015 },
  { fromScale: 1.02, toScale: 1.1, fromX: 0, toX: 0.015, fromY: 0, toY: -0.015 },
];

export function motionFor(i: number): Motion {
  return MOVES[((i % MOVES.length) + MOVES.length) % MOVES.length];
}

// How the video picks its photos: every photo (as many as fit in a
// minute), or the highlights (most reactions, best-looking).
export type RecapMode = 'all' | 'highlights';

// Every video is 15 seconds to a minute (titles included). Photos share
// what's left, each on screen 1.4 to 5 seconds.
export const MIN_TOTAL_MS = 15_000;
export const MAX_TOTAL_MS = 60_000;
export const MIN_PHOTO_MS = 1_400;
export const MAX_PHOTO_MS = 5_000;
const ROOM_MS = MAX_TOTAL_MS - TITLE_MS - END_MS;
export const MAX_ALL_PHOTOS = Math.floor(ROOM_MS / MIN_PHOTO_MS);

// Highlights: about 40% of the roll, 4 to 8 photos.
export function highlightCount(n: number): number {
  return Math.min(n, Math.max(4, Math.min(8, Math.round(n * 0.4))));
}

// How long each photo stays up so the whole video lands in 15 s to 1 min.
export function photoMs(count: number): number {
  if (count <= 0) return PHOTO_MS;
  const wanted = count * PHOTO_MS;
  const total = Math.min(ROOM_MS, Math.max(MIN_TOTAL_MS - TITLE_MS - END_MS, wanted));
  return Math.round(Math.min(MAX_PHOTO_MS, Math.max(MIN_PHOTO_MS, total / count)));
}

// The title card over the event photo (or the best one), then the photos
// in roll order, then the end card. No photo plays twice; with a single
// photo it's the title's and plays once more on its own. With no photos
// there's nothing: returns [].
export function buildRecapScenes<T extends Rated>(
  photos: T[],
  coverId: string | null,
  options: { mode?: RecapMode } = {}
): Scene<T>[] {
  const mode = options.mode ?? 'all';
  const usable = photos.filter((p) => p.hasPicture);
  if (usable.length === 0) return [];
  const cover =
    usable.find((p) => p.id === coverId) ??
    (mode === 'highlights' ? pickHighlights(usable, 1)[0] : usable[0]);
  const rest = usable.filter((p) => p !== cover);
  let played: T[];
  if (rest.length === 0) played = [cover];
  else if (mode === 'highlights') played = pickHighlights(rest, highlightCount(usable.length));
  else played = rest.length > MAX_ALL_PHOTOS ? pickRecapPhotos(rest, null, undefined, MAX_ALL_PHOTOS) : rest;
  const ms = photoMs(played.length);
  return [
    { kind: 'title', ms: TITLE_MS, photo: cover },
    ...played.map((photo, i) => ({ kind: 'photo' as const, ms, photo, motion: motionFor(i) })),
    { kind: 'end', ms: END_MS },
  ];
}

export function totalMs(scenes: { ms: number }[]): number {
  return scenes.reduce((n, s) => n + s.ms, 0);
}

// A frame's caption: who took it, and when it went up ("Sara · 8:14 PM").
// First names only, so it fits on one line in the video.
export function recapCaption(name: string | null | undefined, time: string | null | undefined): string {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? '';
  return [first, (time ?? '').trim()].filter(Boolean).join(' · ');
}

// The cross-fade between scenes, and how long the whole thing runs.
export const FADE_MS = 450;

// Which photos a recap was made from, as a short fingerprint: the mode, how
// many photos, and a hash of their ids in order. A saved recap is reused only
// while this still matches (new photos or new highlights make a new one).
export function recapSignature(mode: RecapMode, scenes: { kind: string; photo?: { id: string } | null }[]): string {
  const ids = scenes.flatMap((s) => (s.kind !== 'end' && s.photo ? [s.photo.id] : []));
  let h = 0x811c9dc5;
  for (const ch of ids.join(',')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${mode}:${ids.length}:${h.toString(16).padStart(8, '0')}`;
}
