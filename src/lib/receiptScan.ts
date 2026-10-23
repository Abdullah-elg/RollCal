import { FunctionsHttpError } from '@supabase/supabase-js';
import * as ImagePicker from 'expo-image-picker';
import { BillDraft, DraftItem } from './bills';
import { supabase } from './supabase';

// Turns a photo of a receipt into a bill draft for the review screen. The
// reading happens in the scan-receipt edge function (Gemini); nothing is
// stored, and the person checks every line before sharing.

export type ScanSource = 'camera' | 'library';

export type ScanResult =
  // scansLeft is the free scans still left this month, or null for Pro.
  | { draft: BillDraft; scansLeft: number | null }
  // scansLeft is set when the photo was read but wasn't a receipt: that
  // still used a free scan.
  | { error: string; scansLeft?: number | null }
  // The free scans for this month are used up; time to show Pro.
  | { limitReached: true }
  // They closed the camera or picker without choosing a photo.
  | { cancelled: true };

type ScannedDraft = Omit<BillDraft, 'eventId' | 'currency' | 'paymentMethodIds'> & {
  currency: string | null;
  items: DraftItem[];
};

// onReading fires once a photo is chosen, while the receipt is being read.
// fallbackCurrency is used when the receipt gives no clue to its currency.
export async function scanReceipt(
  eventId: string,
  source: ScanSource,
  onReading: () => void,
  fallbackCurrency: string
): Promise<ScanResult> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      return { error: 'RollCal needs the camera to scan receipts. You can allow it in Settings.' };
    }
  }
  // Half quality keeps the upload small; receipt text stays sharp.
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: 'images',
    quality: 0.5,
    base64: true,
  };
  const picked =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  const photo = picked.canceled ? null : picked.assets[0];
  if (!photo) return { cancelled: true };
  if (!photo.base64) return { error: 'Couldn’t open that photo. Try another one.' };
  onReading();

  const { data, error } = await supabase.functions.invoke('scan-receipt', {
    body: { image: photo.base64, mimeType: photo.mimeType ?? 'image/jpeg' },
    // The function gives each model 20 seconds; never spin forever.
    timeout: 75_000,
  });
  if (error) {
    // The function explains what went wrong in plain words; use them.
    if (error instanceof FunctionsHttpError) {
      const body = await error.context.json().catch(() => null);
      if (body?.code === 'scan_limit') return { limitReached: true };
      if (typeof body?.error === 'string') {
        return 'scansLeft' in body ? { error: body.error, scansLeft: body.scansLeft } : { error: body.error };
      }
    }
    return { error: 'Couldn’t read the receipt right now. Try again, or type it in.' };
  }

  const { draft: scanned, scansLeft } = data as { draft: ScannedDraft; scansLeft: number | null };
  return {
    scansLeft,
    draft: {
      ...scanned,
      eventId,
      currency: scanned.currency ?? fallbackCurrency,
      paymentMethodIds: [],
    },
  };
}
