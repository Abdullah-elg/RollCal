// Roll uploads. Finds the events a user can still add photos to, picks media,
// strips hidden details, and uploads to storage while checking the plan's
// storage allowance and Pro-only video. Also deletes an event's files.

import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { cleanPhoto, THUMB_SIDE } from './cleanPhoto';
import { discardMedia, MediaError, uploadMedia } from './media';
import { supabase } from './supabase';
import { videoThumb } from './videoThumb';
import {
  formatBytes,
  loadUploadAllowance,
  MAX_FILE_BYTES,
  overAllowance,
  UploadAllowance,
  VIDEO_MAX_SECONDS,
  FREE_VIDEO_SECONDS,
  FREE_VIDEO_BYTES,
} from './uploads';
import { Event } from '../types';
import { hapticShutter } from './haptics';
import { rollState } from './roll';

const BUCKET = 'event-photos' as const;

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

// Uploads one picked photo or video, with a small preview for the grid, and
// records it in photos. The database fills in its size and type from the
// stored file and refuses long videos on the free plan; if the row is refused, the file
// is thrown away so it doesn't count against the allowance. Goes to R2
// through the media Worker (lib/media), or Supabase Storage if the Worker
// can't be reached. Returns the new row's id.
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
  let thumb: ArrayBuffer | null = null;
  if (isVideo) {
    // Read the video straight from disk.
    body = await new File(asset.uri).arrayBuffer();
    ext = (asset.uri.split('.').pop() ?? 'mp4').toLowerCase();
    contentType = asset.mimeType ?? (ext === 'mov' ? 'video/quicktime' : 'video/mp4');
    thumb = await videoThumb(asset.uri);
  } else {
    // Strips location and other hidden details; see cleanPhoto.
    const photo = await cleanPhoto(asset.uri, quality, undefined, THUMB_SIDE);
    body = photo.body;
    ext = photo.ext;
    contentType = photo.mimeType;
    thumb = photo.thumb ?? null;
  }

  let path: string;
  let inR2 = true;
  try {
    path = await uploadMedia({ bucket: BUCKET, eventId, body, contentType, thumb });
  } catch (e) {
    if (!(e instanceof MediaError) || e.reason !== 'unavailable') {
      const reason = e instanceof MediaError ? e.reason : 'failed';
      throw new UploadError(
        reason === 'limit' ? 'limit' : reason === 'video' ? 'video' : 'failed',
        e instanceof Error ? e.message : 'Upload failed'
      );
    }
    inR2 = false;
    path = await uploadToStorage(eventId, body, ext, contentType);
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
    if (inR2) await discardMedia(BUCKET, path);
    else await supabase.storage.from(BUCKET).remove([path]);
    throw new UploadError(
      rowError.hint === 'video_pro' ? 'video' : rowError.hint === 'photos_full' ? 'roll_full' : 'failed',
      rowError.message
    );
  }
  return data.id;
}

// The way uploads worked before R2, used only when the media Worker can't
// be reached.
async function uploadToStorage(
  eventId: string,
  body: ArrayBuffer,
  ext: string,
  contentType: string
): Promise<string> {
  const path = `${eventId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, { contentType });
  if (error) {
    // Storage's row-level security only says no here when the allowance is used up.
    throw new UploadError(
      /row-level security|unauthorized|403/i.test(error.message) ? 'limit' : 'failed',
      error.message
    );
  }
  return path;
}

// Why an upload stopped: 'limit' = their storage is full,
// 'video' = a video without Pro.
export class UploadError extends Error {
  constructor(
    readonly reason: 'limit' | 'video' | 'roll_full' | 'failed',
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

// The roll's picker: photos and videos for everyone. Free accounts can add
// videos up to 15 seconds; uploadRollMedia turns longer ones into a prompt.
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
    // Free: short videos only (15 s, 25 MB; the server checks the same).
    if (!isPro) {
      const short = !!a.duration && a.duration <= FREE_VIDEO_SECONDS * 1000 + 500;
      const small = !a.fileSize || a.fileSize <= FREE_VIDEO_BYTES;
      if (!short || !small) {
        needsPro = 'video';
        return false;
      }
      return true;
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
      if (reason === 'roll_full') {
        problems.push('The photo roll is full. The host can make room for more with an Event Pass or Plus.');
        break;
      }
      problems.push('Some uploads didn’t go through. Please try again.');
      break;
    }
  }

  if (uploaded > 0) hapticShutter();
  return { uploaded, needsPro, problems };
}

function proLimitMessage(a: UploadAllowance): string {
  return `You’ve stored ${formatBytes(a.storedLimit)}, the most your plan allows. Remove some uploads to add more.`;
}

// Deletes every file in an event's folder. Called before the event row is
// deleted, since removing the rows alone leaves the files in storage.
export async function removeEventFiles(eventId: string): Promise<void> {
  const { data } = await supabase.storage.from(BUCKET).list(eventId, { limit: 1000 });
  const paths = (data ?? []).map((f) => `${eventId}/${f.name}`);
  if (paths.length > 0) await supabase.storage.from(BUCKET).remove(paths);
}
