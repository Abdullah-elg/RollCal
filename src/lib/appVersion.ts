// The minimum-version check's arithmetic, kept free of app imports so the
// tests can run it in plain Node. The fetching lives in minVersion.ts.

// Compares dotted versions number by number ("1.10.0" is newer than
// "1.9.2"; "1.2" equals "1.2.0"). Anything after a "-" or "+" is ignored.
// Returns -1, 0 or 1. A part that isn't a number counts as 0.
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v
      .trim()
      .split(/[-+]/)[0]
      .split('.')
      .map((p) => {
        const n = Number.parseInt(p, 10);
        return Number.isFinite(n) && n >= 0 ? n : 0;
      });
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

// Whether this build must update, given app_config's min_version value
// ({"ios": "1.2.0", "android": "1.2.0"}). Fails open: an unknown version,
// a missing platform or anything malformed never blocks anyone.
export function mustUpdate(
  current: string | null | undefined,
  platform: string,
  minVersion: unknown,
): boolean {
  if (!current || typeof minVersion !== 'object' || minVersion === null) return false;
  const min = (minVersion as Record<string, unknown>)[platform];
  if (typeof min !== 'string' || !/^\d+(\.\d+)*/.test(min.trim())) return false;
  if (!/^\d+(\.\d+)*/.test(current.trim())) return false;
  return compareVersions(current, min) < 0;
}
