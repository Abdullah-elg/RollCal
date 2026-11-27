// The recap as a video file, written on the phone (iOS for now). null where
// the native part isn't there (Android, or an older build), so the app can
// hide "Save video" instead of failing.
import { requireOptionalNativeModule } from 'expo-modules-core';

export type RecapVideoScene = {
  kind: 'title' | 'photo' | 'end';
  ms: number;
  // A picture's https or file:// link (title and photo scenes).
  uri?: string | null;
  // Slow move (photo scenes): scale and drift as a share of the frame.
  fromScale?: number;
  toScale?: number;
  fromX?: number;
  toX?: number;
  fromY?: number;
  toY?: number;
  title?: string;
  subtitle?: string;
  caption?: string;
};

export type RecapVideoOptions = {
  scenes: RecapVideoScene[];
  // The RollCal mark for the end card (a file:// or https link).
  markUri?: string | null;
  fileName: string;
  fadeMs?: number;
};

type Native = { exportAsync(options: RecapVideoOptions): Promise<string> };

const native = requireOptionalNativeModule<Native>('RecapVideo');

export const canExportRecapVideo = native != null;

// Resolves with the file:// link of the finished .mp4.
export function exportRecapVideo(options: RecapVideoOptions): Promise<string> {
  if (!native) return Promise.reject(new Error('Video export is not available on this device yet.'));
  return native.exportAsync(options);
}
