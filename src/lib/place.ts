// How an event's place reads on screen. A pin dropped where the map had no
// street name used to be saved as "Pinned location (lat, lng)"; people
// shouldn't see raw numbers, so that shows as "Pinned on the map".

export const PINNED_LABEL = 'Pinned on the map';

export function placeLabel(location: string | null | undefined): string {
  const text = (location ?? '').trim();
  return /^Pinned location \(.*\)$/.test(text) ? PINNED_LABEL : text;
}
