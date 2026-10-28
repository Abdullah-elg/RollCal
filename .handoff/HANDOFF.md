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
