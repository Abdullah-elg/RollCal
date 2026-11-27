// RollCal's media Worker: the only way into the R2 bucket of photos, videos
// and profile photos. The database decides who may add or see what
// (supabase/media-r2.sql); this checks the files themselves and moves them.
//
//   POST /v1/uploads                     reserve a file name (database checks)
//   PUT  /v1/uploads/<bucket>/<name>     the file, or ?part=thumb its preview
//   POST /v1/uploads/<bucket>/<name>/done   check what arrived and confirm it
//   POST /v1/links                       viewing links for files you may see
//   GET  /v1/f/<key>?e=&s=               a file, by a signed link
//   every 5 minutes                      delete files whose rows are gone
//
// Signed-in requests carry the person's Supabase token and the app's
// publishable key, the same headers supabase-js sends.

interface Env {
  MEDIA: R2Bucket;
  // A second, private copy of every file (see backUp). Optional so the
  // Worker still runs where the bucket hasn't been made yet.
  BACKUP?: R2Bucket;
  UPLOAD_LIMIT: RateLimit;
  LINK_LIMIT: RateLimit;
  SUPABASE_URL: string;
  // RollCal's own address for the same project (Supabase custom domain).
  // Tokens name it as their issuer once the domain is active.
  API_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  LINK_SECRET: string;
  // Shared with the report-email function, for support's photo links.
  MEDIA_ADMIN_KEY: string;
}

type Bucket = 'event-photos' | 'avatars';
const BUCKETS: ReadonlySet<string> = new Set(['event-photos', 'avatars']);
// "<uuid>/<file>", the names the database hands out (and older ones copied
// from Supabase Storage).
const NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[A-Za-z0-9._-]{1,120}$/;
const KEY_RE = /^(thumbs\/)?(event-photos|avatars)\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,130}$/;

// Links last 12 to 18 hours and only change every 6, so the phone's image
// cache sees the same address for a picture all day.
const LINK_SECONDS = 12 * 3600;
const LINK_STEP = 6 * 3600;
const MAX_NAMES = 200;

const fileKey = (bucket: Bucket, name: string) => `${bucket}/${name}`;
const thumbKey = (bucket: Bucket, name: string) => `thumbs/${bucket}/${name}.jpg`;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
const fail = (status: number, error: string, hint?: string) => json(status, { error, hint });
const slowDown = () => fail(429, 'Too many requests. Try again in a minute.', 'busy');

// ---------------------------------------------------------------------------
// Base64url and signatures
// ---------------------------------------------------------------------------
const enc = new TextEncoder();

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes: ArrayBuffer): string {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}

let linkKey: { secret: string; key: CryptoKey } | null = null;
async function linkSignature(env: Env, key: string, exp: number): Promise<string> {
  if (!linkKey || linkKey.secret !== env.LINK_SECRET) {
    const k = await crypto.subtle.importKey(
      'raw',
      enc.encode(env.LINK_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    linkKey = { secret: env.LINK_SECRET, key: k };
  }
  return bytesToB64url(await crypto.subtle.sign('HMAC', linkKey.key, enc.encode(`${key}\n${exp}`)));
}

async function signedLink(env: Env, origin: string, key: string, exp: number): Promise<string> {
  const s = await linkSignature(env, key, exp);
  return `${origin}/v1/f/${key}?e=${exp}&s=${s}`;
}

// ---------------------------------------------------------------------------
// Who is asking: a Supabase token, checked against the project's public keys
// ---------------------------------------------------------------------------
let jwks: { keys: Map<string, CryptoKey>; at: number } | null = null;

async function signingKey(env: Env, kid: string): Promise<CryptoKey | null> {
  const stale = !jwks || Date.now() - jwks.at > 10 * 60_000;
  // An unknown key id refetches at most once a minute.
  const unknown = jwks && !jwks.keys.has(kid) && Date.now() - jwks.at > 60_000;
  if (stale || unknown) {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
    if (res.ok) {
      const body = (await res.json()) as { keys: (JsonWebKey & { kid?: string; alg?: string })[] };
      const keys = new Map<string, CryptoKey>();
      for (const k of body.keys ?? []) {
        if (k.kid && k.alg === 'ES256') {
          keys.set(
            k.kid,
            await crypto.subtle.importKey('jwk', k, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
              'verify',
            ])
          );
        }
      }
      jwks = { keys, at: Date.now() };
    }
  }
  return jwks?.keys.get(kid) ?? null;
}

function bearer(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

// The signed-in person's id, or null.
async function userId(req: Request, env: Env): Promise<string | null> {
  const token = bearer(req);
  const parts = token?.split('.');
  if (!token || parts?.length !== 3) return null;
  try {
    const [h, p, s] = parts;
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
    if (header.alg !== 'ES256' || typeof header.kid !== 'string') return null;
    const key = await signingKey(env, header.kid);
    if (!key) return null;
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      b64urlToBytes(s),
      enc.encode(`${h}.${p}`)
    );
    if (!ok) return null;
    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (
      typeof claims.sub !== 'string' ||
      typeof claims.exp !== 'number' ||
      claims.exp * 1000 < Date.now() ||
      claims.role !== 'authenticated' ||
      !aud.includes('authenticated') ||
      ![`${env.SUPABASE_URL}/auth/v1`, `${env.API_URL}/auth/v1`].includes(claims.iss)
    ) {
      return null;
    }
    return claims.sub;
  } catch {
    return null;
  }
}

// Server-to-server calls (report emails) send the admin key.
function isAdmin(req: Request, env: Env): boolean {
  const token = bearer(req);
  if (!token || !env.MEDIA_ADMIN_KEY || env.MEDIA_ADMIN_KEY.length < 32) return false;
  return sameBytes(enc.encode(token), enc.encode(env.MEDIA_ADMIN_KEY));
}

// ---------------------------------------------------------------------------
// The database
// ---------------------------------------------------------------------------
type Caller = { token: string; apikey: string } | 'service';

async function rpc<T>(
  env: Env,
  fn: string,
  args: Record<string, unknown>,
  as: Caller
): Promise<{ ok: true; data: T } | { ok: false; status: number; hint?: string; message?: string }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (as === 'service') {
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    headers.apikey = key;
    // Older service role keys are tokens; newer secret keys go in apikey only.
    if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`;
  } else {
    headers.apikey = as.apikey;
    headers.authorization = `Bearer ${as.token}`;
  }
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(args),
  });
  const body = (await res.json().catch(() => null)) as unknown;
  if (res.ok) return { ok: true, data: body as T };
  const err = (body ?? {}) as { hint?: string; message?: string };
  return { ok: false, status: res.status, hint: err.hint ?? undefined, message: err.message };
}

function caller(req: Request): Caller | null {
  const token = bearer(req);
  const apikey = req.headers.get('apikey');
  return token && apikey ? { token, apikey } : null;
}

type Reservation = {
  owner: string;
  size_bytes: number;
  thumb_bytes: number;
  content_type: string;
  stored: boolean;
};

async function reservation(env: Env, bucket: Bucket, name: string): Promise<Reservation | null> {
  const r = await rpc<Reservation[]>(env, 'media_reservation', { p_bucket: bucket, p_name: name }, 'service');
  return r.ok ? (r.data[0] ?? null) : null;
}

function parseTarget(segments: string[]): { bucket: Bucket; name: string } | null {
  const [bucket, ...rest] = segments;
  const name = rest.map(decodeURIComponent).join('/');
  if (!BUCKETS.has(bucket) || !NAME_RE.test(name)) return null;
  return { bucket: bucket as Bucket, name };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// POST /v1/uploads {bucket, eventId, contentType, size, thumbSize}
async function reserve(req: Request, env: Env): Promise<Response> {
  const as = caller(req);
  const uid = as ? await userId(req, env) : null;
  if (!as || !uid) return fail(401, 'Sign in first');
  if (!(await env.UPLOAD_LIMIT.limit({ key: uid })).success) return slowDown();
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b.bucket !== 'string' || !BUCKETS.has(b.bucket)) return fail(400, 'Bad request');
  const r = await rpc<string>(
    env,
    'reserve_media_upload',
    {
      p_bucket: b.bucket,
      p_event: typeof b.eventId === 'string' ? b.eventId : null,
      p_content_type: b.contentType,
      p_size: b.size,
      p_thumb_size: typeof b.thumbSize === 'number' ? b.thumbSize : 0,
    },
    as
  );
  if (!r.ok) return fail(r.status === 401 ? 401 : 403, r.message ?? 'Not allowed', r.hint);
  return json(200, { name: r.data });
}

// PUT /v1/uploads/<bucket>/<name>[?part=thumb]
async function put(req: Request, env: Env, segments: string[], url: URL): Promise<Response> {
  const uid = await userId(req, env);
  if (!uid) return fail(401, 'Sign in first');
  if (!(await env.UPLOAD_LIMIT.limit({ key: uid })).success) return slowDown();
  const target = parseTarget(segments);
  if (!target) return fail(400, 'Bad file name');
  const r = await reservation(env, target.bucket, target.name);
  if (!r || r.owner !== uid) return fail(404, 'No such upload');
  if (r.stored) return fail(409, 'Already uploaded');

  const isThumb = url.searchParams.get('part') === 'thumb';
  const expectedType = isThumb ? 'image/jpeg' : r.content_type;
  const expectedLength = Number(isThumb ? r.thumb_bytes : r.size_bytes);
  const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const length = Number(req.headers.get('content-length'));
  if (!req.body || expectedLength <= 0 || type !== expectedType || length !== expectedLength) {
    return fail(400, 'The file doesn’t match what was reserved');
  }

  const key = isThumb ? thumbKey(target.bucket, target.name) : fileKey(target.bucket, target.name);
  // Each part is written once: a second PUT can't rewrite it over and over.
  const stored = await env.MEDIA.put(key, req.body, {
    httpMetadata: { contentType: expectedType },
    onlyIf: new Headers({ 'if-none-match': '*' }),
  });
  if (stored === null) return fail(409, 'Already uploaded');
  if (stored.size !== expectedLength) {
    await env.MEDIA.delete(key);
    return fail(400, 'The file didn’t arrive whole');
  }
  if (isThumb) {
    // Arrived after the upload was confirmed: it wasn't counted, so drop it.
    const now = await reservation(env, target.bucket, target.name);
    if (!now || now.stored) await env.MEDIA.delete(key);
  }
  return json(200, { ok: true });
}

// POST /v1/uploads/<bucket>/<name>/done
async function done(req: Request, env: Env, segments: string[]): Promise<Response> {
  const uid = await userId(req, env);
  if (!uid) return fail(401, 'Sign in first');
  if (!(await env.UPLOAD_LIMIT.limit({ key: uid })).success) return slowDown();
  const target = parseTarget(segments);
  if (!target) return fail(400, 'Bad file name');
  const r = await reservation(env, target.bucket, target.name);
  if (!r || r.owner !== uid) return fail(404, 'No such upload');
  if (r.stored) return json(200, { ok: true });

  const file = await env.MEDIA.head(fileKey(target.bucket, target.name));
  if (!file || file.size !== Number(r.size_bytes)) return fail(400, 'The file isn’t all there');
  let thumbSize = 0;
  if (Number(r.thumb_bytes) > 0) {
    const thumb = await env.MEDIA.head(thumbKey(target.bucket, target.name));
    // A missing or partial preview isn't worth failing the upload over.
    if (thumb && thumb.size === Number(r.thumb_bytes)) thumbSize = thumb.size;
    else if (thumb) await env.MEDIA.delete(thumbKey(target.bucket, target.name));
  }
  const c = await rpc<boolean | null>(
    env,
    'confirm_media_upload',
    { p_bucket: target.bucket, p_name: target.name, p_size: file.size, p_thumb_size: thumbSize },
    'service'
  );
  if (!c.ok) return fail(500, 'Could not save the upload');
  return json(200, { ok: true });
}

// POST /v1/links {bucket, names, seconds?}
// -> { links: {name: {url, thumb}}, missing: [names to ask Storage for], expires }
async function links(req: Request, env: Env, origin: string): Promise<Response> {
  const b = (await req.json().catch(() => null)) as
    | { bucket?: unknown; names?: unknown; seconds?: unknown }
    | null;
  if (!b || typeof b.bucket !== 'string' || !BUCKETS.has(b.bucket) || !Array.isArray(b.names)) {
    return fail(400, 'Bad request');
  }
  const bucket = b.bucket as Bucket;
  const names = b.names
    .filter((n): n is string => typeof n === 'string' && NAME_RE.test(n))
    .slice(0, MAX_NAMES);

  let rows: { name: string; has_thumb: boolean; in_r2: boolean }[];
  let seconds = LINK_SECONDS;
  if (isAdmin(req, env)) {
    // Support's links last as long as they ask, up to a week.
    if (typeof b.seconds === 'number' && b.seconds > 0) seconds = Math.min(b.seconds, 7 * 86400);
    // Support's report emails: full-size links, no viewer check.
    rows = names.map((name) => ({ name, has_thumb: false, in_r2: true }));
  } else {
    const as = caller(req);
    const uid = as ? await userId(req, env) : null;
    if (!as || !uid) return fail(401, 'Sign in first');
    if (!(await env.LINK_LIMIT.limit({ key: uid })).success) return slowDown();
    const r = await rpc<typeof rows>(env, 'readable_media', { p_bucket: bucket, p_names: names }, as);
    if (!r.ok) return fail(r.status === 401 ? 401 : 500, 'Could not check those files');
    rows = r.data;
  }

  const exp = Math.ceil((Date.now() / 1000 + seconds) / LINK_STEP) * LINK_STEP;
  const out: Record<string, { url: string; thumb: string | null }> = {};
  const missing: string[] = [];
  for (const row of rows) {
    if (!row.in_r2) {
      missing.push(row.name);
      continue;
    }
    out[row.name] = {
      url: await signedLink(env, origin, fileKey(bucket, row.name), exp),
      thumb: row.has_thumb ? await signedLink(env, origin, thumbKey(bucket, row.name), exp) : null,
    };
  }
  return json(200, { links: out, missing, expires: exp });
}

// GET /v1/f/<key>?e=<expiry>&s=<signature>
async function serve(req: Request, env: Env, key: string, url: URL): Promise<Response> {
  const exp = Number(url.searchParams.get('e'));
  const sig = url.searchParams.get('s') ?? '';
  if (!KEY_RE.test(key) || !Number.isInteger(exp) || exp * 1000 < Date.now()) {
    return new Response('Not found', { status: 404 });
  }
  const expected = await linkSignature(env, key, exp);
  if (!sameBytes(enc.encode(sig), enc.encode(expected))) return new Response('Not found', { status: 404 });

  const obj = await env.MEDIA.get(key, { range: req.headers, onlyIf: req.headers });
  if (!obj) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('accept-ranges', 'bytes');
  // Shown only as the type it was saved as, and never as a page that runs.
  headers.set('x-content-type-options', 'nosniff');
  headers.set('content-security-policy', "default-src 'none'; sandbox");
  // Private: the link is the permission, so shared caches don't keep it.
  headers.set('cache-control', `private, max-age=${Math.max(0, exp - Math.floor(Date.now() / 1000))}`);
  if (!('body' in obj)) return new Response(null, { status: 304, headers });

  const range = obj.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (range && req.headers.has('range')) {
    const offset = range.suffix !== undefined ? obj.size - range.suffix : (range.offset ?? 0);
    const length = range.suffix !== undefined ? range.suffix : (range.length ?? obj.size - offset);
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set('content-length', String(length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('content-length', String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}

// ---------------------------------------------------------------------------
// Clean-up: files whose rows are gone, and uploads never finished
// ---------------------------------------------------------------------------
async function cleanUp(env: Env): Promise<void> {
  await rpc<number>(env, 'expire_media_reservations', {}, 'service');
  for (let round = 0; round < 10; round++) {
    const r = await rpc<{ id: number; bucket: Bucket; name: string }[]>(
      env,
      'claim_media_deletions',
      { n: 200 },
      'service'
    );
    if (!r.ok || r.data.length === 0) return;
    const keys = r.data.flatMap((d) => [fileKey(d.bucket, d.name), thumbKey(d.bucket, d.name)]);
    await env.MEDIA.delete(keys);
    await rpc(env, 'finish_media_deletions', { ids: r.data.map((d) => d.id) }, 'service');
    if (r.data.length < 200) return;
  }
}

// Backup: every hour, copy new or changed files into the BACKUP bucket.
// Photos have no other copy, so this is what lets a file deleted by mistake
// (a bug, a compromised account) be put back. Files people delete on
// purpose leave the backup too, 30 days after they leave the main bucket,
// as the privacy policy promises ("backups are overwritten within 30 days").
// A file that's gone from the main bucket gets a small marker,
// gone/<key>, holding when it was first missed.
const BACKUP_CRON = '23 * * * *';
const BACKUP_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const BACKUP_MAX_COPIES = 300; // per run, to stay well inside Worker limits

async function listAll(bucket: R2Bucket, prefix?: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    for (const o of page.objects) out.set(o.key, o.etag);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

async function backUp(env: Env): Promise<void> {
  const backup = env.BACKUP;
  if (!backup) return;
  const [main, copies, gone] = await Promise.all([
    listAll(env.MEDIA),
    listAll(backup),
    listAll(backup, 'gone/'),
  ]);
  for (const k of gone.keys()) copies.delete(k);

  // New or changed files.
  let copied = 0;
  for (const [key, etag] of main) {
    if (copied >= BACKUP_MAX_COPIES) break;
    if (copies.get(key) === etag) continue;
    const obj = await env.MEDIA.get(key);
    if (!obj) continue;
    await backup.put(key, obj.body, { httpMetadata: obj.httpMetadata, customMetadata: { source_etag: etag } });
    copied++;
  }

  // Back in the main bucket: forget it was missing.
  const back = [...gone.keys()].filter((g) => main.has(g.slice('gone/'.length)));
  if (back.length) await backup.delete(back);

  // Gone from the main bucket: mark it, and drop the copy after 30 days.
  const now = Date.now();
  for (const key of copies.keys()) {
    if (main.has(key)) continue;
    const marker = `gone/${key}`;
    if (!gone.has(marker)) {
      await backup.put(marker, String(now));
      continue;
    }
    const m = await backup.get(marker);
    const since = m ? Number(await m.text()) : now;
    if (now - since >= BACKUP_KEEP_MS) await backup.delete([key, marker]);
  }
  console.log(`backup: ${copied} copied, ${main.size} files`);
}

// The web join page (rollcal.app/join) uploads and asks for links from the
// browser; only RollCal's own site may. The app isn't a browser and needs
// none of this.
const WEB_ORIGINS: ReadonlySet<string> = new Set(['https://rollcal.app', 'https://www.rollcal.app']);

function withCors(req: Request, res: Response): Response {
  const origin = req.headers.get('origin');
  if (!origin || !WEB_ORIGINS.has(origin)) return res;
  const out = new Response(res.body, res);
  out.headers.set('access-control-allow-origin', origin);
  out.headers.append('vary', 'origin');
  return out;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') {
      const origin = req.headers.get('origin');
      if (!origin || !WEB_ORIGINS.has(origin)) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': origin,
          'access-control-allow-methods': 'GET, POST, PUT',
          'access-control-allow-headers': 'authorization, apikey, content-type',
          'access-control-max-age': '86400',
          vary: 'origin',
        },
      });
    }
    return withCors(req, await route(req, env));
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === BACKUP_CRON) ctx.waitUntil(backUp(env));
    else ctx.waitUntil(cleanUp(env));
  },
} satisfies ExportedHandler<Env>;

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean);
  try {
    if (segments[0] !== 'v1') return new Response('Not found', { status: 404 });
    const [, route, ...rest] = segments;
    if (route === 'f' && (req.method === 'GET' || req.method === 'HEAD')) {
      return await serve(req, env, rest.join('/'), url);
    }
    if (route === 'links' && req.method === 'POST') return await links(req, env, url.origin);
    if (route === 'uploads') {
      if (rest.length === 0 && req.method === 'POST') return await reserve(req, env);
      if (rest[rest.length - 1] === 'done' && req.method === 'POST') {
        return await done(req, env, rest.slice(0, -1));
      }
      if (req.method === 'PUT') return await put(req, env, rest, url);
    }
    return new Response('Not found', { status: 404 });
  } catch (e) {
    console.error('media worker', e instanceof Error ? e.message : e);
    return fail(500, 'Something went wrong');
  }
}
