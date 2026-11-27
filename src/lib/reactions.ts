// Photo reactions: ❤️ 😂 🔥, one of each per person. If the table isn't there
// yet (or a query fails) there are simply no reactions.

import { supabase } from './supabase';
import { ReactionRow, ReactionSummary, summarize } from './reactionsSummary';

export { REACTIONS, REACTION_NAMES, badgeFor, summarize } from './reactionsSummary';
export type { Reaction, ReactionSummary } from './reactionsSummary';

const CHUNK = 100;

// Null when reactions can't be loaded, so the screen hides the counts.
export async function loadReactions(
  photoIds: string[],
  userId: string
): Promise<Map<string, ReactionSummary> | null> {
  try {
    const rows: ReactionRow[] = [];
    for (let i = 0; i < photoIds.length; i += CHUNK) {
      const { data, error } = await supabase
        .from('photo_reactions')
        .select('photo_id, user_id, emoji')
        .in('photo_id', photoIds.slice(i, i + CHUNK));
      if (error) return null;
      rows.push(...((data ?? []) as ReactionRow[]));
    }
    return summarize(rows, userId);
  } catch {
    return null;
  }
}

// True when it worked.
export async function toggleReaction(
  photoId: string,
  userId: string,
  emoji: string,
  on: boolean
): Promise<boolean> {
  try {
    if (on) {
      const { error } = await supabase
        .from('photo_reactions')
        .insert({ photo_id: photoId, user_id: userId, emoji });
      // 23505: already there, which is what was wanted.
      return !error || error.code === '23505';
    }
    const { error } = await supabase
      .from('photo_reactions')
      .delete()
      .eq('photo_id', photoId)
      .eq('user_id', userId)
      .eq('emoji', emoji);
    return !error;
  } catch {
    return false;
  }
}
