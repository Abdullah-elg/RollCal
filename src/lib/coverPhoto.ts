import * as ImagePicker from 'expo-image-picker';
import { uploadPhotoAsset } from './photos';
import { supabase } from './supabase';

// The cover is an ordinary photo row pointed to by events.cover_photo_id.
// A host can add one before the event; like every photo it stays out of the
// roll until the roll opens at the start (see isRollOpen).

export async function setCoverPhoto(
  eventId: string,
  photoId: string | null
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('events')
    .update({ cover_photo_id: photoId })
    .eq('id', eventId);
  return { error: error ? error.message : null };
}

// Host picks one image from their library; it becomes the event's cover.
export async function pickAndUploadCover(
  eventId: string,
  userId: string
): Promise<{ photoId: string | null; error: string | null }> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: 'images',
    allowsEditing: true,
    aspect: [4, 3],
    quality: 1,
  });
  if (result.canceled || result.assets.length === 0) return { photoId: null, error: null };

  try {
    const photoId = await uploadPhotoAsset(eventId, userId, result.assets[0], 0.8);
    const { error } = await setCoverPhoto(eventId, photoId);
    return { photoId, error };
  } catch (err) {
    return { photoId: null, error: err instanceof Error ? err.message : 'Upload failed.' };
  }
}

// Photos (cover included) only show up in the roll, counts and activity once
// the event has started.
export function isRollOpen(startsAt: string): boolean {
  return Date.now() >= new Date(startsAt).getTime();
}

// Reads starts_at from a photo row's embedded `events!inner(starts_at)`.
// PostgREST returns it as an object; supabase-js may type it as an array.
export function eventStartsAt(
  events: { starts_at: string } | { starts_at: string }[]
): string {
  return Array.isArray(events) ? events[0].starts_at : events.starts_at;
}
