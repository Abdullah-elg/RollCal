import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { eventStartsAt, isRollOpen } from './coverPhoto';
import { latestOf } from './marks';
import { loadServerChatReads, loadServerMarks, saveServerMarks } from './seenMarks';

// Per-event "last read" times, so the app can mark which chats and rolls
// have something new since you last looked. Kept on the phone and on the
// server (seenMarks), so reading on one phone counts on the others.

type ReadMap = Record<string, string>;

const readKey = (userId: string) => `rollcal.chatRead.${userId}`;

async function getLocalChatReadMap(userId: string): Promise<ReadMap> {
  try {
    const raw = await AsyncStorage.getItem(readKey(userId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// Read on this phone or another one (the server's chat reads): the later wins.
export async function getChatReadMap(userId: string): Promise<ReadMap> {
  const [local, server] = await Promise.all([
    getLocalChatReadMap(userId),
    loadServerChatReads(userId),
  ]);
  return latestOf(local, server);
}

export async function markChatRead(
  userId: string,
  eventId: string,
  timestamp: string
): Promise<void> {
  try {
    const map = await getLocalChatReadMap(userId);
    // Never move the mark backwards.
    if (!map[eventId] || timestamp > map[eventId]) {
      map[eventId] = timestamp;
      await AsyncStorage.setItem(readKey(userId), JSON.stringify(map));
    }
  } catch {
    // A lost mark only means a dot lingers until the chat is opened again.
  }
}

// Which of these events have messages from other people since I last read
// them. One query for all of them, reduced on the client.
export async function loadUnreadChats(
  userId: string,
  eventIds: string[]
): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  const [{ data: messages }, readMap] = await Promise.all([
    supabase
      .from('messages')
      .select('event_id, sender_id, created_at')
      .in('event_id', eventIds)
      .order('created_at', { ascending: false })
      .limit(300),
    getChatReadMap(userId),
  ]);

  const unread = new Set<string>();
  for (const m of messages ?? []) {
    if (m.sender_id === userId) continue;
    const readAt = readMap[m.event_id];
    if (!readAt || m.created_at > readAt) unread.add(m.event_id);
  }
  return unread;
}

const photoReadKey = (userId: string) => `rollcal.photoRead.${userId}`;

async function getLocalPhotoReadMap(userId: string): Promise<ReadMap> {
  try {
    const raw = await AsyncStorage.getItem(photoReadKey(userId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// Looked at on this phone or another one: the later wins.
export async function getPhotoReadMap(userId: string): Promise<ReadMap> {
  const [local, server] = await Promise.all([
    getLocalPhotoReadMap(userId),
    loadServerMarks('photos'),
  ]);
  return latestOf(local, server);
}

// The time photos were last viewed before this visit's mark overwrote it, so
// the album can still show which photos are new. Only kept when the old mark
// is clearly from an earlier visit (not one written seconds ago).
const previousPhotoMarks = new Map<string, string>();
const RECENT_MARK_MS = 30_000;

export function previousPhotoMark(eventId: string): string | undefined {
  return previousPhotoMarks.get(eventId);
}

export function isRecentMark(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < RECENT_MARK_MS;
}

export async function markPhotosRead(
  userId: string,
  eventId: string,
  timestamp: string
): Promise<void> {
  try {
    const map = await getLocalPhotoReadMap(userId);
    const before = map[eventId];
    if (before && !isRecentMark(before)) previousPhotoMarks.set(eventId, before);
    if (!map[eventId] || timestamp > map[eventId]) {
      map[eventId] = timestamp;
      await AsyncStorage.setItem(photoReadKey(userId), JSON.stringify(map));
    }
    // The server keeps the later of the two, for your other phones.
    await saveServerMarks('photos', { [eventId]: timestamp }, false);
  } catch {
    // A lost mark only means a dot lingers until opened again
  }
}

export async function loadUnreadPhotos(
  userId: string,
  eventIds: string[]
): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  const [{ data: photos }, readMap] = await Promise.all([
    supabase
      .from('photos')
      .select('event_id, uploader_id, created_at, events!inner(starts_at)')
      .in('event_id', eventIds)
      .order('created_at', { ascending: false })
      .limit(300),
    getPhotoReadMap(userId),
  ]);

  const unread = new Set<string>();
  for (const p of photos ?? []) {
    if (p.uploader_id === userId) continue;
    // A cover added before the event isn't news until the roll opens.
    if (!isRollOpen(eventStartsAt(p.events))) continue;
    const readAt = readMap[p.event_id];
    if (!readAt || p.created_at > readAt) unread.add(p.event_id);
  }
  return unread;
}

// ---------------------------------------------------------------------------
// Event changes: the host changed the name, place, time or description
// (details_changed_at, event-changes.sql). Lights the event's ring until you
// open the event. Your own changes don't count.

const eventSeenKey = (userId: string) => `rollcal.eventSeen.${userId}`;
// With no mark yet (a fresh install), only recent changes count, so old
// events don't all light up at once.
const NEW_CHANGE_MS = 7 * 24 * 60 * 60 * 1000;

async function getLocalEventSeenMap(userId: string): Promise<ReadMap> {
  try {
    const raw = await AsyncStorage.getItem(eventSeenKey(userId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function markEventSeen(userId: string, eventId: string, timestamp: string): Promise<void> {
  try {
    const map = await getLocalEventSeenMap(userId);
    if (!map[eventId] || timestamp > map[eventId]) {
      map[eventId] = timestamp;
      await AsyncStorage.setItem(eventSeenKey(userId), JSON.stringify(map));
    }
    await saveServerMarks('event', { [eventId]: timestamp }, false);
  } catch {
    // A lost mark only means the ring stays lit until the event is opened again.
  }
}

export async function loadChangedEvents(userId: string, eventIds: string[]): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  const [{ data, error }, local, server] = await Promise.all([
    supabase
      .from('events')
      .select('id, details_changed_at, details_changed_by')
      .in('id', eventIds)
      .not('details_changed_at', 'is', null),
    getLocalEventSeenMap(userId),
    loadServerMarks('event'),
  ]);
  // Before event-changes.sql runs the columns don't exist: nothing lights.
  if (error) return new Set();
  const seen = latestOf(local, server);
  const cutoff = new Date(Date.now() - NEW_CHANGE_MS).toISOString();
  const changed = new Set<string>();
  for (const e of data ?? []) {
    if (!e.details_changed_at || e.details_changed_by === userId) continue;
    const seenAt = seen[e.id];
    if (seenAt ? e.details_changed_at > seenAt : e.details_changed_at > cutoff) changed.add(e.id);
  }
  return changed;
}
