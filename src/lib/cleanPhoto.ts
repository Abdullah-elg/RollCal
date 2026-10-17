import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

// Phone photos carry hidden metadata: where they were taken (GPS), when, and
// the phone's make and serial-style details. Anyone who downloads a photo
// from a roll could read it. Re-drawing the picture into a fresh JPEG keeps
// only the pixels, so every photo is cleaned this way before it uploads.
// (HEIC photos come out as JPEG too, which every phone can show.)

export type CleanPhoto = { base64: string; mimeType: 'image/jpeg'; ext: 'jpg' };

export async function cleanPhoto(uri: string, quality: number): Promise<CleanPhoto> {
  const image = await ImageManipulator.manipulate(uri).renderAsync();
  const saved = await image.saveAsync({ compress: quality, format: SaveFormat.JPEG, base64: true });
  if (!saved.base64) throw new Error('Could not read that photo.');
  return { base64: saved.base64, mimeType: 'image/jpeg', ext: 'jpg' };
}
