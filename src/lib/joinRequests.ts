// Who can join an event, and requests to join. The host picks one of three
// modes (events.join_mode); supabase/join-modes.sql enforces them:
//   open      anyone with the link, QR or code joins straight away
//   approval  joining from the link sends the host a request to approve
//   invite    only people the host invites; the link, QR and code don't work
import { RsvpStatus } from '../types';
import { supabase } from './supabase';

export type JoinMode = 'open' | 'approval' | 'invite';

export const JOIN_MODES: { mode: JoinMode; label: string; detail: string }[] = [
  {
    mode: 'open',
    label: 'Anyone with the link',
    detail: 'People who have the link, QR code or invite code join straight away.',
  },
  {
    mode: 'approval',
    label: 'People you approve',
    detail: 'Anyone with the link can ask to join. You decide who gets in.',
  },
  {
    mode: 'invite',
    label: 'Only people you invite',
    detail: 'The link, QR code and invite code are turned off.',
  },
];

// Joins from a link, QR or code: 'joined' when they're in, 'requested' when
// the host has to approve them first.
export async function joinEvent(
  eventId: string,
  status: RsvpStatus
): Promise<{ result: 'joined' | 'requested' } | { error: string }> {
  const { data, error } = await supabase.rpc('join_event', { p_event: eventId, p_status: status });
  if (error) return { error: error.message };
  return { result: data === 'requested' ? 'requested' : 'joined' };
}

// Whether this person is already waiting for the host to let them in.
export async function hasPendingRequest(eventId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('event_join_requests')
    .select('id')
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}

export async function cancelJoinRequest(eventId: string, userId: string): Promise<void> {
  await supabase.from('event_join_requests').delete().eq('event_id', eventId).eq('user_id', userId);
}

export type JoinRequest = {
  id: string;
  userId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  createdAt: string;
};

// The requests waiting on an event, oldest first. Only the host can see them.
export async function loadJoinRequests(eventId: string): Promise<JoinRequest[]> {
  const { data: rows } = await supabase
    .from('event_join_requests')
    .select('id, user_id, created_at')
    .eq('event_id', eventId)
    .order('created_at', { ascending: true });
  if (!rows || rows.length === 0) return [];
  const { data: people } = await supabase
    .from('profiles')
    .select('id, display_name, username, avatar_url')
    .in(
      'id',
      rows.map((r) => r.user_id)
    );
  return rows.map((r) => {
    const p = people?.find((x) => x.id === r.user_id);
    return {
      id: r.id,
      userId: r.user_id,
      name: p?.display_name || 'Someone',
      username: p?.username ?? null,
      avatarUrl: p?.avatar_url ?? null,
      createdAt: r.created_at,
    };
  });
}

export async function answerJoinRequest(
  requestId: string,
  approve: boolean
): Promise<string | null> {
  const { error } = await supabase.rpc(approve ? 'approve_join_request' : 'decline_join_request', {
    p_request: requestId,
  });
  return error ? error.message : null;
}

export async function setJoinMode(eventId: string, mode: JoinMode): Promise<string | null> {
  const { error } = await supabase.from('events').update({ join_mode: mode }).eq('id', eventId);
  return error ? error.message : null;
}
