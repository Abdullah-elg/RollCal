// SociaLink "Delete account" (App Store guideline 5.1.1(v)).
//
// Called from Settings with the signed-in user's JWT:
//   supabase.functions.invoke('delete-account', { method: 'POST' })
//
// Order matters:
//   1. Storage first. Files are not rows, so no foreign key cascades them,
//      and deleting storage.objects rows in SQL would orphan the blobs. We go
//      through the Storage API with the service role instead:
//        - avatars/{uid}/*                     (their profile photos)
//        - event-photos/{event_id}/*           for every event they created
//        - event-photos files they uploaded    to anyone else's event
//   2. auth.admin.deleteUser(uid). auth.users -> profiles is ON DELETE
//      CASCADE, and every public table references profiles (or events) with
//      ON DELETE CASCADE, so this one call removes their profile, rsvps,
//      messages, photos rows, friendships, invitations (sent and received),
//      event_invite_requests, event_bans, and the events they created along
//      with everything hanging off those events.
//
// Events they created are deleted, not handed off: the app has no co-host
// concept, and promoting a guest would hand someone a leader's powers (kick,
// ban, link control, deleting others' photos) they never agreed to.
//
// Deploy with "Enforce JWT verification" ON - only signed-in users may call it.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

// Every file directly under a folder (the app never nests deeper).
async function listFolder(
  admin: ReturnType<typeof createClient>,
  bucket: string,
  folder: string,
): Promise<string[]> {
  const paths: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage
      .from(bucket)
      .list(folder, { limit: 1000, offset });
    if (error) throw error;
    // Folder placeholders come back with a null id.
    for (const f of data ?? []) if (f.id) paths.push(`${folder}/${f.name}`);
    if (!data || data.length < 1000) return paths;
  }
}

async function removeAll(
  admin: ReturnType<typeof createClient>,
  bucket: string,
  paths: string[],
) {
  for (let i = 0; i < paths.length; i += 1000) {
    const { error } = await admin.storage.from(bucket).remove(paths.slice(i, i + 1000));
    if (error) throw error;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json(401, { error: 'Not signed in' });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  const uid = userData?.user?.id;
  if (userError || !uid) return json(401, { error: 'Not signed in' });

  try {
    // Avatars.
    await removeAll(admin, 'avatars', await listFolder(admin, 'avatars', uid));

    // Whole albums of events they created (everyone's photos go with the event).
    const { data: events, error: eventsError } = await admin
      .from('events')
      .select('id')
      .eq('creator_id', uid);
    if (eventsError) throw eventsError;
    const ownEventIds = (events ?? []).map((e) => e.id as string);
    const photoPaths = new Set<string>();
    for (const id of ownEventIds) {
      for (const p of await listFolder(admin, 'event-photos', id)) photoPaths.add(p);
    }

    // Their uploads to other people's events.
    const { data: photos, error: photosError } = await admin
      .from('photos')
      .select('storage_path')
      .eq('uploader_id', uid);
    if (photosError) throw photosError;
    for (const p of photos ?? []) photoPaths.add(p.storage_path as string);

    await removeAll(admin, 'event-photos', [...photoPaths]);

    // Rows: everything cascades from auth.users (see header).
    const { error: deleteError } = await admin.auth.admin.deleteUser(uid);
    if (deleteError) throw deleteError;

    return json(200, { ok: true });
  } catch (e) {
    console.error('delete-account failed', uid, e);
    return json(500, { error: 'Could not delete your account. Please try again.' });
  }
});
