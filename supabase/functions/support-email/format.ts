// Builds the email sent to support for each ticket. No Deno or Supabase
// imports, so `npm test` can run it.

export type TicketForEmail = {
  id: string;
  created_at: string;
  category: 'account' | 'problem' | 'pro' | 'other';
  message: string;
  contact_email: string | null;
  app_info: Record<string, unknown>;
  user: { id: string; name: string; username: string | null } | null;
};

export const CATEGORY_LABELS: Record<TicketForEmail['category'], string> = {
  account: 'Account change',
  problem: 'Problem with the app',
  pro: 'Plans and subscriptions',
  other: 'Something else',
};

// Short reference people can quote, like "#C7EA6E60".
export const ticketRef = (id: string) => `#${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildTicketEmail(t: TicketForEmail): { subject: string; text: string; html: string } {
  const from = t.user ? `${t.user.name}${t.user.username ? ` (@${t.user.username})` : ''}` : 'Deleted account';
  const subject = `Support ${ticketRef(t.id)}: ${CATEGORY_LABELS[t.category]} from ${from}`;
  const info = Object.entries(t.app_info ?? {})
    .map(([k, v]) => `${k} ${String(v)}`)
    .join(', ');

  const rows: [string, string][] = [
    ['Topic', CATEGORY_LABELS[t.category]],
    ['From', `${from}${t.user ? ` · ${t.user.id}` : ''}`],
    ['Email', t.contact_email ?? '(none on the account)'],
    ['When', new Date(t.created_at).toUTCString()],
  ];
  if (info) rows.push(['App', info]);
  rows.push(['Ticket', `${ticketRef(t.id)} · ${t.id}`]);

  const replyNote = t.contact_email
    ? `Reply to this email to answer ${t.user?.name ?? 'them'} at ${t.contact_email}.`
    : 'There is no email on this account to reply to.';

  const text = [...rows.map(([k, v]) => `${k}: ${v}`), '', t.message, '', replyNote].join('\n');

  const cell = 'padding:4px 12px 4px 0;vertical-align:top;font:14px/1.45 -apple-system,Segoe UI,sans-serif;';
  const html = `<div style="font:14px/1.45 -apple-system,Segoe UI,sans-serif;color:#161A17">
<h2 style="font-size:18px;margin:0 0 12px">${escapeHtml(subject)}</h2>
<p style="white-space:pre-wrap;background:#F6F4EE;border:1px solid #E2DFD5;border-radius:8px;padding:12px 14px;margin:0 0 16px">${escapeHtml(t.message)}</p>
<table style="border-collapse:collapse">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="${cell}color:#636A62;white-space:nowrap">${escapeHtml(k)}</td><td style="${cell}">${escapeHtml(v)}</td></tr>`
    )
    .join('')}</table>
<p style="color:#636A62;margin-top:16px">${escapeHtml(replyNote)}</p>
</div>`;

  return { subject, text, html };
}

// The automatic reply to the person who wrote in, in the same style as the
// sign-in emails (supabase/email-templates).
export function buildAckEmail(
  t: Pick<TicketForEmail, 'id' | 'category' | 'message'>,
  firstName: string | null
): { subject: string; text: string; html: string } {
  const ref = ticketRef(t.id);
  const subject = `We got your message ${ref}`;
  const hello = firstName ? `Hi ${firstName},` : 'Hi,';
  const lead =
    'Thanks for getting in touch. We’ve received your message and we’re looking into it. ' +
    'We usually reply within 5–7 business days. Reports of abuse or anything involving a ' +
    'child are looked at within 24 hours.';
  const followUp = `To add anything, just reply to this email and keep ${ref} in the subject.`;

  const text = [
    hello,
    '',
    lead,
    '',
    `Your message (${CATEGORY_LABELS[t.category]}, ${ref}):`,
    t.message,
    '',
    followUp,
    '',
    'RollCal Support',
  ].join('\n');

  const font = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;";
  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#F6F4EE;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F4EE;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFEFA;border:1px solid #E2DFD5;border-radius:12px;">
        <tr><td style="padding:28px 28px 0 28px;${font}">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td width="32" height="32" style="width:32px;height:32px;"><img src="https://rollcal.app/email-icon.png" width="32" height="32" alt="RollCal" style="display:block;width:32px;height:32px;border:0;outline:none;"></td>
            <td style="padding-left:10px;font-size:18px;font-weight:700;color:#161A17;">RollCal</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:24px 28px 28px 28px;${font}color:#161A17;">
          <h1 style="margin:0 0 8px 0;font-size:22px;line-height:1.3;font-weight:700;">We got your message</h1>
          <p style="margin:0 0 16px 0;font-size:15px;line-height:1.55;color:#161A17;">${escapeHtml(hello)}</p>
          <p style="margin:0 0 20px 0;font-size:15px;line-height:1.55;color:#636A62;">${escapeHtml(lead)}</p>
          <p style="margin:0 0 6px 0;font-size:13px;color:#636A62;">${escapeHtml(CATEGORY_LABELS[t.category])} &middot; ${escapeHtml(ref)}</p>
          <div style="white-space:pre-wrap;font-size:15px;line-height:1.55;color:#161A17;background:#F6F4EE;border:1px solid #E2DFD5;border-radius:8px;padding:12px 14px;">${escapeHtml(t.message)}</div>
          <p style="margin:20px 0 0 0;font-size:13px;line-height:1.5;color:#636A62;">${escapeHtml(followUp)}</p>
        </td></tr>
      </table>
      <p style="margin:16px 0 0 0;${font}font-size:12px;color:#8A9088;">
        RollCal &middot; <a href="https://rollcal.app" style="color:#8A9088;">rollcal.app</a> &middot; <a href="mailto:support@rollcal.app" style="color:#8A9088;">support@rollcal.app</a>
      </p>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}
