import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { patientFetch } from './patientFetch';
import { secureSessionStorage } from './secureSession';

// Credentials come from .env (EXPO_PUBLIC_* vars are inlined by Expo at build time).
// Never hardcode them here.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase credentials. Copy .env.example to .env and fill in ' +
      'EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY, then restart the dev server.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Sessions persist on the device between app launches, encrypted with a
    // key kept in the Keychain / Keystore (see secureSession.ts).
    storage: secureSessionStorage,
    // Fixed name for the saved sign-in. supabase-js names it after the
    // address (sb-<first part of the host>-auth-token), so moving to
    // api.rollcal.app, or off Supabase, would otherwise sign everyone out.
    storageKey: 'sb-qwtvpmrxmlfuwmnyawcq-auth-token',
    autoRefreshToken: true,
    persistSession: true,
    // No browser URL to parse on native.
    detectSessionInUrl: false,
  },
  // Reads give up and retry instead of hanging on a dead connection.
  global: { fetch: patientFetch },
});
