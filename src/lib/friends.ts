import { Profile } from '../types';
import { supabase } from './supabase';

// A friendship row paired with the *other* person's profile, which is what
// every screen actually wants to render.
export type FriendLink = {
  friendshipId: string;
  profile: Profile;
};

export type FriendData = {
  friends: FriendLink[];
  // Requests waiting on me to answer.
  incoming: FriendLink[];
  // Requests I've sent that haven't been answered.
  outgoing: FriendLink[];
};

export const EMPTY_FRIEND_DATA: FriendData = {
  friends: [],
  incoming: [],
  outgoing: [],
};

const EMPTY = EMPTY_FRIEND_DATA;

export async function loadFriendData(userId: string): Promise<FriendData> {
  // RLS already limits rows to ones I'm part of; the filter keeps the
  // intent obvious and lets the index do its job.
  const { data: rows } = await supabase
    .from('friendships')
    .select('*')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);
  if (!rows || rows.length === 0) return EMPTY;

  const otherIds = rows.map((r) =>
    r.requester_id === userId ? r.addressee_id : r.requester_id
  );
  const { data: profiles } = await supabase
    .from('profiles')
    .select('*')
    .in('id', otherIds);

  const result: FriendData = { friends: [], incoming: [], outgoing: [] };
  for (const row of rows) {
    const otherId = row.requester_id === userId ? row.addressee_id : row.requester_id;
    const profile = profiles?.find((p) => p.id === otherId);
    // A profile can be missing if the account was deleted; skip those.
    if (!profile) continue;
    const link: FriendLink = { friendshipId: row.id, profile };
    if (row.status === 'accepted') result.friends.push(link);
    else if (row.addressee_id === userId) result.incoming.push(link);
    else result.outgoing.push(link);
  }

  const byName = (a: FriendLink, b: FriendLink) =>
    a.profile.display_name.localeCompare(b.profile.display_name);
  result.friends.sort(byName);
  result.incoming.sort(byName);
  result.outgoing.sort(byName);
  return result;
}

// Find people by name or @username, leaving out anyone either of you has
// blocked. Strips characters that would break PostgREST's `or` filter syntax.
export async function searchProfiles(
  query: string,
  excludeUserId: string,
  hidden: Set<string> = new Set()
): Promise<Profile[]> {
  const q = query.trim().replace(/^@/, '').replace(/[,()*]/g, '');
  if (q.length < 2) return [];
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .or(`display_name.ilike.%${q}%,username.ilike.%${q}%`)
    .neq('id', excludeUserId)
    .limit(20);
  return ((data ?? []) as Profile[]).filter((p) => !hidden.has(p.id));
}

// 'friends' when they had already asked you: their request is accepted
// instead (how two people in Quiet mode add each other).
export type FriendRequestResult = { result: 'requested' | 'friends' } | { error: string };

export async function sendFriendRequest(otherId: string): Promise<FriendRequestResult> {
  const { data, error } = await supabase.rpc('request_friend', { other: otherId });
  if (error) return { error: 'Could not send the request. Please try again.' };
  // 'unavailable' means a block either way; say no more than that.
  if (data === 'unavailable') return { error: 'You can’t add this person.' };
  return { result: data === 'friends' ? 'friends' : 'requested' };
}

export async function acceptFriendRequest(
  friendshipId: string
): Promise<string | null> {
  const { error } = await supabase
    .from('friendships')
    .update({ status: 'accepted' })
    .eq('id', friendshipId);
  return error ? error.message : null;
}

// Covers declining, cancelling, and unfriending - all just drop the row.
export async function removeFriendship(
  friendshipId: string
): Promise<string | null> {
  const { error } = await supabase
    .from('friendships')
    .delete()
    .eq('id', friendshipId);
  return error ? error.message : null;
}
