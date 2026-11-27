import * as ImagePicker from 'expo-image-picker';
import type { CoverCrop } from './coverCrop';
import { uploadPhotoAsset } from './photos';
import { supabase } from './supabase';

// The cover is an ordinary photo row pointed to by events.cover_photo_id.
// A host can add one before the event; like every photo it stays out of the
// roll until the roll opens at the start (see isRollOpen).

// The crop is how the full photo is framed in the 2:1 cover (null: centred).
// Choosing a photo without a frame resets it (see cover-crop.sql).
export async function setCoverPhoto(
  eventId: string,
  photoId: string | null,
  crop?: CoverCrop | null
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('events')
    .update(crop === undefined ? { cover_photo_id: photoId } : { cover_photo_id: photoId, cover_crop: crop })
    .eq('id', eventId);
  return { error: error ? error.message : null };
}

// Just the new frame for the photo that's already the cover.
export async function setCoverCrop(eventId: string, crop: CoverCrop): Promise<{ error: string | null }> {
  const { error } = await supabase.from('events').update({ cover_crop: crop }).eq('id', eventId);
  return { error: error ? error.message : null };
}

// Host picks one image from their library for the cover. Null if they
// cancel. No crop here: the whole photo goes in the roll, and the cover's
// frame is chosen next in CoverCropper (the system crop is square on iOS
// whatever shape is asked for, so it never matched the cover).
export async function pickCoverAsset(): Promise<ImagePicker.ImagePickerAsset | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: 'images',
    allowsEditing: false,
    quality: 1,
  });
  return result.canceled || result.assets.length === 0 ? null : result.assets[0];
}

// Uploads a picked image (whole, into the roll) and makes it the event's
// cover, framed by `crop`.
export async function uploadCoverAsset(
  eventId: string,
  userId: string,
  asset: ImagePicker.ImagePickerAsset,
  crop: CoverCrop | null = null
): Promise<{ photoId: string | null; error: string | null }> {
  try {
    const photoId = await uploadPhotoAsset(eventId, userId, asset, 0.8);
    const { error } = await setCoverPhoto(eventId, photoId, crop);
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
