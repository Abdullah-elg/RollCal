// Getting everything out of Supabase and R2, for moving RollCal to another
// host (docs/MIGRATION-AWS.md).
//
//   node scripts/export-for-migration.mjs --check
//     Read-only. Lists what there is to move: rows per table, accounts by
//     sign-in method, files in R2 and still in Supabase Storage, extensions,
//     scheduled jobs and server functions. Writes migration-export/inventory.json.
//
//   DATABASE_URL='postgresql://…' node scripts/export-for-migration.mjs --export
//     The real copy, on migration day. Needs pg_dump 17 (brew install libpq)
//     and the database connection string from Supabase → Project Settings →
//     Database (you type it; it's never saved). Writes into migration-export/:
//       schema.sql   tables, functions, policies, triggers (public + private)
//       data.sql     every row of public + private
//       auth.sql     accounts and their sign-in methods (auth.users,
//                    auth.identities), including password hashes: treat as secret
//     then prints the command that copies the R2 bucket.
//
// migration-export/ is in .gitignore: it holds people's data.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_REF = 'qwtvpmrxmlfuwmnyawcq';
const OUT = 'migration-export';
const mode = process.argv.includes('--export') ? 'export' : 'check';

function query(sql) {
  const out = execFileSync(
    'npx',
    ['supabase', 'db', 'query', `--remote=${PROJECT_REF}`, '--read-only', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  );
  const body = JSON.parse(out.slice(out.indexOf('{')));
  if (body.error) throw new Error(body.error.message);
  return body.rows ?? [];
}

function check() {
  const tables = query(`
    select n.nspname || '.' || c.relname as "table", c.reltuples::bigint as rows
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'private') and c.relkind in ('r', 'p')
     order by 1`);
  const accounts = query(`
    select coalesce(i.provider, case when u.is_anonymous then 'guest' else 'none' end) as method,
           count(distinct u.id) as people
      from auth.users u left join auth.identities i on i.user_id = u.id
     group by 1 order by 2 desc`);
  const files = query(`
    select 'r2' as place, count(*) as files, coalesce(sum(size_bytes + thumb_bytes), 0) as bytes
      from public.media_objects where stored_at is not null
    union all
    select 'supabase storage, ' || bucket_id, count(*), coalesce(sum((metadata->>'size')::bigint), 0)
      from storage.objects group by bucket_id`);
  const extensions = query(`select extname as name, extversion as version from pg_extension order by 1`);
  const jobs = query(`select jobname as name, schedule from cron.job order by 1`);
  const inventory = {
    taken_at: new Date().toISOString(),
    tables,
    accounts,
    files,
    extensions,
    scheduled_jobs: jobs,
    server_functions: execFileSync('ls', ['supabase/functions'], { encoding: 'utf8' }).trim().split('\n'),
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'inventory.json'), JSON.stringify(inventory, null, 2));

  const total = tables.reduce((n, t) => n + Math.max(0, Number(t.rows)), 0);
  console.log(`${tables.length} tables, about ${total} rows`);
  console.log(`Accounts by sign-in: ${accounts.map((a) => `${a.method} ${a.people}`).join(', ')}`);
  for (const f of files) console.log(`Files in ${f.place}: ${f.files} (${(Number(f.bytes) / 1048576).toFixed(1)} MB)`);
  console.log(`Extensions: ${extensions.map((e) => e.name).join(', ')}`);
  console.log(`Scheduled jobs: ${jobs.map((j) => j.name).join(', ')}`);
  console.log(`Wrote ${join(OUT, 'inventory.json')}`);
}

function exportAll() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Set DATABASE_URL to the connection string from Supabase → Project Settings → Database.');
  const version = execFileSync('pg_dump', ['--version'], { encoding: 'utf8' });
  if (!/\b17\./.test(version)) throw new Error(`Needs pg_dump 17 (found: ${version.trim()}). brew install libpq`);
  mkdirSync(OUT, { recursive: true });
  const dump = (file, args) => {
    execFileSync('pg_dump', ['--dbname', url, '--no-owner', '--no-privileges', '--file', join(OUT, file), ...args], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    console.log(`Wrote ${join(OUT, file)}`);
  };
  dump('schema.sql', ['--schema-only', '--schema=public', '--schema=private']);
  dump('data.sql', ['--data-only', '--schema=public', '--schema=private']);
  dump('auth.sql', ['--data-only', '--table=auth.users', '--table=auth.identities']);
  console.log(`
Next, copy the photos (R2 → the new bucket). With rclone set up for both:
  rclone sync r2:rollcal-media s3:<new-bucket> --progress
or with the AWS CLI, using R2's S3 address (Cloudflare → R2 → Manage API tokens):
  aws s3 sync s3://rollcal-media ./r2-copy --endpoint-url https://<account-id>.r2.cloudflarestorage.com
  aws s3 sync ./r2-copy s3://<new-bucket>
Keys stay the same: <bucket>/<name> and thumbs/<bucket>/<name>.jpg.`);
}

try {
  if (mode === 'export') exportAll();
  else check();
} catch (e) {
  console.error(e.message ?? e);
  process.exit(1);
}
