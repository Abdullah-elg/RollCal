// Photos and videos reported to the event's host (supabase/host-reports.sql).
// The host sees the photo, the reason and the details, never who reported
// it, and keeps or deletes it. The server checks it's really the host.

import { REPORT_REASONS, ReportReason } from './safety';
import { supabase } from './supabase';

const BUCKET = 'event-photos';

export type HostReport = {
  id: string;
  event_id: string;
  photo_id: string;
  uploader_id: string | null;
  kind: 'photo' | 'video';
  reason: ReportReason;
  details: string | null;
  // RollCal support was told too (a serious reason).
  also_support: boolean;
  decision: 'kept' | 'deleted' | null;
  decided_at: string | null;
  created_at: string;
};

export type HostReportView = {
  report: HostReport;
  eventTitle: string;
  // null once the photo has been deleted.
  storagePath: string | null;
  uploaderName: string | null;
};

const COLS =
  'id, event_id, photo_id, uploader_id, kind, reason, details, also_support, decision, decided_at, created_at';

export const reasonLabel = (reason: ReportReason) =>
  REPORT_REASONS.find((r) => r.value === reason)?.label ?? 'Something else';

// null: not yours to review (you aren't the host) or it's gone.
// Throws if it couldn't be loaded.
export async function loadHostReport(id: string): Promise<HostReportView | null> {
  const { data, error } = await supabase.from('host_reports').select(COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const report = data as HostReport;
  const [event, photo, uploader] = await Promise.all([
    supabase.from('events').select('title').eq('id', report.event_id).maybeSingle(),
    supabase.from('photos').select('storage_path').eq('id', report.photo_id).maybeSingle(),
    report.uploader_id
      ? supabase
          .from('profiles')
          .select('display_name, first_name')
          .eq('id', report.uploader_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return {
    report,
    eventTitle: event.data?.title ?? 'Your event',
    storagePath: photo.data?.storage_path ?? null,
    uploaderName: uploader.data?.display_name || uploader.data?.first_name || null,
  };
}

// Reports of your events still waiting on you, one per photo, for the inbox.
export async function loadWaitingHostReports(
  userId: string
): Promise<Pick<HostReport, 'id' | 'event_id' | 'photo_id' | 'kind' | 'created_at'>[]> {
  const { data, error } = await supabase
    .from('host_reports')
    .select('id, event_id, photo_id, kind, created_at')
    .eq('host_id', userId)
    .is('decision', null)
    .order('created_at', { ascending: true });
  // Before host-reports.sql has run there's no table: nothing to show.
  if (error || !data) return [];
  const seen = new Set<string>();
  return data.filter((r) => (seen.has(r.photo_id) ? false : (seen.add(r.photo_id), true)));
}

// Keep or delete. The server records the decision first and deletes the
// row; then the file is removed through the same storage rule the album's
// Delete uses (the host may delete any file in their event). If a report of
// it was serious, the server only hides it ('hidden') and the file stays
// for support (storage refuses to delete it anyway).
// Returns the decision on record, or an error message.
export async function resolveHostReport(
  view: HostReportView,
  decision: 'keep' | 'delete'
): Promise<{ decision: 'kept' | 'deleted' } | { error: string }> {
  const { data, error } = await supabase.rpc('resolve_host_report', {
    p_report: view.report.id,
    p_decision: decision,
  });
  if (error) {
    return {
      error:
        error.code === '42501'
          ? 'Only the event’s host can review this report.'
          : 'Could not save that. Please try again.',
    };
  }
  if (data === 'deleted' && view.storagePath) {
    // If this fails the file is left behind with no row. That's the better
    // way round: a row with no file would show as a broken photo. It still
    // counts toward storage until the event's files are cleaned up.
    await supabase.storage
      .from(BUCKET)
      .remove([view.storagePath])
      .catch(() => {});
  }
  return { decision: data === 'kept' ? 'kept' : 'deleted' };
}
