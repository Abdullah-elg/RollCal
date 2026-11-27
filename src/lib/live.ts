// Live changes to database rows (Supabase Realtime), in one place. The rest
// of the app asks to hear about inserts, updates and deletes on a table and
// gets back a function that stops listening, so another real-time service
// could replace this file alone (docs/MIGRATION-AWS.md).

import { supabase } from './supabase';

export type LiveEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

export type LiveChange = {
  event: 'INSERT' | 'UPDATE' | 'DELETE';
  // The row after the change (empty for a delete) and before it (only its id
  // for a delete).
  new: Record<string, unknown>;
  old: Record<string, unknown>;
};

export type LiveWatch = {
  table: string;
  event: LiveEvent;
  // One column equal to a value, e.g. { column: 'event_id', value: id }.
  // Deletes can't be filtered (they only carry the id), so leave it out there.
  match?: { column: string; value: string };
  onChange: (change: LiveChange) => void;
};

// Listens for every watch on one connection. name says what it's for; each
// call gets a fresh channel, because supabase-js hands back an existing one
// with the same name, and a screen reopened quickly got the old channel,
// still closing, with no live updates.
export function listen(name: string, watches: LiveWatch[]): () => void {
  let channel = supabase.channel(`${name}-${Math.random().toString(36).slice(2, 8)}`);
  for (const w of watches) {
    channel = channel.on(
      'postgres_changes' as never,
      {
        event: w.event,
        schema: 'public',
        table: w.table,
        ...(w.match ? { filter: `${w.match.column}=eq.${w.match.value}` } : {}),
      },
      (payload: { eventType: LiveChange['event']; new: Record<string, unknown>; old: Record<string, unknown> }) =>
        w.onChange({ event: payload.eventType, new: payload.new ?? {}, old: payload.old ?? {} })
    );
  }
  channel.subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
