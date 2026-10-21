import { placeLabel } from './placeLabel';
import { supabase } from './supabase';

// Place names for dropped pins, from OpenStreetMap's Nominatim, under its
// usage policy: one request per pin the person confirms, an identifying
// User-Agent with a contact address, answers kept for the session, the
// "© OpenStreetMap contributors" credit shown in the picker, and a server
// off switch (supabase/functions/reverse-geocode).

export const OSM_CREDIT = '© OpenStreetMap contributors';
const USER_AGENT = 'RollCal/1.0 (+https://rollcal.app; support@rollcal.app)';

const answers = new Map<string, string | null>();
let switchChecked: { enabled: boolean; at: number } | null = null;

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

async function lookupsEnabled(): Promise<boolean> {
  if (switchChecked && Date.now() - switchChecked.at < 10 * 60 * 1000) return switchChecked.enabled;
  try {
    const { data } = await withTimeout(supabase.functions.invoke('reverse-geocode', { method: 'GET' }), 2500);
    const enabled = (data as { enabled?: boolean } | null)?.enabled !== false;
    switchChecked = { enabled, at: Date.now() };
    return enabled;
  } catch {
    // Can't reach the switch: assume it's on rather than lose the feature.
    return true;
  }
}

// "King Street West, Toronto", or null if it can't be found in time.
export async function lookupPlace(lat: number, lng: number): Promise<string | null> {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (answers.has(key)) return answers.get(key) ?? null;
  if (!(await lookupsEnabled())) return null;
  try {
    const res = await withTimeout(
      fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${lat}&lon=${lng}`,
        { headers: { 'User-Agent': USER_AGENT } }
      ),
      3500
    );
    if (!res.ok) return null;
    const label = placeLabel(await res.json());
    answers.set(key, label);
    return label;
  } catch {
    return null;
  }
}
