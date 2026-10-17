# RollCal

Plan an event with friends, chat while it's coming up, and share one photo roll once it's over.

Built with Expo SDK 57 (React Native 0.86), TypeScript and Supabase.

## What it does

- **Events**: title, description, start/end, a map pin, and a 6-character invite code. Guests join by code, QR scan or link, and RSVP Going / Maybe / Can't go.
- **Invites**: hosts invite friends directly. Guests can suggest friends, and the host approves or declines.
- **Photo roll**: opens when the event ends and accepts uploads for 48 hours. The host can close it early or reopen it, and pick a cover photo.
- **Chat**: one realtime chat per event, with RSVP tags next to names and per-event mute.
- **Calendar**: month view with multi-day events, a day agenda, and tap-an-empty-day to create.
- **Friends**: search by name or @username, send and manage requests.
- **Reminders**: local notifications before events and around the roll window.
- **Sign in**: email with a verification code, Sign in with Apple (iOS), or Google.

## Layout

```text
src/
  components/   shared UI (sheets, pickers, photo roll, scanner) and ui.tsx primitives
  context/      auth, theme and unread-count providers
  hooks/        useFriendData, useKeyboardShift
  lib/          Supabase queries and small helpers, one file per area
  navigation/   tabs + stack, route param types
  screens/      one file per screen
  theme.ts      palettes, type scale, spacing
supabase/
  policies.sql        RLS helpers, policies and storage bucket rules
  schema-updates.sql  columns and tables added after the original schema
  functions/join/     edge function that turns https invite links into app links
```

## Setup

```bash
npm install
cp .env.example .env   # then fill in your Supabase URL and anon key
```

In the Supabase SQL editor, run these in order: `supabase/schema-updates.sql`, `supabase/policies.sql`, `supabase/bills.sql`, `supabase/media.sql`, then `supabase/security.sql`. All are safe to re-run. Deploy `supabase/functions/join` with JWT verification turned off so invite links work for people who aren't signed in.

### Sign-in providers

All of this is in the Supabase dashboard under **Authentication**.

**Redirect URL.** Under URL Configuration, add `rollcal://**` to the redirect allow list. Google sign-in returns to the app through it.

**Email verification.** Under Sign In / Providers → Email, turn on **Confirm email**. Then, under Emails → **Confirm signup**, make the template show the code rather than a link, for example:

```html
<h2>Your RollCal code</h2>
<p>Enter this code in the app: <strong>{{ .Token }}</strong></p>
```

The app asks for that code right after sign-up, and again if someone tries to log in before confirming.

**Custom SMTP (required before testers sign up).** Supabase's built-in mailer only delivers to members of your Supabase team, and only a few emails an hour. Under Authentication → Emails → SMTP Settings, plug in a real provider (Resend, Postmark, SendGrid and Amazon SES all work). You'll need a domain you can add DNS records to.

**Google.**
1. In Google Cloud Console, create an OAuth client of type *Web application*.
2. Add `https://YOUR-REF.supabase.co/auth/v1/callback` as an authorized redirect URI.
3. Paste the client ID and secret into Supabase → Providers → Google.

No iOS or Android client IDs are needed, because sign-in runs in a browser sheet.

**Apple (iOS).** Leave the Secret Key, Team ID and Key ID fields empty. They're only for web sign-in, and the app uses the native iOS flow.
1. In your Apple Developer account, enable *Sign in with Apple* for the App ID `app.rollcal`. EAS does this for you on the first build if you let it manage credentials.
2. In Supabase → Providers → Apple, turn it on and add `app.rollcal` under Client IDs.

The native flow needs nothing else. Apple sign-in isn't shown on Android, which only offers Google and email.

## Running locally

```bash
npm run typecheck
npm run ios        # or: npm run android
```

The app uses native modules (camera, maps, media library), so it needs a development build. Expo Go won't work.

## Test builds (EAS)

`.env` is gitignored, so EAS never sees it. Add the two Supabase values to EAS once per environment, or the build will crash on launch:

```bash
npx eas-cli login
npx eas-cli init
npx eas-cli env:create --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value https://YOUR-REF.supabase.co --visibility plaintext
npx eas-cli env:create --environment preview --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value YOUR_ANON_KEY --visibility plaintext
```

Repeat with `--environment production` for the iOS build.

**Android APK**

```bash
npx eas-cli build --platform android --profile preview
```

EAS gives you a link and a QR code that installs the APK directly. Maps only render if the Google Maps API key in `app.json` allows the SHA-1 of the EAS keystore (`npx eas-cli credentials` shows it).

**iOS TestFlight** (needs a paid Apple Developer account)

```bash
npx eas-cli build --platform ios --profile production --auto-submit
```

Once processing finishes, add testers under TestFlight in App Store Connect. Internal testers get it right away. External testers need a one-time beta review.

Each production build bumps the build number automatically, so you never need to edit it by hand.

## Things to check on a real phone

1. Sign up on two phones (one with email, one with Apple or Google), enter the email code, and set a profile photo.
2. Create an event with a map pin and confirm the address resolves.
3. Share it from phone A, then scan the QR on phone B (`+` → Join an event).
4. Chat back and forth and check that messages arrive without refreshing.
5. For an event that ended in the last 48 hours, add photos with `+` → Add photos, then save one from the roll to the camera roll.
6. Switch the phone between light and dark mode.

## App icon

`assets/` holds the icon, Android adaptive layers, splash mark and favicon. All of them are generated by `python3 scripts/generate-icons.py`, which needs Pillow and the installed fonts. Edit the script and re-run it rather than editing the PNGs by hand.

## License

MIT
