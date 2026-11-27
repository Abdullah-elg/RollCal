// The event cover's frame: which part of the full photo shows in the cover.
// The cover is always COVER_ASPECT wide to 1 tall (event page, home card,
// event form), so the frame the host picks is exactly what everyone sees.
// The roll keeps the whole photo.

export const COVER_ASPECT = 2;

// Fractions of the photo's width and height. Null means "centred".
export type CoverCrop = { x: number; y: number; w: number; h: number };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// The centred 2:1 frame for a photo of this size (what a null crop means).
export function centredCrop(imageW: number, imageH: number, aspect = COVER_ASPECT): CoverCrop {
  const imageAspect = imageW / imageH;
  if (imageAspect > aspect) {
    const w = aspect / imageAspect;
    return { x: (1 - w) / 2, y: 0, w, h: 1 };
  }
  const h = imageAspect / aspect;
  return { x: 0, y: (1 - h) / 2, w: 1, h };
}

// Where to draw the full photo inside a box so only the frame shows: the
// image is sized and shifted, and the box clips the rest.
export function coverImageLayout(
  crop: CoverCrop,
  boxW: number,
  boxH: number
): { width: number; height: number; left: number; top: number } {
  const width = boxW / crop.w;
  const height = boxH / crop.h;
  return { width, height, left: -crop.x * width, top: -crop.y * height };
}

// The frame for a photo shown at `scale` (screen points per photo pixel)
// and shifted by tx, ty inside a frame of frameW x frameH, kept inside the
// photo. Rounded to 4 places so it stores small.
export function cropFromTransform(
  imageW: number,
  imageH: number,
  frameW: number,
  frameH: number,
  scale: number,
  tx: number,
  ty: number
): CoverCrop {
  const shownW = imageW * scale;
  const shownH = imageH * scale;
  const w = clamp(frameW / shownW, 0.0001, 1);
  const h = clamp(frameH / shownH, 0.0001, 1);
  const x = clamp(-tx / shownW, 0, 1 - w);
  const y = clamp(-ty / shownH, 0, 1 - h);
  const r = (n: number) => Math.round(n * 10000) / 10000;
  return { x: r(x), y: r(y), w: r(w), h: r(h) };
}

// The smallest zoom that still fills the frame, and how far the photo can
// move at a zoom without showing a gap.
export function minCoverScale(imageW: number, imageH: number, frameW: number, frameH: number): number {
  return Math.max(frameW / imageW, frameH / imageH);
}

export function clampOffset(
  imageW: number,
  imageH: number,
  frameW: number,
  frameH: number,
  scale: number,
  tx: number,
  ty: number
): { tx: number; ty: number } {
  return {
    tx: clamp(tx, frameW - imageW * scale, 0),
    ty: clamp(ty, frameH - imageH * scale, 0),
  };
}

// A saved crop back into a zoom and offset, to reopen the cropper where the
// host left it.
export function transformFromCrop(
  crop: CoverCrop,
  imageW: number,
  imageH: number,
  frameW: number
): { scale: number; tx: number; ty: number } {
  const scale = frameW / (crop.w * imageW);
  return { scale, tx: -crop.x * imageW * scale, ty: -crop.y * imageH * scale };
}

// A cover_crop value from the database, or null if it isn't a usable frame.
export function parseCoverCrop(raw: unknown): CoverCrop | null {
  if (!raw || typeof raw !== 'object') return null;
  const { x, y, w, h } = raw as Record<string, unknown>;
  if ([x, y, w, h].some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null;
  const c = { x: x as number, y: y as number, w: w as number, h: h as number };
  if (c.w <= 0 || c.h <= 0 || c.x < 0 || c.y < 0 || c.x + c.w > 1.001 || c.y + c.h > 1.001) return null;
  return c;
}
