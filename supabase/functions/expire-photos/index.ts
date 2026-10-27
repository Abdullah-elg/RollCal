// RollCal hourly cleanup: deletes photos and videos from events past their
// keep date (see supabase/expiry.sql for the rule), and deletes events whose
// host deleted them 48 hours ago (supabase/event-delete.sql).
//
// Called every hour by the pg_cron job "expire-photos", which sends the key
// stored in Vault in the x-expire-key header. Nothing else can trigger it.
//
// For each due event: delete the files through the Storage API (deleting
// storage rows in SQL would leave the files behind), then the photo rows,
// then mark the event so the app can explain the empty roll. A deleted
// event goes the same way, then its row (which takes everything else).
//
// Deploy with "Enforce JWT verification" OFF; the key check replaces it.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET = 'event-photos';
// Stop starting new events after this, well inside the function time limit;
// whatever's left is picked up the next hour.
const TIME_BUDGET_MS = 100_000;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

type Admin = ReturnType<typeof createClient>;

async function removeFiles(admin: Admin, eventId: string): Promise<number> {
  // Every file in the event's folder (the app never nests deeper).
  const paths: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage.from(BUCKET).list(eventId, { limit: 1000, offset });
    if (error) throw error;
    // Folder placeholders come back with a null id.
    for (const f of data ?? []) if (f.id) paths.push(`${eventId}/${f.name}`);
    if (!data || data.length < 1000) break;
  }
  for (let i = 0; i < paths.length; i += 1000) {
    const { error } = await admin.storage.from(BUCKET).remove(paths.slice(i, i + 1000));
    if (error) throw error;
  }
  return paths.length;
}

async function expireEvent(admin: Admin, eventId: string): Promise<number> {
  const files = await removeFiles(admin, eventId);
  const { error: rowsError } = await admin.from('photos').delete().eq('event_id', eventId);
  if (rowsError) throw rowsError;

  const { error: markError } = await admin
    .from('events')
    .update({ photos_expired_at: new Date().toISOString(), cover_photo_id: null })
    .eq('id', eventId);
  if (markError) throw markError;
  return files;
}

async function deleteEvent(admin: Admin, eventId: string): Promise<number> {
  const files = await removeFiles(admin, eventId);
  const { error } = await admin.from('events').delete().eq('id', eventId);
  if (error) throw error;
  return files;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const key = req.headers.get('x-expire-key') ?? '';
  const { data: keyOk } = await admin.rpc('expire_photos_key_ok', { key });
  if (!key || keyOk !== true) return json(401, { error: 'Not allowed' });

  const started = Date.now();
  let events = 0;
  let files = 0;
  const failed: string[] = [];

  while (Date.now() - started < TIME_BUDGET_MS) {
    const { data, error } = await admin.rpc('events_to_expire', { max_events: 20 });
    if (error) return json(500, { error: error.message, events, files });
    const due = ((data ?? []) as { event_id: string }[])
      .map((r) => r.event_id)
      .filter((id) => !failed.includes(id));
    if (due.length === 0) break;

    for (const eventId of due) {
      if (Date.now() - started >= TIME_BUDGET_MS) break;
      try {
        files += await expireEvent(admin, eventId);
        events += 1;
      } catch (err) {
        // Leave it for the next run; one bad event shouldn't stop the rest.
        console.error('Could not expire event', eventId, err);
        failed.push(eventId);
      }
    }
  }

  let deleted = 0;
  while (Date.now() - started < TIME_BUDGET_MS) {
    const { data, error } = await admin.rpc('events_to_delete', { max_events: 20 });
    if (error) return json(500, { error: error.message, events, files, deleted });
    const due = ((data ?? []) as { event_id: string }[])
      .map((r) => r.event_id)
      .filter((id) => !failed.includes(id));
    if (due.length === 0) break;

    for (const eventId of due) {
      if (Date.now() - started >= TIME_BUDGET_MS) break;
      try {
        files += await deleteEvent(admin, eventId);
        deleted += 1;
      } catch (err) {
        console.error('Could not delete event', eventId, err);
        failed.push(eventId);
      }
    }
  }

  console.log(`Expired ${events} events, deleted ${deleted}, ${files} files, ${failed.length} failed`);
  return json(200, { events, deleted, files, failed: failed.length });
});
