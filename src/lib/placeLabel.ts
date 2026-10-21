// Turns a Nominatim reverse-geocode answer into a short place name like
// "King Street West, Toronto". No React Native imports, so `npm test` can run it.

type Address = Record<string, string | undefined>;

export function placeLabel(data: { address?: Address; name?: string; display_name?: string } | null): string | null {
  if (!data) return null;
  const a = data.address ?? {};
  const main = a.road || a.pedestrian || a.suburb || a.neighbourhood || a.amenity || data.name;
  const city = a.city || a.town || a.village || a.municipality || a.county;
  if (main && city && main !== city) return `${main}, ${city}`;
  if (main) return main;
  if (city) return city;
  if (data.display_name) return data.display_name.split(',').slice(0, 2).join(',').trim() || null;
  return null;
}

// Rounds to about 11 m, so nearby pins share one lookup.
export const cacheKey = (lat: number, lng: number) => `${lat.toFixed(4)},${lng.toFixed(4)}`;

export const validCoords = (lat: unknown, lng: unknown): lat is number =>
  typeof lat === 'number' &&
  typeof lng === 'number' &&
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lng) <= 180;
