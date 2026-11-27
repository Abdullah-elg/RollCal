# Simplicity review (2026-11-24)

Status: 1-4 and 6-12 done 2026-11-24 (12 as: ⓘ removed, share keeps Invite friends). 5 (merge Calendar) not done. 11 looks like the simulator; check on a phone.

Walked through on the iOS simulator as a first-time user: Home, New event,
Manage event, event page (before and after), Event info, chat, photos,
Calendar, Friends, Notifications, Profile and Settings. Nothing was changed.

The core loop is: make an event → people join → everyone's photos land in
one place → it becomes a memory. Everything below either makes that loop
clearer or moves extras out of its way.

## Do first (biggest effect)

1. **After an event, show the photos first.** On an ended event the photos
   sit at the very bottom, under a locked RSVP block, the chat and the bills.
   Order the page by when you are: before = time, place, who's coming;
   during = Add photos at the top; after = photos first, then chat and bills.
2. **Hide the RSVP buttons once it's over.** "Went / Maybe / Didn't go" plus
   "RSVPs can't change" is three buttons and a sentence for nothing. Show one
   line ("You went") instead.
3. **"More options" on the event form.** Title, photo, time and place show;
   description, who can join, who can add photos and who can chat sit behind
   one closed row that says the current choices in plain words, e.g.
   "Anyone with the link can join · everyone adds photos and chats".
   Better than an "Advanced" label: it tells people the defaults without
   opening it, and nobody has to decide anything to make an event.
4. **One word for the photos.** Today it's "roll", "shared roll", "album",
   "Photos", "shots", "Event photo", "cover", plus "EXP 01" and the phone's
   "camera roll". Use **Photos** everywhere; keep **Event photo** for the
   cover; drop "roll", "shots", "sealed" and the EXP counter from the text
   (keep the film feel in the visuals if you like). "Roll closed." becomes
   "Adding photos closed." and "The roll opens when the event starts."
   becomes "Photos open when the event starts."

## Do next

5. **Merge Calendar into Events.** Two tabs show the same events. A
   List / Calendar switch at the top of Events gives four tabs:
   Events, +, Friends, Profile.
6. **Friends: move "Remove" into the ••• menu.** A red Remove on every row is
   the loudest thing on the screen for the rarest action. Fold "Sent" into
   Requests (two tiles, not three).
7. **One status line on the photos card.** "Roll closed. / 1 photo from 1
   person. / Photos are deleted tomorrow…" → one line, the most urgent first
   ("Photos are deleted tomorrow. Save the ones you want.").
8. **Location without a name.** A dropped pin with no address shows
   "Pinned location (0.0000, 0.0000)" on Home, Calendar and the event.
   Show "Pinned on the map" (or the nearest street) instead of numbers.
9. **Bills only when they're used.** Before anyone splits, show one quiet
   "Split a bill" row, not a "Bills" heading with an empty section (and the
   upcoming on/off switch hides even that).
10. **Home with no upcoming events.** "No events yet." is wrong for someone
    with 9 past events; say "Nothing coming up" with Plan something, and a
    link to Memories.

## Small fixes

11. Emoji in names show as "?" boxes in some rows (Friends, "Human"):
    the name font has no emoji fallback in that component.
12. Three icons sit next to an event title (pencil, share, ⓘ). Share is also
    inside ⓘ; keep share and ⓘ, and move the pencil into ⓘ → Manage event
    only if hosts don't miss it (test it).

## Already simple (leave alone)

Chat, Notifications, Profile with Memories, Settings, Manage event.
