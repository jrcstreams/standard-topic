#!/usr/bin/env python3
"""Generate the topic/briefings hero art (revamp993).

One motif — a dot-matrix globe wrapped in faint network arcs — rendered per
topic family in that family's palette. Everything is drawn procedurally, so
there is no licensing surface and no attribution to carry.

The whole BAND is baked into the image: a left-to-right colour ramp from the
page white into the family tint, with the art fading in over it toward the
right. That is deliberate. Shipping the art on a transparent background cost
~80KB a file, because WebP has to code a full alpha channel over a dense dot
field; flattening it onto the ramp drops the same image to ~11KB and means the
band needs nothing from CSS but `background: url() right center / cover`.
"""
import math, os, random
from PIL import Image, ImageDraw, ImageFilter

W, H, SS = 1600, 400, 3          # output size; SS = supersample factor
# Globe centre (fraction of W/H) and radius (of H). The band renders far
# shorter than this canvas and uses `cover`, so a globe sized to the full
# height gets cropped top and bottom and stops reading as a sphere at all —
# it just looks like a dot field. Keep it well inside the frame.
CX, CY, R = 0.755, 0.50, 0.52

BAND_LEFT = (252, 253, 255)      # the ramp's left end: effectively page white

# family -> (dot rgb, arc rgb, glow rgb, band tint at the right edge)
PALETTES = {
    # Keyed by PARENT topic slug, so a topic page resolves its art with
    # `topic.parent || topic.slug` and needs no lookup table.
    'briefings':          ((78, 102, 200), (112, 134, 220), (150, 170, 246), (214, 222, 248)),
    'world':              ((82, 106, 202), (114, 136, 220), (148, 168, 244), (215, 224, 248)),
    'politics':           ((60, 82, 150),  (92, 112, 176),  (132, 152, 210), (214, 220, 240)),
    'business-finance':   ((66, 90, 162),  (98, 120, 186),  (138, 158, 218), (216, 224, 243)),
    'technology':         ((90, 98, 210),  (120, 126, 228), (156, 162, 246), (219, 220, 249)),
    'science':            ((52, 132, 162), (84, 158, 184),  (128, 194, 214), (211, 232, 242)),
    'health-wellness':    ((62, 140, 142), (96, 168, 170),  (140, 202, 204), (211, 234, 234)),
    'climate-environment':((56, 138, 124), (90, 166, 152),  (134, 200, 188), (210, 234, 229)),
    'sports':             ((178, 114, 58), (200, 140, 84),  (230, 178, 128), (246, 231, 216)),
    'entertainment':      ((160, 84, 168), (186, 114, 192), (216, 156, 220), (240, 222, 243)),
    'arts-culture':       ((128, 88, 182), (154, 116, 204), (190, 156, 232), (232, 222, 246)),
    'lifestyle':          ((152, 98, 142), (178, 126, 168), (210, 166, 202), (241, 224, 236)),
    'media':              ((102, 92, 178), (130, 120, 198), (168, 160, 230), (224, 222, 247)),
    'education':          ((96, 110, 176), (126, 140, 200), (164, 176, 228), (222, 227, 245)),
    'ideas-opinion-more': ((110, 104, 158), (138, 132, 182), (174, 168, 214), (228, 226, 240)),
}

def globe_points(seed):
    """Front-hemisphere lat/lon lattice, tilted so it reads as a sphere."""
    rnd = random.Random(seed)
    tilt = math.radians(16)
    spin = rnd.uniform(0, math.tau)
    pts = []
    for lat_d in range(-78, 79, 6):
        lat = math.radians(lat_d)
        # even angular spacing -> fewer dots near the poles, like a real lattice
        n = max(4, int(round(46 * math.cos(lat))))
        for i in range(n):
            lon = spin + math.tau * i / n
            x = math.cos(lat) * math.sin(lon)
            y = math.sin(lat)
            z = math.cos(lat) * math.cos(lon)
            # tilt about the x axis
            y, z = y * math.cos(tilt) - z * math.sin(tilt), y * math.sin(tilt) + z * math.cos(tilt)
            if z <= 0.02:
                continue                      # back hemisphere
            pts.append((x, y, z))
    return pts

def render(family, seed, out_dir='assets/hero'):
    dot_c, arc_c, glow_c, tint = PALETTES[family]
    w, h = W * SS, H * SS
    cx, cy, r = w * CX, h * CY, h * R
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    rnd = random.Random(seed * 7919)

    pts = globe_points(seed)
    scr = [(cx + p[0] * r, cy - p[1] * r, p[2]) for p in pts]

    # Network arcs first, so the dots sit on top of them.
    arcs = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ad = ImageDraw.Draw(arcs)
    for _ in range(26):
        a, b = rnd.choice(scr), rnd.choice(scr)
        if abs(a[0] - b[0]) < r * 0.35:
            continue
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        # bow the arc away from the globe centre
        bow = 0.30 * math.hypot(b[0] - a[0], b[1] - a[1])
        nx, ny = mx - cx, my - cy
        nl = math.hypot(nx, ny) or 1
        ctrl = (mx + nx / nl * bow, my + ny / nl * bow)
        prev = a[:2]
        for i in range(1, 25):
            t = i / 24
            u = 1 - t
            pt = (u * u * a[0] + 2 * u * t * ctrl[0] + t * t * b[0],
                  u * u * a[1] + 2 * u * t * ctrl[1] + t * t * b[1])
            ad.line([prev, pt], fill=arc_c + (95,), width=max(1, SS))
            prev = pt
    img.alpha_composite(arcs)

    # Globe dots — nearer dots read slightly larger and brighter.
    for x, y, z in scr:
        rad = (1.05 + 1.15 * z) * SS
        al = int(95 + 150 * z)
        d.ellipse([x - rad, y - rad, x + rad, y + rad], fill=dot_c + (al,))

    # Loose scatter above/right of the globe, thinning outward.
    for _ in range(120):
        ang, dist = rnd.uniform(0, math.tau), rnd.uniform(1.02, 1.55)
        x, y = cx + math.cos(ang) * r * dist, cy - abs(math.sin(ang)) * r * dist * 0.8
        if not (0 < x < w and 0 < y < h):
            continue
        rad = rnd.uniform(0.8, 1.9) * SS
        d.ellipse([x - rad, y - rad, x + rad, y + rad], fill=dot_c + (int(rnd.uniform(45, 120)),))

    # A few soft glows for depth.
    glow = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for _ in range(5):
        p = rnd.choice(scr)
        rad = rnd.uniform(6, 12) * SS
        gd.ellipse([p[0] - rad, p[1] - rad, p[0] + rad, p[1] + rad], fill=glow_c + (46,))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(9 * SS)))

    img = img.resize((W, H), Image.LANCZOS)

    # Fade the ART out toward the left so it never crowds the headline.
    import numpy as np
    ramp = np.clip((np.arange(W) / W - 0.26) / (0.70 - 0.26), 0, 1)
    ramp = ramp * ramp * (3 - 2 * ramp)                      # smoothstep
    a = np.array(img.getchannel('A'), dtype=np.uint16)
    img.putalpha(Image.fromarray((a * (ramp * 255).astype(np.uint16) // 255).astype('uint8')))

    # Bake the band itself underneath: page-white on the left easing into the
    # family tint on the right, with a faint vertical lift.
    band = np.zeros((H, W, 3), dtype=np.float64)
    t = np.clip(np.arange(W) / W, 0, 1)[None, :, None]
    t = t ** 0.85
    band += np.array(BAND_LEFT, dtype=np.float64) * (1 - t)
    band += np.array(tint, dtype=np.float64) * t
    v = (np.arange(H) / H)[:, None, None]
    band *= (1.0 - 0.018 * v)
    base = Image.fromarray(band.astype('uint8'), 'RGB')
    base.paste(img, (0, 0), img)

    os.makedirs(out_dir, exist_ok=True)
    p = os.path.join(out_dir, f'{family}.webp')
    base.save(p, 'WEBP', quality=82, method=6)
    return p, os.path.getsize(p)

if __name__ == '__main__':
    for i, fam in enumerate(PALETTES):
        p, n = render(fam, i + 1)
        print(f'{p:34s} {n/1024:6.1f} KB')
