// Both sides of a resize as whole, even pixel counts. Giving only one side
// let the other come out fractional, and the encoder then filled the last
// row and column with garbage, which showed as a pure green line along the
// right and bottom edges of covers and photos.
export function fitSize(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = maxSide / Math.max(width, height);
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return { width: even(width * scale), height: even(height * scale) };
}
