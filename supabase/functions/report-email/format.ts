// Builds the email sent to support for each report. No Deno or Supabase
// imports, so `npm test` can run it.

export type Person = { id: string; name: string; username: string | null } | null;

export type ReportForEmail = {
  id: string;
  created_at: string;
  target_type: 'user' | 'message' | 'photo' | 'event';
  target_id: string;
  reason: string;
  details: string | null;
  reporter: Person;
  reported: Person;
  // What was reported, as far as it still exists.
  messageText?: string | null;
  photoUrl?: string | null;
  eventTitle?: string | null;
};

const REASONS: Record<string, string> = {
  spam: 'Spam',
  harassment: 'Harassment or bullying',
  hate: 'Hate speech',
  nudity: 'Nudity or sexual content',
  violence: 'Violence or threats',
  impersonation: 'Impersonation',
  other: 'Something else',
};

const WHAT: Record<ReportForEmail['target_type'], string> = {
  user: 'a person',
  message: 'a chat message',
  photo: 'a photo or video',
  event: 'an event',
};

export const reasonLabel = (reason: string) => REASONS[reason] ?? reason;

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const who = (p: Person) =>
  p ? `${p.name}${p.username ? ` (@${p.username})` : ''} · ${p.id}` : 'Unknown (account deleted)';

export function buildReportEmail(
  r: ReportForEmail,
  dashboardUrl: string
): { subject: string; text: string; html: string } {
  const reason = reasonLabel(r.reason);
  const subject = `Report: ${reason}, ${WHAT[r.target_type]}${r.reported ? ` by ${r.reported.name}` : ''}`;

  const rows: [string, string][] = [
    ['Reason', reason],
    ['What', `${WHAT[r.target_type]} (${r.target_type} ${r.target_id})`],
    ['Reported', who(r.reported)],
    ['Reported by', who(r.reporter)],
    ['When', new Date(r.created_at).toUTCString()],
  ];
  if (r.details) rows.push(['Their note', r.details]);
  if (r.target_type === 'message') rows.push(['Message', r.messageText ?? '(deleted)']);
  if (r.target_type === 'event') rows.push(['Event', r.eventTitle ?? '(deleted)']);
  if (r.target_type === 'photo') rows.push(['Photo', r.photoUrl ?? '(deleted)']);
  rows.push(['Report id', r.id]);

  const footer =
    'Act on it within 24 hours (App Store rule for reported content): remove the content or the account if needed, ' +
    'then set the report\'s status to "actioned" or "dismissed" in the reports table.';

  const text = [
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    footer,
    `Reports table: ${dashboardUrl}`,
  ].join('\n');

  const cell = 'padding:6px 12px 6px 0;vertical-align:top;font:14px/1.45 -apple-system,Segoe UI,sans-serif;';
  const html = `<div style="font:14px/1.45 -apple-system,Segoe UI,sans-serif;color:#161A17">
<h2 style="font-size:18px;margin:0 0 12px">${escapeHtml(subject)}</h2>
<table style="border-collapse:collapse">${rows
    .map(([k, v]) => {
      const value =
        k === 'Photo' && r.photoUrl
          ? `<a href="${escapeHtml(r.photoUrl)}">Open the photo</a> (link works for 7 days)`
          : escapeHtml(v).replace(/\n/g, '<br>');
      return `<tr><td style="${cell}color:#636A62;white-space:nowrap">${escapeHtml(k)}</td><td style="${cell}">${value}</td></tr>`;
    })
    .join('')}</table>
<p style="color:#636A62;margin-top:16px">${escapeHtml(footer)}</p>
<p><a href="${escapeHtml(dashboardUrl)}">Open the reports table</a></p>
</div>`;

  return { subject, text, html };
}
