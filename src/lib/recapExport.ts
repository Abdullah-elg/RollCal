// Sharing an event's video recap. The first person to share it makes the
// .mp4 on their phone (modules/recap-video, iOS), and it's uploaded and
// saved for the event (event_recaps, supabase/recap-saved.sql). After that,
// everyone in the event plays and shares that same file, with no
// re-rendering, as long as it was made from the same photos (its signature
// still matches). A removed photo deletes the saved recap on the server.
import { File, Paths, UploadType } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Image } from 'react-native';
import { canExportRecapVideo, exportRecapVideo } from '../../modules/recap-video';
import { MEDIA_URL, mediaHeaders } from './media';
import type { RecapData } from './recapLoader';
import { signedUrl } from './signedUrls';
import { supabase } from './supabase';
import { FADE_MS, recapSignature, RecapMode } from './videoRecap';

export { canExportRecapVideo };

const MARK = require('../../assets/icon.png');

export type SavedRecap = { path: string; signature: string };

// The event's saved recaps, by mode. Empty when there are none (or the
// table isn't there yet).
export async function loadSavedRecaps(eventId: string): Promise<Partial<Record<RecapMode, SavedRecap>>> {
  const { data, error } = await supabase
    .from('event_recaps')
    .select('mode, signature, storage_path')
    .eq('event_id', eventId);
  if (error) return {};
  const out: Partial<Record<RecapMode, SavedRecap>> = {};
  for (const r of data ?? []) out[r.mode as RecapMode] = { path: r.storage_path, signature: r.signature };
  return out;
}

// A link to play a saved recap.
export function savedRecapUrl(path: string): Promise<string | null> {
  return signedUrl('event-photos', path);
}

// One file name per version, so the highlights and all-photos videos never
// overwrite each other while one is still being saved in the background
// (that once saved the highlights video as the all-photos one).
function baseName(title: string, mode: RecapMode): string {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 60) || 'RollCal';
  return mode === 'all' ? `${base} recap, all photos` : `${base} recap`;
}
function fileName(title: string, mode: RecapMode): string {
  return `${baseName(title, mode)}.mp4`;
}

// Makes the .mp4 on the phone.
async function render(data: RecapData, reduceMotion: boolean, mode: RecapMode): Promise<string> {
  const { event, when, scenes } = data;
  return exportRecapVideo({
    fileName: baseName(event.title, mode),
    fadeMs: FADE_MS,
    markUri: Image.resolveAssetSource(MARK)?.uri ?? null,
    scenes: scenes.map((s) =>
      s.kind === 'end'
        ? { kind: 'end', ms: s.ms, title: event.title }
        : s.kind === 'title'
          ? { kind: 'title', ms: s.ms, uri: s.photo?.uri ?? null, title: event.title, subtitle: when }
          : {
              kind: 'photo',
              ms: s.ms,
              uri: s.photo.uri,
              caption: s.photo.caption ?? s.photo.meta,
              subtitle: s.photo.caption ? s.photo.meta : undefined,
              ...(reduceMotion
                ? { fromScale: 1.04, toScale: 1.04, fromX: 0, toX: 0, fromY: 0, toY: 0 }
                : s.motion),
            }
    ),
  });
}

// Uploads a finished recap and saves it for the event. Best effort: if it
// fails, the next person just makes their own.
export async function saveRecapFile(
  eventId: string,
  mode: RecapMode,
  signature: string,
  fileUri: string
): Promise<void> {
  // Uploaded straight from the file: reading a 25 MB video into the app's
  // memory right after rendering it could fail on Android, so it never
  // reached the server.
  const file = new File(fileUri);
  const size = file.size;
  if (!size) throw new Error('The video file is missing');
  const { data: name, error } = await supabase.rpc('reserve_recap_upload', {
    p_event: eventId,
    p_mode: mode,
    p_size: size,
  });
  if (error || typeof name !== 'string') throw new Error(error?.message ?? 'Could not save the recap');
  const headers = await mediaHeaders();
  if (!headers) throw new Error('Sign in first');
  const target = `${MEDIA_URL}/v1/uploads/event-photos/${name}`;
  const put = await file.upload(target, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    headers: { ...headers, 'content-type': 'video/mp4' },
  });
  if ((put.status < 200 || put.status >= 300) && put.status !== 409) {
    throw new Error(`Upload failed (${put.status})`);
  }
  const done = await fetch(`${target}/done`, { method: 'POST', headers });
  if (!done.ok) throw new Error(`Upload failed (${done.status})`);
  const { error: saveError } = await supabase.rpc('save_event_recap', {
    p_event: eventId,
    p_mode: mode,
    p_signature: signature,
    p_name: name,
  });
  if (saveError) throw new Error(saveError.message);
}

// Share the event's recap: the saved one if it's still current, otherwise
// make it, share it, and save it for everyone (in the background).
export async function shareRecapVideo(
  eventId: string,
  mode: RecapMode,
  data: RecapData,
  reduceMotion: boolean
): Promise<void> {
  const signature = recapSignature(mode, data.scenes);
  const saved = (await loadSavedRecaps(eventId))[mode];
  if (saved && saved.signature === signature) {
    const url = await savedRecapUrl(saved.path);
    if (url) {
      const target = new File(Paths.cache, fileName(data.event.title, mode));
      if (target.exists) target.delete();
      const file = await File.downloadFileAsync(url, target);
      await Sharing.shareAsync(file.uri, { mimeType: 'video/mp4', UTI: 'public.mpeg-4' });
      return;
    }
  }
  const uri = await render(data, reduceMotion, mode);
  // Saved for everyone while the share sheet is open; a failure only means
  // the next person makes their own.
  saveRecapFile(eventId, mode, signature, uri).catch((e) =>
    console.warn('Could not save the recap for the event', e instanceof Error ? e.message : e)
  );
  await Sharing.shareAsync(uri, { mimeType: 'video/mp4', UTI: 'public.mpeg-4' });
}
