import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabase';
import { Event } from '../types';
import { hapticShutter } from './haptics';
import { rollState } from './roll';

const BUCKET = 'event-photos';

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;

  let bufferLength = base64.length * 0.75;
  if (base64[base64.length - 1] === '=') {
    bufferLength--;
    if (base64[base64.length - 2] === '=') bufferLength--;
  }

  const arrayBuffer = new ArrayBuffer(bufferLength);
  const bytes = new Uint8Array(arrayBuffer);

  let p = 0;
  for (let i = 0; i < base64.length; i += 4) {
    const encoded1 = lookup[base64.charCodeAt(i)];
    const encoded2 = lookup[base64.charCodeAt(i + 1)];
    const encoded3 = lookup[base64.charCodeAt(i + 2)];
    const encoded4 = lookup[base64.charCodeAt(i + 3)];

    bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
    bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
    bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
  }

  return arrayBuffer;
}

// Events the user is part of whose 48-hour upload window is open right now.
export async function getOpenUploadEvents(userId: string): Promise<Event[]> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .order('ends_at', { ascending: false });

  if (error || !data) return [];

  return data.filter((e) => rollState(e, e.uploads_closed).uploadOpen);
}

// Uploads one picked image to the event's folder and records it in photos.
// Returns the new photo row's id.
export async function uploadPhotoAsset(
  eventId: string,
  userId: string,
  asset: ImagePicker.ImagePickerAsset
): Promise<string> {
  if (!asset.base64) throw new Error('Could not read that photo.');
  const ext = asset.uri.split('.').pop()?.toLowerCase() ?? 'jpg';
  const path = `${eventId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, base64ToArrayBuffer(asset.base64), {
      contentType: asset.mimeType ?? 'image/jpeg',
    });
  if (uploadError) throw new Error(uploadError.message);

  const { data, error: rowError } = await supabase
    .from('photos')
    .insert({ event_id: eventId, uploader_id: userId, storage_path: path })
    .select('id')
    .single();
  if (rowError) throw new Error(rowError.message);
  return data.id;
}

// Free uploads are saved at 80% JPEG quality: hard to tell from the original
// on a phone, at a fraction of the size. Pro keeps full quality.
export const photoQuality = (isPro: boolean) => (isPro ? 1 : 0.8);

// Opens the photo picker and uploads what the user chose to the event's roll.
export async function pickAndUploadPhotos(
  eventId: string,
  userId: string,
  isPro: boolean
): Promise<{ count: number; error: string | null }> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: 'images',
    allowsMultipleSelection: true,
    selectionLimit: 10,
    quality: photoQuality(isPro),
    base64: true,
  });

  if (result.canceled || result.assets.length === 0) {
    return { count: 0, error: null };
  }

  let done = 0;
  for (const asset of result.assets) {
    try {
      await uploadPhotoAsset(eventId, userId, asset);
      done += 1;
    } catch (err) {
      return {
        count: done,
        error: err instanceof Error ? err.message : 'Photo upload failed',
      };
    }
  }

  if (done > 0) {
    hapticShutter();
  }

  return { count: done, error: null };
}

// Deletes every file in an event's folder. Called before the event row is
// deleted, since removing the rows alone leaves the files in storage.
export async function removeEventFiles(eventId: string): Promise<void> {
  const { data } = await supabase.storage.from(BUCKET).list(eventId, { limit: 1000 });
  const paths = (data ?? []).map((f) => `${eventId}/${f.name}`);
  if (paths.length > 0) await supabase.storage.from(BUCKET).remove(paths);
}
