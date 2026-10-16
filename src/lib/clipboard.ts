import * as ExpoClipboard from 'expo-clipboard';

// Thin wrappers so callers never have to handle a clipboard error themselves.

export async function setStringAsync(text: string): Promise<boolean> {
  try {
    return await ExpoClipboard.setStringAsync(text);
  } catch {
    return false;
  }
}

export async function getStringAsync(): Promise<string> {
  try {
    return await ExpoClipboard.getStringAsync();
  } catch {
    return '';
  }
}
