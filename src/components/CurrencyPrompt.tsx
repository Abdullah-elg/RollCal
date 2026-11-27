import { useState } from 'react';
import { Alert } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import CurrencyPicker from './CurrencyPicker';

// Asks once for a preferred currency, for anyone who hasn't chosen one:
// people who signed up with Apple or Google, and accounts from before
// currencies existed. Email sign-ups choose on the sign-up form instead.
export default function CurrencyPrompt() {
  const { session, profile, refreshProfile } = useAuth();
  const [saving, setSaving] = useState(false);
  // After the age question, never on top of it.
  if (!profile || profile.currency || session?.user.user_metadata?.age_confirmed !== true) return null;

  const choose = async (code: string) => {
    if (saving) return;
    setSaving(true);
    const { error } = await supabase.from('profiles').update({ currency: code }).eq('id', profile.id);
    setSaving(false);
    if (error) {
      Alert.alert('Couldn’t save that', 'Check your connection and try again.');
      return;
    }
    await refreshProfile();
  };

  return (
    <CurrencyPicker
      visible
      selected={null}
      title="Your currency"
      intro="Which currency do you use? Bills you split and plan prices are shown in it. You can change it any time in Settings."
      onSelect={choose}
    />
  );
}
