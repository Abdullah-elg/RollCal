let ExpoClipboard: typeof import('expo-clipboard') | null = null;

try {
  // Safely require expo-clipboard so older native builds without the module don't crash on import
  ExpoClipboard = require('expo-clipboard');
} catch {
  ExpoClipboard = null;
}

export async function setStringAsync(text: string): Promise<boolean> {
  if (ExpoClipboard && typeof ExpoClipboard.setStringAsync === 'function') {
    try {
      return await ExpoClipboard.setStringAsync(text);
    } catch {
      return false;
    }
  }
  return false;
}

export async function getStringAsync(): Promise<string> {
  if (ExpoClipboard && typeof ExpoClipboard.getStringAsync === 'function') {
    try {
      return await ExpoClipboard.getStringAsync();
    } catch {
      return '';
    }
  }
  return '';
}

export function isClipboardAvailable(): boolean {
  return ExpoClipboard !== null;
}
