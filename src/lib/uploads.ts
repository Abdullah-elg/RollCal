import { supabase } from './supabase';

// How much someone has stored in event rolls against their plan's total
// (2 GB free, 200 GB Pro). The numbers and the enforcement live in the
// database (supabase/media.sql); this only reads them for the app to show.

export type UploadAllowance = {
  isPro: boolean;
  stored: number;
  storedLimit: number;
};

// Each file is capped by the storage bucket (the most the Supabase Free plan
// allows). Raise both together when the plan changes.
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
// About what fits under MAX_FILE_BYTES at 720p.
export const VIDEO_MAX_SECONDS = 60;
// Free accounts: short clips (supabase/plan-limits-2.sql checks the same).
export const FREE_VIDEO_SECONDS = 15;
export const FREE_VIDEO_BYTES = 25 * 1024 * 1024;

export async function loadUploadAllowance(): Promise<UploadAllowance | null> {
  const { data, error } = await supabase.rpc('my_upload_allowance').maybeSingle();
  if (error || !data) return null;
  const row = data as { is_pro: boolean; stored: number; stored_limit: number };
  return {
    isPro: row.is_pro,
    stored: Number(row.stored),
    storedLimit: Number(row.stored_limit),
  };
}

export const overAllowance = (a: UploadAllowance) => a.stored >= a.storedLimit;

// Worth a heads-up from 80% full.
export const nearAllowance = (a: UploadAllowance) =>
  !overAllowance(a) && a.stored >= a.storedLimit * 0.8;

// 1.6 GB, 840 MB, 12 MB. Binary units, to match how limits are set.
export function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb >= 10 ? Math.round(gb) : Math.round(gb * 10) / 10} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}
