import { listen } from './live';
import { supabase } from './supabase';

// "Seen by" in event chat: when each member last read the chat, shared with
// the other members (supabase/chat-reads.sql). The unread dots still use the
// read marks kept on the phone (lib/unread); this is only for showing others.

import type { ChatReads } from './seenBy';
export type { ChatReads } from './seenBy';

// Marks the chat read up to now. The server stamps the time.
export async function markChatReadShared(eventId: string): Promise<void> {
  await supabase.rpc('mark_chat_read', { p_event: eventId });
}

export async function loadChatReads(eventId: string): Promise<ChatReads> {
  const { data } = await supabase
    .from('chat_reads')
    .select('user_id, last_read_at')
    .eq('event_id', eventId);
  const reads: ChatReads = {};
  for (const row of data ?? []) reads[row.user_id] = row.last_read_at;
  return reads;
}

// Live read marks for one event, so "Seen by" fills in while the chat is
// open. Returns the function that stops listening, for unmount.
export function subscribeToChatReads(
  eventId: string,
  onRead: (userId: string, lastReadAt: string) => void
): () => void {
  return listen(`event-chat-reads-${eventId}`, [
    {
      table: 'chat_reads',
      event: '*',
      match: { column: 'event_id', value: eventId },
      onChange: (c) => {
        const row = c.new as { user_id?: string; last_read_at?: string };
        if (row.user_id && row.last_read_at) onRead(row.user_id, row.last_read_at);
      },
    },
  ]);
}

export { seenBy, seenPositions } from './seenBy';
