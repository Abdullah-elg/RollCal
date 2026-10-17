import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { supabase } from './supabase';

export type AppleName = { first: string | null; last: string | null };

export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  return AppleAuthentication.isAvailableAsync();
}

// Apple only shares the user's name on their very first sign-in. onName runs
// before the session starts, so the new profile can be created with it.
export async function signInWithApple(
  onName: (name: AppleName) => void
): Promise<{ error: string | null }> {
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) {
      return { error: 'Apple did not return a sign-in token. Try again.' };
    }
    const first = credential.fullName?.givenName ?? null;
    const last = credential.fullName?.familyName ?? null;
    if (first || last) onName({ first, last });

    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
    });
    return { error: error ? error.message : null };
  } catch (e: unknown) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return { error: null };
    return { error: e instanceof Error ? e.message : 'Apple sign-in failed.' };
  }
}

// Google goes through Supabase's hosted OAuth page in an in-app browser,
// which then redirects back to rollcal://auth-callback with the tokens.
export async function signInWithGoogle(): Promise<{ error: string | null }> {
  const redirectTo = Linking.createURL('auth-callback');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error || !data.url) return { error: error?.message ?? 'Could not start Google sign-in.' };

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return { error: null };

  // Tokens arrive in the URL fragment; errors can come in either part.
  const url = new URL(result.url);
  const params = new URLSearchParams(url.hash.replace(/^#/, ''));
  url.searchParams.forEach((value, key) => params.set(key, value));

  const failure = params.get('error_description') ?? params.get('error');
  if (failure) return { error: failure };

  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (!access_token || !refresh_token) return { error: 'Google sign-in did not finish.' };

  const { error: sessionError } = await supabase.auth.setSession({ access_token, refresh_token });
  return { error: sessionError?.message ?? null };
}
