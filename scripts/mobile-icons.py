"""Icone e schermate di avvio dell'app iOS/Android, disegnate dal logo (punto + onde radio).
Uso: python3 scripts/mobile-icons.py   (richiede Pillow). I PNG generati sono nel repository."""
import glob
import math
import os
from PIL import Image, ImageDraw

BG = (11, 18, 32)
GREEN = (52, 211, 153)
BLUE = (96, 165, 250)
ROOT = os.path.join(os.path.dirname(__file__), '..')


def logo(size, scale=1.0, bg=BG):
    """Logo su quadrato pieno (size x size). scale < 1 lascia margine (zona sicura Android)."""
    ss = 4  # disegno in grande e riduco: bordi lisci
    S = size * ss
    im = Image.new('RGBA', (S, S), bg + (255,) if bg else (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    k = S / 1024 * scale
    cx = S / 2 - 150 * k
    cy = S / 2
    w = int(54 * k)
    r = 66 * k
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=GREEN)
    for rad, col in ((170, GREEN), (300, GREEN), (440, BLUE)):
        R = rad * k
        # PIL disegna il tratto dentro il riquadro: si allarga di mezzo tratto per centrarlo sul raggio
        o = R + w / 2
        d.arc([cx - o, cy - o, cx + o, cy + o], start=-48, end=48, fill=col, width=w)
        # estremità arrotondate
        for a in (-48, 48):
            x = cx + R * math.cos(math.radians(a))
            y = cy + R * math.sin(math.radians(a))
            d.ellipse([x - w / 2 + 1, y - w / 2 + 1, x + w / 2 - 1, y + w / 2 - 1], fill=col)
    return im.resize((size, size), Image.LANCZOS)


def splash(w, h):
    im = Image.new('RGB', (w, h), BG)
    s = int(min(w, h) * 0.5)
    icon = logo(s, 0.9)
    im.paste(icon, ((w - s) // 2, (h - s) // 2), icon)
    return im


def main():
    res = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
    for dpi, n in (('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)):
        base = logo(n, 0.9)
        base.convert('RGB').save(os.path.join(res, f'mipmap-{dpi}', 'ic_launcher.png'))
        rnd = Image.new('RGBA', (n, n), (0, 0, 0, 0))
        mask = Image.new('L', (n * 4, n * 4), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, n * 4 - 1, n * 4 - 1], fill=255)
        rnd.paste(base, (0, 0), mask.resize((n, n), Image.LANCZOS))
        rnd.save(os.path.join(res, f'mipmap-{dpi}', 'ic_launcher_round.png'))
        fg = int(n * 108 / 48)
        logo(fg, 0.62, bg=None).save(os.path.join(res, f'mipmap-{dpi}', 'ic_launcher_foreground.png'))
    for f in glob.glob(os.path.join(res, 'drawable*', 'splash.png')):
        w, h = Image.open(f).size
        splash(w, h).save(f)
    with open(os.path.join(res, 'values', 'ic_launcher_background.xml'), 'w') as fh:
        fh.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0B1220</color>\n</resources>\n')
    xc = os.path.join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets')
    logo(1024, 1.0).convert('RGB').save(os.path.join(xc, 'AppIcon.appiconset', 'AppIcon-512@2x.png'))
    for f in glob.glob(os.path.join(xc, 'Splash.imageset', '*.png')):
        splash(2732, 2732).save(f)
    # icona per il sito e gli store
    os.makedirs(os.path.join(ROOT, 'site', 'img'), exist_ok=True)
    logo(1024, 1.0).convert('RGB').save(os.path.join(ROOT, 'site', 'img', 'app-icon.png'))
    logo(512, 1.0).convert('RGB').save(os.path.join(ROOT, 'site', 'img', 'app-icon-512.png'))
    print('icone e schermate di avvio generate')


if __name__ == '__main__':
    main()
