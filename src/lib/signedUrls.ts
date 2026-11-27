// Temporary links to files in private storage (event photos, profile
// photos), reused for as long as they stay valid. Files in R2 get their
// links (and their small preview's) from the media Worker; files not copied
// there yet, or all of them if the Worker can't be reached, from Supabase
// Storage.
//
// A new signed URL has a new token, so the phone's image cache treats it as a
// different picture and downloads it again. Reusing the same URL until it is
// nearly expired, including across app restarts, lets the cache do its job.
// Requests made in the same moment are batched into one call per bucket, and
// paths the server refuses (a non-friend's profile photo) are remembered for
// a while instead of being asked for again on every render.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { MEDIA_URL, mediaHeaders } from './media';
import { supabase } from './supabase';

type Bucket = 'event-photos' | 'avatars';

const LINK_SECONDS = 12 * 60 * 60;
// Hand out a cached link only while it has at least this long left.
const MIN_LEFT_MS = 60 * 60 * 1000;
const REFUSED_MS = 10 * 60 * 1000;
const STORE_KEY = 'rollcal.signedUrls.v2';

// thumb: the small preview's link, when the file has one.
type Entry = { url: string; thumb: string | null; expires: number };

const links = new Map<string, Entry>(); // `${bucket}/${path}` -> link
const refused = new Map<string, number>(); // key -> when to ask again
const waiting = new Map<string, ((entry: Entry | null) => void)[]>();
const queued: Record<Bucket, Set<string>> = { 'event-photos': new Set(), avatars: new Set() };
let flushTimer: ReturnType<typeof setTimeout> | null = null;

let loaded: Promise<void> | null = null;
function loadStored(): Promise<void> {
  loaded ??= (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORE_KEY);
      const stored = raw ? (JSON.parse(raw) as Record<string, Entry>) : {};
      const now = Date.now();
      for (const [key, entry] of Object.entries(stored)) {
        if (entry.expires - now > MIN_LEFT_MS && !links.has(key)) links.set(key, entry);
      }
    } catch {
      // Starting with an empty cache is fine.
    }
  })();
  return loaded;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const now = Date.now();
    const keep: Record<string, Entry> = {};
    for (const [key, entry] of links) if (entry.expires - now > MIN_LEFT_MS) keep[key] = entry;
    AsyncStorage.setItem(STORE_KEY, JSON.stringify(keep)).catch(() => {});
  }, 1000);
}

function cached(key: string): Entry | null | undefined {
  const entry = links.get(key);
  if (entry && entry.expires - Date.now() > MIN_LEFT_MS) return entry;
  const until = refused.get(key);
  if (until && until > Date.now()) return null;
  return undefined;
}

// Links from the media Worker. Names it says aren't in R2 yet, and every
// name if it can't be reached, are left for Storage.
async function fromWorker(
  bucket: Bucket,
  paths: string[]
): Promise<{ got: Map<string, Entry>; rest: string[]; reached: boolean }> {
  const got = new Map<string, Entry>();
  try {
    const headers = await mediaHeaders();
    if (!headers) return { got, rest: paths, reached: false };
    const res = await fetch(`${MEDIA_URL}/v1/links`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ bucket, names: paths }),
    });
    if (!res.ok) return { got, rest: paths, reached: false };
    const body = (await res.json()) as {
      links: Record<string, { url: string; thumb: string | null }>;
      missing: string[];
      expires: number;
    };
    for (const [name, link] of Object.entries(body.links ?? {})) {
      got.set(name, { url: link.url, thumb: link.thumb, expires: body.expires * 1000 });
    }
    // Names in neither list are ones you may not see.
    return { got, rest: body.missing ?? [], reached: true };
  } catch {
    return { got, rest: paths, reached: false };
  }
}

// keepFor: how long to reuse these links. Short when the Worker couldn't be
// reached, so the app goes back to R2 soon instead of holding these all day.
async function fromStorage(
  bucket: Bucket,
  paths: string[],
  keepFor = LINK_SECONDS
): Promise<Map<string, Entry>> {
  const got = new Map<string, Entry>();
  if (paths.length === 0) return got;
  const { data } = await supabase.storage.from(bucket).createSignedUrls(paths, LINK_SECONDS);
  const expires = Date.now() + keepFor * 1000;
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) got.set(item.path, { url: item.signedUrl, thumb: null, expires });
  }
  return got;
}

async function flush() {
  flushTimer = null;
  for (const bucket of Object.keys(queued) as Bucket[]) {
    const paths = [...queued[bucket]];
    queued[bucket].clear();
    if (paths.length === 0) continue;
    // The Worker takes up to 200 names a time.
    const got = new Map<string, Entry>();
    for (let i = 0; i < paths.length; i += 200) {
      const chunk = paths.slice(i, i + 200);
      const worker = await fromWorker(bucket, chunk);
      worker.got.forEach((v, k) => got.set(k, v));
      const keepFor = worker.reached ? LINK_SECONDS : MIN_LEFT_MS / 1000 + 3600;
      (await fromStorage(bucket, worker.rest, keepFor)).forEach((v, k) => got.set(k, v));
    }
    for (const path of paths) {
      const key = `${bucket}/${path}`;
      const entry = got.get(path) ?? null;
      if (entry) links.set(key, entry);
      else refused.set(key, Date.now() + REFUSED_MS);
      for (const done of waiting.get(key) ?? []) done(entry);
      waiting.delete(key);
    }
  }
  saveSoon();
}

function linkEntry(bucket: Bucket, path: string): Promise<Entry | null> {
  const key = `${bucket}/${path}`;
  const hit = cached(key);
  if (hit !== undefined) return Promise.resolve(hit);
  return new Promise((resolve) => {
    const list = waiting.get(key);
    if (list) {
      list.push(resolve);
      return;
    }
    waiting.set(key, [resolve]);
    queued[bucket].add(path);
    flushTimer ??= setTimeout(flush, 0);
  });
}

// A link for one file, or null if it doesn't exist or isn't ours to see.
export async function signedUrl(bucket: Bucket, path: string): Promise<string | null> {
  await loadStored();
  return (await linkEntry(bucket, path))?.url ?? null;
}

// Links for many files at once: path -> the file's link and its preview's
// (null when it has none), leaving out any it can't get.
export async function signedLinks(
  bucket: Bucket,
  paths: string[]
): Promise<Map<string, { url: string; thumb: string | null }>> {
  await loadStored();
  const results = await Promise.all(paths.map((p) => linkEntry(bucket, p)));
  const map = new Map<string, { url: string; thumb: string | null }>();
  paths.forEach((p, i) => {
    const entry = results[i];
    if (entry) map.set(p, { url: entry.url, thumb: entry.thumb });
  });
  return map;
}

// Links for many files at once: path -> link, leaving out any it can't get.
export async function signedUrls(bucket: Bucket, paths: string[]): Promise<Map<string, string>> {
  const all = await signedLinks(bucket, paths);
  return new Map([...all].map(([p, l]) => [p, l.url]));
}

// The link for one file, for use in a component: null until it arrives, and
// null for good if the server refuses it. 'thumb' prefers the small preview.
export function useSignedUrl(
  bucket: Bucket,
  path: string | null | undefined,
  size: 'full' | 'thumb' = 'full'
): string | null {
  const pick = (e: Entry | null | undefined) =>
    e ? (size === 'thumb' ? (e.thumb ?? e.url) : e.url) : null;
  const [url, setUrl] = useState<string | null>(() =>
    path ? pick(cached(`${bucket}/${path}`)) : null
  );
  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }
    let live = true;
    loadStored()
      .then(() => linkEntry(bucket, path))
      .then((e) => {
        if (live) setUrl(pick(e));
      });
    return () => {
      live = false;
    };
    // pick only depends on size.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket, path, size]);
  return url;
}

// The storage path inside the avatars bucket from what profiles.avatar_url
// holds: older rows have the full public URL, so take what follows
// "/avatars/" and drop any query string.
export function avatarPath(avatarUrl: string | null | undefined): string | null {
  if (!avatarUrl) return null;
  const marker = '/avatars/';
  const at = avatarUrl.indexOf(marker);
  const path = at >= 0 ? avatarUrl.slice(at + marker.length) : avatarUrl;
  return path.split('?')[0] || null;
}

// Forget everything, for signing out: the next person on this phone may not
// be allowed to see the same photos.
export async function clearSignedUrls(): Promise<void> {
  links.clear();
  refused.clear();
  await AsyncStorage.removeItem(STORE_KEY).catch(() => {});
}
