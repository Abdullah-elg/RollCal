import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { createVideoPlayer } from 'expo-video';
import { THUMB_SIDE } from './cleanPhoto';

// A still from near the start of a video, as a small JPEG, so the album grid
// can show what the video is instead of a plain tile. Null if the phone
// can't make one in a few seconds; the upload goes ahead without it.
export async function videoThumb(uri: string): Promise<ArrayBuffer | null> {
  const player = createVideoPlayer(uri);
  try {
    const frames = await Promise.race([
      player.generateThumbnailsAsync(0.5, { maxWidth: THUMB_SIDE, maxHeight: THUMB_SIDE }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);
    const frame = frames?.[0];
    if (!frame) return null;
    const context = ImageManipulator.manipulate(frame);
    try {
      const image = await context.renderAsync();
      const saved = await image.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
      image.release();
      const file = new File(saved.uri);
      try {
        return await file.arrayBuffer();
      } finally {
        try {
          file.delete();
        } catch {
          // Harmless leftover in the cache folder.
        }
      }
    } finally {
      context.release();
    }
  } catch {
    return null;
  } finally {
    player.release();
  }
}
