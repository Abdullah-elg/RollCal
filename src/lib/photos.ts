import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabase';
import { Event } from '../types';
import { hapticShutter } from './haptics';

const UPLOAD_WINDOW_MS = 48 * 60 * 60 * 1000;
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

/**
 * Returns all events where the user is host or attendee and uploads are currently open.
 */
export async function getOpenUploadEvents(userId: string): Promise<Event[]> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .order('ends_at', { ascending: false });

  if (error || !data) return [];

  const now = Date.now();
  const openEvents = data.filter((e) => {
    const endsAt = new Date(e.ends_at).getTime();
    const withinWindow = now >= endsAt && now <= endsAt + UPLOAD_WINDOW_MS;
    return withinWindow && !e.uploads_closed;
  });

  return openEvents;
}

/**
 * Opens image picker and uploads selected photos for an event.
 */
export async function pickAndUploadPhotos(
  eventId: string,
  userId: string
): Promise<{ count: number; error: string | null }> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: 'images',
    allowsMultipleSelection: true,
    selectionLimit: 10,
    quality: 0.7,
    base64: true,
  });

  if (result.canceled || result.assets.length === 0) {
    return { count: 0, error: null };
  }

  let done = 0;
  for (const asset of result.assets) {
    try {
      if (!asset.base64) continue;
      const ext = asset.uri.split('.').pop()?.toLowerCase() ?? 'jpg';
      const path = `${eventId}/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, base64ToArrayBuffer(asset.base64), {
          contentType: asset.mimeType ?? 'image/jpeg',
        });

      if (uploadError) throw new Error(uploadError.message);

      const { error: rowError } = await supabase
        .from('photos')
        .insert({ event_id: eventId, uploader_id: userId, storage_path: path });

      if (rowError) throw new Error(rowError.message);
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
