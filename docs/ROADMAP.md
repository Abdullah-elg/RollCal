# RollCal: what's left to build

Updated 2026-11-23. Tick items off here as they ship (details go in
`.handoff/HANDOFF.md`).

## Features to add (4 left)

1. **Expiry and reminders** (stage 4).
2. **Paywall** (stage 5).
3. **Event Pass purchase** (stage 6), once RevenueCat is set up.
4. **Security and legal pass** (stage 7), including the Plan Terms rewrite.
5. ~~**Who can upload and who can chat.**~~ Done 2026-11-24. The host chooses per event:
   everyone (today's behaviour) or only the host. With "only the host", the
   host can give chosen members permission. Same two settings for the
   event chat. Enforced in the database, not only in the app.
6. ~~**Bill splitting on/off.**~~ Done 2026-11-24. The host turns it on or off when creating the
   event and later in its settings. Off hides the bill entry and blocks new
   bills; existing bills stay readable.
7. ~~**Profile photo privacy.**~~ Done 2026-11-24. Default stays friends-only; the switch shows it to everyone. A setting for whether people who aren't your
   friends can see your profile photo (they see the plain placeholder).
   Enforced where photo links are handed out, not only in the app.
8. ~~**Settings layout.**~~ Done 2026-11-23. The profile part (photo, name, Edit profile) moves to
   the top of Settings. Log out and Delete account stay where they are, in a
   section renamed to something like "Signing in".

## Review (1)

1. **Look over everything and suggest changes.** In this order:
   1. The app: every screen and state (empty, loading, error, long text),
      light and dark, small and large iPhones, on the simulator.
   2. The website (rollcal.app, including /join and the legal pages), on
      phone and desktop widths.
   3. The colour scheme, across both.
   Report suggestions first; change nothing until the user picks.

## Fixes (4)

1. Joining by event ID ignores invite-code changes.
2. Google sign-in: move from the implicit flow to PKCE.
3. Pushes are lost when Expo's push service fails.
4. Photo expiry stalls when 20+ events fail in one run.

## Go-live steps (not features)

* Web guests (feature D): anonymous sign-ins on (about 10/hour), run
  `supabase/guest-web.sql`, push the website.
* ~~Run `supabase/function-calls.sql`~~ (done 2026-11-23).
* EAS build (when testing moves off the simulators): carries `api.rollcal.app`,
  react-native-view-shot and expo-sharing, and every change since the last build.
* After that build is out: raise `min_version`, rerun the media copy script,
  retire the Supabase Storage files.

## Social redesign (in progress)

Stage 1 the look (done 2026-11-24) · Stage 2 reactions and activity · Stage 3 come-back moments
(photos ready reveal, memory reminders). See docs/UI-COLOUR-REVIEW.md.

### After all 3 stages: the UI and colour review list (user's request, 2026-11-24)

Items marked (S1) are covered by Stage 1 and get ticked there.

1. ~~(S1)~~ Done in Stage 1: Light-mode switches: darken the "off" track to #959083 (3.2:1).
2. ~~(S1)~~ Done in Stage 1: Dark-mode red buttons: dark text on the red instead (5.0:1; a deeper red would have made red text fail).
3. ~~(S1)~~ Done in Stage 1: Cards: a touch more separation from the background.
4. ~~(S1)~~ Done in Stage 1: Use the green on purpose: one filled green button per screen.
5. ~~(S1)~~ Done in Stage 1: One main button on the event page, by phase.
6. ~~(S1)~~ Done in Stage 1: Photos card on a dark film-strip band with the EXP counter.
7. ~~(S1)~~ Done in Stage 1: Home: "Recent memories" strip under upcoming events.
8. Sign-in screen: add the app icon or sample photos.
9. Large text: event card date wraps instead of cutting off; bell not squeezed; icons grow with text.
10. Event page: pencil next to the share icon on the right.
11. Website homepage: phone screenshots, App Store / Google Play badges, three "how it works" steps.
12. Website desktop: two columns (words left, phone mockup right).
13. Website footer: "Child Safety" wraps on phones.
14. Website wording: body text says "photos"; "Share the roll" can stay as the headline.
15. Join page: check again once web guests go live.

## Video recap
- Phase 1 done (26 Nov 2026): the in-app player ("Play as a video" on the Recap screen), seamless with cross-fades and captions.
- Phase 2 iOS done (26 Nov 2026): "Share video" makes a 1080x1920 MP4 on the phone (modules/recap-video). Android still to do (Media3 Transformer).
- Optional: AI captions that describe each photo (Gemini, about a cent per recap; needs a privacy-policy update first).
- Phase 3: music (bundled royalty-free tracks), styles, and choosing the photos.
- Pricing ideas tied to recaps: see docs/MONETIZATION.md.

