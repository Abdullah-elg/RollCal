// RollCal support tickets: emails each new ticket to support (see
// supabase/support.sql), with the person's email as the reply-to so
// answering in your inbox goes straight to them. Then it sends the person a
// short note saying their message arrived, which replies back to support.
//
// Called by the database when tickets are filed, and by the "support-email"
// cron job as a retry, with the key stored in Vault in the x-support-key
// header. Nothing else can trigger it.
//
// Uses the project's RESEND_API_KEY secret (shared with report-email).
// Optional secrets: SUPPORT_EMAIL_TO (defaults to support@rollcal.app) and
// SUPPORT_EMAIL_FROM (defaults to "RollCal Support <support@rollcal.app>").
//
// Deploy with "Enforce JWT verification" OFF; the key check replaces it.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildAckEmail, buildTicketEmail, type TicketForEmail } from './format.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const TO = Deno.env.get('SUPPORT_EMAIL_TO') || 'support@rollcal.app';
const FROM = Deno.env.get('SUPPORT_EMAIL_FROM') || 'RollCal Support <support@rollcal.app>';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

type TicketRow = Omit<TicketForEmail, 'user'> & { user_id: string };

async function send(
  to: string,
  email: { subject: string; text: string; html: string },
  replyTo: string | null
): Promise<string | null> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], ...(replyTo ? { reply_to: replyTo } : {}), ...email }),
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

  const key = req.headers.get('x-support-key') ?? '';
  const { data: keyOk } = await admin.rpc('support_email_key_ok', { key });
  if (!key || keyOk !== true) return json(401, { error: 'Not allowed' });
  if (!RESEND_API_KEY) return json(500, { error: 'RESEND_API_KEY is not set' });

  const { data: claimed, error } = await admin.rpc('claim_support_emails', { max_rows: 20 });
  if (error) return json(500, { error: error.message });

  let sent = 0;
  let acknowledged = 0;
  const failed: string[] = [];
  for (const row of (claimed ?? []) as TicketRow[]) {
    const { data: p } = await admin
      .from('profiles')
      .select('id, display_name, first_name, username')
      .eq('id', row.user_id)
      .maybeSingle();
    const ticket: TicketForEmail = {
      ...row,
      user: p ? { id: p.id, name: p.display_name || 'Someone', username: p.username } : null,
    };
    const problem = await send(TO, buildTicketEmail(ticket), row.contact_email);
    if (problem) {
      console.error('Could not email ticket', row.id, problem);
      failed.push(row.id);
      continue;
    }
    sent += 1;
    // Their copy. Not retried if it fails: a retry would send support's copy
    // again too.
    if (row.contact_email) {
      const ackProblem = await send(
        row.contact_email,
        buildAckEmail(row, p?.first_name?.trim() || null),
        TO
      );
      if (ackProblem) console.error('Could not acknowledge ticket', row.id, ackProblem);
      else acknowledged += 1;
    }
  }
  // Unclaim the ones that didn't go, so the cron job tries them again.
  if (failed.length > 0) {
    await admin.from('support_tickets').update({ emailed_at: null }).in('id', failed);
  }

  console.log(`Emailed ${sent} tickets (${acknowledged} acknowledged), ${failed.length} failed`);
  return json(200, { sent, acknowledged, failed: failed.length });
});
