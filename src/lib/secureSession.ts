import AsyncStorage from '@react-native-async-storage/async-storage';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { base64ToBytes, bytesToBase64, utf8Decode, utf8Encode } from './utf8';

// Where Supabase keeps the signed-in session. The session is too big for
// the Keychain / Keystore (about 2 KB per item), so it's encrypted with
// AES-256-GCM and the ciphertext goes in AsyncStorage, while the key itself
// lives in the Keychain (iOS) or Keystore (Android). Someone copying the
// app's files gets ciphertext without the key.

const KEY_NAME = 'rollcal.sessionKey';
// Marks values written by this adapter, so plain sessions saved by older
// versions of the app can still be read once and then rewritten encrypted.
const PREFIX = 'enc1:';

let keyPromise: Promise<AESEncryptionKey> | null = null;

// Making a new key replaces the old one for good, and the saved session can
// never be read again. So a missing key is checked twice before that happens:
// the Keystore can come back empty for a moment on a busy phone.
async function readStoredKey(): Promise<string | null> {
  const first = await SecureStore.getItemAsync(KEY_NAME);
  if (first) return first;
  await new Promise((resolve) => setTimeout(resolve, 300));
  return SecureStore.getItemAsync(KEY_NAME);
}

function sessionKey(): Promise<AESEncryptionKey> {
  keyPromise ??= (async () => {
    const stored = await readStoredKey();
    if (stored) return AESEncryptionKey.import(stored, 'hex');
    const key = await AESEncryptionKey.generate();
    await SecureStore.setItemAsync(KEY_NAME, await key.encoded('hex'), {
      // Readable after the first unlock, so token refresh works in the
      // background; never synced to other devices or iCloud backups.
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
    return key;
  })().catch((err) => {
    keyPromise = null;
    throw err;
  });
  return keyPromise;
}

let warned = false;
function warnOnce(err: unknown) {
  if (warned) return;
  warned = true;
  console.warn('Session saved unencrypted: secure storage unavailable.', err);
}

export const secureSessionStorage = {
  async getItem(name: string): Promise<string | null> {
    const raw = await AsyncStorage.getItem(name);
    if (raw === null) return null;
    if (!raw.startsWith(PREFIX)) {
      // Saved by an older version in plain text: hand it over once and
      // store it encrypted from now on.
      await this.setItem(name, raw).catch(() => {});
      return raw;
    }
    try {
      // Bytes, not a base64 string: Android's expo-crypto rejects strings here.
      const sealed = AESSealedData.fromCombined(base64ToBytes(raw.slice(PREFIX.length)));
      const bytes = (await aesDecryptAsync(sealed, await sessionKey(), {
        output: 'bytes',
      })) as Uint8Array;
      return utf8Decode(bytes);
    } catch {
      // Unreadable right now: the Keystore can fail for a moment on a busy
      // phone, as well as for good (a backup restored on a new phone, or
      // tampered data). Treat it as signed out for now, but keep the data:
      // deleting it here signed people out for good over a passing error.
      // If it really can't be read, the next sign-in overwrites it.
      return null;
    }
  },

  async setItem(name: string, value: string): Promise<void> {
    let stored: string;
    try {
      const sealed = await aesEncryptAsync(utf8Encode(value), await sessionKey());
      stored = PREFIX + bytesToBase64((await sealed.combined('bytes')) as Uint8Array);
    } catch (err) {
      // No usable Keychain / Keystore. Real installs always have one; unsigned
      // simulator builds don't. Keep the session as before rather than sign
      // the person out, and try encrypting again next time.
      warnOnce(err);
      stored = value;
    }
    await AsyncStorage.setItem(name, stored);
  },

  async removeItem(name: string): Promise<void> {
    await AsyncStorage.removeItem(name);
  },
};
