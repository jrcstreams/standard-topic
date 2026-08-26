#!/usr/bin/env python3
"""Briefing-card art v3 (revamp997) — the mug photos are replaced by generated
graphics in the site's own dot-matrix language (John: the photo read as
cookie-cutter; wants a background graphic, concise, on-brand).

Morning: a halftone sun lifting over layered horizon arcs, warm amber over the
card's light ground. Evening: a halftone crescent and star field over the
card's navy. Each image bakes a left-edge fade into its card ground colour
(#eef2fb / #101a33), so the art can sit in the card's right half with no CSS
masking and no alpha channel (which costs ~6x the bytes on dot fields).
"""
import math, os, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SS = 3
W, H = 1280, 640

def dot_circle(d, cx, cy, r_outer, pitch, color, alpha_fn, clip=None):
    """Fill a disc with a dot grid; alpha_fn(nx, ny) -> 0..1 per dot."""
    n = int(r_outer * 2 / pitch)
    for gy in range(n + 1):
        for gx in range(n + 1):
            x = cx - r_outer + gx * pitch
            y = cy - r_outer + gy * pitch
            nx, ny = (x - cx) / r_outer, (y - cy) / r_outer
            if nx * nx + ny * ny > 1:
                continue
            if clip and not clip(x, y):
                continue
            a = alpha_fn(nx, ny)
            if a <= 0.02:
                continue
            r = pitch * (0.22 + 0.16 * a)
            d.ellipse([x - r, y - r, x + r, y + r], fill=color + (int(255 * a),))

def finish(img, ground, out_base):
    img = img.resize((W, H), Image.LANCZOS)
    # left fade into the card ground
    ramp = np.clip((np.arange(W) / W - 0.02) / (0.42 - 0.02), 0, 1)
    ramp = ramp * ramp * (3 - 2 * ramp)
    a = np.array(img.getchannel('A'), dtype=np.uint16)
    img.putalpha(Image.fromarray((a * (ramp * 255).astype(np.uint16) // 255).astype('uint8')))
    base = Image.new('RGB', (W, H), ground)
    base.paste(img, (0, 0), img)
    for w in (1280, 800):
        r = base if w == W else base.resize((w, round(H * w / W)), Image.LANCZOS)
        p = f'assets/briefing/{out_base}-{w}.webp'
        r.save(p, 'WEBP', quality=84, method=6)
        print(f'{p:44s} {os.path.getsize(p)/1024:5.1f} KB')

def morning():
    w, h = W * SS, H * SS
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    rnd = random.Random(11)
    cx, cy, R = int(w * 0.74), int(h * 0.66), int(h * 0.34)
    horizon = cy + int(R * 0.55)
    # sun disc: brighter toward the top edge, clipped at the horizon
    dot_circle(d, cx, cy, R, 13 * SS, (222, 148, 62),
               lambda nx, ny: max(0.0, 0.9 - 0.55 * (ny + 1) / 2),
               clip=lambda x, y: y < horizon)
    # rays: short dotted spokes above the disc
    for k in range(7):
        ang = math.pi * (0.15 + 0.7 * k / 6)
        for step in range(3):
            dist = R * (1.18 + 0.16 * step)
            x, y = cx + math.cos(ang) * dist, cy - abs(math.sin(ang)) * dist
            r = (2.6 - 0.5 * step) * SS
            d.ellipse([x - r, y - r, x + r, y + r], fill=(224, 158, 80, int(150 - 38 * step)))
    # layered horizon arcs in brand indigo, below the sun
    for i, (dy, al) in enumerate([(0, 120), (26, 84), (52, 56)]):
        yy = horizon + dy * SS
        for x in range(int(w * 0.30), w, 9 * SS):
            bow = math.sin((x - w * 0.30) / (w * 0.7) * math.pi) * 26 * SS * (1 + i * 0.35)
            r = 1.9 * SS
            d.ellipse([x - r, yy - bow - r, x + r, yy - bow + r], fill=(90, 114, 196, al))
    # ambient warm dust
    for _ in range(70):
        x = rnd.uniform(w * 0.42, w); y = rnd.uniform(0, h)
        r = rnd.uniform(0.8, 2.0) * SS
        d.ellipse([x - r, y - r, x + r, y + r], fill=(206, 152, 92, int(rnd.uniform(30, 80))))
    glow = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([cx - R * 1.5, cy - R * 1.5, cx + R * 1.5, cy + R * 1.5],
                                 fill=(238, 186, 120, 60))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(30 * SS)))
    finish(img, (238, 242, 251), 'morning')

def evening():
    w, h = W * SS, H * SS
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    rnd = random.Random(23)
    cx, cy, R = int(w * 0.76), int(h * 0.42), int(h * 0.30)
    # crescent: a dot disc with a bite clipped out
    bite_x, bite_y = cx + R * 0.42, cy - R * 0.42
    dot_circle(d, cx, cy, R, 13 * SS, (168, 186, 240),
               lambda nx, ny: 0.85,
               clip=lambda x, y: (x - bite_x) ** 2 + (y - bite_y) ** 2 > (R * 0.82) ** 2)
    # star field
    for _ in range(120):
        x = rnd.uniform(w * 0.36, w); y = rnd.uniform(0, h)
        if (x - cx) ** 2 + (y - cy) ** 2 < (R * 1.25) ** 2:
            continue
        r = rnd.uniform(0.7, 2.1) * SS
        d.ellipse([x - r, y - r, x + r, y + r], fill=(180, 196, 244, int(rnd.uniform(50, 150))))
    # two faint constellation arcs
    for i in range(2):
        y0 = h * (0.68 + 0.12 * i)
        for x in range(int(w * 0.34), w, 11 * SS):
            bow = math.sin((x - w * 0.34) / (w * 0.66) * math.pi) * 30 * SS
            r = 1.7 * SS
            d.ellipse([x - r, y0 - bow - r, x + r, y0 - bow + r], fill=(120, 142, 214, 70))
    glow = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([cx - R * 1.4, cy - R * 1.4, cx + R * 1.4, cy + R * 1.4],
                                 fill=(150, 172, 240, 55))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(26 * SS)))
    finish(img, (16, 26, 51), 'evening')

if __name__ == '__main__':
    morning()
    evening()
