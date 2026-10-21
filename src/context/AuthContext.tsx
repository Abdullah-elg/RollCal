// Holds the signed-in session and the user's profile for the whole app, and
// the sign-in, sign-up and password reset flows. It creates the profile row
// the first time a session arrives, and owns the under-13 block, which is
// kept on this phone only.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session } from '@supabase/supabase-js';
import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { unregisterPush } from '../lib/notifications';
import * as social from '../lib/socialAuth';
import { supabase } from '../lib/supabase';
import { isSupportedCurrency } from '../lib/currency';
import { cleanUsername, usernameFallbacks, usernameFromName, usernameProblem } from '../lib/username';
import { Profile } from '../types';

type AuthContextValue = {
  session: Session | null;
  profile: Profile | null;
  // True while restoring the persisted session on app launch.
  loading: boolean;
  signUp: (
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    username: string,
    currency: string
  ) => Promise<{ error: string | null; needsEmailConfirm: boolean }>;
  // needsEmailConfirm: the account exists but the email code was never entered.
  signIn: (
    email: string,
    password: string
  ) => Promise<{ error: string | null; needsEmailConfirm: boolean }>;
  // Confirms the code from the sign-up email; success signs the user in.
  verifyEmail: (email: string, code: string) => Promise<{ error: string | null }>;
  resendEmailCode: (email: string) => Promise<{ error: string | null }>;
  // Emails a code for choosing a new password. Succeeds whether or not the
  // email has an account, so the screen can't be used to look people up.
  sendPasswordReset: (email: string) => Promise<{ error: string | null }>;
  // Checks the code, then sets the new password; success signs the user in.
  resetPassword: (
    email: string,
    code: string,
    newPassword: string
  ) => Promise<{ error: string | null }>;
  // True between a correct reset code and the new password being saved.
  // The app stays on the sign-in screens meanwhile.
  recovering: boolean;
  // Someone on this phone said they're under 13. Kept on the device, so the
  // answer can't simply be changed and tried again.
  ageBlocked: boolean;
  // Records that the signed-in person passed the age check.
  confirmAge: () => Promise<{ error: string | null }>;
  // Under 13: deletes the account just made, signs out, blocks this phone.
  refuseUnderAge: () => Promise<void>;
  blockForAge: () => Promise<void>;
  signInWithApple: () => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  // Refetch the profile row after edits so the whole app sees new names.
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const AGE_BLOCK_KEY = 'rollcal.ageBlocked';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);
  const [ageBlocked, setAgeBlocked] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(AGE_BLOCK_KEY)
      .then((v) => setAgeBlocked(!!v))
      .catch(() => {});
  }, []);
  // Set just before an Apple sign-in, read when that new user's profile is
  // created. A ref (not state) so the profile effect sees it immediately.
  const pendingName = useRef<social.AppleName | null>(null);

  // Restore the persisted session once, then track every auth change.
  // The listener only sets state - doing Supabase calls inside it can
  // deadlock supabase-js, so profile loading happens in the effect below.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Whenever we have a user, make sure their profiles row exists and load it.
  // Creating it here (not only at sign-up) means the row still gets created
  // when email confirmation is on and the first real session arrives later.
  useEffect(() => {
    const user = session?.user;
    if (!user) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    (async () => {
      // Retry a failed read instead of treating it as "no profile yet". Right
      // after sign-in a phone clock that runs a little slow makes the server
      // reject the new token ("JWT issued at future") for a second or two.
      let existing = null;
      for (let attempt = 0; ; attempt++) {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .maybeSingle();
        if (cancelled) return;
        if (!error) {
          existing = data;
          break;
        }
        if (attempt === 3) {
          console.warn('Profile load failed:', error.message);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      if (existing) {
        pendingName.current = null;
        setProfile(existing);
        return;
      }
      // Names come from sign-up metadata (email), the provider's profile
      // (Google), or the one-time name Apple hands over. The username is the
      // one chosen at sign-up; Apple and Google sign-ins get one made from
      // their name. Never from the email, which would give the address away.
      const meta = user.user_metadata ?? {};
      const str = (v: unknown) => (typeof v === 'string' && v.trim()) || null;
      const [providerFirst, ...providerRest] = (str(meta.full_name) ?? str(meta.name) ?? '').split(' ');
      const firstName =
        pendingName.current?.first ?? str(meta.first_name) ?? str(meta.given_name) ?? str(providerFirst);
      const lastName =
        pendingName.current?.last ??
        str(meta.last_name) ??
        str(meta.family_name) ??
        str(providerRest.join(' '));
      pendingName.current = null;
      const displayName =
        str(meta.display_name) || [firstName, lastName].filter(Boolean).join(' ') || 'Someone';
      const chosen = cleanUsername(str(meta.username) ?? '');
      const usernameBase = usernameProblem(chosen) ? usernameFromName(firstName, lastName) : chosen;

      let created = null;
      // Digits are added only if someone took the name in the meantime.
      for (const username of [usernameBase, ...usernameFallbacks(usernameBase)]) {
        const { data, error } = await supabase
          .from('profiles')
          .insert({
            id: user.id,
            display_name: displayName,
            first_name: firstName,
            last_name: lastName,
            username,
            avatar_url: str(meta.avatar_url) ?? str(meta.picture),
            // Chosen at sign-up; Apple and Google sign-ins are asked in the app.
            currency: isSupportedCurrency(str(meta.currency)) ? str(meta.currency) : null,
          })
          .select()
          .single();
        if (!error) {
          created = data;
          break;
        }
        // 23505 = username taken; retry with the suffixed variant.
        if (error.code !== '23505') {
          // Most common cause: supabase SQL (policies/schema) not run yet.
          console.warn('Profile create failed:', error.message);
          break;
        }
      }
      if (!cancelled && created) setProfile(created);
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  const signUp: AuthContextValue['signUp'] = async (
    email,
    password,
    firstName,
    lastName,
    username,
    currency
  ) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      // Stashing the names in auth metadata lets the profile-ensure effect
      // above create the row even if the session arrives later.
      options: {
        data: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          display_name: `${firstName.trim()} ${lastName.trim()}`.trim(),
          username: cleanUsername(username),
          currency,
          // Passed the age check on the sign-up form.
          age_confirmed: true,
        },
      },
    });
    if (error) return { error: error.message, needsEmailConfirm: false };
    // With "Confirm email" enabled in Supabase, sign-up returns a user but
    // no session - the user must click the email link before logging in.
    return { error: null, needsEmailConfirm: !data.session };
  };

  const signIn: AuthContextValue['signIn'] = async (email, password) => {
    // Any other way in ends an unfinished password reset.
    setRecovering(false);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error?.code === 'email_not_confirmed') {
      // Send a fresh code so the verify screen has something to check.
      await supabase.auth.resend({ type: 'signup', email: email.trim() });
      return { error: null, needsEmailConfirm: true };
    }
    return { error: error ? error.message : null, needsEmailConfirm: false };
  };

  const verifyEmail: AuthContextValue['verifyEmail'] = async (email, code) => {
    setRecovering(false);
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    });
    return { error: error ? error.message : null };
  };

  const resendEmailCode: AuthContextValue['resendEmailCode'] = async (email) => {
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim() });
    return { error: error ? error.message : null };
  };

  const sendPasswordReset: AuthContextValue['sendPasswordReset'] = async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    return { error: error ? error.message : null };
  };

  const resetPassword: AuthContextValue['resetPassword'] = async (email, code, newPassword) => {
    setRecovering(true);
    // A correct code signs the person in. If saving the password then fails
    // (too weak, same as before), they're still signed in from the code, so
    // a retry skips straight to saving.
    const { data: current } = await supabase.auth.getSession();
    const signedInAs = current.session?.user.email?.toLowerCase();
    if (signedInAs !== email.trim().toLowerCase()) {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: 'recovery',
      });
      if (error) {
        setRecovering(false);
        return { error: error.message };
      }
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { error: error.message };
    setRecovering(false);
    return { error: null };
  };

  const blockForAge = async () => {
    setAgeBlocked(true);
    await AsyncStorage.setItem(AGE_BLOCK_KEY, new Date().toISOString()).catch(() => {});
  };

  const confirmAge: AuthContextValue['confirmAge'] = async () => {
    const { error } = await supabase.auth.updateUser({ data: { age_confirmed: true } });
    return { error: error ? 'Couldn’t save that. Check your connection and try again.' : null };
  };

  const refuseUnderAge = async () => {
    await blockForAge();
    // The same function as Settings → Delete account.
    await supabase.functions.invoke('delete-account', { method: 'POST' }).catch(() => {});
    await unregisterPush();
    await supabase.auth.signOut();
  };

  const signInWithApple = () => {
    setRecovering(false);
    return social.signInWithApple((name) => {
      pendingName.current = name;
    });
  };

  const signInWithGoogle = () => {
    setRecovering(false);
    return social.signInWithGoogle();
  };

  const signOut = async () => {
    setRecovering(false);
    // While still signed in, so the server lets this phone's token go.
    await unregisterPush();
    await supabase.auth.signOut();
  };

  const refreshProfile = async () => {
    const uid = session?.user.id;
    if (!uid) return;
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', uid)
      .maybeSingle();
    if (data) setProfile(data);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        loading,
        signUp,
        signIn,
        verifyEmail,
        resendEmailCode,
        sendPasswordReset,
        resetPassword,
        recovering,
        ageBlocked,
        confirmAge,
        refuseUnderAge,
        blockForAge,
        signInWithApple,
        signInWithGoogle,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
