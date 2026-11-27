# Builds the App Store and Google Play screenshots and the Play feature
# graphic from raw simulator captures in store/raw/ (iPhone 15 Pro Max,
# 1290x2796, demo account "Sam Rivera" with stock photos from Pexels, see
# store/source-photos/SOURCES.md).
#
#   python3 scripts/store-screens.py
#
# Writes store/app-store/*.png (1290x2796, 6.9" iPhone),
# store/play/screenshot-*.png (1080x1920) and store/play/feature-graphic.png
# (1024x500). Colours are the app's: paper, film ink, coral as a small accent
# only (never a big coral background).
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'store' / 'raw'
FONTS = ROOT / 'node_modules' / '@expo-google-fonts' / 'figtree'
PAPER = (246, 244, 238)
PAPER_2 = (234, 230, 219)
INK = (22, 26, 23)
FILM = (33, 28, 25)
CORAL = (184, 69, 42)
CORAL_LIGHT = (240, 153, 123)
MUTED = (95, 100, 92)


def font(weight: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / weight / f'Figtree_{weight}.ttf'), size)


# Screens in store order: raw capture, kicker, headline, dark background?
SCREENS = [
    ('roll', 'Shared roll', 'Everyone’s photos.\nOne roll.', False),
    ('recap-play', 'Video recaps', 'Your night,\nas a short film', True),
    ('viewer', 'Reactions', 'React to the\nbest moments', False),
    ('bill', 'Split the bill', 'Tap what you had.\nPay your part.', False),
    ('home', 'Plan it', 'Every plan,\nin one place', False),
    ('chat', 'Event chat', 'Chat with\neveryone going', False),
    ('memories', 'Memories', 'Relive it\nany time', False),
    ('picture', 'Recap card', 'Share the night\nin one picture', True),
]


def rounded(im: Image.Image, radius: int) -> Image.Image:
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width - 1, im.height - 1), radius, fill=255)
    out = im.convert('RGBA')
    out.putalpha(mask)
    return out


def phone(screen: Image.Image, width: int, rim: bool = False) -> Image.Image:
    """The capture in a simple dark bezel, with rounded corners."""
    bezel = round(width * 0.028)
    inner_w = width - 2 * bezel
    inner_h = round(screen.height * inner_w / screen.width)
    inner = rounded(screen.resize((inner_w, inner_h), Image.LANCZOS), round(inner_w * 0.115))
    body = Image.new('RGBA', (width, inner_h + 2 * bezel), (0, 0, 0, 0))
    ImageDraw.Draw(body).rounded_rectangle(
        (0, 0, body.width - 1, body.height - 1), round(width * 0.13), fill=(17, 17, 17, 255),
        # A lighter edge so the phone doesn't vanish on the dark slides.
        outline=(92, 84, 76, 255) if rim else None, width=max(2, round(width * 0.004)) if rim else 0,
    )
    body.alpha_composite(inner, (bezel, bezel))
    return body


def shadow(size: tuple[int, int], radius: int, blur: int, alpha: int) -> Image.Image:
    pad = blur * 3
    sh = Image.new('RGBA', (size[0] + 2 * pad, size[1] + 2 * pad), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((pad, pad, pad + size[0], pad + size[1]), radius, fill=(0, 0, 0, alpha))
    return sh.filter(ImageFilter.GaussianBlur(blur))


def centered_text(draw, y, text, f, fill, W, spacing):
    for line in text.split('\n'):
        w = draw.textlength(line, font=f)
        draw.text(((W - w) / 2, y), line, font=f, fill=fill)
        y += f.size + spacing
    return y


def screenshot(raw: str, kicker: str, headline: str, dark: bool, W: int, H: int) -> Image.Image:
    bg = FILM if dark else PAPER
    canvas = Image.new('RGBA', (W, H), bg + (255,))
    d = ImageDraw.Draw(canvas)
    s = W / 1290
    y = round(150 * s)
    k = font('600SemiBold', round(42 * s))
    label = ' '.join(kicker.upper())
    kw = d.textlength(label, font=k)
    d.text(((W - kw) / 2, y), label, font=k, fill=CORAL_LIGHT if dark else CORAL)
    y += round(42 * s) + round(36 * s)
    y = centered_text(d, y, headline, font('800ExtraBold', round(112 * s)), PAPER if dark else INK, W, round(10 * s))
    top = y + round(70 * s)

    shot = Image.open(RAW / f'{raw}.png').convert('RGB')
    # As big as fits, and let the phone run off the bottom edge a little.
    width = min(round(W * 0.8), round((H - top + 120 * s) / (shot.height / shot.width + 0.06)))
    ph = phone(shot, width, rim=dark)
    x = (W - ph.width) // 2
    sh = shadow(ph.size, round(width * 0.13), round(36 * s), 90 if not dark else 160)
    canvas.alpha_composite(sh, (x - round(36 * s) * 3, top - round(36 * s) * 3 + round(24 * s)))
    canvas.alpha_composite(ph, (x, top))
    return canvas.convert('RGB')


def feature_graphic() -> Image.Image:
    W, H = 1024, 500
    c = Image.new('RGBA', (W, H), PAPER + (255,))
    d = ImageDraw.Draw(c)
    # A film strip band behind the phones.
    d.rectangle((560, 0, W, H), fill=PAPER_2)
    for yy in (18, H - 30):
        for xx in range(572, W, 30):
            d.rounded_rectangle((xx, yy, xx + 14, yy + 12), 3, fill=PAPER)

    icon = Image.open(ROOT / 'assets' / 'icon.png').convert('RGBA').resize((96, 96), Image.LANCZOS)
    c.alpha_composite(rounded(icon, 22), (64, 92))
    d.text((64, 212), 'RollCal', font=font('800ExtraBold', 76), fill=INK)
    y = 306
    for line in ('Plan it. Shoot it.', 'Share the roll.'):
        d.text((66, y), line, font=font('600SemiBold', 34), fill=MUTED)
        y += 44
    d.text((66, 410), 'Photos, video recaps and bills for every event', font=font('500Medium', 19), fill=CORAL)

    for raw, cx, cy, angle in (('roll', 700, 70, 6), ('recap-play', 880, 40, -5)):
        ph = phone(Image.open(RAW / f'{raw}.png').convert('RGB'), 210)
        ph = ph.rotate(angle, resample=Image.BICUBIC, expand=True)
        sh = shadow(ph.size, 30, 14, 70)
        c.alpha_composite(sh, (cx - ph.width // 2 - 42, cy - 42 + 10))
        c.alpha_composite(ph, (cx - ph.width // 2, cy))
    return c.convert('RGB')


def main() -> None:
    ios = ROOT / 'store' / 'app-store'
    play = ROOT / 'store' / 'play'
    ios.mkdir(parents=True, exist_ok=True)
    play.mkdir(parents=True, exist_ok=True)
    for old in play.glob('screenshot-*.png'):
        old.unlink()
    for i, (raw, kicker, headline, dark) in enumerate(SCREENS, start=1):
        name = f'{i}-{raw}.png'
        screenshot(raw, kicker, headline, dark, 1290, 2796).save(ios / name, optimize=True)
        screenshot(raw, kicker, headline, dark, 1080, 1920).save(play / f'screenshot-{name}', optimize=True)
        print(name)
    feature_graphic().save(play / 'feature-graphic.png', optimize=True)
    print('feature-graphic.png')


if __name__ == '__main__':
    main()
