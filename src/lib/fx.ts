import { getLocales } from 'expo-localization';
import { isSupportedCurrency, Rates } from './currency';
import { supabase } from './supabase';

// The currency of the phone's region, as a starting suggestion. US dollars
// if the region's currency isn't one RollCal offers.
export function deviceCurrency(): string {
  try {
    const code = getLocales()[0]?.currencyCode;
    return isSupportedCurrency(code) ? code : 'USD';
  } catch {
    return 'USD';
  }
}

// Exchange rates from the server (refreshed there twice a day), kept for an
// hour. null if they can't be loaded; callers then skip converting.
let cache: { rates: Rates; at: number } | null = null;
const MAX_AGE_MS = 60 * 60 * 1000;

export async function loadRates(): Promise<Rates | null> {
  if (cache && Date.now() - cache.at < MAX_AGE_MS) return cache.rates;
  const { data, error } = await supabase.from('fx_rates').select('currency, per_usd');
  if (error || !data || data.length === 0) return cache?.rates ?? null;
  const rates: Rates = {};
  for (const row of data) rates[row.currency] = Number(row.per_usd);
  cache = { rates, at: Date.now() };
  return rates;
}
