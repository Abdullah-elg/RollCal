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

export type CleanPhoto = {
  body: ArrayBuffer;
  mimeType: 'image/jpeg';
  ext: 'jpg';
  // The small preview, when thumbSide was given (null if it couldn't be made).
  thumb?: ArrayBuffer | null;
};

// The album grid's previews: this many pixels on the longer side, which is
// sharp at three across on any phone.
export const THUMB_SIDE = 480;
const THUMB_QUALITY = 0.7;

// Reads a saved JPEG and deletes it from the cache folder.
async function takeFile(uri: string): Promise<ArrayBuffer> {
  const file = new File(uri);
  try {
    return await file.arrayBuffer();
  } finally {
    try {
      file.delete();
    } catch {
      // A leftover file in the cache folder is harmless; iOS clears it.
    }
  }
}

// maxSide shrinks the photo so its longer side is at most that many pixels;
// leave it out to keep the full size. thumbSide also makes a small preview
// from the same picture.
export async function cleanPhoto(
  uri: string,
  quality: number,
  maxSide?: number,
  thumbSide?: number
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
    const wide = image.width >= image.height;
    const longest = Math.max(image.width, image.height);
    const saved = await image.saveAsync({ compress: quality, format: SaveFormat.JPEG });
    image.release();
    image = null;
    const body = await takeFile(saved.uri);

    let thumb: ArrayBuffer | null | undefined;
    if (thumbSide) {
      try {
        if (longest > thumbSide) context.resize(wide ? { width: thumbSide } : { height: thumbSide });
        image = await context.renderAsync();
        const small = await image.saveAsync({ compress: THUMB_QUALITY, format: SaveFormat.JPEG });
        image.release();
        image = null;
        thumb = await takeFile(small.uri);
      } catch {
        thumb = null;
      }
    }
    return { body, mimeType: 'image/jpeg', ext: 'jpg', thumb };
  } finally {
    image?.release();
    context.release();
  }
}
