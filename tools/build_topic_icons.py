"""Build the inline topic-icon registry from Lucide.

For each topic in data/topics.json, picks a Lucide icon by content
keywords (first match wins). Downloads each unique Lucide SVG once,
extracts the inner path/circle/etc. content (so it stays compatible
with the existing `<svg stroke="currentColor">` wrapper in
topic-icons.js), and writes a generated js/utils/topic-icons.js with
the registry plus topic-slug → icon-key mapping. Also stamps each
topic's `icon` field in topics.json so the app picks up the new keys.

Run from repo root:  python3 tools/build_topic_icons.py
"""

import json
import os
import re
import sys
import urllib.request
from collections import Counter

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOPICS_JSON = os.path.join(REPO, 'data', 'topics.json')
OUT_JS = os.path.join(REPO, 'js', 'utils', 'topic-icons.js')
LUCIDE_BASE = 'https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/{}.svg'

# Ordered (substrings, lucide-icon) — first match wins. Patterns target
# the topic SLUG (lowercase, hyphenated).
RULES = [
    # Home
    (['^home$'], 'house'),

    # === Top-level parent groups ===
    (['business-finance', 'business-and-finance'], 'briefcase'),
    (['^technology$'], 'cpu'),
    (['^science$'], 'atom'),
    (['health-wellness', 'health-and-wellness'], 'heart-pulse'),
    (['^politics$'], 'landmark'),
    (['geopolit', 'world-affair', '^world$'], 'globe'),
    (['^lifestyle$'], 'sparkles'),
    (['^media$'], 'newspaper'),
    (['^sports$'], 'trophy'),
    (['climate-environment', 'climate-and-environment'], 'cloud-sun'),
    (['^entertainment$'], 'film'),
    (['^education$'], 'graduation-cap'),
    (['^ideas-opinion', '^ideas$', '^opinion$', 'philosoph'], 'lightbulb'),

    # === Business / finance subs ===
    (['banking'], 'landmark'),
    (['crypto', 'web3', 'blockchain'], 'bitcoin'),
    (['deals-ma', 'mergers', 'm-and-a'], 'handshake'),
    (['economy', 'economic'], 'chart-line'),
    (['energy-commodities', 'commodit'], 'flame'),
    (['fintech'], 'credit-card'),
    (['housing', 'real-estate'], 'house'),
    (['jobs-labor', 'labor', 'jobs'], 'briefcase'),
    (['markets'], 'trending-up'),
    (['personal-finance'], 'piggy-bank'),
    (['small-business'], 'store'),

    # === Technology subs ===
    (['artificial-intelligence', '^ai-'], 'sparkles'),
    (['ai-governance', 'ai-policy'], 'scale'),
    (['cloud-computing'], 'cloud'),
    (['consumer-electronics'], 'smartphone'),
    (['cybersecurity'], 'shield-check'),
    (['data-analytics', 'data-and-analytics'], 'database'),
    (['emerging-tech'], 'rocket'),
    (['privacy', 'data-protection'], 'lock'),
    (['programming', 'development'], 'code'),
    (['robotics', 'automation'], 'bot'),
    (['social-media'], 'message-circle'),
    (['software-saas', 'software-and-saas'], 'code'),
    (['startups', 'venture-capital'], 'rocket'),

    # === Science subs ===
    (['astronomy', 'space'], 'rocket'),
    (['chemistry', 'biology', 'genetic'], 'flask-conical'),
    (['physics'], 'atom'),
    (['research-academia', 'academia'], 'microscope'),

    # === Health subs ===
    (['fitness', 'exercise'], 'dumbbell'),
    (['healthcare-industry'], 'stethoscope'),
    (['nutrition', 'diet'], 'utensils'),
    (['medical-research', 'pharma', 'biotech'], 'pill'),
    (['public-health'], 'heart-pulse'),
    (['mental-health'], 'brain'),

    # === Politics subs ===
    (['campaigns', 'elections'], 'vote'),
    (['us-politics', 'state-politics', 'us-legislati'], 'landmark'),
    (['international-politics'], 'flag'),
    (['law-regulation', 'law-and-reg'], 'scale'),
    (['policy'], 'scroll-text'),

    # === World / geopolitics subs ===
    (['conflict', 'war'], 'swords'),
    (['defense', 'military'], 'shield'),
    (['diplomacy', 'foreign-policy'], 'flag'),
    (['immigration', 'migration'], 'plane'),
    (['humanitarian'], 'heart-handshake'),
    (['trade'], 'ship'),
    (['africa', 'european', '^europe$', 'asia', 'latin-am', 'middle-east', 'oceania', 'arctic', 'caribbean', '^us$', '^canada$', '^china$', '^india$', '^japan$', '^russia', 'russia-eastern'], 'map'),
    (['congress', 'white-house'], 'landmark'),

    # === Sports subs ===
    (['football-nfl', 'nfl', 'super-bowl', 'football'], 'trophy'),
    (['basketball', 'nba'], 'trophy'),
    (['baseball', 'mlb'], 'trophy'),
    (['hockey', 'nhl'], 'trophy'),
    (['soccer', 'mls', 'fifa'], 'trophy'),
    (['olympic'], 'medal'),
    (['tennis'], 'trophy'),
    (['golf'], 'flag-triangle-right'),
    (['combat', 'mma', 'boxing', 'ufc'], 'sword'),
    (['college-sports', 'ncaa'], 'graduation-cap'),
    (['esports'], 'gamepad-2'),
    (['fantasy', 'betting'], 'dice-5'),

    # === Entertainment subs ===
    (['film', 'movies', 'cinema'], 'film'),
    (['tv-streaming', 'tv-and-streaming', 'streaming'], 'tv'),
    (['music'], 'music'),
    (['podcast', 'radio'], 'mic'),
    (['gaming', 'video-game'], 'gamepad-2'),
    (['celebrit'], 'star'),
    (['books', 'literature'], 'book-open'),
    (['theater', 'broadway'], 'drama'),
    (['arts', 'culture', 'museum'], 'palette'),

    # === Media subs ===
    (['journalism'], 'newspaper'),
    (['advertising', 'ad-industry'], 'megaphone'),
    (['local-news'], 'newspaper'),

    # === Lifestyle subs ===
    (['travel'], 'plane'),
    (['fashion'], 'shirt'),
    (['relationship', 'dating', 'family'], 'heart'),
    (['cooking', 'food'], 'utensils'),
    (['home-design', 'interior', 'home-and'], 'sofa'),
    (['pets'], 'cat'),
    (['cars', 'autos', 'automotive'], 'car'),

    # === Climate / environment subs ===
    (['climate-policy', 'climate-science'], 'cloud-sun'),
    (['energy-transition', 'renewable'], 'sun'),
    (['wildlife', 'biodivers'], 'rabbit'),
    (['weather', 'storm'], 'cloud-rain'),
    (['oceans', 'marine'], 'droplets'),
    (['agriculture', 'food-systems'], 'wheat'),
    (['clean-energy', 'sustainability'], 'leaf'),
    (['architecture', 'design-'], 'building-2'),
    (['home-garden', 'home-and-garden', 'gardening'], 'sprout'),
    (['work-careers', 'careers-'], 'briefcase'),
    (['media-business'], 'newspaper'),

    # === Education subs ===
    (['k-12', 'k12'], 'school'),
    (['college', 'university', 'higher-ed'], 'graduation-cap'),
    (['online-learning', 'edtech'], 'monitor'),
    (['skills', 'workforce-learning'], 'list-checks'),

    # === Ideas / philosophy / religion subs ===
    (['religion'], 'book-open'),
    (['history'], 'calendar'),
    (['philosophy'], 'lightbulb'),
]

FALLBACK = 'circle-dot'

# Icons used by app.js outside the topic dataset (e.g., Custom Search,
# Prompt Generator). Force-included so topicIconSVG() can find them
# even though no topic slug maps to them.
EXTRA_ICONS = ['search', 'house', 'rocket']


def map_topic(slug):
    s = slug.lower()
    for substrs, icon in RULES:
        for needle in substrs:
            if needle.startswith('^') and needle.endswith('$'):
                if s == needle[1:-1]:
                    return icon
            elif needle.startswith('^'):
                if s.startswith(needle[1:]):
                    return icon
            elif needle in s:
                return icon
    return FALLBACK


def fetch_lucide(name):
    url = LUCIDE_BASE.format(name)
    req = urllib.request.Request(url, headers={'User-Agent': 'standard-topic-topic-icon-build'})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode('utf-8')


# Lucide SVGs wrap their content in <svg ...>...</svg>. Strip the outer
# tag so we keep just the path/circle/line/etc. inner content — the
# existing topic-icons.js renders its own <svg stroke="currentColor">
# wrapper around the inner paths.
INNER_RE = re.compile(r'<svg[^>]*>(?P<inner>.*?)</svg>', re.DOTALL)


def extract_inner(svg):
    m = INNER_RE.search(svg)
    if not m:
        raise ValueError('Could not extract inner SVG')
    inner = m.group('inner').strip()
    # Collapse whitespace and newlines for compact module output.
    inner = re.sub(r'\s+', ' ', inner)
    return inner


def main():
    with open(TOPICS_JSON) as f:
        data = json.load(f)
    topics = data['topics']

    mapping = {t['slug']: map_topic(t['slug']) for t in topics}
    unique_icons = sorted(set(mapping.values()) | set(EXTRA_ICONS))

    print(f'Topics: {len(topics)}')
    print(f'Unique Lucide icons: {len(unique_icons)}')

    icon_inners = {}
    failed = []
    for name in unique_icons:
        try:
            svg = fetch_lucide(name)
            icon_inners[name] = extract_inner(svg)
            print(f'  ✓ {name}')
        except Exception as e:
            failed.append((name, str(e)))
            print(f'  ✗ {name}: {e}')

    if failed:
        print(f'\n{len(failed)} icon(s) failed. Aborting.')
        for n, err in failed:
            print(f'  {n}: {err}')
        sys.exit(1)

    # Stamp topics.json with the new icon keys.
    for t in topics:
        t['icon'] = mapping[t['slug']]
    with open(TOPICS_JSON, 'w') as f:
        json.dump(data, f, indent=2)

    # Generate topic-icons.js. The existing module exports
    # topicIconSVG(key, className) — keep that signature so callers
    # don't change. ICONS now contains every icon used by topics.
    icons_block = ',\n  '.join(
        f"'{name}': '{inner.replace(chr(92), chr(92)*2).replace(chr(39), chr(92)+chr(39))}'"
        for name, inner in sorted(icon_inners.items())
    )

    js = f"""// AUTO-GENERATED by tools/build_topic_icons.py — do not hand-edit.
// Inline Lucide-derived SVG registry for the topic page-title icon.
// Each entry is the inner SVG content (paths/circles/etc.); the
// renderer wraps it in <svg stroke="currentColor"> so the icon
// inherits the surrounding title color.

const ICONS = {{
  {icons_block}
}};

export function topicIconSVG(key, className = 'topic-banner-icon') {{
  const inner = ICONS[key] || ICONS['circle-dot'];
  return `<span class="${{className}}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${{inner}}</svg></span>`;
}}

export function hasTopicIcon(key) {{ return key in ICONS; }}
"""

    with open(OUT_JS, 'w') as f:
        f.write(js)

    # Summary
    counts = Counter(mapping.values())
    fallbacks = [s for s, i in mapping.items() if i == FALLBACK]
    print(f'\nWrote {OUT_JS}')
    print(f'Updated topics.json icon fields')
    print(f'\nTop 10 icons by usage:')
    for name, n in counts.most_common(10):
        print(f'  {n:3}  {name}')
    print(f'\n{len(fallbacks)} topic(s) fell back to "{FALLBACK}":')
    for s in fallbacks[:30]:
        print(f'  {s}')


if __name__ == '__main__':
    main()
