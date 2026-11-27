// Copies photos, videos and profile photos from Supabase Storage to R2, with
// a small preview for each (a still for videos), and records them in
// media_objects so the app loads them from R2 (supabase/media-r2.sql).
//
// Only files something uses are copied: photo rows and current profile
// photos. Leftover files stay behind in Storage. Safe to run again: files
// already in R2 are skipped, so a second run after older builds stop
// uploading copies just what's new.
//
// Run from the project folder on a Mac (previews use the built-in sips and
// qlmanage), signed in to wrangler and the Supabase CLI:
//   node scripts/migrate-media-to-r2.mjs            copy
//   node scripts/migrate-media-to-r2.mjs --dry-run  only list what would be copied
//
// The Supabase secret key is read through the Supabase CLI (or from
// SUPABASE_SECRET_KEY) and never printed.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const PROJECT_REF = 'qwtvpmrxmlfuwmnyawcq';
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const R2_BUCKET = 'rollcal-media';
const THUMB_SIDE = 480;
const DRY_RUN = process.argv.includes('--dry-run');
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const ALLOWED_TYPES = {
  'event-photos': [...IMAGE_TYPES, 'image/gif', 'video/mp4', 'video/quicktime'],
  avatars: IMAGE_TYPES,
};

function secretKey() {
  if (process.env.SUPABASE_SECRET_KEY) return process.env.SUPABASE_SECRET_KEY;
  const out = execFileSync(
    'npx',
    ['supabase', 'projects', 'api-keys', '--project-ref', PROJECT_REF, '--reveal', '-o', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  );
  const key = JSON.parse(out).find((k) => k.type === 'secret')?.api_key;
  if (!key) throw new Error('No Supabase secret key found. Sign in with `npx supabase login`.');
  return key;
}

// What profiles.avatar_url holds: a path, or (older rows) a full public URL.
function avatarPath(value) {
  if (!value) return null;
  const at = value.indexOf('/avatars/');
  const path = at >= 0 ? value.slice(at + '/avatars/'.length) : value;
  return path.split('?')[0] || null;
}

function r2Put(key, file, contentType) {
  execFileSync(
    'npx',
    ['wrangler', 'r2', 'object', 'put', `${R2_BUCKET}/${key}`, '--file', file, '--content-type', contentType, '--remote'],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
}

// A JPEG preview at most THUMB_SIDE on its longer side, or null.
function makeThumb(file, isVideo, dir) {
  try {
    let still = file;
    if (isVideo) {
      execFileSync('qlmanage', ['-t', '-s', String(THUMB_SIDE * 2), '-o', dir, file], { stdio: 'ignore' });
      const png = readdirSync(dir).find((f) => f.startsWith(file.split('/').pop()) && f.endsWith('.png'));
      if (!png) return null;
      still = join(dir, png);
    }
    const out = join(dir, 'thumb.jpg');
    execFileSync(
      'sips',
      ['-Z', String(THUMB_SIDE), '-s', 'format', 'jpeg', '-s', 'formatOptions', '70', still, '--out', out],
      { stdio: 'ignore' }
    );
    return statSync(out).size > 0 ? out : null;
  } catch {
    return null;
  }
}

async function main() {
  const admin = createClient(SUPABASE_URL, secretKey(), { auth: { persistSession: false } });

  const [{ data: photos, error: pErr }, { data: profiles, error: aErr }, { data: done, error: mErr }] =
    await Promise.all([
      admin.from('photos').select('event_id, uploader_id, storage_path'),
      admin.from('profiles').select('id, avatar_url').not('avatar_url', 'is', null),
      admin.from('media_objects').select('bucket, name').not('stored_at', 'is', null),
    ]);
  if (pErr || aErr || mErr) throw pErr ?? aErr ?? mErr;
  const already = new Set((done ?? []).map((m) => `${m.bucket}/${m.name}`));

  const todo = [
    ...photos.map((p) => ({ bucket: 'event-photos', name: p.storage_path, owner: p.uploader_id, event_id: p.event_id })),
    ...profiles
      .map((p) => ({ bucket: 'avatars', name: avatarPath(p.avatar_url), owner: p.id, event_id: null }))
      .filter((f) => f.name && f.name.startsWith(`${f.owner}/`)),
  ].filter((f) => !already.has(`${f.bucket}/${f.name}`));

  console.log(`${todo.length} file(s) to copy, ${already.size} already in R2.`);
  if (DRY_RUN) {
    for (const f of todo) console.log(`  ${f.bucket}/${f.name}`);
    return;
  }

  let copied = 0;
  let failed = 0;
  for (const f of todo) {
    const dir = mkdtempSync(join(tmpdir(), 'rollcal-media-'));
    try {
      const { data: blob, error } = await admin.storage.from(f.bucket).download(f.name);
      if (error || !blob) throw new Error(error?.message ?? 'download failed');
      // Only the types new uploads may have; anything else (an SVG from
      // before the bucket was narrowed, say) stays behind for a person to check.
      const contentType = (blob.type || '').toLowerCase();
      if (!ALLOWED_TYPES[f.bucket].includes(contentType)) {
        throw new Error(`skipped: type ${contentType || 'unknown'} isn't allowed`);
      }
      const file = join(dir, f.name.split('/').pop());
      writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
      const size = statSync(file).size;

      r2Put(`${f.bucket}/${f.name}`, file, contentType);
      // Profile photos are shown small already; they don't get a preview.
      const thumb = f.bucket === 'event-photos' ? makeThumb(file, contentType.startsWith('video/'), dir) : null;
      if (thumb) r2Put(`thumbs/${f.bucket}/${f.name}.jpg`, thumb, 'image/jpeg');

      const { error: rowError } = await admin.from('media_objects').upsert({
        bucket: f.bucket,
        name: f.name,
        owner: f.owner,
        event_id: f.event_id,
        size_bytes: size,
        thumb_bytes: thumb ? statSync(thumb).size : 0,
        content_type: contentType,
        stored_at: new Date().toISOString(),
      });
      if (rowError) throw rowError;
      copied += 1;
      console.log(`  copied ${f.bucket}/${f.name}${thumb ? ' (+ preview)' : ''}`);
    } catch (e) {
      failed += 1;
      console.log(`  FAILED ${f.bucket}/${f.name}: ${e?.message ?? e}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  console.log(`Done: ${copied} copied, ${failed} failed.${failed ? ' Run it again to retry.' : ''}`);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
