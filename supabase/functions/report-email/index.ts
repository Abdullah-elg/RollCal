// RollCal report alerts: emails each new report to support (see
// supabase/report-email.sql).
//
// Called by the database when reports are filed, and by the "report-email"
// cron job as a retry, with the key stored in Vault in the x-report-key
// header. Nothing else can trigger it.
//
// Sends through Resend's API, the same account Supabase Auth uses for its
// emails (docs/LAUNCH.md, section 2).
// Secrets:
//   RESEND_API_KEY      required; the Resend key (a sending-only one is fine)
//   REPORT_EMAIL_TO     optional; defaults to support@rollcal.app
//   REPORT_EMAIL_FROM   optional; defaults to "RollCal <support@rollcal.app>"
//
// Deploy with "Enforce JWT verification" OFF; the key check replaces it.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildReportEmail, type Person, type ReportForEmail } from './format.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const TO = Deno.env.get('REPORT_EMAIL_TO') || 'support@rollcal.app';
const FROM = Deno.env.get('REPORT_EMAIL_FROM') || 'RollCal <support@rollcal.app>';
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0];
const DASHBOARD = `https://supabase.com/dashboard/project/${PROJECT_REF}/editor`;
// Links to reported photos stay valid this long.
const PHOTO_LINK_SECONDS = 7 * 24 * 60 * 60;
const MEDIA_URL = Deno.env.get('MEDIA_URL') || 'https://media.rollcal.app';
const MEDIA_ADMIN_KEY = Deno.env.get('MEDIA_ADMIN_KEY') ?? '';

// A week-long link to a photo in R2, or null if it isn't there (or the
// Worker isn't set up), in which case Storage is asked.
async function mediaLink(path: string): Promise<string | null> {
  if (!MEDIA_ADMIN_KEY) return null;
  try {
    const res = await fetch(`${MEDIA_URL}/v1/links`, {
      method: 'POST',
      headers: { authorization: `Bearer ${MEDIA_ADMIN_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ bucket: 'event-photos', names: [path], seconds: PHOTO_LINK_SECONDS }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { links?: Record<string, { url: string }> };
    return body.links?.[path]?.url ?? null;
  } catch {
    return null;
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

type ReportRow = {
  id: string;
  created_at: string;
  reporter_id: string;
  target_type: ReportForEmail['target_type'];
  target_id: string;
  target_user_id: string | null;
  reason: string;
  details: string | null;
};

type Admin = ReturnType<typeof createClient>;

async function person(admin: Admin, id: string | null): Promise<Person> {
  if (!id) return null;
  const { data } = await admin
    .from('profiles')
    .select('id, display_name, username')
    .eq('id', id)
    .maybeSingle();
  return data ? { id: data.id, name: data.display_name || 'Someone', username: data.username } : null;
}

// Who and what the report is about, as far as it still exists.
async function describe(admin: Admin, r: ReportRow): Promise<ReportForEmail> {
  const [reporter, reported] = await Promise.all([
    person(admin, r.reporter_id),
    person(admin, r.target_user_id ?? (r.target_type === 'user' ? r.target_id : null)),
  ]);
  const out: ReportForEmail = { ...r, reporter, reported };
  if (r.target_type === 'message') {
    const { data } = await admin.from('messages').select('body').eq('id', r.target_id).maybeSingle();
    out.messageText = data?.body ?? null;
  } else if (r.target_type === 'event') {
    const { data } = await admin.from('events').select('title').eq('id', r.target_id).maybeSingle();
    out.eventTitle = data?.title ?? null;
  } else if (r.target_type === 'photo') {
    const { data } = await admin.from('photos').select('storage_path').eq('id', r.target_id).maybeSingle();
    if (data?.storage_path) {
      // In R2 (through the media Worker), or still in Storage.
      out.photoUrl = await mediaLink(data.storage_path);
      if (!out.photoUrl) {
        const { data: signed } = await admin.storage
          .from('event-photos')
          .createSignedUrl(data.storage_path, PHOTO_LINK_SECONDS);
        out.photoUrl = signed?.signedUrl ?? null;
      }
    }
  }
  return out;
}

async function send(email: { subject: string; text: string; html: string }): Promise<string | null> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [TO], ...email }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return null;
    return `Resend ${res.status}: ${(await res.text()).slice(0, 300)}`;
  } catch (err) {
    return `Resend request failed: ${err}`;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const key = req.headers.get('x-report-key') ?? '';
  const { data: keyOk } = await admin.rpc('report_email_key_ok', { key });
  if (!key || keyOk !== true) return json(401, { error: 'Not allowed' });
  if (!RESEND_API_KEY) return json(500, { error: 'RESEND_API_KEY is not set' });

  const { data: claimed, error } = await admin.rpc('claim_report_emails', { max_rows: 20 });
  if (error) return json(500, { error: error.message });

  let sent = 0;
  const failed: string[] = [];
  for (const row of (claimed ?? []) as ReportRow[]) {
    const problem = await send(buildReportEmail(await describe(admin, row), DASHBOARD));
    if (problem) {
      console.error('Could not email report', row.id, problem);
      failed.push(row.id);
    } else {
      sent += 1;
    }
  }
  // Unclaim the ones that didn't go, so the cron job tries them again.
  if (failed.length > 0) {
    await admin.from('reports').update({ emailed_at: null }).in('id', failed);
  }

  console.log(`Emailed ${sent} reports, ${failed.length} failed`);
  return json(200, { sent, failed: failed.length });
});
