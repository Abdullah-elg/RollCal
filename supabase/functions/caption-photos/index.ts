// RollCal "AI captions" for the video recap: a short line describing each
// photo ("Golden hour by the cars") and a 1-10 "looks great" score, used
// with reactions to pick the recap's highlight photos.
//
// Video recaps are paid: the photos must all be from one event, and
// recap_video_allowed(event) must say yes (the event or the person is on a
// paid plan), or nothing is sent to the model.
//
// At most 300 photos per person per day (claim_caption_quota).
//
// Called by the app with the signed-in user's JWT:
//   supabase.functions.invoke('caption-photos', { body: { photoIds } })
// Only photos the person can see are captioned (looked up as them, under
// the photos rules), and each photo is captioned once ever: the line is
// saved in photo_captions and reused, so the cost is at most one small model
// call per photo. The picture sent is the small preview from our own media
// storage, fetched here (never a link from the app). Nothing else about the
// person is sent.
//
// Secrets: GEMINI_API_KEY (required; the same one scan-receipt uses),
// GEMINI_CAPTION_MODEL (optional, to switch the model without a code change).
// Deploy with "Enforce JWT verification" ON.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { allowedImageUrl, cleanCaption, cleanScore } from './clean.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const MEDIA_URL = 'https://media.rollcal.app';
// Cheapest first; a busy or slow model hands over to the next.
const MODELS = [
  Deno.env.get('GEMINI_CAPTION_MODEL') || 'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
];
const BUSY = new Set([429, 500, 503]);
const MODEL_TIMEOUT_MS = 12_000;
const MAX_PHOTOS = 30; // per call; the app asks in batches
const MAX_IMAGE_BYTES = 4_000_000;
const PARALLEL = 6;
const IMAGE_HOSTS = [
  new URL(MEDIA_URL).hostname,
  new URL(SUPABASE_URL).hostname,
  'api.rollcal.app',
  'qwtvpmrxmlfuwmnyawcq.supabase.co',
];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const PROMPT = `Write one short caption for this photo, for a fun video recap of a get-together with friends.

- At most 7 words, plain and warm, like a friend would write it.
- Say what's happening or the mood of the moment (the food, the place, the activity, the light).
- Never describe a person's body, looks, age, race, religion, health or anything sensitive, and never guess who someone is. "Friends at the table" is fine.
- No names, emoji, hashtags or quotation marks.
- If the photo is unclear, describe the setting.

Also give a score from 1 to 10 for how good this photo would look in the recap: 10 is a sharp, well-lit, lively moment people will love; 1 is blurry, dark, a screenshot, a receipt or an accidental shot.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: { caption: { type: 'STRING' }, score: { type: 'INTEGER' } },
  required: ['caption', 'score'],
};

function userIdFrom(authorization: string): string | null {
  try {
    const payload = authorization.replace(/^Bearer\s+/i, '').split('.')[1];
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof claims.sub === 'string' ? claims.sub : null;
  } catch {
    return null;
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

async function caption(
  image: string,
  mimeType: string
): Promise<{ text: string; score: number | null; model: string } | null> {
  const request = JSON.stringify({
    contents: [{ parts: [{ inline_data: { mime_type: mimeType, data: image } }, { text: PROMPT }] }],
    generationConfig: {
      response_mime_type: 'application/json',
      response_schema: SCHEMA,
      temperature: 0.4,
      max_output_tokens: 200,
      thinking_config: { thinking_level: 'low' },
    },
  });
  for (const model of [...new Set(MODELS)]) {
    let res: Response;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: request,
        signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
      });
    } catch (err) {
      console.warn(`${model} didn't answer in time: ${err}`);
      continue;
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.warn(`${model} ${res.status}: ${detail.slice(0, 300)}`);
      if (BUSY.has(res.status)) continue;
      return null;
    }
    try {
      const answer = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = answer?.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text ?? '';
      const parsed = JSON.parse(text);
      const cleaned = cleanCaption(parsed.caption);
      return cleaned ? { text: cleaned, score: cleanScore(parsed.score), model } : null;
    } catch {
      return null;
    }
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!GEMINI_API_KEY) return json(500, { error: 'Captions aren’t set up yet.' });

  const started = Date.now();
  const step = (what: string) => console.log(`${what} after ${Date.now() - started}ms`);
  const authorization = req.headers.get('authorization') ?? '';
  const userId = userIdFrom(authorization);
  if (!userId) return json(401, { error: 'Not signed in' });

  let body: { photoIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Send the photo ids as JSON.' });
  }
  const ids = Array.isArray(body.photoIds)
    ? [...new Set(body.photoIds.filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)))]
    : [];
  if (ids.length === 0) return json(200, { captions: {}, scores: {} });
  if (ids.length > MAX_PHOTOS) return json(400, { error: `At most ${MAX_PHOTOS} photos at a time.` });

  // As the person: only photos they can see come back.
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
  });
  const [{ data: photos, error: photoError }, { data: existing }] = await Promise.all([
    asUser.from('photos').select('id, kind, storage_path, event_id').in('id', ids),
    asUser.from('photo_captions').select('photo_id, caption, score').in('photo_id', ids),
  ]);
  if (photoError) return json(401, { error: 'Not signed in' });
  step(`${photos?.length ?? 0} visible photos, ${existing?.length ?? 0} already captioned`);

  const captions: Record<string, string> = {};
  const scores: Record<string, number> = {};
  for (const c of existing ?? []) {
    captions[c.photo_id] = c.caption;
    if (typeof c.score === 'number') scores[c.photo_id] = c.score;
  }
  // Captioned once ever; photos captioned before scores existed get one now.
  const todo = (photos ?? []).filter((p) => !captions[p.id] || scores[p.id] === undefined);
  if (todo.length === 0) return json(200, { captions, scores });

  // Paid feature: one event at a time, and it must be allowed for this person.
  const events = [...new Set(todo.map((p) => p.event_id))];
  if (events.length !== 1) return json(400, { error: 'Send photos from one event at a time.' });
  const { data: allowed, error: allowError } = await asUser.rpc('recap_video_allowed', { eid: events[0] });
  if (allowError || allowed !== true) {
    return json(403, { error: 'Video recaps come with Plus or an Event Pass.', code: 'recap_locked', captions, scores });
  }

  // A daily cap per person (300 photos, see membership-and-caps.sql), far
  // above any real use. Past it, the recap just plays without new captions.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: granted, error: quotaError } = await admin.rpc('claim_caption_quota', {
    p_user: userId,
    p_count: todo.length,
  });
  if (quotaError) {
    console.warn('caption quota check failed', quotaError.message);
    return json(200, { captions, scores });
  }
  if (typeof granted !== 'number' || granted <= 0) {
    console.warn('daily caption cap reached');
    return json(200, { captions, scores });
  }
  todo.splice(granted);

  // Links to the small previews, from the media Worker as the person (it
  // checks they may see each one).
  const links = new Map<string, string>();
  try {
    const res = await fetch(`${MEDIA_URL}/v1/links`, {
      method: 'POST',
      headers: { authorization, apikey: ANON_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ bucket: 'event-photos', names: todo.map((p) => p.storage_path) }),
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) {
      const got = (await res.json()) as { links?: Record<string, { url: string; thumb: string | null }> };
      for (const p of todo) {
        const link = got.links?.[p.storage_path];
        const pick = link?.thumb ?? (p.kind === 'video' ? null : link?.url);
        if (pick) links.set(p.id, pick);
      }
    }
  } catch (err) {
    console.warn('media links failed', String(err));
  }
  // Older files still in Supabase Storage.
  const missing = todo.filter((p) => p.kind !== 'video' && !links.has(p.id));
  if (missing.length > 0) {
    const { data } = await asUser.storage
      .from('event-photos')
      .createSignedUrls(missing.map((p) => p.storage_path), 300);
    for (const item of data ?? []) {
      const p = missing.find((m) => m.storage_path === item.path);
      if (p && item.signedUrl) links.set(p.id, item.signedUrl);
    }
  }
  step(`${links.size} picture links`);

  const queue = todo.filter((p) => links.has(p.id));
  const work = async () => {
    while (queue.length > 0) {
      const p = queue.shift()!;
      const url = links.get(p.id)!;
      if (!allowedImageUrl(url, IMAGE_HOSTS)) {
        console.warn('skipped a link outside our storage');
        continue;
      }
      try {
        // No redirects: the allowed-host check above only covers this URL.
        const res = await fetch(url, { signal: AbortSignal.timeout(8_000), redirect: 'error' });
        if (!res.ok) continue;
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) continue;
        const type = res.headers.get('content-type') ?? 'image/jpeg';
        const mimeType = /^image\/(jpeg|png|webp|heic|heif)$/.test(type) ? type : 'image/jpeg';
        const got = await caption(toBase64(bytes), mimeType);
        if (!got) continue;
        const { error } = await admin
          .from('photo_captions')
          .upsert(
            // A missing score is saved as 5, so the photo isn't asked about again.
            { photo_id: p.id, caption: got.text, score: got.score ?? 5, model: got.model },
            { onConflict: 'photo_id' }
          );
        if (error) console.warn('could not save a caption', error.message);
        captions[p.id] = got.text;
        scores[p.id] = got.score ?? 5;
      } catch (err) {
        console.warn('caption failed', String(err));
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, work));
  step(`captioned ${Object.keys(captions).length - (existing?.length ?? 0)} new`);
  return json(200, { captions, scores });
});
