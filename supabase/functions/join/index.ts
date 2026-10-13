// SociaLink invite redirect, served from your Supabase project at
//   https://<project-ref>.supabase.co/functions/v1/join?code=ABCD1234
//
// Messaging apps always linkify https URLs; tapping one hits this function,
// which 302-redirects straight into the app (?to= carries the Expo Go
// dev-server URL while testing; without it, the production socialink://
// scheme). A redirect - rather than an HTML landing page - because Supabase's
// gateway rewrites text/html to text/plain on the shared domain
// (anti-phishing), but passes redirects through untouched.
//
// Deploy: Dashboard -> Edge Functions -> "join" -> paste this file -> deploy,
// with "Enforce JWT verification" OFF so people without accounts can open it.

// Only forward to app schemes we expect - never to arbitrary URLs.
function safeTarget(raw: string | null, code: string): string {
  if (raw && (raw.startsWith('exp://') || raw.startsWith('socialink://'))) {
    return raw;
  }
  return code ? `socialink://join/${code}` : '';
}

Deno.serve((req: Request) => {
  const url = new URL(req.url);
  const code = (url.searchParams.get('code') ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
  const target = safeTarget(url.searchParams.get('to'), code);

  if (target) {
    return new Response(null, {
      status: 302,
      headers: { location: target },
    });
  }

  // No usable params - a readable plain-text fallback.
  return new Response(
    'SociaLink invite\n\nOpen the SociaLink app, tap "Join with code" and enter the code from this message.\n',
    { headers: { 'content-type': 'text/plain; charset=utf-8' } }
  );
});
