import { Session } from '@supabase/supabase-js';
import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react';
import { supabase } from '../lib/supabase';
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
    lastName: string
  ) => Promise<{ error: string | null; needsEmailConfirm: boolean }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  // Refetch the profile row after edits so the whole app sees new names.
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

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
      const { data: existing, error: selectError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();
      if (selectError) {
        console.warn('Profile load failed:', selectError.message);
      }
      if (cancelled) return;
      if (existing) {
        setProfile(existing);
        return;
      }
      // Names travel in auth metadata from sign-up to here; the username is
      // the email's local part, with digits appended if it's already taken
      // (two people at different domains can share a local part).
      const meta = user.user_metadata ?? {};
      const firstName = (meta.first_name as string | undefined)?.trim() || null;
      const lastName = (meta.last_name as string | undefined)?.trim() || null;
      const displayName =
        (meta.display_name as string | undefined) ??
        [firstName, lastName].filter(Boolean).join(' ') ??
        user.email?.split('@')[0] ??
        'Someone';
      const usernameBase =
        user.email?.split('@')[0]?.toLowerCase().replace(/[^a-z0-9._-]/g, '') ||
        'user';

      let created = null;
      for (const username of [
        usernameBase,
        `${usernameBase}${Math.floor(100 + Math.random() * 900)}`,
      ]) {
        const { data, error } = await supabase
          .from('profiles')
          .insert({
            id: user.id,
            display_name: displayName,
            first_name: firstName,
            last_name: lastName,
            username,
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

  const signUp: AuthContextValue['signUp'] = async (email, password, firstName, lastName) => {
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
        },
      },
    });
    if (error) return { error: error.message, needsEmailConfirm: false };
    // With "Confirm email" enabled in Supabase, sign-up returns a user but
    // no session - the user must click the email link before logging in.
    return { error: null, needsEmailConfirm: !data.session };
  };

  const signIn: AuthContextValue['signIn'] = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    return { error: error ? error.message : null };
  };

  const signOut = async () => {
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
      value={{ session, profile, loading, signUp, signIn, signOut, refreshProfile }}
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
