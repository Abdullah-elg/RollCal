// Uploads to RollCal's media storage (Cloudflare R2), through the media
// Worker (workers/media). The database decides whether the upload is
// allowed when the Worker reserves a name for it (supabase/media-r2.sql);
// the file and its small preview then go up, and the Worker checks they
// arrived whole before confirming them.
//
// If the Worker can't be reached at all, callers fall back to Supabase
// Storage (MediaError 'unavailable'), which keeps working until it's retired.

import { supabase } from './supabase';

export const MEDIA_URL = 'https://media.rollcal.app';

export type MediaBucket = 'event-photos' | 'avatars';

// 'limit': the plan's storage is full. 'video': videos need a paid plan.
// 'unavailable': the Worker didn't answer; use Supabase Storage instead.
export class MediaError extends Error {
  constructor(
    public reason: 'limit' | 'video' | 'unavailable' | 'failed',
    message?: string
  ) {
    super(message ?? reason);
  }
}

// The same two headers supabase-js sends, so the Worker can ask the
// database as you.
export async function mediaHeaders(): Promise<Record<string, string> | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const apikey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  return token && apikey ? { authorization: `Bearer ${token}`, apikey } : null;
}

async function send(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  // 409: that part already arrived (a retry after a lost answer).
  if (!res.ok && res.status !== 409) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new MediaError('failed', body?.error ?? `Upload failed (${res.status})`);
  }
  return res;
}

// Uploads one file (and its preview, if given) and returns its name in the
// bucket: "<event or user id>/<file>", the same shape as Storage paths.
export async function uploadMedia(opts: {
  bucket: MediaBucket;
  eventId?: string;
  body: ArrayBuffer;
  contentType: string;
  thumb?: ArrayBuffer | null;
}): Promise<string> {
  const headers = await mediaHeaders();
  if (!headers) throw new MediaError('failed', 'Sign in first');
  const thumb = opts.thumb && opts.thumb.byteLength > 0 ? opts.thumb : null;

  let res: Response;
  try {
    res = await fetch(`${MEDIA_URL}/v1/uploads`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        bucket: opts.bucket,
        eventId: opts.eventId ?? null,
        contentType: opts.contentType,
        size: opts.body.byteLength,
        thumbSize: thumb?.byteLength ?? 0,
      }),
    });
  } catch {
    throw new MediaError('unavailable');
  }
  // Not deployed yet, or down: the old way still works.
  if (res.status === 404 || res.status >= 500) throw new MediaError('unavailable');
  const reserved = (await res.json().catch(() => null)) as
    | { name?: string; error?: string; hint?: string }
    | null;
  if (!res.ok || !reserved?.name) {
    const hint = reserved?.hint;
    throw new MediaError(
      hint === 'limit' ? 'limit' : hint === 'video_pro' ? 'video' : 'failed',
      reserved?.error
    );
  }

  const target = `${MEDIA_URL}/v1/uploads/${opts.bucket}/${reserved.name}`;
  await send(target, {
    method: 'PUT',
    headers: { ...headers, 'content-type': opts.contentType },
    body: opts.body,
  });
  if (thumb) {
    // A missing preview only means the grid shows the full photo.
    await send(`${target}?part=thumb`, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'image/jpeg' },
      body: thumb,
    }).catch(() => {});
  }
  await send(`${target}/done`, { method: 'POST', headers });
  return reserved.name;
}

// Throws an upload away after its photo row was refused, so it stops
// counting toward storage. Best effort: unused files are cleared daily anyway.
export async function discardMedia(bucket: MediaBucket, name: string): Promise<void> {
  await supabase.rpc('discard_media', { p_bucket: bucket, p_name: name }).then(
    () => {},
    () => {}
  );
}
