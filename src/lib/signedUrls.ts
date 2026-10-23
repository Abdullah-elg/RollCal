// Temporary links to files in private storage (event photos, profile
// photos), reused for as long as they stay valid.
//
// A new signed URL has a new token, so the phone's image cache treats it as a
// different picture and downloads it again. Reusing the same URL until it is
// nearly expired, including across app restarts, lets the cache do its job.
// Requests made in the same moment are batched into one call per bucket, and
// paths the server refuses (a non-friend's profile photo) are remembered for
// a while instead of being asked for again on every render.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

type Bucket = 'event-photos' | 'avatars';

const LINK_SECONDS = 12 * 60 * 60;
// Hand out a cached link only while it has at least this long left.
const MIN_LEFT_MS = 60 * 60 * 1000;
const REFUSED_MS = 10 * 60 * 1000;
const STORE_KEY = 'rollcal.signedUrls.v1';

type Entry = { url: string; expires: number };

const links = new Map<string, Entry>(); // `${bucket}/${path}` -> link
const refused = new Map<string, number>(); // key -> when to ask again
const waiting = new Map<string, Array<(url: string | null) => void>>();
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

function cached(key: string): string | null | undefined {
  const entry = links.get(key);
  if (entry && entry.expires - Date.now() > MIN_LEFT_MS) return entry.url;
  const until = refused.get(key);
  if (until && until > Date.now()) return null;
  return undefined;
}

async function flush() {
  flushTimer = null;
  for (const bucket of Object.keys(queued) as Bucket[]) {
    const paths = [...queued[bucket]];
    queued[bucket].clear();
    if (paths.length === 0) continue;
    const { data } = await supabase.storage.from(bucket).createSignedUrls(paths, LINK_SECONDS);
    const got = new Map<string, string>();
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) got.set(item.path, item.signedUrl);
    }
    const expires = Date.now() + LINK_SECONDS * 1000;
    for (const path of paths) {
      const key = `${bucket}/${path}`;
      const url = got.get(path) ?? null;
      if (url) links.set(key, { url, expires });
      else refused.set(key, Date.now() + REFUSED_MS);
      for (const done of waiting.get(key) ?? []) done(url);
      waiting.delete(key);
    }
  }
  saveSoon();
}

// A link for one file, or null if it doesn't exist or isn't ours to see.
export async function signedUrl(bucket: Bucket, path: string): Promise<string | null> {
  await loadStored();
  const key = `${bucket}/${path}`;
  const hit = cached(key);
  if (hit !== undefined) return hit;
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

// Links for many files at once: path -> link, leaving out any it can't get.
export async function signedUrls(bucket: Bucket, paths: string[]): Promise<Map<string, string>> {
  const results = await Promise.all(paths.map((p) => signedUrl(bucket, p)));
  const map = new Map<string, string>();
  paths.forEach((p, i) => {
    const url = results[i];
    if (url) map.set(p, url);
  });
  return map;
}

// The link for one file, for use in a component: null until it arrives, and
// null for good if the server refuses it.
export function useSignedUrl(bucket: Bucket, path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() =>
    path ? (cached(`${bucket}/${path}`) ?? null) : null
  );
  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }
    let live = true;
    signedUrl(bucket, path).then((u) => {
      if (live) setUrl(u);
    });
    return () => {
      live = false;
    };
  }, [bucket, path]);
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
