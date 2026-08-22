"""Build a JS module that inlines all shortcut SVG contents as a
registry. Output mirrors js/utils/topic-icons.js — an ICONS object
keyed by filename-stem mapping to the SVG inner content. This lets
the renderer inline the SVG directly into the DOM, where currentColor
resolves correctly to the parent's CSS color.

HISTORY (revamp965): despite the "do not hand-edit" banner this script
writes, 221 topic-specific icon overrides had been appended by hand to the
generated file (revamp547). A JS object literal takes the LAST value for a
duplicate key, so those overrides were what actually rendered — and running
this script would have silently discarded all 221 with nothing to catch it.
They have since been written back into their source .svg files, so the file
is genuinely generated again and this script is safe to run. Keep it that
way: to change an icon, edit its .svg and re-run this — never append to the
generated module. The guard below fails loudly if hand edits reappear."""

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

# Detect hand edits in the file we are about to overwrite (see HISTORY above)
# and abort BEFORE opening it for writing — a guard that fires after the write
# has already destroyed what it was guarding.
prev_dupes = []
if os.path.exists(OUT):
    prev = open(OUT).read()
    seen = set()
    for k in re.findall(r'^"([a-z0-9-]+)":', prev, flags=re.M):
        if k in seen:
            prev_dupes.append(k)
        seen.add(k)
if prev_dupes:
    raise SystemExit(
        f"REFUSED: {OUT} contains {len(prev_dupes)} duplicate key(s) — it has been "
        f"hand-edited and those later entries are what actually render. Regenerating "
        f"would discard them.\nFirst few: {prev_dupes[:5]}\n"
        f"Fix: write each override's value into its assets/shortcut-icons/<key>.svg, "
        f"then re-run. (See the revamp965 note at the top of this file.)")

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
