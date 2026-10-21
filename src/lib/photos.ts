// Roll uploads. Finds the events a user can still add photos to, picks media,
// strips hidden details, and uploads to storage while checking the plan's
// storage allowance and Pro-only video. Also deletes an event's files.

import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { cleanPhoto } from './cleanPhoto';
import { supabase } from './supabase';
import {
  formatBytes,
  loadUploadAllowance,
  MAX_FILE_BYTES,
  overAllowance,
  UploadAllowance,
  VIDEO_MAX_SECONDS,
} from './uploads';
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
// Being able to see an event isn't enough: a pending or declined invite shows
// it too, but only members can add to its roll (private.is_member: the host,
// anyone with an RSVP, or an accepted invite).
export async function getOpenUploadEvents(userId: string): Promise<Event[]> {
  const [events, rsvps, invites] = await Promise.all([
    supabase.from('events').select('*').order('ends_at', { ascending: false }),
    supabase.from('rsvps').select('event_id').eq('user_id', userId),
    supabase
      .from('invitations')
      .select('event_id')
      .eq('invited_user_id', userId)
      .eq('status', 'accepted'),
  ]);
  if (events.error || !events.data) return [];

  const joined = new Set([...(rsvps.data ?? []), ...(invites.data ?? [])].map((r) => r.event_id));
  return events.data.filter(
    (e) =>
      (e.creator_id === userId || joined.has(e.id)) && rollState(e, e.uploads_closed).uploadOpen
  );
}

// Uploads one picked photo or video to the event's folder and records it in
// photos. The database fills in its size and type from the stored file and
// refuses videos without Pro; if the row is refused, the file is removed so
// it doesn't count against the allowance. Returns the new row's id.
export async function uploadPhotoAsset(
  eventId: string,
  userId: string,
  asset: ImagePicker.ImagePickerAsset,
  // JPEG quality for photos (see photoQuality).
  quality: number
): Promise<string> {
  const isVideo = asset.type === 'video';

  let body: ArrayBuffer;
  let ext: string;
  let contentType: string;
  if (isVideo) {
    // Videos never come as base64; read the file straight from disk.
    body = await new File(asset.uri).arrayBuffer();
    ext = (asset.uri.split('.').pop() ?? 'mp4').toLowerCase();
    contentType = asset.mimeType ?? 'video/mp4';
  } else {
    // Strips location and other hidden details; see cleanPhoto.
    const photo = await cleanPhoto(asset.uri, quality);
    body = base64ToArrayBuffer(photo.base64);
    ext = photo.ext;
    contentType = photo.mimeType;
  }
  const path = `${eventId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, body, {
    contentType,
  });
  if (uploadError) {
    // Storage's row-level security only says no here when the allowance is used up.
    throw new UploadError(
      /row-level security|unauthorized|403/i.test(uploadError.message) ? 'limit' : 'failed',
      uploadError.message
    );
  }

  const { data, error: rowError } = await supabase
    .from('photos')
    .insert({
      event_id: eventId,
      uploader_id: userId,
      storage_path: path,
      duration_ms: isVideo && asset.duration ? Math.round(asset.duration) : null,
    })
    .select('id')
    .single();
  if (rowError) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw new UploadError(rowError.hint === 'video_pro' ? 'video' : 'failed', rowError.message);
  }
  return data.id;
}

// Why an upload stopped: 'limit' = their storage is full,
// 'video' = a video without Pro.
export class UploadError extends Error {
  constructor(
    readonly reason: 'limit' | 'video' | 'failed',
    message: string
  ) {
    super(message);
  }
}

// Free uploads are saved at 80% JPEG quality: hard to tell from the original
// on a phone, at a fraction of the size. Pro keeps full quality.
export const photoQuality = (isPro: boolean) => (isPro ? 1 : 0.8);

// Checked before the picker opens, so nobody chooses photos only to be told
// no: 'storage' = show Pro (free), a message = Pro's own limit, null = go ahead.
export async function uploadBlocker(isPro: boolean): Promise<'storage' | string | null> {
  const allowance = await loadUploadAllowance();
  if (!allowance || !overAllowance(allowance)) return null;
  return isPro ? proLimitMessage(allowance) : 'storage';
}

// The roll's picker: photos and videos for everyone, so free users can see
// videos are possible; uploadRollMedia turns theirs into a Pro prompt.
export async function pickRollMedia(): Promise<ImagePicker.ImagePickerAsset[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    allowsMultipleSelection: true,
    selectionLimit: 10,
    // Full quality here; cleanPhoto applies the plan's quality when it
    // re-saves each photo, so it's compressed once, not twice.
    quality: 1,
    videoMaxDuration: VIDEO_MAX_SECONDS,
    // iOS: 720p keeps a minute of video under the file size cap. Android
    // returns videos as recorded, so long ones are caught by the size check.
    videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720,
  });
  return result.canceled ? [] : result.assets;
}

export type RollUploadResult = {
  uploaded: number;
  // Show the Pro screen for this reason, if set.
  needsPro: 'video' | 'storage' | null;
  // Plain-language problems to show, one per skipped file or failure.
  problems: string[];
};

// Uploads what was picked, in order, skipping what can't go up and saying
// why. Stops at the allowance: free users get the Pro prompt, Pro users a note.
export async function uploadRollMedia(
  eventId: string,
  userId: string,
  isPro: boolean,
  assets: ImagePicker.ImagePickerAsset[],
  onProgress?: (done: number, total: number) => void
): Promise<RollUploadResult> {
  const problems: string[] = [];
  let needsPro: RollUploadResult['needsPro'] = null;

  const allowance = await loadUploadAllowance();
  if (allowance && overAllowance(allowance)) {
    return isPro
      ? { uploaded: 0, needsPro: null, problems: [proLimitMessage(allowance)] }
      : { uploaded: 0, needsPro: 'storage', problems: [] };
  }

  const ready = assets.filter((a) => {
    if (a.type !== 'video') return true;
    if (!isPro) {
      needsPro = 'video';
      return false;
    }
    if (a.duration && a.duration > (VIDEO_MAX_SECONDS + 1) * 1000) {
      problems.push(`Videos can be up to ${VIDEO_MAX_SECONDS / 60} minute long. Trim it and try again.`);
      return false;
    }
    if (a.fileSize && a.fileSize > MAX_FILE_BYTES) {
      problems.push(`That video is over ${formatBytes(MAX_FILE_BYTES)}. Try a shorter clip.`);
      return false;
    }
    return true;
  });

  let uploaded = 0;
  onProgress?.(0, ready.length);
  for (const asset of ready) {
    try {
      await uploadPhotoAsset(eventId, userId, asset, photoQuality(isPro));
      uploaded += 1;
      onProgress?.(uploaded, ready.length);
    } catch (err) {
      const reason = err instanceof UploadError ? err.reason : 'failed';
      if (reason === 'limit') {
        if (isPro) {
          const latest = await loadUploadAllowance();
          problems.push(latest ? proLimitMessage(latest) : 'You’ve reached your upload limit.');
        } else {
          needsPro = 'storage';
        }
        break;
      }
      if (reason === 'video') {
        needsPro = 'video';
        continue;
      }
      problems.push('Some uploads didn’t go through. Please try again.');
      break;
    }
  }

  if (uploaded > 0) hapticShutter();
  return { uploaded, needsPro, problems };
}

function proLimitMessage(a: UploadAllowance): string {
  return `You’ve stored ${formatBytes(a.storedLimit)}, the most Pro allows. Remove some uploads to add more.`;
}

// Deletes every file in an event's folder. Called before the event row is
// deleted, since removing the rows alone leaves the files in storage.
export async function removeEventFiles(eventId: string): Promise<void> {
  const { data } = await supabase.storage.from(BUCKET).list(eventId, { limit: 1000 });
  const paths = (data ?? []).map((f) => `${eventId}/${f.name}`);
  if (paths.length > 0) await supabase.storage.from(BUCKET).remove(paths);
}
