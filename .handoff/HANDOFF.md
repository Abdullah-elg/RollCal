# RollCal handoff

Expo SDK 57 app, Supabase project `qwtvpmrxmlfuwmnyawcq`. The owner runs all SQL migrations themselves; give SQL as a file in `supabase/`, dry-run only inside a rolled-back transaction. Run order is in README.md.

## Latest work (2026-10-27, uncommitted)
- Chat "seen": anyone whose newest read message is their own gets no mark (`src/lib/seenBy.ts`).
- Chat replies: `messages.reply_to` (`supabase/message-replies.sql`); long-press → Reply; quote shown in bubble (`EventChatScreen.tsx`).
- Notifications inbox: bell on Home opens `NotificationsScreen`; built from data in `src/lib/inbox.ts`, New/Earlier rules in `src/lib/inboxArrange.ts` (seen items kept 2 days, pending requests kept until answered, one item per chat).
- Share button sits next to the info button, same 22pt circle.
- Sign-up shows a red inline error for RollCal's own addresses.
- Profile photo menu is an in-app sheet (`src/components/ActionMenuSheet.tsx`).
- Times always say AM/PM (`tidyDayPeriod` in `src/lib/dates.ts`).
- Past events: "Delete event" schedules deletion in 48h and pushes everyone (`supabase/event-delete.sql`); host can "Keep event"; hourly `expire-photos` function deletes due events.

- Seen marks also treat a person's own latest message as their read point.
- Inbox hides bills you've already paid.

## Status
Both migrations and expire-photos v3 are live (checked 2026-10-27). Tested on the iOS Release simulator build: inbox, tap-through, replies, seen marks, share/info pair, AM/PM, photo menu, delete/keep, and the hourly cleanup deleting a due event. Not seen on screen: the sign-up support@ error (simulator froze), Android.

## 2026-10-27 later (uncommitted)
- Chat pushes replace each other per chat (collapseId/tag in send-push/messages.ts); local chat alerts too, and they open the chat.
- Push registration retries when the app comes to the front; failures go to Sentry. No Android phone has ever registered a push token: check the FCM V1 key on expo.dev and the Firebase API key's SHA-1 restrictions.
- Sentry (`src/lib/crashReporting.ts`): off until EXPO_PUBLIC_SENTRY_DSN is set; eas.json sets SENTRY_DISABLE_AUTO_UPLOAD=true until SENTRY_AUTH_TOKEN exists. Privacy policy mentions it (app + web).
- Swipe right on a message to reply (`SwipeToReply`, built on PanResponder); full-screen back swipe off on EventChat only. Tapping a quote jumps to the original.
- Seen sync: `supabase/seen-sync.sql` (seen_marks); unread dots also use server chat_reads.
- Pay together: "Pay X for N bills together" on a bill opens a list of all their unpaid bills; tap one to choose your part (Bill with pickOnly), send all at once.
- Needs the owner: run seen-sync.sql; redeploy send-push.

## 2026-10-29 (uncommitted)
- Chat: no time under messages; centered time line at a new day or after a 1h pause; tap a message for its time (`formatChatDivider`, `startsChatTimeBlock` in dates.ts).
- Push: fixed an infinite register loop (token listener re-fetched the token; one iPhone made 115k calls). Android 13+: channel is created before asking permission; Android re-asks once (`rollcal.pushAsked.2`). "Don't Allow" no longer opens Settings. Reminder sync and local chat checks run one at a time. Tapped notification is cleared after handling (was reopening on every token refresh).
- Android still has 0 push tokens: token fetch fails on the phone; read `adb logcat` for "Push token unavailable" to see why.
- Edit profile → Password (`ChangePasswordScreen`): current+new, or emailed code+new (also lets Apple/Google accounts add one). `changePassword` / `setPasswordWithCode` in AuthContext.
- Verify email: checks at 6 digits automatically; wrong code shakes, buzzes, clears. CODE_LENGTH must match Supabase's Email OTP length.
- Signing in to an unconfirmed account re-sends a code at most every 10 min per email (robots were flooding support@).
- All @rollcal.app addresses are refused (app + `supabase/reserved-domain.sql`, which also confirms google-test@ and deletes testuser99@).
- Pro screen: "Compare Free and Pro" sheet (`PLAN_COMPARISON` in lib/pro.ts).
- Support reply time is 5–7 business days (24h for abuse/child safety); templates in `docs/SUPPORT-REPLIES.md`.
- Pay together / bundle: a failed send keeps only the unsent bills, so a retry can't pay twice.
- Realtime channels get unique names per screen; chat reloads when the app returns to the front.
- Privacy policy lists Cloudflare, Microsoft 365 and that data may leave Canada; web legal pages rebuilt; mailto links no longer swallow the full stop.
- Server hardening in `supabase/launch-hardening.sql` (scan race, push dedupe, chat rate limit, roll window, lost pushes, etc.) — owner runs it; scan-receipt needs redeploying.

## 2026-10-29 plans stage 1 (uncommitted, SQL NOT applied)
- `supabase/plans.sql`: profiles.plan (free/plus/pro) + plan_expires_at (admin-only, trigger `profiles_plan_sync` keeps is_pro = plan<>'free' both ways), daily cron `plans-expire`, events.keep_forever (admin-only), `event_passes`, `private.effective_plan/event_tier/upload_tier/upload_pool`, RPCs `event_plan`, `my_upload_rules`, `upload_allowance_for`; storage pools Free 2 / Plus 50 / Pro 250 GB, host pool or 20 GB event pool in premium events (enforced in the storage insert policy via `private.can_upload_to`); videos by upload tier; receipt scans: free = 2 successes + 6 tries a month (`receipt_scans.succeeded`); quiet mode for all; `app_config.min_version`. Owner how-to SQL at the top of the file.
- scan-receipt marks a scan succeeded (service role) only on a 200 with a receipt. Redeploy after running plans.sql.
- App: quiet mode ungated; `planOf` in lib/pro.ts; min-version gate (`lib/appVersion.ts`, `lib/minVersion.ts`, `UpdateRequiredScreen`).
- Needs the owner: run plans.sql (after storage-total/launch-hardening), then redeploy scan-receipt.

- Decision (2026-10-29): rename "Pro terms" to "Plan terms" in stage 7 when legal pages are rewritten for Basic/Plus/Pro/Event Pass; keep the /pro-terms URL.

## 2026-10-29 host reports (uncommitted, SQL NOT applied)
- Reporting a photo/video in an album first asks: "The host" or "RollCal support" (`ReportSheet` with `hostId`; rules in `src/lib/reportRoute.ts`, tested). Not offered when you're the host or the host uploaded it. Harassment, hate, nudity, violence always reach support too (one muted line tells the reporter).
- `supabase/host-reports.sql`: `reports.route`, `host_reports` (host-only RLS, no reporter column, decision lives only here), triggers `reports_route` / `reports_to_host` (push kind `hostReport`), RPC `resolve_host_report`, report emails only for support-routed or serious reports. Dry-run passed (rolled back).
- Host: push + inbox item (`hostReport`) open `HostReportScreen` (keep / delete with confirm). Delete removes the file via the existing host storage rule, then the RPC deletes the row.
- Security fixes: new reason `child_safety` ("Involves a child", any report, always to support). Host "Delete" on a serious report only hides the photo (`photos.hidden_at`; album RLS and storage read/delete rules skip it via `private.photo_file_held`), keeping the file for support. Host sees report times rounded to the hour. At most 5 host-report pushes per host per hour (advisory lock). Reporter sees the route the server stored. Delete order: RPC first, then the file.
- Needs the owner: run host-reports.sql after plans.sql, then redeploy report-email (label only).
- Known gaps: a hidden photo's file still counts toward storage; deleting the event (or the 30-day expiry) removes the hidden row.

## 2026-10-29: Reported photos in the album
- Waiting host reports load app-wide in `UnreadContext` (`hostReports`). They put a dot on the event on Home and on the Events tab, and they're added to the app-icon badge.
- `EventAlbum`: a reported tile gets a 3pt `colors.danger` outline. Tapping it opens `HostReport` (Keep/Delete) instead of the viewer. `HostReportScreen` refreshes the unread state after a decision.
- `supabase/host-report-badge.sql` adds waiting host reports (one per photo) to `private.badge_count`, the push badge.

## 2026-10-29: Stage 3, media in Cloudflare R2 (built, not deployed yet)
- `supabase/media-r2.sql` adds `media_objects`, a list of R2 files with their sizes. Storage counts read it together with `storage.objects`. It also adds `private.media_deletions`, filled by triggers when photo, event or account rows go away, plus the reserve, confirm and readable RPCs.
- The Worker is `workers/media`, at media.rollcal.app, with the R2 binding MEDIA on bucket `rollcal-media`.
  - It checks ES256 JWTs against the Supabase JWKS.
  - Uploads: reserve as the user, PUT through the Worker (size and type must match the reservation), then `/done` confirms with the service role.
  - Viewing uses HMAC-signed links that change every 6 hours. A cron every 5 minutes deletes queued files and drops stale reservations.
  - Secrets: `SUPABASE_SERVICE_ROLE_KEY` (the sb_secret key), `LINK_SECRET`, and `MEDIA_ADMIN_KEY`, which must match the report-email secret of the same name.
- App: `src/lib/media.ts` uploads and falls back to Supabase Storage when the Worker can't be reached. `signedUrls` asks the Worker first, and anything listed as `missing` falls back to Storage. Grid tiles use `thumbUrl`, made with cleanPhoto's `thumbSide` or, for videos, `videoThumb` (expo-video plus image-manipulator).
- `scripts/migrate-media-to-r2.mjs` copies the files that photo rows and avatars use, with previews made by sips/qlmanage. It's idempotent.
- After the new build is out: raise `min_version`, run the copy script again, then drop the Storage insert policies and delete the Storage files.

## 2026-10-29: Feature B, Profile tab
- The last tab is now `ProfileTab` (`src/screens/ProfileScreen.tsx`). It shows the avatar, name and @username, then Memories: a 2-column grid of past events that have photos visible to you, newest first.
  - Each tile shows the event photo, else the first photo, else a video's still.
  - Data comes from `src/lib/memories.ts`; the logic lives in `memoriesArrange.ts`, which has tests.
- Settings moved from a tab to the stack screen `Settings`, opened by the gear on Profile. It uses the native header and no longer draws its own title. Its bottom padding only clears the home indicator.
- Profile also has the editable photo and an Edit profile button. `src/components/EditableAvatar.tsx` holds the shared photo control (camera badge plus the choose/remove menu); Settings uses it too. In Settings, Account now sits just above About, and Appearance comes first.

## 2026-10-29: Event album capped at 9, and the All photos screen
- `EventAlbum` takes `previewCount` and `onShowAll`. The event page passes 9. With more than 9 photos it shows the first 8 (the cover stays as the 2x2 top-left tile when set) and then a "+N more" tile: the next photo, blurred and dimmed, with a red outline if a photo reported to you is among the rest. The viewer still swipes through every photo.
- New stack screen `EventPhotos` (`src/screens/EventPhotosScreen.tsx`, params `eventId`, `fromMemories`) shows the full album. Memories open it with `fromMemories`, which adds a floating "Go to event" button.
- Photo viewer: the outer SafeAreaView inside the Modal is now a plain View that pads the bottom with the app's `insets.bottom`; the top is padded only in `viewerTop`. Inside a Modal, SafeAreaView measured the top as 0 some times and the real inset others, so the header was padded twice and the photo shrank. The Report/Delete row has extra bottom padding (`spacing.lg`).
- Memories: `anniversaryLabel` (in memoriesArrange.ts, with tests) matches 1, 3 and 6 months, then 1 to 100 years, on the same day of the month, clamped to the month's last day. Matching memories appear as wide cards above the grid ("From 1 year ago"); they stay in the grid too.

## 2026-10-29: Feature C, shareable recap
- `Recap` stack screen (`src/screens/RecapScreen.tsx`), opened from "Recap" next to "Save all" in the album header.
  - It draws a 1080×1920 canvas (in points: 1080/PixelRatio) using the light palette only.
  - Content: date and place, title, up to 6 photos in `recapLayout` (`src/lib/recap.ts`, tested), and the mark (`assets/icon.png`) with the EXP count and "by N people".
  - Photo choice is `pickRecapPhotos`: the cover first, then evenly spread across the roll. "Pick other photos" shuffles.
  - Capture uses react-native-view-shot `captureRef` (a jpg tmpfile, verified at 1080×1920). Share uses expo-sharing; Save uses expo-media-library/legacy.
- New native deps: react-native-view-shot 5.1.0 and expo-sharing ~57.0.24 (pods installed). An EAS build is needed.
- Fix: the album's Save/Save all now gets its download link from `signedUrl` (R2 or Storage). Before, it used Storage only, so saving R2-only uploads failed.
- The event's share page also has a "Share a recap" section at the top (Make a recap opens `Recap`). It shows only when the event has ended and has photos; the QR and invite link stay below. Shared recaps are copied to `<title> recap.jpg` so the share sheet shows a real name. The recap title is sized by its length (76/62/50), because iOS `adjustsFontSizeToFit` shrank short titles to almost nothing.

## 2026-11-23: Feature D, web guests (built; not live)
- `supabase/guest-web.sql` (dry-run tested; NOT run yet):
  - `public.guest_gate` is the PostgREST db_pre_request allowlist for is_anonymous users. It reads the JWT directly, so the anon role works.
  - Restrictive `guests_no_*` policies on every public table and on storage.objects.
  - Guests only see profiles of people they share an event with.
  - `profiles.is_guest` plus a trigger that generates a `guest-…` username and blocks avatars.
  - Guest uploads: images only, 100 photos / 500 MB per event (a media_objects trigger).
  - Guest reports: own-event photos only. `reports_limit` is now security definer.
  - A trigger on auth.users blocks guests from adding an email or phone.
  - Daily `guests-prune` job.
- Web: `web/join/index.html` + `web/join-landing.js` + `web/join-guest.js`, with self-hosted `web/vendor/supabase-js-2.112.4.js` and a strict CSP for /join/* in `web/_headers`. Turnstile is wired but off: Supabase captcha applies to all sign-ins and the app sends no captcha token.
- Worker: CORS for rollcal.app (deploy pending; wrangler login had expired).
- App: `guestName` adds "(guest)" on the event page and album; people search drops guests; `Profile.is_guest` is optional.
- Privacy policy updated (web guests, R2 storage).
- Accepted for now: co-members' full profile rows are visible to guests (as to members); Realtime public channels are still on.

## 2026-11-23: Ready to move to AWS later (docs/MIGRATION-AWS.md)
- Database address: plan is `api.rollcal.app` as a Supabase custom domain (add-on). The Worker accepts tokens from both issuers (`API_URL` var); the web join page and CSP already use api.rollcal.app. Still to do: enable the add-on, DNS (CNAME + TXT), Google OAuth redirect, activate, then switch EAS `EXPO_PUBLIC_SUPABASE_URL` and `.env`.
- `supabase/function-calls.sql` (run by user 2026-11-23): `private.call_function` + `private.functions_base_url`. The poke_* functions and the expire-photos cron use them.
- `src/lib/live.ts` is the only Realtime user. chat, chatReads and payments call `listen()` and get an unsubscribe function back.
- `scripts/export-for-migration.mjs --check` (read-only, tested) writes `migration-export/inventory.json` (gitignored). `--export` needs pg_dump 17 and DATABASE_URL, and is untested (no pg_dump installed).

## 2026-11-23 — api.rollcal.app live
- Supabase custom domain api.rollcal.app is active (CNAME api → project, DNS only; TXT _acme-challenge.api). Old supabase.co address still works server-side, but third-party OAuth only works via the custom domain now.
- .env and EAS production EXPO_PUBLIC_SUPABASE_URL = https://api.rollcal.app.
- src/lib/supabase.ts pins auth storageKey 'sb-qwtvpmrxmlfuwmnyawcq-auth-token' so the host change doesn't sign people out (verified on simulator: still signed in, memories/photos load).
- Worker redeployed (version 69ad8476) with API_URL; accepts both issuers. Pending: EAS build; function-calls.sql run by user 2026-11-23.

## 2026-11-23: Memories separator, roadmap
- ProfileScreen: when there are anniversary cards, a hairline plus an "All memories" heading (`restHead`) separates them from the grid.
- `docs/ROADMAP.md` is now the list of what's left: 8 features, 4 fixes, go-live steps.

## 2026-11-23: Settings layout
- SettingsScreen: the profile card (avatar, name, @username, Edit profile, Plan) is now first, with no heading. The old Account section is renamed "Signing in" and sits last, below About: "Signed in as <email>", full-width Log out, then the Delete account text button.

## 2026-11-24: Upload/chat permissions (live; SQL run by user)
- `supabase/post-permissions.sql` (dry-run 19/19, NOT run): events.photos_by / chat_by ('everyone'|'host'), table event_allowed (host-managed; update must keep user a member), private.may_post / may_post_path, restrictive insert policies on photos, storage.objects (event-photos), messages, a media_objects trigger for R2 reservations, edit_message now also needs may_post, and an rsvps delete trigger drops a leaver's allowance.
- App: `src/lib/postRules.ts` (+test), `src/lib/postPermissions.ts`, `src/components/PostRulePicker.tsx`. CreateEventScreen pickers (sends the fields only when changed). EventDetail: host pickers under "Who can join"; PersonActionsSheet has a new `actions` list, used for "Let them add photos / chat" and "Stop letting them …" when the rule is host-only. EventAlbum hides Add photos with a note; EventChatScreen swaps the message box for a note (checked on focus).
- Security review: no Critical/High/Medium. Lows fixed in the SQL except keeping may_post executable by authenticated (policies run it as the user; private schema isn't exposed).

## 2026-11-24: Manage event
- The pencil on the event page (and a "Manage event" button in the ⓘ sheet, host only) opens `CreateEvent` with `editEventId`, now titled "Manage event". In edit mode it adds the event photo (preview, Upload/Remove via coverPhoto.ts) at the top and Cancel event / Delete event (after it ends) / Keep event (if deletion is scheduled) at the bottom, with the same ConfirmDialogs. Who can join / add photos / chat save with "Save changes".
- The ⓘ sheet no longer has the event photo, the three pickers, or cancel/delete. Hosts still tap a person for Remove / Let them add photos / chat. The deletion banner on the event page has a "Keep event" link for the host.
- Follow-up: the event photo is now a 180pt cover area at the top of both New event and Manage event ("Add event photo" when empty; the photo with Change/Remove chips when set). New events hold the picked asset and upload it right after the insert (`pickCoverAsset` / `uploadCoverAsset` in coverPhoto.ts; a failed upload alerts and the event still opens). Every block on the form is 24pt apart (`block` / `fieldBlock` styles; Field keeps its own 16).

## 2026-11-24: Simplicity pass (docs/SIMPLICITY-REVIEW.md items 1-4, 6-12; 5 skipped)
- Event page: the ⓘ button is gone; the "N going" row opens the sheet, now titled "Who's going"/"Who went" (people, waiting invites, Invite friends, Adding photos controls, Keep forever, Leave/Report, Manage event last). Share page has Invite friends at the top; back from Invite returns to where you came from.
- Page order: once the event has started (`started`), the photos block comes first; before, it's last. After it ends, non-hosts see one line ("You went.") instead of the RSVP buttons. Bills: no heading until a bill exists.
- EventAlbum: one status line (expired/expiring warning wins; otherwise status + count in one sentence).
- `src/lib/place.ts` placeLabel(): old "Pinned location (lat, lng)" values show as "Pinned on the map"; LocationPicker saves PINNED_LABEL now.
- New event: "More options" row (summary of join/photos/chat) folds description + the three pickers; Manage event shows them open.
- Wording: "roll"/"shots"/"sealed"/"album" → photos across the app (EventAlbum, CreateActionSheet, notifications.ts, inbox.ts, Settings, HostReport, Recap, pro.ts). Kept the sign-in tagline. Server-side text still says "roll": push.sql + roll-opens-at-start.sql push bodies, media-r2.sql upload errors (needs a migration).
- Friends (builder): Remove moved into the ••• sheet (`extra`), Sent folded into Requests (SentRequests route now unused but still registered). Home: "Nothing coming up." + "See your memories" when the user has past events.
- Emoji "?" boxes in a name: data is valid UTF-8 and PersonRow renders it plainly; likely simulator rendering. Check on a real phone.
- Follow-up: More options is folded in Manage event too (same row and summary). `supabase/wording-photos.sql` (run by user 2026-11-24, verified live) rewords photos_from_file, push_roll_openings and reserve_media_upload so the database no longer says "roll".

## 2026-11-24: Bill splitting on/off
- `supabase/bills-toggle.sql` (run by user 2026-11-24, verified live): events.bills_enabled (default true), private.bills_on(), restrictive insert policy bills_insert_enabled. Existing bills stay readable/editable.
- App: "Split bills" switch at the end of More options (New event + Manage event; sent only when changed; summary adds "no bill splitting"). Event page hides "Split a bill" when off; the Bills section still shows existing bills.

## 2026-11-24: Profile photo visibility
- Profile photos were already friends-only (readable_media + storage avatars_read). New: `supabase/avatar-visibility.sql` (dry-run 6/6, run by user 2026-11-24, verified live) adds profiles.avatar_public (default false), private.avatar_visible(viewer, owner), and rewrites readable_media's avatars branch + avatars_read to use it.
- Settings → Privacy: "Show my photo to everyone" switch (updates profiles.avatar_public). Links already handed out keep working until they expire (up to ~6 hours) after switching back to friends only.
- Privacy policy sentence updated and UPDATED bumped to November 24, 2026; web/privacy regenerated (needs the website pushed to go live).

## 2026-11-24: UI and colour review
- docs/UI-COLOUR-REVIEW.md: 15 suggestions (colour contrast fixes, one main green action per screen, photos card film band, Home memories strip, sign-in visual, large-text fixes, website screenshots/badges/layout). Nothing changed yet; waiting on the user's pick.

## 2026-11-24: Social redesign, Stage 1 (the look)
- theme.ts: new `live`/`onLive` (coral #B8452A / #F0997B) for "now/new" only; light `line` #D6D1C3; dark `card` #1E2420; dark `onDanger` #111513; `switchTrackOff` #959083.
- HomeScreen (builder): stories row (2+ upcoming events, ring = live or unread), photo-forward cards with "Live now" badge and wrapping date/place line, "From your memories" strip (loadMemories + signedLinks), press scale + haptics + fade-in. Old NextUpHero removed. Helper src/lib/homeEvents.ts (+test).
- EventDetailScreen (builder): one main green button by phase (Invite friends before / none during / Share a recap after), pencil + share on the right, "Live now" pill, icons scale with font scale (clamped 1–1.4), rows scale on press.
- EventAlbum (builder + me): dark film-strip band (#161A17, dark mode #232925) with sprockets, EXP counter, one status line, Recap/Save all; "Open now" pill; Add photos full width under the band; full-bleed square band; tiles scale on press; new photos fade in.
- Known nit: on the event page after an event, "Share a recap" button and the band's "Recap" link both exist.
- Memory: social-redesign-plan.md — after Stage 3, do the rest of the review list in docs/ROADMAP.md.
- Stage 1 follow-up: film strip is now a darker shade of the page (light #EAE6DB, dark #0A0D0B; holes in the page colour; text ink / #565D55 muted) via filmColors() in EventAlbum. New `src/components/InfoTip.tsx` (ⓘ → fading card over scrim) replaces long captions: Settings (Quiet mode, photo visibility, Notifications section), event form (Split bills; pickers show just the choice), film strip (Adding photos). Removed the share page's invite sentence and the reopen sentence; QR hint shortened. `Button` now passes flexBasis/width/alignSelf to its outer wrapper (Add photos is full width). Home memory tiles have a placeholder frame while loading.

## 2026-11-24: Cohesive pass (no dividers, film ink + coral)
- Palette: accent green → warm film ink (light #2A2420 / dark #EFE9DD with dark text); accentText → coral (#B8452A / #F0997B); switches on = coral track. App icon + splash (app.json #1F5C4A) still green: needs new art + native build.
- `SectionLabel` (ui.tsx) is the one section heading (17 semibold ink); `SECTION_GAP` = spacing.xl replaces divider lines between sections. Builders applied it across EventDetail, CreateEvent, Home, Profile, Calendar, Settings, bills, sheets. Inset hairlines only between repeated rows. Event page: going/chat/split-a-bill grouped with `rowGap`.
- EventAlbum: host tools ("Reopen for 24h", "Set/Change event photo") are chips inside the film strip (`toolRow`), removed from below.
- Home: section spacing via renderSectionFooter (SectionSeparator put a gap under headings).
- Follow-up: the film strip now wraps Add photos, the allowance/notice/empty note and the photo grid (FILM_FRAME 8pt border; grid sized from gridWidth), with sprockets top and bottom. Host tool chips share one row evenly (flex 1) with space above/below. Event page: "N going/went" and Chat are two equal tiles in one row (`tileRow`/`tile`), placed where the going row was; the separate chat row is gone (old whosGoingRow/chatRow styles unused).
- Follow-up: strip tool buttons are rounded squares (radii.sm, like Button). Going/Chat tiles are compact horizontal rows: picture left (3 avatars / chat icon), title + one line beside it; unread dot next to "Chat".
- Follow-up: going/chat tiles are wider (tileRow marginHorizontal -spacing.md) with a faint ink wash (c.ink + '0D') instead of the card colour. "You went" line removed; the people tile's subtitle says where you stand (meLine: "You + 2", "Just you so far", "You said maybe", "You didn't go", "See who"). Gap above the photo strip is spacing.lg (albumGap); EventAlbum container has no top margin.

## 2026-11-24: Polish pass
- theme.ts radii roles: tag 4, control 10, card 16, sheet 24, full (sm/md/lg kept as legacy). Builders applied roles across all components and screens; Buttons/fields/chips = control (48 high), cards/tiles/dialogs/thumbnails = card, EXP/Cover/badges = tag.
- EventAlbum: strip "Recap" link removed (Share a recap button stays); single cover photo is the 2x2 square (featureSize) like with more photos. EventPhotos: "Go to event" is a secondary full-width button above the strip (no longer floating).
- Friends: Search/Requests tiles use the ink wash, no border; PersonRow MoreAction is a plain inkMuted icon (44pt target). Home: past-event titles in ink. Calendar Day: weekday over a large date. SignIn: app icon above the title.
- Emoji "?" boxes: simulator-only (user confirmed real devices are fine). Calendar event dots: already existed.
- Follow-up: going/chat tiles use filmColors(c, dark).base (exported from EventAlbum) like the strip. "Split a bill" alone gets splitGap (spacing.lg). Sheet: Report + Leave side by side (guestActions), "Keep these photos forever" is a secondary Button. Strip: "Keep forever" (coral) beside Save all for free events → Upgrade pass; deletion line coral, tappable → Upgrade, with spacing above. Calendar Day: date header back to h3; event start time no longer adjustsFontSizeToFit (iOS shrank it to ~4pt in Day view). Home: "Expiring soon" horizontal strip (past events with photos deleted within WARN_DAYS, via loadPhotoExpiry), those events left out of "From your memories".

## 2026-11-25: Social redesign Stage 2 (reactions + new marker)
- `supabase/photo-reactions.sql` (RUN by user 2026-11-26 and verified: table, RLS, 3 policies; simulator test added and removed a ❤️ on the user's own event 'Hello', table left empty): photo_reactions(photo_id, user_id, emoji ❤️/😂/🔥, created_at), PK (photo_id,user_id,emoji). RLS: read/insert via a subquery on photos (inherits photo visibility, hidden photos excluded); insert/delete own only. guest-web.sql's guests_no_* loop will cover it when that runs.
- Note: the iOS 26.3 simulator on this Mac draws ALL emoji as ? boxes (Safari too, even after reboot). It's a simulator problem, not the app; check emoji on a real device.
- App (builder): src/lib/reactionsSummary.ts (pure, tested), src/lib/reactions.ts (loadReactions → null on error, toggleReaction). EventAlbum: reaction bar in the viewer above Report/Delete (optimistic, haptic bounce, rollback), tile badge bottom-left (top emoji + total), coral "new" dot top-right for others' photos since the previous photo-read mark (unread.ts keeps previousPhotoMark; marks <30s old fall back to the previous one).
- Verified on simulator without the table: viewer opens, no bar, no errors. Activity line ("Sara added 6 photos") already existed.

## 2026-11-26: viewer cleanup, new logo, monetization plan, video recap phase 1
- Photo viewer (EventAlbum): Save / Set as event photo / Report / Delete moved into a ⋯ menu (ActionMenuSheet, rendered inside the viewer Modal) next to ✕. Reactions float on see-through pills at a FIXED spot near the bottom (user's choice: no jumping while swiping); videos sit 96pt up, above the player controls. The cover photo shows an "Event photo" tag on the photo.
- Logo (user picked, after rejecting coral as too Claude-like): PAPER background gradient, film-ink frame, the window and perforations cut through to the paper (no shadow inside them), coral only on the lens. scripts/generate-icons.py default VARIANT=paper; ICON_VARIANT=ink renders a dark alternative to previews only. Applied to assets/*, web/icon.png, web/favicon.png, web/email-icon.png, the ios AppIcon and SplashScreenLogo, and the Android adaptive background (#F1ECE3). The website CSS accent is still green (web review is on the roadmap). assets/previews/logo-compare.png compares the versions.
- docs/MONETIZATION.md: recommendation of Free + Event Pass ($4.99, bought by the host and shared by everyone in the event) + Plus subscription; drop Pro as a separate tier. Nothing in code changed yet.
- Video recap: src/lib/videoRecap.ts (scene plan, recapCaption, FADE_MS; tested) + src/screens/VideoRecapScreen.tsx (one seamless video: title card, up to 12 photos with Ken Burns moves and a caption "First name · time", 450ms cross-fades, film-ink end card; tap to pause; no story bars, per the user; reduce-motion respected). End card: "Share video" (iOS) + "Watch again".
- Video export (phase 2, iOS only): local Expo module modules/recap-video (expo-module.config.json platforms ["ios"], RecapVideo.podspec, RecapVideoModule.swift). exportAsync renders 1080x1920 at 30fps with AVAssetWriter H.264 (~29 MB for 12 scenes), the same scenes, cross-fades and captions drawn with UIKit, into Caches/<title> recap.mp4. JS: modules/recap-video/index.ts (requireOptionalNativeModule, so Android hides the button). Checked on the simulator: a valid 29 s 1080x1920 file, frames look right. After adding native files: cd ios && pod install. Android export still to do (Media3 Transformer).
- Captions are metadata only (who + when); AI descriptions of photos would mean sending photos to Gemini, which needs a privacy-policy change, so that's left as a decision for the user. Route 'VideoRecap' (fullScreenModal), entry "Play as a video" on RecapScreen. pickRecapPhotos takes an optional max (4th arg).
- "Recap closed by itself" earlier: most likely the user tapping in the simulator at the same time (a later share sheet was logged as "dismissed manually" with no input from Claude). No crash or JS error found.

## 2026-11-26 (later): AI captions, recap fixes, recap screen, monetization v2
- Recap repeat fixed: (1) the title card's photo (cover) no longer plays again as the first scene (buildRecapScenes picks max+1 and plays chosen.slice(1)); (2) progress is reset to 0 BEFORE the next scene mounts, so it doesn't flash for a frame and jump back. Tests cover both.
- Shared loader src/lib/recapLoader.ts (loadRecap: event, when, scenes with meta "Name · time" + AI caption). src/lib/recapExport.ts (shareRecapVideo: scenes -> native writer -> share sheet). Both the player and the Recap screen use them.
- AI captions: supabase/photo-captions.sql (NOT run yet; rolled-back dry run OK: RLS on, authenticated SELECT only, policy via photo visibility). Edge function supabase/functions/caption-photos (index.ts + clean.ts, tested): JWT on, photos looked up as the user, captions once per photo ever (service role writes), previews fetched from media.rollcal.app/storage only (host allow-list), gemini-3.5-flash-lite then 3.6-flash, 12s timeout, 4 in parallel. NOT deployed yet (deploy after the SQL). App waits up to 15s, then plays with "Name · time".
- Cost: 3.5-flash-lite $0.30/M input, $2.50/M output (paid tier; content not used for training). About 300 input + ~30 output tokens per preview, so ~$0.0002 per photo, ~$0.002 per recap, once per photo.
- Player shows two-line captions (AI line + "Name · time"); the native export draws the same (subtitle field).
- Privacy policy + terms updated for AI captions (UPDATED November 26, 2026); web/privacy and web/terms regenerated, not pushed.
- EventPhotosScreen: "Share a recap" (primary) above "Go to event" when the event is over and has photos.
- RecapScreen: a Video | Picture switch (calendar toggle style). Video: cover preview with a play badge + Play / Share video. Picture: the story card + Share / Save / Shuffle.
- docs/MONETIZATION.md v2: value meters (people per event, photos per event, how long kept). Free 15 people / 150 photos / 30 days; Event Pass $4.99 (50 people), Big Event Pass $14.99 (300), Plus $4.99/mo or $39.99/yr. Guests are never asked to pay. Not built yet.
- Note: pro.ts PLAN_FEATURES still says free photos are kept "1 year", but expiry.sql uses 30 days. Fix when the plans are rebuilt.

## 2026-11-26 (late): captions live, recap jumping fixed
- photo-captions.sql RUN by the user and verified (RLS on, authenticated SELECT only, 1 policy). caption-photos edge function DEPLOYED (v1, verify_jwt on). First run: 9 photos captioned in 5.4s by gemini-3.5-flash-lite, e.g. "Fun times around the ping pong table", "Midnight noodles with good friends".
- Recap "jumping" root cause: all scenes shared ONE Animated.Value, so on every scene change the outgoing photo snapped to its start pose (and opacity 0) for a frame, and the outgoing scene was remounted as the "prev" layer (image reload flicker). Fix: one Animated.Value per scene (values map, valueFor(i)); render [index-1, index] keyed by scene index so a photo keeps its view; restart clears the map. Moves are now gentle push-ins from centre (1.02 -> 1.10, drift <= 2%), and there's a test for that.
- Captions: the outgoing scene drops its caption, and the new caption fades in at 18-30% of its scene, so two captions never overlap (same in the Swift export, drawScene(caption:false) for the scene underneath).
- The user drives the simulator in parallel at times; check the screen before tapping. A picture share sheet was opened by a mis-tap and cancelled (success=NO, nothing sent).

## 2026-11-26 (night): video recap is paid; highlights; 15 s to 1 min
- supabase/recap-video.sql (NOT run yet; rolled-back dry run OK: Hello allowed for its Pro host, a made-up event false): photo_captions.score smallint 1-10; public.recap_video_allowed(eid) = member AND (private.event_tier(eid) is not null OR the person's effective plan is plus/pro). Same "better of event and person" rule as uploads.
- caption-photos (updated locally, NOT deployed yet; deploy AFTER the SQL or every call fails on the missing column or function): asks Gemini for caption + score; one event per call; 403 code recap_locked unless recap_video_allowed; up to 30 photos a call, 6 at a time; photos with a caption but no score are rescored once; a missing score is saved as 5. Returns {captions, scores}.
- Planner (src/lib/videoRecap.ts): modes 'highlights' (about 40% of the roll, 4-8 photos) and 'all' (up to MAX_ALL_PHOTOS=39, spread); photoMs() keeps every video at 15 s to 1 min (1.4-5 s per photo; under 3 photos can run shorter). Highlights = reactions*3 + score (5 if none), back in roll order (src/lib/recap.ts pickHighlights). The picture recap uses pickPicturePhotos (cover + the best of the rest; Shuffle stays random).
- App: recapLoader.loadRecapPhotos (reactions, saved captions/scores, uploader) + loadRecap(eventId, mode) (makes missing captions only via the gated function, waits up to 20 s) + recapVideoAllowed (rpc, falls back to the person's own plan). RecapScreen Video tab: Highlights · Ns / All photos · Ns choice, Play / Share video; a PLUS tag and showProPrompt('recap') when locked. The player checks access too and shows "Video recaps come with Plus" with See plans / Not now. pro.ts: 'recap' reason + prompt + a "Video recaps" row in the plans table.
- The user's account is Pro (set by hand), so the locked path can't be seen with their account; covered by code and server checks only.

## 2026-11-26 (late night)
- recap-video.sql RUN by the user and verified (score smallint; recap_video_allowed is security definer, authenticated-only). caption-photos v2 DEPLOYED: all 10 Hello photos captioned and scored (5-9).
- Recap screen Video tab: the Play button was removed (the preview's play badge plays it); "Share video" is now the primary (white) button.
- docs/MONETIZATION.md v3: freemium with Free / Event Pass (Party $5.99 up to 75, Big Day $19.99 up to 300) / Plus ($4.99/mo, $34.99/yr, 7-day trial on yearly). Free gets 25 people, 200 photos, 30 days (Save all always free) and a 5-second video recap preview. Benchmarks from RevenueCat State of Subscription Apps 2026. Not built yet; the build order is in the doc. Pro would be dropped (grandfathered).

## 2026-11-26: monetization v4 + docs/PLANS.md
- docs/MONETIZATION.md v4 (user's choices): Free capped at 10 people per event; passes Party $5.99 (75), Big Day $19.99 (300), Unlimited $29.99 (no people limit); Plus $4.99/mo or $34.99/yr (100 people, passes 30% off). Fair-use storage: Free 2 GB per account, Party 10 GB, Big Day 30 GB, Unlimited 60 GB per event, Plus 50 GB (R2 cost at the cap is about $1.80-$10.80/yr). Bills stay free; only AI scans (3/mo free, +5 per pass, unlimited on Plus) and Plus extras (auto-reminders, CSV export) are paid.
- docs/PLANS.md: every feature by plan, with (planned) markers. Nothing in code has changed for plans yet.

## 2026-11-26: saved recaps + plans phase 1 (limits)
- supabase/recap-saved.sql (NOT run; rolled-back dry run passed: reserve as host, member reads it, a photo delete removes the recap and queues its R2 file, anon can't reserve). It adds:
  - the event_recaps table (event, mode, signature, storage_path), readable by members;
  - reserve_recap_upload and save_event_recap (only someone with recap_video_allowed, only their own stored mp4 upload);
  - a delete trigger that takes the file with it;
  - a trigger that drops the event's recaps when any of its photos is deleted or hidden;
  - expire_media_reservations now keeps recap files.
- App (src/lib/recapExport.ts): shareRecapVideo(eventId, mode, data, reduceMotion) reuses the saved file when recapSignature (videoRecap.ts: mode + count + FNV hash of the photo ids) matches; otherwise it renders, starts the upload + save in the background, and opens the share sheet. The upload is direct: rpc reserve_recap_upload, then PUT + /done on the media Worker; no Worker change was needed. Play on the Recap screen opens the saved mp4 (VideoRecap savedPath -> SavedRecapPlayer with expo-video) when it's current. The saved list refreshes on focus.
- supabase/plan-limits.sql (NOT run; rolled-back dry run passed: new free event (10,200), Hello unlimited, 9 others + host going, the 11th is refused "This event is full", old events uncapped). It adds:
  - event_passes.tier (party/big_day/unlimited);
  - events.capped (existing events false, new events true; the app can't change it, same guard as keep_forever);
  - private.event_limits and public.event_limits (people_limit, photos_limit, going, photos), members only;
  - a trigger on rsvps for "going" (the host counts as one; maybe/not_going are free);
  - a trigger on photos insert (photos_full).
- App: src/lib/planLimits.ts (+ planLimitsText.ts, pure, tested): guestFacing() for joining or RSVP (the guest is never asked to pay), HOST_FULL_MESSAGE when approving a request, the 'roll_full' upload reason with its message, the host's "8 of 10 spots taken · Make room" under the tiles (showProPrompt('people')), and pro.ts 'people'/'photos' prompts plus plan-table rows.
- WARNING (fixed): src/lib/limits.ts holds text-length limits (NAME_MAX etc.). It was briefly overwritten, then restored from git; it was identical to HEAD. The plan-limits module is planLimits.ts.
- Phase 2 still to do: storage caps per pass tier (10/30/60 GB), the free 15 s video (needs a server duration check), the plans/paywall screen rebuilt as Free/Plus/3 passes, the 5-second free preview of the video recap, RevenueCat (the user has to set up accounts), notifying the host when the event is full, and Plus pass discounts.
- 2026-11-26: recap-saved.sql and plan-limits.sql RUN by the user and verified (triggers, functions, RLS; 0 of 22 existing events capped). Tested on the simulator: Share video rendered once (~16 s) and saved a 13 MB highlights recap (event_recaps row, file stored); Play then streamed the saved mp4 (SavedRecapPlayer) with the captions baked in. The share sheet was cancelled; nothing was sent. RecapScreen now asks for saved recaps fresh when Play is pressed (no stale state).
- The people meter can't be seen with the user's account: they're Pro, so their events are unlimited. It shows on capped events of free hosts.

## 2026-11-27: plans phase 2
- supabase/plan-limits-2.sql (NOT run; rolled-back dry runs OK: the event_full push is sent once on a repeat; the no-pass pool is 20 GB; free_video_ok allows short videos and refuses long/big ones; photos_from_file compiles and stays attached). It adds:
  - private.event_pool_limit (pass tier 10/30/60 GB, else 20) inside upload_pool;
  - free short videos: free_video_ok (<=25 MB, <=15.5 s), reserve_media_upload + photos_from_file replaced (a free video must report duration_ms);
  - push_outbox kind 'eventFull' and public.notify_event_full(eid) (host, one push per 24 h via push_once, only when really full).
- App:
  - photos.ts allows free videos <=15 s / 25 MB (FREE_VIDEO_* in uploads.ts); the 'video' prompt wording changed.
  - Full events: guest text "This event is full. We’ve let the host know." and notifyHostFull from rsvp.ts/joinRequests.ts.
  - Free video recap = a 5 s preview (recapLoader.loadPreview: title + first photo, no AI) ending on an offer card with See plans / Watch again. RecapScreen Play opens it for free users; Share video still shows the prompt.
  - Plans screen: PLAN_IDS free/plus/party/bigday/unlimited (Pro still exists for current Pro users but is hidden). Prices: Plus $4.99/mo, $34.99/yr; passes $5.99/$19.99/$29.99; PASS_BLURBS; startingPlan by reason; Monthly/Yearly is only shown on the Plus card. Deep links that used plan 'pass' now use 'party'.
  - Pass receipt scans still show '—' (+5 per pass isn't enforced yet).
- docs/PURCHASES-SETUP.md: the user's RevenueCat/App Store/Play steps and product IDs. Purchases themselves are not wired yet (they need the user's public keys, a dev build, and a webhook to write event_passes).

## 2026-11-27: Bills label, website redesign, plans split
- plan-limits-2.sql RUN by the user and verified.
- CreateEventScreen: a "Bills" section label above the Split bills switch (More options).
- Website: style.css recoloured (paper, film ink buttons, coral --link; dark variant), so every page (beta, join, legal) picks it up. A new homepage web/index.html + web/home.css: hero with a CSS film strip (no real photos), store badges, How it works, 4 features, plans teaser (every event / one event), footer. Checked in the browser in light, dark and mobile. The store badges are black text placeholders linking to /ios/ and /android/; swap in Apple's and Google's OFFICIAL badge artwork (not yet downloaded; needs the user's OK). Not deployed (Cloudflare Pages).
- .claude/launch.json "website" serves web/ on :8787 for previews.
- Plans screen: a segmented "Every event" (Free, Plus; Monthly/Yearly) / "One event" (Party, Big Day, Unlimited) switch with a one-line blurb; PLAN_GROUPS / PLAN_GROUP_NAMES / PLAN_GROUP_BLURBS in pro.ts; names centred.

- 2026-11-27: Website store badges are now the official artwork in `web/badges/` (Apple `app-store.svg` from developer.apple.com, Google `google-play.png` from play.google.com). Shown at the same 52px visible height; the Google PNG padding is offset in `web/home.css`. They link to /ios/ and /android/ beta pages until the store listings exist. Apple rules: no edits or animation, clear space of 1/4 height. Not deployed.
- 2026-11-27: Website DEPLOYED to Cloudflare Pages project `rollcal` (direct upload, NOT git-connected: pushing to GitHub does not deploy). Deploy: copy web/ without .wrangler/.DS_Store, then `npx wrangler pages deploy <dir> --project-name rollcal --branch main`. Live at rollcal.app.
- 2026-11-27: Apple badge removed from the website (not allowed until the app is on the App Store); a plain "Get the iPhone beta" button links to /ios/. Google badge kept. Asset links carry ?v=2 (bump it when icon/css change, also in scripts/build-legal-pages.mjs) so browsers drop old cached green files. web/favicon.ico added.
- 2026-11-27: Beta pages (/ios, /android) redesigned: step cards, "Having trouble?" section, shared web/beta.css. Legal: documents.ts updated (Terms: plans/limits/storage, recaps; "Pro Terms" -> "Plan Terms" covering Plus, Event Passes, grandfathered Pro, storage 2/50/250 GB + pass 10/30/60 GB from the server; Privacy: reactions, recaps, purchases, RevenueCat once wired). App labels say "Plan Terms" (URL stays /pro-terms/). Legal web pages rebuilt with web/legal.css (contents list, shared footer); child-safety and delete-account restyled and updated. All deployed. Not yet seen on the simulator (text only; tsc + 232 tests pass). Stray tracked sed backups src/screens/*.tsx-E (7 files) should be deleted.
- 2026-11-27: Homepage graphics (CSS/SVG only, no real photos): app drawings above How it works steps, a looping recap phone, a split receipt, feature icons. home.css is now ?v=3 everywhere. Deployed.
- 2026-11-27: Homepage motion: web/motion.js (IntersectionObserver adds .in to [data-reveal] once; adds .motion to <html>; skipped with reduce motion). Hero frames "develop" and strip sets down on load; drawings play once on scroll; feature hover lift. Text never animates. home.css ?v=4. Deployed.
