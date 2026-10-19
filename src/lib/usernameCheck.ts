import { supabase } from './supabase';

// Whether a (cleaned, valid) username is free. Works before sign-in. Null
// when the check itself failed, so the screen can stay quiet rather than
// claim it's taken.
export async function isUsernameAvailable(name: string): Promise<boolean | null> {
  const { data, error } = await supabase.rpc('username_available', { name });
  if (error) return null;
  return data === true;
}
