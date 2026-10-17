# RollCal launch setup

Everything here is set up outside the code, in the order to do it. The aim is that nothing needs migrating once RollCal is in the stores: anything users' phones point at (the API address, links, app IDs, product IDs) is fixed before release, and anything that can change later lives on the server.

## Locked in now (never change these)

| What | Value |
| --- | --- |
| iOS bundle ID / Android package | `app.rollcal` |
| App link scheme | `rollcal://` |
| Shared links | `https://rollcal.app/join/CODE` |
| Support email | `support@rollcal.app` |

The old `com.abdullah.elg.SociaLink` app on your test phones is a separate app now. Delete it.

## 1. Domain and website (Cloudflare, free)

1. Add `rollcal.app` to Cloudflare and change the nameservers at your registrar to the two Cloudflare gives you.
2. **Pages:** Workers & Pages → Create → Pages → connect the GitHub repo.
   - Build command: `npm run build:legal`
   - Build output directory: `web`
   - Add the custom domain `rollcal.app`, plus `www.rollcal.app` redirecting to it.
3. **Email Routing:** forward `support@rollcal.app` to your own inbox. This only handles incoming mail.
4. **App link files.** Fill these in, commit, and Pages redeploys:
   - `web/.well-known/apple-app-site-association`: replace `TEAMID` with your Apple Team ID (developer.apple.com → Membership).
   - `web/.well-known/assetlinks.json`: replace `PLAY_APP_SIGNING_SHA256` with the SHA-256 from Play Console → your app → Test and release → App integrity → App signing key certificate. Add a second entry with the upload key's SHA-256 from `eas credentials` if you test builds outside the Play Store.
5. **Store links:** once the listings are live, put the App Store and Google Play URLs into the `data-store` links in `web/index.html` and `web/join/index.html`.

Pages your store listings need:
- Privacy policy: `https://rollcal.app/privacy/`
- Terms: `https://rollcal.app/terms/`
- Account deletion (Google Play): `https://rollcal.app/delete-account/`
- Support: `mailto:support@rollcal.app`

## 2. Sending email from support@rollcal.app (Resend)

Supabase's built-in mailer only reaches your own team, a few times an hour. It can't send to real users.

1. Create a Resend account → Domains → add `rollcal.app`. Add the DNS records it shows (SPF, DKIM, and the bounce MX on a `send.` subdomain) in Cloudflare. These sit alongside Cloudflare Email Routing; they don't clash.
2. Add a DMARC record in Cloudflare: TXT `_dmarc` → `v=DMARC1; p=quarantine; rua=mailto:support@rollcal.app`.
3. Resend → API Keys → create a sending-only key.
4. Supabase → Authentication → Emails → SMTP Settings → enable:
   - Host `smtp.resend.com`, port `465`, username `resend`, password = the API key
   - Sender email `support@rollcal.app`, sender name `RollCal`
5. Supabase → Authentication → Rate Limits: raise "emails sent per hour" (Supabase keeps it low until you use your own SMTP).
6. Check the "Confirm signup" template says RollCal and shows the code. The README has the template.

Resend's free plan covers 3,000 emails a month. Its first paid plan is about $20 a month for 50,000.

## 3. Supabase

**Upgrade the project to Pro ($25/month) before launch.** The Free plan:
- stops at 1 GB of stored files for the whole app;
- caps each file at 50 MB;
- pauses a project after a week with no activity;
- has no daily backups.

Pro includes 100 GB of storage and files up to 500 GB, then charges for usage. After upgrading:
- Storage → Settings: set the global file size limit to at least 200 MB.
- Ask me to raise video length to 3 minutes. That's `VIDEO_MAX_SECONDS` and `MAX_FILE_BYTES` in `src/lib/uploads.ts` plus the bucket limit in `supabase/media.sql`.

**Custom domain `api.rollcal.app` (Pro add-on, about $10/month).** This is the most important future-proofing step. Every installed app talks to the address in `EXPO_PUBLIC_SUPABASE_URL`. If that's `xxxx.supabase.co`, you can never move projects or regions without every user updating the app. With `api.rollcal.app` you can.
1. Supabase → Project Settings → Custom Domains → add `api.rollcal.app` and add its records in Cloudflare (set them to "DNS only", not proxied).
2. Set `EXPO_PUBLIC_SUPABASE_URL=https://api.rollcal.app` in `.env` and in your EAS environment variables. Do this before the first store build.
3. Google Cloud → your OAuth web client → add `https://api.rollcal.app/auth/v1/callback` as an authorized redirect URI. Keep the old one until the switch is done.

**Authentication → URL Configuration:**
- Site URL: `https://rollcal.app`
- Redirect URLs: add `rollcal://**`, and remove `socialink://**` once your test phones run the new build.

**Authentication → Providers → Apple:** replace the client ID `com.abdullah.elg.SociaLink` with `app.rollcal`.

**Edge Functions:** redeploy `join` from `supabase/functions/join`. It now forwards old invite links to `rollcal.app`.

## 4. Apple Developer

1. Register the App ID `app.rollcal` with **Sign in with Apple** and **Associated Domains** turned on. EAS can do this on the first build if you let it manage credentials.
2. App Store Connect → create the app with that bundle ID.
3. Before Pro goes live: create one subscription group, "RollCal Pro", with `rollcal_pro_monthly` ($6.99) and `rollcal_pro_yearly` ($49.99), and a 7-day free trial. **Product IDs are permanent,** so use these exact names.

## 5. Google Play and Google Cloud

1. Play Console → create the app with the package `app.rollcal`. Fill in the Data safety form: account info, photos and videos, and payment handles are collected; nothing is sold or used for ads.
2. Add the same two subscription products (`rollcal_pro_monthly`, `rollcal_pro_yearly`).
3. **Google Maps key.** It's in `app.json`, so anyone with the app can read it. In Google Cloud → Credentials, restrict it:
   - Android: package `app.rollcal` plus the Play app signing SHA-1.
   - iOS: bundle ID `app.rollcal`.
   - APIs: only the Maps SDKs.
4. Google sign-in needs no new client IDs, because it runs through Supabase in a browser sheet. Only the redirect URI from section 3 changes.

## 6. Receipt scanning (Gemini)

You don't need a different provider: the Gemini API becomes pay-per-token as soon as billing is on.

1. aistudio.google.com → your API key's project → **Set up billing**. The paid tier:
   - doesn't use your users' receipts to improve Google's models (the free tier does);
   - raises the rate limits so many people can scan at once.
2. Google Cloud → Billing → Budgets & alerts: add a monthly budget, for example $50, with email alerts.
3. Cost per scan is under a cent:
   - `gemini-3.6-flash`: about $0.002 now, about $0.008 from January 2027 when its price doubles.
   - `gemini-3.5-flash-lite`: about $0.002.

   1,000 Pro users scanning 20 receipts a month is roughly $40–150 a month.

**Why this is already future-proof:** the app never talks to Gemini directly. Only the `scan-receipt` function on the server does. You can change models (the `GEMINI_MODEL` secret), or move to Vertex AI, Claude or OpenAI, by editing that one function, with no app update. If you'd rather start cheaper, set `GEMINI_MODEL` to `gemini-3.5-flash-lite`; it read the test receipt perfectly.

## 7. Before the first store build

- [ ] In-app purchases wired up. RevenueCat is recommended: it handles both stores' receipts and trials, and sets `is_pro` through a webhook. Until then, hide the "Coming soon" button or the review will be rejected.
- [ ] Push notifications set up (Expo push and an EAS project) so reminders and payment alerts reach closed apps.
- [ ] `eas init` with slug `rollcal` under the account that will own the app.
- [ ] Fill in `OPERATOR` and `PROVINCE` in `src/legal/documents.ts`, run `npm run build:legal`, and have a lawyer review the three documents.
- [ ] Turn on leaked-password protection: Supabase → Authentication → Policies.
