// RollCal's old invite redirect, served at
//   https://<project-ref>.supabase.co/functions/v1/join?code=ABCD1234
//
// New invites link to https://rollcal.app/join/CODE instead. This stays
// deployed so links shared before the switch keep working: it sends them on
// to the same page on rollcal.app, which opens the app or shows the code.
//
// Deploy with "Enforce JWT verification" OFF so people without accounts can
// open it.

Deno.serve((req: Request) => {
  const code = (new URL(req.url).searchParams.get('code') ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
  return new Response(null, {
    status: 302,
    headers: { location: code ? `https://rollcal.app/join/${code}` : 'https://rollcal.app' },
  });
});
