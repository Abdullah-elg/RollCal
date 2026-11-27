// Loads everything the video recap needs: the event, its photos (minus
// people you've blocked) with picture links, who took each and when, their
// reactions and AI captions and "looks great" scores, and the scene plan
// for the chosen mode (all photos, or the highlights).
//
// Video recaps are paid (recap_video_allowed). Only then are missing
// captions and scores made, by the caption-photos edge function, once per
// photo ever. If that's slow or fails, the recap plays with "Name · time"
// and picks highlights by reactions alone.

import { formatDay, formatTime } from './dates';
import { guestName } from './guests';
import { planOf } from './pro';
import { placeLabel } from './place';
import { pickRecapPhotos } from './recap';
import { loadBlockedIds } from './safety';
import { signedLinks } from './signedUrls';
import { supabase } from './supabase';
import type { Profile } from '../types';
import { buildRecapScenes, MAX_ALL_PHOTOS, recapCaption, RecapMode, Scene } from './videoRecap';

export type RecapPic = {
  id: string;
  kind: 'photo' | 'video';
  hasPicture: boolean;
  uri: string | null;
  // "Sara · 8:14 PM"
  meta: string;
  // "Golden hour by the cars", when there is one.
  caption: string | null;
  reactions: number;
  score: number | null;
  uploader: string;
};

export type RecapData = {
  event: { title: string; starts_at: string; location: string | null; cover_photo_id: string | null };
  when: string;
  scenes: Scene<RecapPic>[];
};

const CAPTION_WAIT_MS = 20_000;
const BATCH = 30;
const CHUNK = 100;

// May this person make this event's video? Asks the server; if that
// check isn't there (an older database), falls back to their own plan.
export async function recapVideoAllowed(eventId: string, profile: Profile | null): Promise<boolean> {
  const { data, error } = await supabase.rpc('recap_video_allowed', { eid: eventId });
  if (!error && typeof data === 'boolean') return data;
  return planOf(profile) === 'plus' || planOf(profile) === 'pro';
}

// Every photo with its link, who/when, reactions and any saved caption.
export async function loadRecapPhotos(eventId: string): Promise<{
  event: RecapData['event'];
  when: string;
  pics: RecapPic[];
}> {
  const [{ data: ev, error }, { data: rows }, blocked] = await Promise.all([
    supabase.from('events').select('title, starts_at, location, cover_photo_id').eq('id', eventId).maybeSingle(),
    supabase
      .from('photos')
      .select('id, kind, storage_path, uploader_id, created_at')
      .eq('event_id', eventId)
      .order('created_at', { ascending: true }),
    loadBlockedIds(),
  ]);
  if (error || !ev) throw error ?? new Error('gone');
  const visible = (rows ?? []).filter((r) => !blocked.has(r.uploader_id));
  const ids = visible.map((r) => r.id);
  const uploaderIds = [...new Set(visible.map((r) => r.uploader_id))];
  const [links, { data: people }, reactions, saved] = await Promise.all([
    signedLinks('event-photos', visible.map((r) => r.storage_path)),
    uploaderIds.length > 0
      ? supabase.from('profiles').select('*').in('id', uploaderIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
    reactionCounts(ids),
    savedCaptions(ids),
  ]);
  const pics: RecapPic[] = visible.map((r) => {
    const link = links.get(r.storage_path);
    const uri = r.kind === 'video' ? (link?.thumb ?? null) : (link?.url ?? null);
    const who = people?.find((p) => p.id === r.uploader_id);
    const c = saved.get(r.id);
    return {
      id: r.id,
      kind: r.kind,
      hasPicture: !!uri,
      uri,
      meta: recapCaption(who ? guestName(who) : null, formatTime(r.created_at)),
      caption: c?.caption ?? null,
      reactions: reactions.get(r.id) ?? 0,
      score: c?.score ?? null,
      uploader: r.uploader_id,
    };
  });
  const place = ev.location ? placeLabel(ev.location) : null;
  return { event: ev, when: [formatDay(ev.starts_at), place].filter(Boolean).join(' · '), pics };
}

// The video: photos, then (paid) captions and scores for the ones that may
// play, then the plan for the mode.
export async function loadRecap(eventId: string, mode: RecapMode): Promise<RecapData> {
  const { event, when, pics } = await loadRecapPhotos(eventId);
  const usable = pics.filter((p) => p.hasPicture);
  // Highlights are chosen from scores, so every candidate needs one; for
  // "all", only the ones that fit in the minute.
  const candidates =
    usable.length > MAX_ALL_PHOTOS + 1 ? pickRecapPhotos(usable, event.cover_photo_id, undefined, MAX_ALL_PHOTOS + 1) : usable;
  const need = candidates.filter((p) => !p.caption || p.score === null);
  if (need.length > 0) {
    const got = await makeCaptions(need.map((p) => p.id));
    for (const p of pics) {
      const g = got.get(p.id);
      if (g) {
        p.caption = g.caption ?? p.caption;
        p.score = g.score ?? p.score;
      }
    }
  }
  const scenes = buildRecapScenes(candidates, event.cover_photo_id, { mode });
  return { event, when, scenes };
}

// The free taste of the video: the title over the event photo and the first
// photo, about 5 seconds, then the offer card. No AI captions are made.
export async function loadPreview(eventId: string, mode: RecapMode): Promise<RecapData> {
  const { event, when, pics } = await loadRecapPhotos(eventId);
  const all = buildRecapScenes(pics, event.cover_photo_id, { mode });
  if (all.length === 0) return { event, when, scenes: [] };
  const end = all[all.length - 1];
  const taste = all.slice(0, Math.min(2, all.length - 1)).map((s) =>
    s.kind === 'title' ? { ...s, ms: 2600 } : s.kind === 'photo' ? { ...s, ms: 2600 } : s
  );
  return { event, when, scenes: [...taste, { ...end, ms: 1200 }] };
}

async function reactionCounts(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await supabase
        .from('photo_reactions')
        .select('photo_id')
        .in('photo_id', ids.slice(i, i + CHUNK));
      if (error) break;
      for (const r of data ?? []) out.set(r.photo_id, (out.get(r.photo_id) ?? 0) + 1);
    }
  } catch {
    // Highlights fall back to looks alone.
  }
  return out;
}

async function savedCaptions(ids: string[]): Promise<Map<string, { caption: string; score: number | null }>> {
  const out = new Map<string, { caption: string; score: number | null }>();
  try {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await supabase
        .from('photo_captions')
        .select('*')
        .in('photo_id', ids.slice(i, i + CHUNK));
      if (error) break;
      for (const c of (data ?? []) as { photo_id: string; caption: string; score?: number | null }[]) {
        out.set(c.photo_id, { caption: c.caption, score: c.score ?? null });
      }
    }
  } catch {
    // No captions yet.
  }
  return out;
}

async function makeCaptions(ids: string[]): Promise<Map<string, { caption?: string; score?: number }>> {
  const out = new Map<string, { caption?: string; score?: number }>();
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += BATCH) batches.push(ids.slice(i, i + BATCH));
  const asked = Promise.all(
    batches.map((photoIds) =>
      supabase.functions
        .invoke<{ captions?: Record<string, string>; scores?: Record<string, number> }>('caption-photos', {
          body: { photoIds },
        })
        .then(({ data }) => {
          for (const [id, caption] of Object.entries(data?.captions ?? {})) {
            if (typeof caption === 'string' && caption) out.set(id, { ...out.get(id), caption });
          }
          for (const [id, score] of Object.entries(data?.scores ?? {})) {
            if (typeof score === 'number') out.set(id, { ...out.get(id), score });
          }
        })
        .catch(() => {})
    )
  );
  await Promise.race([asked, new Promise((resolve) => setTimeout(resolve, CAPTION_WAIT_MS))]);
  return out;
}
