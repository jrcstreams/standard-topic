#!/usr/bin/env python3
"""Topic-page hero art, v2 (revamp997) — one image per topic.

v1 shipped 14 parent-family images in 14 palettes; John's brief for v2
(#voice-2026-08-27): every topic gets its OWN graphic, accurate to the topic,
in ONE brand palette across the whole site.

The motif source is the topic's own Lucide icon (data/topics.json `icon` →
js/utils/topic-icons.js), rendered as a halftone: the icon is rasterised
large, then rebuilt as dots on a grid — dot size follows stroke coverage — so
all 99 graphics share one visual language (the AI Briefings globe's dot-matrix)
while each stays literally the topic's own mark.

Run `node -e ...` (see EXTRACT below) first to refresh /tmp/topic-icons.json
from topics.json + topic-icons.js, then this script. Rerun both whenever a
topic or its icon changes.

Band mechanics are inherited from gen-hero-art.py: the white→indigo ramp is
baked into the image (an alpha channel costs ~6x the bytes), art fades out
toward the left where the headline sits.
"""
import io, json, math, os, random, re
import numpy as np
import cairosvg
from PIL import Image, ImageDraw, ImageFilter

W, H, SS = 1600, 300, 3
OUT = 'assets/hero/topics'

# One brand palette for every topic (familiarity over per-family colour).
BAND_LEFT  = (252, 253, 255)
BAND_TINT  = (216, 223, 246)     # ramp's right end
DOT        = (74, 100, 190)      # halftone dots
DOT_SOFT   = (128, 148, 214)     # ambient scatter
GLOW       = (150, 170, 240)

EXTRACT = """node -e "const fs=require('fs');const src=fs.readFileSync('js/utils/topic-icons.js','utf8');const m=src.match(/const ICONS = \\{([\\s\\S]*?)\\n\\};/);const ICONS=eval('({'+m[1]+'})');const t=require('./data/topics.json');fs.writeFileSync('/tmp/topic-icons.json',JSON.stringify((t.topics||t).filter(x=>x.slug!=='home').map(x=>({slug:x.slug,icon:x.icon,inner:ICONS[x.icon]||ICONS['circle-dot']}))))" """

def icon_mask(inner, px=960):
    """Rasterise a Lucide inner-SVG fragment to a white-on-transparent mask."""
    inner = inner.replace('fill="currentColor"', 'fill="white"')
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" '
           f'fill="none" stroke="white" stroke-width="1.7" '
           f'stroke-linecap="round" stroke-linejoin="round">{inner}</svg>')
    png = cairosvg.svg2png(bytestring=svg.encode(), output_width=px, output_height=px)
    return Image.open(io.BytesIO(png)).getchannel('A')

def render(slug, inner, seed):
    rnd = random.Random(seed * 6271)
    w, h = W * SS, H * SS
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # ── Halftone the icon ──
    # The band renders much shorter than this canvas and `cover` scales the
    # image to the band's WIDTH, so anything outside the central ~55% of the
    # canvas height gets cropped. The motif is sized to survive that: half the
    # canvas height, dead centre.
    mpx = 960
    mask = np.array(icon_mask(inner, mpx), dtype=np.float32) / 255.0
    icon_h = int(h * 0.50)                      # crop-safe icon box height
    cx, cy = int(w * 0.79), int(h * 0.50)
    cells = 22                                  # halftone resolution
    pitch = icon_h // cells
    cell_m = mpx / cells                        # matching pitch on the mask
    x0, y0 = cx - icon_h // 2, cy - icon_h // 2
    for gy in range(cells):
        for gx in range(cells):
            m0x, m0y = int(gx * cell_m), int(gy * cell_m)
            cov = float(mask[m0y:int(m0y + cell_m), m0x:int(m0x + cell_m)].mean())
            if cov < 0.06:
                continue
            r = (0.16 + 0.34 * min(1.0, cov * 2.4)) * pitch
            px = x0 + gx * pitch + pitch / 2
            py = y0 + gy * pitch + pitch / 2
            al = int(120 + 130 * min(1.0, cov * 2.2))
            d.ellipse([px - r, py - r, px + r, py + r], fill=DOT + (al,))

    # ── Ambient scatter around the motif, thinning outward ──
    for _ in range(90):
        ang = rnd.uniform(0, math.tau)
        dist = rnd.uniform(0.55, 1.15) * icon_h * 0.9
        x, y = cx + math.cos(ang) * dist, cy + math.sin(ang) * dist * 0.7
        if not (0 < x < w and 0 < y < h):
            continue
        r = rnd.uniform(0.8, 2.0) * SS
        d.ellipse([x - r, y - r, x + r, y + r], fill=DOT_SOFT + (int(rnd.uniform(36, 96)),))

    # ── A couple of soft glows for depth ──
    glow = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for _ in range(4):
        gx = cx + rnd.uniform(-0.4, 0.4) * icon_h
        gy = cy + rnd.uniform(-0.4, 0.4) * icon_h
        r = rnd.uniform(7, 13) * SS
        gd.ellipse([gx - r, gy - r, gx + r, gy + r], fill=GLOW + (46,))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(9 * SS)))

    img = img.resize((W, H), Image.LANCZOS)

    # ── Fade the art out toward the headline side ──
    ramp = np.clip((np.arange(W) / W - 0.30) / (0.68 - 0.30), 0, 1)
    ramp = ramp * ramp * (3 - 2 * ramp)
    a = np.array(img.getchannel('A'), dtype=np.uint16)
    img.putalpha(Image.fromarray((a * (ramp * 255).astype(np.uint16) // 255).astype('uint8')))

    # ── Bake the band underneath ──
    band = np.zeros((H, W, 3), dtype=np.float64)
    t = (np.clip(np.arange(W) / W, 0, 1) ** 0.85)[None, :, None]
    band += np.array(BAND_LEFT, dtype=np.float64) * (1 - t)
    band += np.array(BAND_TINT, dtype=np.float64) * t
    band *= (1.0 - 0.018 * (np.arange(H) / H)[:, None, None])
    base = Image.fromarray(band.astype('uint8'))
    base.paste(img, (0, 0), img)

    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, f'{slug}.webp')
    base.save(p, 'WEBP', quality=82, method=6)
    return os.path.getsize(p)

if __name__ == '__main__':
    topics = json.load(open('/tmp/topic-icons.json'))
    total = 0
    for i, t in enumerate(topics):
        n = render(t['slug'], t['inner'], i + 1)
        total += n
    sizes = total / 1024
    print(f'{len(topics)} images, {sizes:.0f} KB total, {sizes/len(topics):.1f} KB avg')
