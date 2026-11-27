# Moving RollCal's backend to AWS

A runbook for moving off Supabase and Cloudflare, written before launch so
the move is a checked plan, not a rewrite. Nothing here has to happen now.
`node scripts/export-for-migration.mjs --check` lists what there is to move
(it writes `migration-export/inventory.json`).

## What was set up before launch to make this easy

| Piece | Prepared by | Why it helps |
|---|---|---|
| Database address | `api.rollcal.app` (Supabase custom domain) | Installed apps never see a supabase.co address, so the backend can move without a forced update. |
| Photo address | `media.rollcal.app` (the media Worker) | Same for photos and videos. |
| Web pages | `rollcal.app` | Already ours. |
| Calls from the database to server functions | `private.call_function` (`supabase/function-calls.sql`) | One function to change, not seven files. |
| Live updates (chat, read marks, payments) | `src/lib/live.ts` | The only file that uses Supabase Realtime. |
| User ids | `profiles.id` everywhere | Every table keys on RollCal's own ids, not the sign-in provider's. |
| Store links, deep links | `rollcal.app/...` | Not tied to any host. |

## How each piece moves

| Today | On AWS | Effort |
|---|---|---|
| Supabase Postgres 17 | Amazon RDS for PostgreSQL 17 | Low. Same database. Restore `schema.sql` and `data.sql` from the export. |
| `auth.uid()`, `auth.jwt()` in policies | Two small SQL functions reading the request's verified token from a setting the API sets per request | Low. The policies stay as they are. |
| Supabase Auth (email, Apple, Google, guests) | Amazon Cognito, or self-hosted Supabase Auth (GoTrue) | **Medium.** See *Accounts* below. |
| Supabase Data API (PostgREST) used by 30 files | Self-hosted PostgREST (open source) on ECS Fargate or App Runner, behind `api.rollcal.app` | Medium. The app's queries keep working unchanged. |
| Supabase Realtime (`src/lib/live.ts`) | Self-hosted Supabase Realtime, or API Gateway WebSockets / AppSync with `live.ts` rewritten | Medium. One file either way. |
| Server functions (8 in use, Deno; `join` is an old SociaLink redirect to delete) | AWS Lambda (Node.js 22) behind `api.rollcal.app/functions/v1/...` | Low. Each uses only `Deno.serve` and `Deno.env`. `scan-receipt` and `caption-photos` call Google Gemini over HTTPS, which works the same from Lambda (or swap to Amazon Bedrock). |
| `pg_cron` jobs (8) | `pg_cron` on RDS (supported), or EventBridge Scheduler | Low. |
| `pg_net` (database → function calls) | Lambda invoked from EventBridge or SQS (rewrite `private.call_function`), or the `aws_lambda` RDS extension | Low–medium. One function. The exchange-rate fetch (`fx_refresh` in `currency.sql`) also uses pg_net and moves to a scheduled Lambda. |
| Supabase Vault (4 keys) | AWS Secrets Manager | Low. |
| Photos in Supabase Storage | None left (emptied 2026-11-27); everything is in R2 | Done. |
| Cloudflare R2 + media Worker | S3 + CloudFront + a Lambda for uploads and signed links, behind `media.rollcal.app` | Medium. Same keys and paths. The Worker's logic ports almost line for line. |
| Cloudflare Pages (`web/`) | S3 + CloudFront, or Amplify Hosting | Low. Static files. Port `_redirects` and `_headers` to CloudFront functions. |
| Emails via Resend | Amazon SES | Low. |
| Push via Expo | Unchanged | None. |

## Accounts (the careful part)

* **Ids:** keep RollCal's user ids. Store each person's new provider id
  (for example the Cognito `sub`) in a mapping column, never the other way
  round.
* **Email and password:** Supabase stores bcrypt hashes. Cognito can't import
  them, so use Cognito's *user migration* trigger. On each person's first
  sign-in after the move, a Lambda checks the password against the exported
  hash, then Cognito keeps it. Nobody resets anything.
  Self-hosting Supabase Auth instead keeps the hashes as they are.
* **Apple:** the same Apple developer team and Services ID give the same user
  identifier, so accounts link back by that id.
* **Google:** same OAuth client, same `sub`. Add the new callback address to
  the Google client before switching.
* **Web guests:** anonymous accounts don't need to move. Their photos stay
  attached to their ids. Guests sign in fresh on the web.

## The move, in order

1. **Freeze the plan.** Run `--check`, compare it with this page, and update
   anything new.
2. **Build the AWS side** next to the live one: RDS, PostgREST, auth, Realtime,
   Lambdas, S3 and CloudFront, Secrets Manager, SES. Use a test domain such as
   `api-next.rollcal.app`.
3. **Rehearse.** Run `--export` against production, restore into AWS, copy R2
   to S3, and point a test build of the app at the test domains. Go through
   the test list below.
4. **Announce a short maintenance window.** Raise `app_config.min_version`
   only if the app itself changed.
5. **Cut over:**
   1. Turn uploads off (close rolls) and stop the cron jobs on Supabase.
   2. Run `--export` and restore it. Sync R2 to S3 again (only new files copy).
   3. Point `api.rollcal.app` and `media.rollcal.app` at AWS. That's a DNS
      change, and installed apps follow it.
   4. Turn the cron jobs on in AWS. Watch errors and sign-ins.
6. **Keep Supabase and R2 untouched for 30 days** as the way back. To roll
   back, point the two names at them again.
7. After 30 days, delete the old data and cancel the plans.

## Test list after a rehearsal or the move

* Sign in with email, Apple and Google. Sign up. Reset a password.
* Open an event. Chat updates live and read marks appear.
* Upload a photo and a video. The grid shows previews. Delete one.
* Pushes arrive (chat, friend request). Report and support emails arrive.
* The hourly expiry job runs. An expired event's photos go.
* Join from the web as a guest, add a photo, and the host sees it.
* Bill splitting and a receipt scan.

## Running the export

```bash
node scripts/export-for-migration.mjs --check
```
```bash
brew install libpq
```
```bash
DATABASE_URL='postgresql://…from Supabase → Project Settings → Database…' node scripts/export-for-migration.mjs --export
```
The exported `auth.sql` holds password hashes. Keep `migration-export/` off
shared drives and delete it after the move.
