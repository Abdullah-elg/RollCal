import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

// Phone photos carry hidden metadata: where they were taken (GPS), when, and
// the phone's make and serial-style details. Anyone who downloads a photo
// from a roll could read it. Re-drawing the picture into a fresh JPEG keeps
// only the pixels, so every photo is cleaned this way before it uploads.
// (HEIC photos come out as JPEG too, which every phone can show.)
//
// Memory: a 48 MP iPhone photo is about 200 MB once drawn. The drawn image is
// released as soon as the JPEG is saved, and the JPEG is read straight from
// disk rather than through a base64 string, so uploading several big photos
// in a row doesn't run the phone out of memory (iOS closes the app when it
// does, which looks like a crash).

export type CleanPhoto = { body: ArrayBuffer; mimeType: 'image/jpeg'; ext: 'jpg' };

// maxSide shrinks the photo so its longer side is at most that many pixels;
// leave it out to keep the full size.
export async function cleanPhoto(
  uri: string,
  quality: number,
  maxSide?: number
): Promise<CleanPhoto> {
  const context = ImageManipulator.manipulate(uri);
  let image: Awaited<ReturnType<typeof context.renderAsync>> | null = null;
  try {
    image = await context.renderAsync();
    if (maxSide && Math.max(image.width, image.height) > maxSide) {
      const resize =
        image.width >= image.height ? { width: maxSide } : { height: maxSide };
      image.release();
      image = await context.resize(resize).renderAsync();
    }
    const saved = await image.saveAsync({ compress: quality, format: SaveFormat.JPEG });
    image.release();
    image = null;

    const file = new File(saved.uri);
    try {
      return { body: await file.arrayBuffer(), mimeType: 'image/jpeg', ext: 'jpg' };
    } finally {
      try {
        file.delete();
      } catch {
        // A leftover file in the cache folder is harmless; iOS clears it.
      }
    }
  } finally {
    image?.release();
    context.release();
  }
}
