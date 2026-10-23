// Profile photo upload and removal. The avatars bucket is private: only you
// and your friends can load your photo (see Avatar and lib/signedUrls). The
// photo is cropped square and re-saved first, which strips location and other
// hidden details. profiles.avatar_url holds the file's path in the bucket.

import * as ImagePicker from 'expo-image-picker';
import { cleanPhoto } from './cleanPhoto';
import { supabase } from './supabase';

export async function pickAndUploadAvatar(
  userId: string
): Promise<{ url: string | null; error: string | null; canceled?: boolean }> {
  try {
    // No photo-library permission needed: the system picker hands over only
    // the photo they choose. (Android builds don't include READ_MEDIA_* at
    // all, per Google Play's photo picker policy.)
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return { url: null, error: null, canceled: true };
    }

    // Friends can see it, so strip location and other hidden details. It's
    // only ever shown small, so 1024 px across is plenty.
    const photo = await cleanPhoto(result.assets[0].uri, 0.85, 1024);
    const path = `${userId}/${Date.now()}.${photo.ext}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, photo.body, {
        contentType: photo.mimeType,
        upsert: true,
      });

    if (uploadError) {
      return { url: null, error: uploadError.message };
    }

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_url: path })
      .eq('id', userId);

    if (updateError) {
      return { url: null, error: updateError.message };
    }

    await deleteAvatarFiles(userId, path);
    return { url: path, error: null };
  } catch (e: any) {
    return { url: null, error: e?.message ?? 'An unexpected error occurred.' };
  }
}

// Deletes this person's photo files, except `keep`: removing a photo should
// remove the file, and each upload has its own name, so old ones would pile
// up otherwise. Best effort; a leftover file is unreachable without a link.
async function deleteAvatarFiles(userId: string, keep?: string): Promise<void> {
  const { data } = await supabase.storage.from('avatars').list(userId);
  const old = (data ?? []).map((f) => `${userId}/${f.name}`).filter((p) => p !== keep);
  if (old.length > 0) await supabase.storage.from('avatars').remove(old);
}

export async function removeAvatar(
  userId: string
): Promise<{ error: string | null }> {
  try {
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_url: null })
      .eq('id', userId);

    if (updateError) {
      return { error: updateError.message };
    }
    await deleteAvatarFiles(userId);
    return { error: null };
  } catch (e: any) {
    return { error: e?.message ?? 'An unexpected error occurred.' };
  }
}
