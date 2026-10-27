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
