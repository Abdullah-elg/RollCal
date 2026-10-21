import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { eventEndsAt, isRollOpen } from './coverPhoto';

// Per-event "last read" times, kept on the device, so the app can mark which
// chats have said something since you last looked.

type ReadMap = Record<string, string>;

const readKey = (userId: string) => `rollcal.chatRead.${userId}`;

export async function getChatReadMap(userId: string): Promise<ReadMap> {
  try {
    const raw = await AsyncStorage.getItem(readKey(userId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function markChatRead(
  userId: string,
  eventId: string,
  timestamp: string
): Promise<void> {
  try {
    const map = await getChatReadMap(userId);
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

export async function getPhotoReadMap(userId: string): Promise<ReadMap> {
  try {
    const raw = await AsyncStorage.getItem(photoReadKey(userId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function markPhotosRead(
  userId: string,
  eventId: string,
  timestamp: string
): Promise<void> {
  try {
    const map = await getPhotoReadMap(userId);
    if (!map[eventId] || timestamp > map[eventId]) {
      map[eventId] = timestamp;
      await AsyncStorage.setItem(photoReadKey(userId), JSON.stringify(map));
    }
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
      .select('event_id, uploader_id, created_at, events!inner(ends_at)')
      .in('event_id', eventIds)
      .order('created_at', { ascending: false })
      .limit(300),
    getPhotoReadMap(userId),
  ]);

  const unread = new Set<string>();
  for (const p of photos ?? []) {
    if (p.uploader_id === userId) continue;
    // A cover added before the event isn't news until the roll opens.
    if (!isRollOpen(eventEndsAt(p.events))) continue;
    const readAt = readMap[p.event_id];
    if (!readAt || p.created_at > readAt) unread.add(p.event_id);
  }
  return unread;
}
