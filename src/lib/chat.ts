import { RealtimeChannel } from '@supabase/supabase-js';
import { Message, RsvpStatus } from '../types';
import { supabase } from './supabase';

// Event chat. RLS does the gatekeeping on both ends: only members can read
// or post, and Realtime applies the same SELECT policy, so a kicked user's
// live subscription stops delivering as well.

// Most recent messages, oldest first. A cap keeps the first paint quick;
// events don't need infinite scrollback to be useful.
const PAGE = 200;

export async function loadMessages(eventId: string): Promise<Message[]> {
  const { data } = await supabase
    .from('messages')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
    .limit(PAGE);
  return (data ?? []).reverse();
}

export async function sendMessage(
  eventId: string,
  senderId: string,
  body: string
): Promise<string | null> {
  const trimmed = body.trim();
  if (!trimmed) return null;
  const { error } = await supabase
    .from('messages')
    .insert({ event_id: eventId, sender_id: senderId, body: trimmed });
  return error ? error.message : null;
}

// Live inserts for one event. Returns the channel so the caller can
// unsubscribe on unmount.
export function subscribeToMessages(
  eventId: string,
  onInsert: (message: Message) => void
): RealtimeChannel {
  return supabase
    .channel(`event-chat-${eventId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `event_id=eq.${eventId}`,
      },
      (payload) => onInsert(payload.new as Message)
    )
    .subscribe();
}

// Who's in the event, with how they answered - so the chat can show whether
// the person talking is actually coming.
export type ChatMember = {
  name: string;
  avatarUrl?: string | null;
  status: RsvpStatus | 'host' | null;
};

export type ChatRoster = Record<string, ChatMember>;

export async function loadChatRoster(eventId: string): Promise<ChatRoster> {
  const [{ data: event }, { data: rsvps }] = await Promise.all([
    supabase.from('events').select('creator_id').eq('id', eventId).maybeSingle(),
    supabase.from('rsvps').select('user_id, status').eq('event_id', eventId),
  ]);

  const ids = [
    ...new Set([
      ...(event ? [event.creator_id] : []),
      ...(rsvps ?? []).map((r) => r.user_id),
    ]),
  ];
  if (ids.length === 0) return {};

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url')
    .in('id', ids);

  const roster: ChatRoster = {};
  for (const id of ids) {
    const p = profiles?.find((profile) => profile.id === id);
    const name = p?.display_name ?? 'Someone';
    const avatarUrl = p?.avatar_url ?? null;
    // The host leads, whatever they RSVP'd.
    const status =
      event?.creator_id === id
        ? ('host' as const)
        : ((rsvps?.find((r) => r.user_id === id)?.status as RsvpStatus) ?? null);
    roster[id] = { name, avatarUrl, status };
  }
  return roster;
}

// Fallback for someone who has spoken but isn't on the roster any more -
// they left, or were removed. Name only; no status to show.
export async function loadSenderNames(
  senderIds: string[]
): Promise<Record<string, { name: string; avatarUrl?: string | null }>> {
  if (senderIds.length === 0) return {};
  const { data } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url')
    .in('id', senderIds);
  const names: Record<string, { name: string; avatarUrl?: string | null }> = {};
  for (const row of data ?? []) {
    names[row.id] = { name: row.display_name, avatarUrl: row.avatar_url };
  }
  return names;
}
