// Memories on the Profile tab: events you were part of that are over and
// have photos, newest first, each with a picture to show and how many photos
// it has. The photos you can see are the ones in events you're a member of
// (the database decides), so an event with none of yours doesn't show.

import { arrangeMemories, EventRow, Memory, PhotoRow } from './memoriesArrange';
import { loadBlockedIds } from './safety';
import { supabase } from './supabase';

export type { Memory };

export async function loadMemories(): Promise<Memory[]> {
  const { data: events, error } = await supabase
    .from('events')
    .select('id, title, starts_at, ends_at, cover_photo_id')
    .lte('ends_at', new Date().toISOString());
  if (error) throw error;
  if (!events || events.length === 0) return [];
  const [{ data: photos, error: photoError }, blocked] = await Promise.all([
    supabase
      .from('photos')
      .select('id, event_id, uploader_id, storage_path, kind')
      .in(
        'event_id',
        events.map((e) => e.id)
      )
      .order('created_at', { ascending: true }),
    loadBlockedIds(),
  ]);
  if (photoError) throw photoError;
  return arrangeMemories(events as EventRow[], (photos ?? []) as PhotoRow[], blocked);
}
