import { RealtimeChannel } from '@supabase/supabase-js';
import { Message, RsvpStatus } from '../types';
import { eventEnded } from './rsvpLabels';
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

// How long after sending a message its sender can still edit it. The server
// enforces it (edit_message in supabase/message-edits.sql); the app uses it
// to decide whether to offer Edit.
export const EDIT_WINDOW_MS = 10 * 60 * 1000;

export const canStillEdit = (message: Message, now = Date.now()) =>
  now - new Date(message.created_at).getTime() < EDIT_WINDOW_MS;

// Changes the text of your own message. Returns when it was edited.
export async function editMessage(
  messageId: string,
  body: string
): Promise<{ editedAt: string } | { error: string }> {
  const { data, error } = await supabase.rpc('edit_message', {
    p_message: messageId,
    p_body: body.trim(),
  });
  if (error) {
    return {
      error:
        error.code === '42501'
          ? 'Messages can only be edited for 10 minutes after sending.'
          : 'Could not save that. Please try again.',
    };
  }
  return { editedAt: data as string };
}

// Deletes a message for everyone. Allowed for its sender and the host.
export async function deleteMessage(messageId: string): Promise<string | null> {
  const { error } = await supabase.from('messages').delete().eq('id', messageId);
  return error ? 'Could not delete that. Please try again.' : null;
}

// Live changes for one event: new messages, edits and deletions. Returns the
// channel so the caller can unsubscribe on unmount. Deletions can't be
// filtered by event (they only carry the message id), so the caller ignores
// ids it doesn't have.
export function subscribeToMessages(
  eventId: string,
  onInsert: (message: Message) => void,
  onUpdate?: (message: Message) => void,
  onDelete?: (messageId: string) => void
): RealtimeChannel {
  const filter = `event_id=eq.${eventId}`;
  return supabase
    .channel(`event-chat-${eventId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter },
      (payload) => onInsert(payload.new as Message)
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'messages', filter },
      (payload) => onUpdate?.(payload.new as Message)
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'messages' },
      (payload) => {
        const id = (payload.old as { id?: string })?.id;
        if (id) onDelete?.(id);
      }
    )
    .subscribe();
}

// Who's in the event, with how they answered - so the chat can show whether
// the person talking is actually coming. ended says the event is over, so the
// answers read in the past tense.
export type ChatMember = {
  name: string;
  avatarUrl?: string | null;
  status: RsvpStatus | 'host' | null;
};

export type ChatRoster = Record<string, ChatMember>;

export async function loadChatRoster(
  eventId: string
): Promise<{ members: ChatRoster; ended: boolean }> {
  const [{ data: event }, { data: rsvps }] = await Promise.all([
    supabase.from('events').select('creator_id, ends_at').eq('id', eventId).maybeSingle(),
    supabase.from('rsvps').select('user_id, status').eq('event_id', eventId),
  ]);

  const ids = [
    ...new Set([
      ...(event ? [event.creator_id] : []),
      ...(rsvps ?? []).map((r) => r.user_id),
    ]),
  ];
  const ended = event ? eventEnded(event.ends_at) : false;
  if (ids.length === 0) return { members: {}, ended };

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
  return { members: roster, ended };
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
