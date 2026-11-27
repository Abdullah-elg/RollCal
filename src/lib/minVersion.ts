import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { mustUpdate } from './appVersion';
import { supabase } from './supabase';

// The oldest app version still allowed, from app_config (plans.sql). Raise
// min_version there to retire builds the server no longer supports.

// Where "Update RollCal" sends people.
export const STORE_URLS = {
  ios: 'https://apps.apple.com/app/id6825499121',
  android: 'https://play.google.com/store/apps/details?id=app.rollcal',
} as const;

// Asked once when the app starts. Any error (offline, an older database
// without the table) lets the app carry on.
export function useMustUpdate(): boolean {
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('app_config')
          .select('value')
          .eq('key', 'min_version')
          .maybeSingle();
        if (cancelled || error || !data) return;
        if (mustUpdate(Constants.expoConfig?.version, Platform.OS, data.value)) setBlocked(true);
      } catch {
        // Fail open.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return blocked;
}
