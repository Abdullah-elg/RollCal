import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { Event } from '../types';

const COVER_TAG_REGEX = /(?:\r?\n)?<!--cover:([a-zA-Z0-9_-]+)-->/;
const ASYNC_PREFIX = '@event_cover_photo_';

/**
 * Extracts clean user-facing description text and any encoded cover photo ID.
 */
export function parseEventDescription(raw: string | null | undefined): {
  description: string | null;
  coverPhotoId: string | null;
} {
  if (!raw) return { description: null, coverPhotoId: null };
  const match = raw.match(COVER_TAG_REGEX);
  const coverPhotoId = match ? match[1] : null;
  const cleaned = raw.replace(COVER_TAG_REGEX, '').trim();
  return {
    description: cleaned.length > 0 ? cleaned : null,
    coverPhotoId,
  };
}

/**
 * Formats a description text with an encoded cover photo ID.
 */
export function formatEventDescription(
  currentRaw: string | null | undefined,
  coverPhotoId: string | null
): string | null {
  const { description } = parseEventDescription(currentRaw);
  if (!coverPhotoId) {
    return description;
  }
  const tag = `<!--cover:${coverPhotoId}-->`;
  return description ? `${description}\n${tag}` : tag;
}

export async function getCoverPhotoId(
  eventId: string,
  eventRow?: Event | null
): Promise<string | null> {
  // 1. If event row already has cover_photo_id column filled, use it directly
  if (eventRow?.cover_photo_id) {
    AsyncStorage.setItem(ASYNC_PREFIX + eventId, eventRow.cover_photo_id).catch(() => {});
    return eventRow.cover_photo_id;
  }

  // 2. Check if encoded in event description
  if (eventRow?.description) {
    const { coverPhotoId } = parseEventDescription(eventRow.description);
    if (coverPhotoId) {
      AsyncStorage.setItem(ASYNC_PREFIX + eventId, coverPhotoId).catch(() => {});
      return coverPhotoId;
    }
  }

  // 3. Fallback to local device cache
  try {
    const cached = await AsyncStorage.getItem(ASYNC_PREFIX + eventId);
    if (cached) return cached;
  } catch {
    // Ignore storage errors
  }

  return null;
}

export async function setCoverPhoto(
  eventId: string,
  photoId: string | null,
  currentDescription?: string | null
): Promise<{ error: string | null }> {
  // 1. Update local storage cache immediately
  try {
    if (photoId) {
      await AsyncStorage.setItem(ASYNC_PREFIX + eventId, photoId);
    } else {
      await AsyncStorage.removeItem(ASYNC_PREFIX + eventId);
    }
  } catch {
    // Ignore cache error
  }

  // 2. Update Supabase database
  const formattedDesc = formatEventDescription(currentDescription, photoId);

  // Try updating both cover_photo_id and description
  const payloadWithCol: Record<string, any> = {
    description: formattedDesc,
    cover_photo_id: photoId,
  };

  const { error: err1 } = await supabase
    .from('events')
    .update(payloadWithCol)
    .eq('id', eventId);

  // If column cover_photo_id doesn't exist, retry updating description alone
  if (err1) {
    const { error: err2 } = await supabase
      .from('events')
      .update({ description: formattedDesc })
      .eq('id', eventId);

    if (err2) {
      return { error: err2.message };
    }
  }

  return { error: null };
}
