import * as ImagePicker from 'expo-image-picker';
import { cleanPhoto } from './cleanPhoto';
import { supabase } from './supabase';

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function pickAndUploadAvatar(
  userId: string
): Promise<{ url: string | null; error: string | null; canceled?: boolean }> {
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      return {
        url: null,
        error: 'Permission to access photos is needed to set a profile photo.',
      };
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return { url: null, error: null, canceled: true };
    }

    // Profile photos are public, so strip location and other hidden details.
    const photo = await cleanPhoto(result.assets[0].uri, 0.85);
    const path = `${userId}/${Date.now()}.${photo.ext}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, base64ToArrayBuffer(photo.base64), {
        contentType: photo.mimeType,
        upsert: true,
      });

    if (uploadError) {
      return { url: null, error: uploadError.message };
    }

    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
    const publicUrl = urlData.publicUrl;

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_url: publicUrl })
      .eq('id', userId);

    if (updateError) {
      return { url: null, error: updateError.message };
    }

    return { url: publicUrl, error: null };
  } catch (e: any) {
    return { url: null, error: e?.message ?? 'An unexpected error occurred.' };
  }
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
    return { error: null };
  } catch (e: any) {
    return { error: e?.message ?? 'An unexpected error occurred.' };
  }
}
