# Generates RollCal's app icon, Android adaptive layers, splash mark and favicon.
# Run from the repo root: python3 scripts/generate-icons.py (needs Pillow and
# numpy). Previews land in assets/previews/ and aren't used by the app.
#
# The mark is one frame of film that is also a calendar page: perforations
# down both sides, binding rings on top, and the roll's lens in the window.
# Everything is drawn at SS x size and scaled down with LANCZOS, so edges are
# smooth with no stair-stepping.
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / 'assets'
PREVIEWS = OUT / 'previews'
PREVIEWS.mkdir(exist_ok=True)

SS = 4
N = 1024 * SS
GREEN = (31, 92, 74, 255)
INK = (22, 26, 23, 255)
CREAM = (246, 244, 238, 255)
WHITE = (255, 255, 255, 255)
TOP = np.array([40, 112, 90], float)  # background gradient, top
BOT = np.array([26, 78, 63], float)   # and bottom


def px(v):
    return int(round(v * SS))


def gradient():
    t = np.linspace(0, 1, N)[:, None, None]
    rgb = TOP * (1 - t) + BOT * t
    return Image.fromarray(np.repeat(rgb, N, axis=1).astype(np.uint8), 'RGB').convert('RGBA')


def mark(scale=1.0, mono=False):
    """The film-frame calendar, centred on the canvas. Design units are a
    1024 canvas at scale 1."""
    k = scale
    c = 512

    def X(v):  # design x relative to the centre
        return px(c + v * k)

    def Y(v):
        return px(c + v * k)

    def box(l, t, r, b):
        return [X(l), Y(t), X(r), Y(b)]

    # Frame 616 x 560, sitting a little low so the rings balance it.
    fl, ft, fr, fb, fr_r = -308, -250, 308, 310, 112
    layer = Image.new('RGBA', (N, N), (0, 0, 0, 0))

    if not mono:
        shadow = Image.new('RGBA', (N, N), (0, 0, 0, 0))
        ImageDraw.Draw(shadow).rounded_rectangle(
            box(fl, ft + 26, fr, fb + 26), radius=px(fr_r * k), fill=(6, 28, 22, 85))
        layer = Image.alpha_composite(layer, shadow.filter(ImageFilter.GaussianBlur(px(34 * k))))

    frame = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    fd = ImageDraw.Draw(frame)
    fd.rounded_rectangle(box(fl, ft, fr, fb), radius=px(fr_r * k), fill=WHITE if mono else CREAM)

    # Cut-outs: three perforations a side, and (in one colour) the window.
    cut = Image.new('L', (N, N), 0)
    cd = ImageDraw.Draw(cut)
    hw, hh, hr = 64, 76, 18
    for x0 in (fl + 44, fr - 44 - hw):
        for i in range(3):
            y0 = ft + 98 + i * 136
            cd.rounded_rectangle(box(x0, y0, x0 + hw, y0 + hh), radius=px(hr * k), fill=255)
    wl, wt, wr, wb, wrad = fl + 150, ft + 96, fr - 150, fb - 96, 60
    if mono:
        cd.rounded_rectangle(box(wl, wt, wr, wb), radius=px(wrad * k), fill=255)
    a = np.array(frame)
    a[..., 3] = np.minimum(a[..., 3], 255 - np.array(cut))
    frame = Image.fromarray(a, 'RGBA')
    fd = ImageDraw.Draw(frame)

    # The window and the lens in it.
    lcx, lcy = 0, (wt + wb) / 2
    R, hub = 104, 56
    if not mono:
        fd.rounded_rectangle(box(wl, wt, wr, wb), radius=px(wrad * k), fill=INK)
        fd.ellipse(box(lcx - R, lcy - R, lcx + R, lcy + R), fill=CREAM)
        fd.ellipse(box(lcx - hub, lcy - hub, lcx + hub, lcy + hub), fill=GREEN)
    else:
        # A white ring in the empty window.
        fd.ellipse(box(lcx - R, lcy - R, lcx + R, lcy + R), fill=WHITE)
        a = np.array(frame)
        hole = Image.new('L', (N, N), 0)
        ImageDraw.Draw(hole).ellipse(box(lcx - hub, lcy - hub, lcx + hub, lcy + hub), fill=255)
        a[..., 3] = np.minimum(a[..., 3], 255 - np.array(hole))
        frame = Image.fromarray(a, 'RGBA')

    layer = Image.alpha_composite(layer, frame)

    # Binding rings: pills crossing the top edge.
    d = ImageDraw.Draw(layer)
    rw = 56
    for ox in (-136, 136):
        d.rounded_rectangle(box(ox - rw / 2, ft - 70, ox + rw / 2, ft + 74),
                            radius=px(rw / 2 * k), fill=WHITE if mono else CREAM)
    return layer


def down(img, size):
    return img.resize((size, size), Image.LANCZOS)


def rounded(img, radius_frac=0.2237):
    """Clip to an iOS-style rounded square, antialiased."""
    m = Image.new('L', (N, N), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, N - 1, N - 1], radius=int(N * radius_frac), fill=255)
    out = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    out.paste(img, (0, 0), m)
    return out


# Android shows the middle 72 of the 108 dp canvas, and the 66 dp circle in
# the middle is safe in every launcher shape; at 0.66 the mark fits in it.
ANDROID_SCALE = 0.66

full = Image.alpha_composite(gradient(), mark())
down(full, 1024).convert('RGB').save(OUT / 'icon.png')  # iOS: square, no transparency
down(rounded(full), 1024).save(OUT / 'splash-icon.png')
down(rounded(full), 48).save(OUT / 'favicon.png')
down(mark(ANDROID_SCALE), 1024).save(OUT / 'android-icon-foreground.png')
down(gradient(), 1024).save(OUT / 'android-icon-background.png')
down(mark(ANDROID_SCALE, mono=True), 1024).save(OUT / 'android-icon-monochrome.png')

# Previews.
paper = (246, 244, 238, 255)
ios = Image.alpha_composite(Image.new('RGBA', (N, N), paper), rounded(full))
down(ios, 512).save(PREVIEWS / 'preview-ios.png')
android = Image.alpha_composite(gradient(), mark(ANDROID_SCALE))
inner = android.crop((N // 6, N // 6, N - N // 6, N - N // 6)).resize((N, N), Image.LANCZOS)
circle = Image.new('L', (N, N), 0)
ImageDraw.Draw(circle).ellipse([0, 0, N - 1, N - 1], fill=255)
pa = Image.new('RGBA', (N, N), paper)
pa.paste(inner, (0, 0), circle)
down(pa, 512).save(PREVIEWS / 'preview-android.png')
mono = Image.alpha_composite(Image.new('RGBA', (N, N), (60, 64, 60, 255)), mark(ANDROID_SCALE, mono=True))
mono = mono.crop((N // 6, N // 6, N - N // 6, N - N // 6))
down(mono, 512).save(PREVIEWS / 'preview-mono.png')
strip = Image.new('RGBA', (430, 200), paper)
x = 10
for size in (180, 87, 58, 40):
    strip.alpha_composite(down(rounded(full), size), (x, 10))
    x += size + 15
strip.save(PREVIEWS / 'preview-small.png')
print('done')
