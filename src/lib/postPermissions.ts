// Reading and changing who can add photos and chat in an event
// (supabase/post-permissions.sql). The rule itself is in postRules.ts.

import { supabase } from './supabase';
import { Allowed, PostKind, PostRule } from './postRules';

// The people the host let in. Members can read it; empty on failure, which
// only hides buttons (the database still decides).
export async function loadAllowed(eventId: string): Promise<Allowed[]> {
  const { data, error } = await supabase
    .from('event_allowed')
    .select('user_id, photos, chat')
    .eq('event_id', eventId);
  return error ? [] : ((data ?? []) as Allowed[]);
}

// Host only: Everyone or Only the host.
export async function setPostRule(
  eventId: string,
  kind: PostKind,
  rule: PostRule
): Promise<string | null> {
  const { error } = await supabase
    .from('events')
    .update(kind === 'photos' ? { photos_by: rule } : { chat_by: rule })
    .eq('id', eventId);
  return error ? error.message : null;
}

// Host only: let someone in (or not) for photos or chat. Keeps the other
// permission as it was.
export async function setAllowed(
  eventId: string,
  current: Allowed[],
  userId: string,
  kind: PostKind,
  on: boolean
): Promise<{ allowed: Allowed[]; error: string | null }> {
  const before = current.find((a) => a.user_id === userId) ?? { user_id: userId, photos: false, chat: false };
  const row = { ...before, [kind]: on };
  const { error } = await supabase
    .from('event_allowed')
    .upsert({ event_id: eventId, ...row }, { onConflict: 'event_id,user_id' });
  if (error) return { allowed: current, error: error.message };
  return { allowed: [...current.filter((a) => a.user_id !== userId), row], error: null };
}
