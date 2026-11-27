// Tidies a caption from the model before it's saved: one line, no quotes,
// emoji or hashtags, no trailing full stop, at most 80 characters (cut at a
// word). Returns null when nothing usable is left.
export function cleanCaption(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/#\S+/g, '')
    .replace(/\p{Extended_Pictographic}|️|‍/gu, '')
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  s = s.replace(/[.。]+$/, '').trim();
  if (s.length > 80) {
    const cut = s.slice(0, 80);
    const space = cut.lastIndexOf(' ');
    s = (space > 40 ? cut.slice(0, space) : cut).replace(/[,;:\-–—]+$/, '').trim();
  }
  if (s.length < 2) return null;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Only pictures from our own storage are fetched, never a link from outside.
export function allowedImageUrl(url: string, hosts: string[]): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && hosts.includes(u.hostname);
  } catch {
    return false;
  }
}

// The model's "looks great" score as a whole number 1-10, or null.
export function cleanScore(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(10, Math.max(1, Math.round(n)));
}
