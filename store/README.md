# Store images

Made by `python3 scripts/store-screens.py` from the captures in `raw/`.

| Folder | Size | Where it goes |
|---|---|---|
| `app-store/1-8` | 1290 × 2796 | App Store Connect → RollCal → the version → iPhone 6.9" Display |
| `play/screenshot-1-8` | 1080 × 1920 | Play Console → Grow → Store presence → Main store listing → Phone screenshots |
| `play/feature-graphic.png` | 1024 × 500 | Same page → Feature graphic |
| `play/icon-512.png` | 512 × 512 | Same page → App icon |

`raw/` are iPhone 15 Pro Max (iOS 17.2) simulator captures of a demo account
("Sam Rivera", made-up friends and events). Photos are free Pexels stock
(`source-photos/SOURCES.md`). Order tells the story: shared roll, video recap,
reactions, bill split, plans, chat, memories, recap card.

To redo: edit `SCREENS` in the script (headline text), or recapture a screen into
`raw/` with `xcrun simctl io <device> screenshot --type=png raw/<name>.png`.
