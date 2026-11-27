# UI and colour review (2026-11-24)

Checked on the iOS simulator: light and dark mode, an iPhone SE (sign-in
screen; other screens need a signed-in account there), and the largest
normal accessibility text size. Website: rollcal.app, /join and the legal
pages at phone and desktop widths, light and dark. Nothing was changed.

## Overall

The base is good: calm paper/ink/film-green palette, one typeface (Figtree),
consistent spacing, and every text colour passes WCAG AA in both themes.
Dark mode is well done. The main weakness is the opposite of clutter: most
screens are flat. Every row has the same weight, and the green accent
almost never marks "do this", so nothing leads the eye.

## Colour (measured contrast, WCAG)

| Pair | Light | Dark | Needs |
|---|---|---|---|
| Body text on background | 16.0 | 16.0 | 4.5 ✔ |
| Muted text on background | 5.1 | 7.1 | 4.5 ✔ |
| Green on background | 7.1 | 6.5 | 4.5 ✔ |
| White on green button | 7.8 | 6.7 (dark text) | 4.5 ✔ |
| Red text on background | 6.6 | 5.0 | 4.5 ✔ |
| White on red button | — | **3.7** | 4.5 ✘ |
| Switch "off" track on card | **1.3** | clear by eye | 3.0 ✘ (light) |
| Card on background | 1.09 | 1.10 | (separation) |

Suggestions:
1. **Light-mode switches:** darken the "off" track (#E2DFD5 → about #959083, 3.2:1)
   so an off switch is clearly visible.
2. **Dark-mode red buttons:** use dark text on the red, or a deeper red
   (#C9413A with white text is 4.9).
3. **Cards:** slightly more separation from the background (card a touch
   whiter in light mode, or a firmer border), so grouped content reads as a
   group without relying on a faint hairline.
4. **Use the green on purpose:** one filled green button per screen for the
   main action, and nowhere else. Today it's mostly unused.

## App

5. **One main action on the event page,** by phase, as a filled green
   button under the details: before it starts and you're the host with few
   people → "Invite friends"; during → "Add photos" (already there, but low
   on the page before it starts); after → "Share a recap". Everything else
   stays as rows.
6. **The photos card is the product but looks like a notice.** Give it the
   film identity: the "EXP" counter and status on a dark film-strip band
   at the top of the card, photos below. It's the one place a bit of
   personality pays off.
7. **Home with few events** is mostly empty. Add a small "Recent memories"
   strip (last 3 events with photos) under upcoming events.
8. **Sign-in screen** is only text. Add the app icon or a small collage of
   sample photos above the name, so the first screen says "photos".
9. **Large text:** the event card's date line cuts off ("7:00 P…") and drops
   the place; let it wrap to two lines. The bell next to "Your events" gets
   squeezed; move it to its own row or shrink the title at large sizes.
   Icons don't grow with text (pencil next to a huge title); scale them a
   little with the text size.
10. **Event page icons:** the pencil sits mid-title and the share icon far
    right; put both together on the right.

## Website

11. **Homepage is a block of text.** Add: phone screenshots of the app (event
    page, photos, a recap), real App Store / Google Play badges instead of
    underlined text, and three short "how it works" steps
    (Make an event → Everyone adds photos → Keep the memories).
12. **Desktop layout:** the text column is narrow and small on a wide
    screen. Two columns (words left, phone mockup right), bigger headline.
13. **Footer** wraps "Child Safety" across lines on phones; give links a
    little more spacing or stack them.
14. **Tagline mismatch:** the site says "Share the roll" while the app now
    says "photos". Fine as a brand line, but keep body text in app words.
15. The join page is good. Once web guests (feature D) go live it will
    show the guest flow; check it again then.

## Already good (leave)

Typography, spacing, dark mode, legal pages, join page, chat, Settings,
Profile with Memories.
