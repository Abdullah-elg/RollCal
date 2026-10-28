// "Seen" marks kept on the server so they follow you between phones
// (supabase/seen-sync.sql). Keys are "<prefix>:<id>". Everything here fails
// quietly: the phone's own copy still works if the server can't be reached
// or the table isn't there yet.

import { Marks } from './marks';
import { supabase } from './supabase';

// prefix "inbox" -> { "<item key>": when }
export async function loadServerMarks(prefix: 'inbox' | 'photos'): Promise<Marks> {
  try {
    const { data, error } = await supabase
      .from('seen_marks')
      .select('key, seen_at')
      .like('key', `${prefix}:%`);
    if (error) return {};
    const marks: Marks = {};
    for (const row of data ?? []) marks[row.key.slice(prefix.length + 1)] = row.seen_at;
    return marks;
  } catch {
    return {};
  }
}

// firstOnly: keep the mark already there (first seen); otherwise the server
// keeps whichever is later.
export async function saveServerMarks(
  prefix: 'inbox' | 'photos',
  marks: Marks,
  firstOnly: boolean
): Promise<void> {
  const rows = Object.entries(marks).map(([key, at]) => ({ key: `${prefix}:${key}`, seen_at: at }));
  if (rows.length === 0) return;
  try {
    for (let i = 0; i < rows.length; i += 200) {
      await supabase
        .from('seen_marks')
        .upsert(rows.slice(i, i + 200), { onConflict: 'user_id,key', ignoreDuplicates: firstOnly });
    }
  } catch {
    // The phone's copy still has it.
  }
}

// When I last read each event's chat, from any phone (chat-reads.sql).
export async function loadServerChatReads(userId: string): Promise<Marks> {
  try {
    const { data, error } = await supabase
      .from('chat_reads')
      .select('event_id, last_read_at')
      .eq('user_id', userId);
    if (error) return {};
    const marks: Marks = {};
    for (const row of data ?? []) marks[row.event_id] = row.last_read_at;
    return marks;
  } catch {
    return {};
  }
}
