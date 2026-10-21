// RollCal place names: the off switch for OpenStreetMap lookups.
//
// When someone drops a pin, their phone asks Nominatim (OpenStreetMap's
// public geocoder) for the place name itself: the public service blocks
// cloud servers, and its usage policy allows lookups people trigger from
// their own device in a moderately used app
// (operations.osmfoundation.org/policies/nominatim). The policy also asks
// that the app can be switched off without an update, which is this
// function: the phone asks it first, and skips Nominatim when
// GEOCODE_ENABLED is set to "false" (Edge Functions → Secrets). The pin's
// coordinates are saved instead.
//
// If RollCal grows past "moderate", move to a paid geocoder and change
// lookupPlace in src/lib/geocode.ts.
//
// Deploy with "Enforce JWT verification" ON: only signed-in people can ask.

const ENABLED = (Deno.env.get('GEOCODE_ENABLED') ?? 'true') !== 'false';

Deno.serve(() =>
  new Response(JSON.stringify({ enabled: ENABLED }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' },
  })
);
