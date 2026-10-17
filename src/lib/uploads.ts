import { supabase } from './supabase';

// How much someone has uploaded to event rolls this month against their
// allowance. The numbers and the enforcement live in the database
// (supabase/media.sql); this only reads them for the app to show.

export type UploadAllowance = {
  isPro: boolean;
  monthUsed: number;
  monthLimit: number;
  stored: number;
  // null for free accounts: their photos expire instead.
  storedLimit: number | null;
};

// Each file is capped by the storage bucket (the most the Supabase Free plan
// allows). Raise both together when the plan changes.
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
// About what fits under MAX_FILE_BYTES at 720p.
export const VIDEO_MAX_SECONDS = 60;

export async function loadUploadAllowance(): Promise<UploadAllowance | null> {
  const { data, error } = await supabase.rpc('my_upload_allowance').maybeSingle();
  if (error || !data) return null;
  const row = data as {
    is_pro: boolean;
    month_used: number;
    month_limit: number;
    stored: number;
    stored_limit: number | null;
  };
  return {
    isPro: row.is_pro,
    monthUsed: Number(row.month_used),
    monthLimit: Number(row.month_limit),
    stored: Number(row.stored),
    storedLimit: row.stored_limit === null ? null : Number(row.stored_limit),
  };
}

export const overAllowance = (a: UploadAllowance) =>
  a.monthUsed >= a.monthLimit || (a.storedLimit !== null && a.stored >= a.storedLimit);

// Worth a heads-up from 80% of the month's allowance.
export const nearAllowance = (a: UploadAllowance) =>
  !overAllowance(a) && a.monthUsed >= a.monthLimit * 0.8;

// 1.6 GB, 840 MB, 12 MB. Binary units, to match how limits are set.
export function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb >= 10 ? Math.round(gb) : Math.round(gb * 10) / 10} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}
