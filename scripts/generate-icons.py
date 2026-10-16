# Generates SociaLink's app icon, Android adaptive layers, splash mark and favicon.
# Run from the repo root: python3 scripts/generate-icons.py (needs Pillow).
#
# The mark is a calendar with one day circled, sitting on a frame of film:
# the event, and the shared roll it ends in.
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / 'assets'
GREEN = (31, 92, 74, 255)
PAPER = (246, 244, 238, 255)
INK = (22, 26, 23, 255)
DOT = (214, 210, 199, 255)
CLEAR = (0, 0, 0, 0)
SS = 4  # supersample for smooth edges

# All geometry is in a 1024 x 1024 design space.


def film_strips(d, k, inset=0):
    """Ink strips down both sides with cream sprocket holes."""
    S = 1024 * k
    sw = 128 * k
    for left in (True, False):
        x0 = inset * k if left else S - inset * k - sw
        # Pillow includes the end pixel, hence the -1s: keeps the black either
        # side of each hole exactly equal.
        d.rectangle((x0, 0, x0 + sw - 1, S - 1), fill=INK)
        n, h, w, top = 6, 62 * k, 58 * k, 150 * k
        step = (S - 2 * top - h) / (n - 1)
        cx = x0 + sw / 2
        for i in range(n):
            y = top + i * step
            d.rounded_rectangle((cx - w / 2, y, cx + w / 2 - 1, y + h - 1), 14 * k, fill=PAPER)


def calendar(d, k, fg=None):
    """Calendar page with rings, a header band and one day circled.
    fg draws the whole thing in a single colour (Android themed icons)."""
    page, head, dot, hot = (fg, CLEAR, fg, fg) if fg else (PAPER, INK, DOT, GREEN)
    x0, y0, x1, y1 = 246 * k, 262 * k, 778 * k, 800 * k
    if fg:
        # Single colour: outline the page instead of filling it.
        d.rounded_rectangle((x0, y0, x1, y1), 52 * k, outline=page, width=round(36 * k))
        d.rectangle((x0, 380 * k, x1, 410 * k), fill=page)
    else:
        d.rounded_rectangle((x0, y0, x1, y1), 52 * k, fill=page)
        d.rounded_rectangle((x0, y0, x1, 410 * k), 52 * k, fill=head)
        d.rectangle((x0, 360 * k, x1, 410 * k), fill=head)
    for cx in (376 * k, 648 * k):
        d.rounded_rectangle((cx - 24 * k, 206 * k, cx + 24 * k, 316 * k), 24 * k, fill=page)
    cols, rows = 4, 3
    gx, gy = (x1 - x0 - 150 * k) / (cols - 1), 112 * k
    for r in range(rows):
        for c in range(cols):
            cx, cy = x0 + 75 * k + c * gx, 494 * k + r * gy
            rad = 46 * k if (r, c) == (1, 2) else 24 * k
            d.ellipse((cx - rad, cy - rad, cx + rad, cy + rad), fill=hot if (r, c) == (1, 2) else dot)


def render(size, draw, bg=CLEAR, corner=0.0):
    k = SS * size / 1024
    S = int(1024 * k)
    im = Image.new('RGBA', (S, S), CLEAR)
    d = ImageDraw.Draw(im)
    if bg != CLEAR:
        d.rounded_rectangle((0, 0, S - 1, S - 1), int(corner * S), fill=bg)
    draw(d, k)
    if corner:
        mask = Image.new('L', (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, S - 1, S - 1), int(corner * S), fill=255)
        im.putalpha(mask)
    return im.resize((size, size), Image.LANCZOS)


def full(d, k):
    film_strips(d, k)
    calendar(d, k)


def shrink(art, scale, size):
    """Centre art at `scale` of a `size` canvas (Android's safe zone is ~66%)."""
    c = Image.new('RGBA', (size, size), CLEAR)
    a = art.resize((int(size * scale),) * 2, Image.LANCZOS)
    c.alpha_composite(a, ((size - a.width) // 2, (size - a.height) // 2))
    return c


# iOS / store icon: full bleed and opaque.
render(1024, full, GREEN).convert('RGB').save(OUT / 'icon.png')

# Android adaptive icon. Launchers show only the middle 72 of 108dp, so the
# strips move inward to stay visible, and the calendar sits in the safe zone.
render(512, lambda d, k: film_strips(d, k, inset=215), GREEN).save(OUT / 'android-icon-background.png')
shrink(render(512, calendar), 0.58, 512).save(OUT / 'android-icon-foreground.png')
shrink(render(432, lambda d, k: calendar(d, k, fg=(255, 255, 255, 255))), 0.58, 432).save(
    OUT / 'android-icon-monochrome.png'
)

# Splash and favicon: the icon as a rounded tile.
render(1024, full, GREEN, corner=0.225).save(OUT / 'splash-icon.png')
render(48, full, GREEN, corner=0.225).save(OUT / 'favicon.png')
