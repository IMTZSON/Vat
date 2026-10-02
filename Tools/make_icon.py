#!/usr/bin/env python3
"""Renders the original Contrail app icon (1024×1024) — night-sky gradient, globe graticule,
cyan contrail arc with glow and an amber aircraft. Variants: light (default), dark, tinted."""
import math, os, sys
from PIL import Image, ImageDraw, ImageFilter

S = 4096  # supersampled canvas
OUT = sys.argv[1] if len(sys.argv) > 1 else "App/Resources/Assets.xcassets/AppIcon.appiconset"

def lerp(a, b, t): return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))

def background(top, bottom):
    img = Image.new("RGBA", (S, S))
    px = img.load()
    cx, cy = S * 0.3, S * 0.2
    maxd = math.hypot(S, S)
    grad = Image.new("RGBA", (1, 256))
    for y in range(256):
        grad.putpixel((0, y), lerp(top, bottom, y / 255) + (255,))
    img = grad.resize((S, S), Image.BILINEAR)
    # soft radial glow top-left
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(glow)
    d.ellipse((-S * 0.2, -S * 0.3, S * 0.9, S * 0.7), fill=(40, 110, 170, 90))
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.12))
    return Image.alpha_composite(img, glow)

def globe(img, color, alpha):
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx, cy, r = S * 0.62, S * 1.02, S * 0.78
    w = int(S * 0.006)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=color + (alpha,), width=w * 2)
    for k in range(1, 6):  # meridians as ellipses
        rx = r * (k / 6)
        d.ellipse((cx - rx, cy - r, cx + rx, cy + r), outline=color + (alpha // 2,), width=w)
    for k in range(1, 6):  # parallels
        y = cy - r * k / 6
        half = math.sqrt(max(0, r * r - (y - cy) ** 2))
        d.line((cx - half, y, cx + half, y), fill=color + (alpha // 2,), width=w)
    return Image.alpha_composite(img, layer)

def contrail_points():
    pts = []
    for i in range(200):
        t = i / 199
        x = S * (0.08 + 0.62 * t)
        y = S * (0.80 - 0.52 * math.sin(t * math.pi / 2) ** 1.1)
        pts.append((x, y, t))
    return pts

def contrail(img, color):
    pts = contrail_points()
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(glow)
    for (x, y, t) in pts:
        r = S * (0.006 + 0.03 * t)
        d.ellipse((x - r, y - r, x + r, y + r), fill=color + (int(70 * t) + 10,))
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.02))
    img = Image.alpha_composite(img, glow)
    core = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(core)
    for (x, y, t) in pts:
        r = S * (0.003 + 0.012 * t)
        c = lerp(color, (235, 252, 255), t * 0.6)
        d.ellipse((x - r, y - r, x + r, y + r), fill=c + (int(120 + 135 * t),))
    return Image.alpha_composite(img, core)

def plane(img, color):
    pts = contrail_points()
    x0, y0, _ = pts[-1]
    x1, y1, _ = pts[-6]
    ang = math.atan2(y0 - y1, x0 - x1)
    L = S * 0.2
    # aircraft silhouette in local coords (nose at +x)
    shape = [(1.0, 0), (0.55, 0.07), (0.25, 0.08), (-0.05, 0.62), (-0.2, 0.62), (0.02, 0.09),
             (-0.42, 0.08), (-0.55, 0.28), (-0.65, 0.28), (-0.58, 0.0),
             (-0.65, -0.28), (-0.55, -0.28), (-0.42, -0.08), (0.02, -0.09), (-0.2, -0.62),
             (-0.05, -0.62), (0.25, -0.08), (0.55, -0.07)]
    cx, cy = x0 + math.cos(ang) * L * 0.42, y0 + math.sin(ang) * L * 0.42
    poly = []
    for (px, py) in shape:
        X = px * L * 0.5; Y = py * L * 0.5
        poly.append((cx + X * math.cos(ang) - Y * math.sin(ang), cy + X * math.sin(ang) + Y * math.cos(ang)))
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(glow).polygon(poly, fill=color + (200,))
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.018))
    img = Image.alpha_composite(img, glow)
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(layer).polygon(poly, fill=color + (255,))
    return Image.alpha_composite(img, layer)

def render(top, bottom, globe_c, trail_c, plane_c, name, opaque=True):
    img = background(top, bottom) if opaque else Image.new("RGBA", (S, S), (0, 0, 0, 0))
    img = globe(img, globe_c, 70)
    img = contrail(img, trail_c)
    img = plane(img, plane_c)
    img = img.resize((1024, 1024), Image.LANCZOS)
    if opaque:
        img = img.convert("RGB")
    img.save(os.path.join(OUT, name))
    print("wrote", name)

os.makedirs(OUT, exist_ok=True)
render((16, 30, 58), (6, 10, 24), (63, 216, 242), (63, 216, 242), (255, 181, 71), "AppIcon.png")
render((8, 14, 30), (2, 4, 10), (63, 216, 242), (63, 216, 242), (255, 181, 71), "AppIcon-Dark.png", opaque=False)
render((0, 0, 0), (0, 0, 0), (200, 200, 200), (230, 230, 230), (255, 255, 255), "AppIcon-Tinted.png")
