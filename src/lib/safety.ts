import { Profile } from '../types';
import { supabase } from './supabase';

// Blocking and reporting. Both are free for everyone. The database enforces
// what a block means (no friend requests or invites between the two people;
// see supabase/safety.sql); the app also hides a blocked person's messages,
// photos and profile from the person who blocked them.

export async function loadBlockedIds(): Promise<Set<string>> {
  const { data } = await supabase.from('blocks').select('blocked_id');
  return new Set((data ?? []).map((r) => r.blocked_id as string));
}

// The people you've blocked, for Settings.
export async function loadBlockedPeople(): Promise<Profile[]> {
  const ids = [...(await loadBlockedIds())];
  if (ids.length === 0) return [];
  const { data } = await supabase.from('profiles').select('*').in('id', ids);
  return ((data ?? []) as Profile[]).sort((a, b) => a.display_name.localeCompare(b.display_name));
}

// Everyone search should leave out: people you blocked and people who
// blocked you (the database doesn't say which).
export async function loadHiddenPeople(): Promise<Set<string>> {
  const { data } = await supabase.rpc('hidden_people');
  return new Set(((data ?? []) as string[]).map(String));
}

export async function blockUser(userId: string, otherId: string): Promise<string | null> {
  const { error } = await supabase.from('blocks').insert({ blocker_id: userId, blocked_id: otherId });
  // 23505: already blocked, which is what they wanted.
  return error && error.code !== '23505' ? 'Could not block them. Please try again.' : null;
}

export async function unblockUser(otherId: string): Promise<string | null> {
  const { error } = await supabase.from('blocks').delete().eq('blocked_id', otherId);
  return error ? 'Could not unblock them. Please try again.' : null;
}

export type ReportTarget = 'user' | 'message' | 'photo' | 'event';
export type ReportReason =
  | 'spam'
  | 'harassment'
  | 'hate'
  | 'nudity'
  | 'violence'
  | 'impersonation'
  | 'child_safety'
  | 'other';

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'harassment', label: 'Bullying or harassment' },
  { value: 'hate', label: 'Hate speech or symbols' },
  { value: 'nudity', label: 'Nudity or sexual content' },
  { value: 'violence', label: 'Violence or threats' },
  { value: 'child_safety', label: 'Involves a child' },
  { value: 'spam', label: 'Spam or scams' },
  { value: 'impersonation', label: 'Pretending to be someone else' },
  { value: 'other', label: 'Something else' },
];

// route 'host' sends a photo or video report to the event's host (see
// lib/reportRoute); the server may still send it to support instead. Before
// host-reports.sql has run there's no route column, so it goes to support
// as before.
export async function reportContent(report: {
  reporterId: string;
  target: ReportTarget;
  targetId: string;
  // Whose it is, so whoever reviews can act on the person.
  targetUserId: string | null;
  reason: ReportReason;
  details?: string;
  route?: 'support' | 'host';
}): Promise<{ error: string | null; route: 'support' | 'host' }> {
  const row = {
    reporter_id: report.reporterId,
    target_type: report.target,
    target_id: report.targetId,
    target_user_id: report.targetUserId,
    reason: report.reason,
    details: report.details?.trim() || null,
  };
  let route: 'support' | 'host' = report.route === 'host' ? 'host' : 'support';
  const withRoute: typeof row & { route?: 'host' } = route === 'host' ? { ...row, route } : row;
  let { error } = await supabase.from('reports').insert(withRoute);
  if (error && route === 'host' && (error.code === 'PGRST204' || error.code === '42703')) {
    route = 'support';
    ({ error } = await supabase.from('reports').insert(row));
  }
  if (!error) {
    // Where the server actually sent it: it may have sent a host report to
    // support instead. If this can't be read, the request stands.
    const { data } = await supabase
      .from('reports')
      .select('route')
      .eq('reporter_id', report.reporterId)
      .eq('target_type', report.target)
      .eq('target_id', report.targetId)
      .maybeSingle();
    const stored = (data as { route?: string } | null)?.route;
    return { error: null, route: stored === 'host' ? 'host' : stored === 'support' ? 'support' : route };
  }
  if (error.code === '23505') {
    return { error: 'You’ve already reported this. We’re looking into it.', route };
  }
  if (error.message.includes('Too many')) {
    return { error: 'You’ve sent a lot of reports today. Try again tomorrow.', route };
  }
  return { error: 'Could not send the report. Please try again.', route };
}

// Quiet mode (every plan): friend requests to you are kept but hidden.
export async function setQuietMode(userId: string, on: boolean): Promise<string | null> {
  const { error } = await supabase.from('profiles').update({ quiet_mode: on }).eq('id', userId);
  return error ? 'Could not change Quiet mode. Please try again.' : null;
}
