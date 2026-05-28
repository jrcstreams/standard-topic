"""Build a JS module that inlines all shortcut SVG contents as a
registry. Output mirrors js/utils/topic-icons.js — an ICONS object
keyed by filename-stem mapping to the SVG inner content. This lets
the renderer inline the SVG directly into the DOM, where currentColor
resolves correctly to the parent's CSS color."""

import os, re, json

SRC_DIR = "/Users/johnchoudhari/Desktop/standard-topic/assets/shortcut-icons"
OUT = "/Users/johnchoudhari/Desktop/standard-topic/js/utils/shortcut-icons-registry.js"

icons = {}
for fn in sorted(os.listdir(SRC_DIR)):
    if not fn.endswith(".svg"):
        continue
    key = fn[:-4]
    with open(os.path.join(SRC_DIR, fn)) as f:
        s = f.read()
    # Strip XML wrapper, keep inner content (paths/circles/etc).
    # Existing pattern: <svg ...>inner</svg>
    m = re.search(r"<svg[^>]*>(.*?)</svg>", s, flags=re.S)
    if not m:
        continue
    inner = m.group(1).strip()
    # Strip HTML comments for compactness.
    inner = re.sub(r"<!--.*?-->", "", inner, flags=re.S).strip()
    # Collapse whitespace runs.
    inner = re.sub(r"\s+", " ", inner)
    icons[key] = inner

with open(OUT, "w") as f:
    f.write("// AUTO-GENERATED from assets/shortcut-icons/*.svg — do not hand-edit.\n")
    f.write("// Inline SVG registry for shortcut icons. Lets renderIcon() emit\n")
    f.write("// inline SVG so currentColor (the parent's CSS color) propagates\n")
    f.write("// to the stroke. Run tools/build_shortcut_registry.py to regenerate\n")
    f.write("// after adding/editing SVGs in assets/shortcut-icons/.\n\n")
    f.write("export const SHORTCUT_ICONS = ")
    f.write(json.dumps(icons, ensure_ascii=False, indent=0).replace('": "', '":"'))
    f.write(";\n")

print(f"Wrote {len(icons)} icons to {OUT}")
