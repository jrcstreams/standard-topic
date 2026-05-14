"""Populate assets/shortcut-icons/ with Lucide SVGs mapped from shortcut keys.

For each shortcut key in data/shortcuts-directory.json, picks a Lucide icon
based on content keywords (first match wins), downloads the SVG once per
unique icon name, recolors the stroke to #385c95, and writes one SVG per
shortcut key. Also emits a manifest of the key→icon mapping.

Run from repo root:  python3 tools/build_icons.py
"""

import json
import os
import re
import sys
import urllib.request
from collections import Counter

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS_DIR = os.path.join(REPO, 'assets', 'shortcut-icons')
MANIFEST = os.path.join(REPO, 'assets', 'shortcut-icons-mapping.json')
DIRECTORY = os.path.join(REPO, 'data', 'shortcuts-directory.json')
COLOR = '#385c95'
LUCIDE_BASE = 'https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/{}.svg'

# Ordered patterns. Each entry: (list_of_substrings, lucide_icon).
# First entry whose substring is found in the key wins. Order matters —
# put more specific terms before generic ones.
RULES = [
    # === AI & technology ===
    (['ai-', 'artificial-intelli', 'llm', 'machine-learning', 'neural-', 'gen-ai', 'agentic'], 'sparkles'),
    (['coding', 'developer', 'programming', 'devops', 'open-source', 'github', 'software-engineer'], 'code'),
    (['cybersecurity', 'cyber-', 'breach', 'hacking', 'zero-day', 'malware', 'ransomware'], 'shield-check'),
    (['cloud-comput', 'kubernetes', 'serverless', 'aws-', 'azure-', 'saas'], 'cloud'),
    (['data-stack', 'data-analytics', 'database', 'big-data', 'data-engineer', 'warehouse'], 'database'),
    (['privacy', 'encryption', 'gdpr', 'data-protection'], 'lock'),
    (['network-', 'infrastructure', '5g-', 'connectivity', 'fiber-'], 'network'),
    (['robotics', 'automation-', 'autonomous-', 'robot-'], 'bot'),
    (['semiconductor', 'silicon-', 'chip-', 'hardware-'], 'cpu'),
    (['blockchain', 'crypto', 'web3', 'bitcoin', 'defi', 'nft', 'ethereum'], 'bitcoin'),
    (['social-media', 'tiktok', 'twitter', 'instagram', 'meta-platforms', 'facebook'], 'message-circle'),
    (['consumer-electronics', 'gadget', 'apple-', 'iphone-', 'android-'], 'smartphone'),

    # === Finance & business ===
    (['interest-rate', 'fed-rate', 'fomc', 'inflation', 'cpi-', 'pce-', 'rate-watch'], 'percent'),
    (['earnings', 'stock-', 'market-', 'wall-street', 'index-', 'futures-', 'commodit'], 'trending-up'),
    (['bank-', 'banking', 'deposit-', 'lending', 'fdic', 'credit-union'], 'landmark'),
    (['fintech', 'payment-', 'venmo', 'paypal', 'stripe'], 'credit-card'),
    (['m-and-a', 'mergers', 'acquisition', 'deals-ma', 'ipo-', 'spac-'], 'handshake'),
    (['economy', 'gdp-', 'recession', 'economic-indicator', 'business-day'], 'chart-line'),
    (['jobs', 'labor', 'employment', 'unemployment', 'hiring', 'layoff', 'workforce'], 'briefcase'),
    (['startup', 'venture-cap', 'vc-', 'entrepre', 'founder', 'unicorn'], 'rocket'),
    (['small-business', 'main-street'], 'store'),
    (['personal-finance', 'savings', 'retirement', '401k', 'taxes-', 'budget'], 'piggy-bank'),
    (['housing', 'real-estate', 'mortgage', 'rent-', 'homebuyer'], 'house'),
    (['e-commerce', 'retail-', 'consumer-spending', 'shopping'], 'shopping-cart'),
    (['advertising', 'ad-industry', 'marketing-', 'brand-'], 'megaphone'),
    (['oil-', 'gas-', 'opec', 'energy-market', 'energy-commodities', 'energy-policy'], 'flame'),
    (['supply-chain', 'logistics', 'shipping-'], 'truck'),
    (['tariff', 'trade-', 'wto-', 'imports-', 'exports-'], 'ship'),
    (['ceo-', 'executive-', 'big-company', 'fortune-500', 'corporate-'], 'building-2'),
    (['activist-investor', 'hedge-fund', 'private-equity', 'institutional-'], 'briefcase'),

    # === Politics & government ===
    (['election', 'campaign', 'primary-', 'polling', 'voter', 'ballot'], 'vote'),
    (['white-house', 'president', 'administration', 'cabinet'], 'landmark'),
    (['congress', 'senate', 'house-of-rep', 'legislati', 'lawmaker'], 'landmark'),
    (['supreme-court', 'judicial', 'court-', 'ruling-', 'judge-', 'scotus', 'explain-this-case'], 'gavel'),
    (['regulation', 'compliance', 'antitrust', 'law-', 'legal-'], 'scale'),
    (['policy', 'reform-', 'bill-', 'legislation'], 'scroll-text'),
    (['diplomacy', 'embassy', 'state-department', 'ambassador'], 'flag'),
    (['lobby', 'pac-', 'donor-', 'fundrais'], 'banknote'),

    # === World & geopolitics ===
    (['geopolit', 'global-', 'international-', 'multilateral', 'world-affair', 'foreign-'], 'globe'),
    (['active-conflict', 'war-', 'ceasefire', 'battle-'], 'swords'),
    (['military', 'defense-', 'pentagon', 'weapons'], 'shield'),
    (['terror', 'extrem', 'insurgenc', 'jihad'], 'shield-alert'),
    (['nato', 'un-', 'eu-', 'g7-', 'g20-', 'imf-'], 'flag'),
    (['africa', 'african', 'european', 'asia', 'asian', 'latin-am', 'middle-east', 'oceania', 'arctic', 'caribbean'], 'map'),
    (['immigration', 'migration', 'refugee', 'asylum', 'border-'], 'plane'),
    (['humanitarian', 'aid-', 'famine-', 'crisis-'], 'heart-handshake'),
    (['sanction-', 'sanctions-'], 'ban'),
    (['country-deep-dive'], 'map'),

    # === Health & wellness ===
    (['fitness', 'exercise', 'workout', 'cardio', 'strength-training', 'gym-'], 'dumbbell'),
    (['nutrition', 'diet', 'meal-', 'recipe'], 'utensils'),
    (['mental-health', 'therapy', 'depression', 'anxiety', 'mindful', 'psycho'], 'brain'),
    (['pharma', 'biotech', 'drug-', 'fda-', 'clinical-trial', 'prescription'], 'pill'),
    (['vaccine', 'immuniz'], 'syringe'),
    (['cancer-', 'oncology', 'tumor-'], 'heart'),
    (['public-health', 'cdc-', 'who-', 'pandem', 'epidemic', 'outbreak', 'disease'], 'heart-pulse'),
    (['healthcare-industry', 'hospital', 'insurance-', 'medicare', 'medicaid'], 'stethoscope'),
    (['sleep-', 'rest-', 'longevity'], 'moon'),
    (['wellness-', 'self-care', 'wellbeing'], 'heart'),

    # === Science ===
    (['physics', 'particle-', 'quantum', 'condensed-matter', 'cosmolog', 'astrophysi'], 'atom'),
    (['astronomy', 'space-', 'nasa-', 'satellite', 'mars-', 'moon-', 'spacex'], 'rocket'),
    (['chemistry', 'molecul', 'compound-', 'reaction-'], 'flask-conical'),
    (['biology', 'genetics', 'genome', 'crispr', 'dna-', 'rna-'], 'dna'),
    (['research-', 'academ', 'phd-', 'peer-review', 'science-recent', 'science-snap', 'scientific'], 'microscope'),
    (['scientific-discover'], 'sparkles'),

    # === Climate & environment ===
    (['climate', 'global-warming', 'carbon-', 'emissions', 'net-zero'], 'cloud-sun'),
    (['environment', 'sustainab', 'green-', 'eco-', 'pollution'], 'leaf'),
    (['weather', 'storm-', 'hurricane', 'tornado', 'flood-', 'drought-', 'wildfire'], 'cloud-rain'),
    (['wildlife', 'animal-', 'biodivers', 'species-', 'conservation-'], 'rabbit'),
    (['ocean-', 'marine-', 'coral-', 'reef-'], 'droplets'),
    (['renewable', 'solar-', 'wind-', 'hydropower', 'geothermal'], 'sun'),

    # === Sports ===
    (['nfl-', 'football-', 'super-bowl', 'gridiron'], 'trophy'),
    (['nba-', 'basketball', 'wnba-', 'playoffs-nba'], 'trophy'),
    (['mlb-', 'baseball', 'world-series'], 'trophy'),
    (['nhl-', 'hockey', 'stanley-cup'], 'trophy'),
    (['soccer-', 'mls-', 'fifa-', 'world-cup', 'premier-league', 'la-liga'], 'trophy'),
    (['olympic', 'world-champion'], 'medal'),
    (['tennis-', 'wimbledon', 'us-open-tennis', 'french-open', 'atp-', 'wta-'], 'trophy'),
    (['golf-', 'pga-', 'masters-tournament', 'ryder-cup'], 'flag-triangle-right'),
    (['boxing-', 'mma-', 'ufc-', 'wrestling'], 'sword'),
    (['esports', 'gaming-leagues', 'twitch-'], 'gamepad-2'),
    (['fantasy-sports', 'sports-betting', 'odds-'], 'dice-5'),
    (['power-rankings', 'power-ranking', 'standings-', 'sports-snapshot', 'sports-roundup', 'sports-headlines'], 'trophy'),
    (['college-football', 'college-basketball', 'ncaa-'], 'graduation-cap'),

    # === Entertainment ===
    (['film-', 'movie-', 'oscar-', 'cannes-', 'box-office', 'hollywood'], 'film'),
    (['tv-', 'streaming', 'netflix', 'hbo', 'emmy', 'series-'], 'tv'),
    (['music-', 'album-', 'concert-', 'tour-', 'grammy', 'songwrit', 'billboard'], 'music'),
    (['podcast', 'radio-'], 'mic'),
    (['gaming-', 'video-game', 'console-', 'game-launch', 'xbox-', 'playstation', 'nintendo'], 'gamepad-2'),
    (['celebrit', 'red-carpet', 'awards-show', 'a-list'], 'star'),
    (['book-', 'literature', 'novel-', 'reading-list', 'publishing'], 'book-open'),
    (['theater', 'broadway-', 'play-pre', 'opera-'], 'drama'),
    (['arts-', 'culture-', 'museum-', 'exhibit', 'gallery-'], 'palette'),
    (['journalism', 'media-news', 'newsroom', 'press-freedom'], 'newspaper'),

    # === Education ===
    (['k-12', 'k12', 'school-district', 'students-', 'teachers-', 'curriculum', 'public-school'], 'school'),
    (['college-', 'university-', 'higher-ed', 'academ', 'admissions', 'tuition'], 'graduation-cap'),
    (['online-learning', 'edtech', 'mooc'], 'monitor'),
    (['math-', 'science-education', 'stem-'], 'calculator'),
    (['reading-', 'writing-', 'literacy'], 'pencil'),
    (['student-debt', 'loan-forgiveness'], 'piggy-bank'),

    # === Lifestyle ===
    (['travel-', 'tourism', 'destinat', 'airline-', 'flight-'], 'plane'),
    (['fashion-', 'beauty-', 'cosmet', 'style-'], 'shirt'),
    (['parenting', 'family-', 'kids-', 'children-'], 'baby'),
    (['relationship', 'dating', 'marriage', 'couples'], 'heart'),
    (['cooking-', 'recipe-', 'restaurant-', 'food-trend'], 'utensils'),
    (['home-', 'interior-', 'decor-', 'design-trend'], 'sofa'),
    (['pets-', 'dog-', 'cat-'], 'cat'),
    (['holiday-', 'gift-', 'christmas', 'thanksgiving', 'hanukkah'], 'gift'),
    (['lifestyle-', 'self-improvement'], 'sparkles'),
    (['automotive', 'auto-', 'ev-', 'car-', 'electric-vehicle'], 'car'),

    # === Generic / structural patterns (catch-all by phrasing) ===
    (['breaking-news', 'breaking-', 'live-update'], 'zap'),
    (['watch'], 'eye'),
    (['tracker', 'monitor-'], 'activity'),
    (['headlines', 'news-snapshot', 'top-stories', 'roundup', 'recap-', 'latest-news', 'news-'], 'newspaper'),
    (['risks', 'warning', 'red-flags', 'concerns', 'worries', 'vulnerabilit', 'threat-'], 'triangle-alert'),
    (['trends', 'momentum-', 'pulse-', 'on-the-rise', 'biggest-movers', 'investing'], 'trending-up'),
    (['glossary', 'definitions', 'terms-explained', 'key-terms'], 'book'),
    (['key-players', 'leaders-to-watch', 'who-to-know', 'movers-and-shakers'], 'users'),
    (['deep-dive', 'breakdown', 'in-depth', 'check'], 'search'),
    (['how-this-affects', 'affects-me', 'impact-on-you', 'matters-to-me'], 'target'),
    (['industry-deep-dive', 'industry-', 'sector-'], 'briefcase'),
    (['on-this-day', 'on-this-week', 'history', 'this-day-in', 'this-week-', 'this-weekend', 'calendar', 'historical', 'historiograph'], 'calendar'),
    (['numbers-in-news', 'by-the-numbers', 'stats-', 'statistic'], 'chart-column'),
    (['hotspots', 'developments', 'updates-'], 'map-pin'),
    (['report-', 'overview', 'snapshot'], 'file-text'),
    (['outlook', 'forecast-', 'what-to-watch', 'looking-ahead'], 'compass'),
    (['big-tech', 'magnificent-7', 'magnificent-seven'], 'building-2'),

    # === Long-tail money / finance patterns ===
    (['credit-card', 'best-credit-card'], 'credit-card'),
    (['deals'], 'handshake'),
    (['tax-', 'taxes'], 'receipt'),
    (['wage', 'salary', 'pay-gap', 'inequality'], 'coins'),
    (['gold-', 'precious-metals', 'silver-'], 'coins'),
    (['payments-industry', 'embedded-finance', 'neobank', 'consumer-credit', 'finance-tools'], 'credit-card'),
    (['tokeniz', 'rwa-'], 'coins'),
    (['funding-roundup', 'funding-round', 'fundrais', 'capital-raise'], 'coins'),
    (['cloud-', 'distributed-cloud'], 'cloud'),

    # === Long-tail tech patterns ===
    (['product-launch', 'new-product', 'new-model-release', 'wearable'], 'rocket'),
    (['best-tech-deals'], 'handshake'),
    (['critical-vulnerab', 'personal-security'], 'shield-alert'),
    (['data-quality', 'observability', 'data-tool'], 'database'),
    (['brain-computer'], 'cpu'),
    (['nuclear-fusion', 'fusion-progress', 'fusion-energy', 'fusion-'], 'atom'),
    (['language-and-framework', 'tech-stack', 'pick-a-tech', 'pick-software', 'enterprise-software'], 'code'),
    (['humanoid', 'robot'], 'bot'),

    # === Long-tail science / health patterns ===
    (['gene-editing', 'genomics', 'genom'], 'dna'),
    (['science-funding', 'science-hype', 'science-politics'], 'flask-conical'),
    (['universities-politics', 'universities-in-the-news', 'healthcare-politics', 'science-politics-'], 'graduation-cap'),
    (['health-condition', 'consumer-health-check', 'health-disparit'], 'stethoscope'),
    (['recovery', 'training-as', 'endurance-training', 'protein-', 'supplements', 'eating-plan', 'coaching-athlete', 'athlete'], 'dumbbell'),
    (['major-trial', 'clinical-readout', 'trial-readout', 'substance-use', 'overdose', 'addiction'], 'pill'),
    (['respiratory-virus', 'vaccination-landscape', 'flu-season'], 'syringe'),

    # === Long-tail politics / world patterns ===
    (['political-calendar', 'this-week-in-washington', 'diplomatic-calendar'], 'calendar'),
    (['most-consequential', 'consequental'], 'star'),
    (['voting-rights', 'electoral-map', 'electoral-'], 'vote'),
    (['major-regulatory', 'regulatory-'], 'scale'),
    (['state-ag', 'state-politics', 'state-attorney'], 'landmark'),
    (['us-china', 'us-russia', 'strategic-competition'], 'globe'),
    (['inside-the-parties', 'political-movements', 'media-narratives', 'spotlight'], 'megaphone'),
    (['underreported', 'around-the-world'], 'globe'),
    (['sahel', 'japan-', 'canada-', 'uk-', 'india-', 'russia', 'ukraine', 'belarus', 'moldova', 'far-right', 'far-left', 'brexit'], 'map'),

    # === Long-tail sports patterns ===
    (['ncaa', 'bracketology', 'top-25', 'coaching-carousel'], 'trophy'),
    (['combat-', 'fight-card', 'pound-for-pound', 'title-picture'], 'sword'),
    (['stat-leaders', 'this-weekends'], 'trophy'),

    # === Long-tail lifestyle / personal patterns ===
    (['forests', 'land-use', 'rewilding'], 'leaf'),
    (['hydrogen', 'clean-tech', 'clean-energy'], 'zap'),
    (['architecture', 'urbanism', 'industrial-product-design'], 'building-2'),
    (['cultural-moment', 'cultural-highlights', 'suggested-entertainment'], 'sparkles'),
    (['books-', 'long-reads', 'reading-list', 'what-should-i-read', 'new-releases-worth-reading'], 'book-open'),
    (['streetwear', 'sneaker', 'wardrobe'], 'shirt'),
    (['cook-tonight', 'what-should-i-cook'], 'utensils'),
    (['cars-best', 'best-evs', 'help-me-pick-a-car', 'maintenance-ownership'], 'car'),
    (['garden', 'smart-home', 'renovate', 'energy-efficiency-upgrade'], 'wrench'),
    (['friendship', 'working-through-conflict'], 'users'),
    (['where-should-i-go', 'plan-my-trip', 'plan-a-local-getaway', 'getaway'], 'plane'),
    (['career-', 'resume-', 'salary-negotiation', 'workplace-', 'manager-leadership', 'job-search', 'remote-work'], 'briefcase'),
    (['audience-distribution', 'local-news-crisis'], 'newspaper'),
    (['build-my-learning', 'learning-plan', 'skills-based', 'tools-to-learn', 'best-tools-to-learn'], 'graduation-cap'),

    # === Ideas, opinion, philosophy, religion ===
    (['ideas-', 'opinion-', 'philosoph'], 'lightbulb'),
    (['moral-', 'ethical-', 'help-with-ethical'], 'scale'),
    (['religion', 'religious'], 'book-open'),

    # === Catch-all utility phrasings ===
    (['help-pick', 'help-me-pick', 'pick-a-', 'pick-software'], 'list-checks'),
    (['where-to-follow', 'catch-me-up', 'beginners-guide', 'beginner-guide', 'how-we-got-here', 'myths-vs-reality', 'myths-vs', 'primer'], 'lightbulb'),
    (['build-my-', 'build-a-', 'set-up-my'], 'wrench'),
    (['help'], 'info'),
]

FALLBACK = 'circle-dot'


def map_key(key):
    """Return the Lucide icon name for a shortcut key."""
    k = key.lower()
    for substrs, icon in RULES:
        for s in substrs:
            if s in k:
                return icon
    return FALLBACK


def fetch_lucide(name):
    url = LUCIDE_BASE.format(name)
    req = urllib.request.Request(url, headers={'User-Agent': 'standard-topic-icon-build'})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode('utf-8')


def recolor(svg):
    # Replace currentColor with our brand color in stroke/fill.
    out = svg.replace('"currentColor"', f'"{COLOR}"')
    out = out.replace("'currentColor'", f"'{COLOR}'")
    return out


def main():
    with open(DIRECTORY) as f:
        directory = json.load(f)
    shortcuts = directory['shortcuts']

    # Build key → icon mapping
    mapping = {}
    for s in shortcuts:
        mapping[s['id']] = map_key(s['id'])

    unique_icons = sorted(set(mapping.values()))
    print(f'Shortcut keys: {len(mapping)}')
    print(f'Unique Lucide icons needed: {len(unique_icons)}')

    # Fetch each unique icon once
    icon_svgs = {}
    failed = []
    for name in unique_icons:
        try:
            icon_svgs[name] = recolor(fetch_lucide(name))
            print(f'  ✓ {name}')
        except Exception as e:
            failed.append((name, str(e)))
            print(f'  ✗ {name}: {e}')

    if failed:
        print(f'\n{len(failed)} icon(s) failed to download. Aborting before writing.')
        for n, err in failed:
            print(f'  {n}: {err}')
        sys.exit(1)

    # Wipe shortcut-icons and re-populate
    for fn in os.listdir(ICONS_DIR):
        if fn.endswith('.svg'):
            os.remove(os.path.join(ICONS_DIR, fn))

    for key, icon_name in mapping.items():
        with open(os.path.join(ICONS_DIR, f'{key}.svg'), 'w') as f:
            f.write(icon_svgs[icon_name])

    # Manifest
    with open(MANIFEST, 'w') as f:
        json.dump({'color': COLOR, 'mapping': mapping}, f, indent=2)

    # Usage stats
    counts = Counter(mapping.values())
    fallback_keys = [k for k, v in mapping.items() if v == FALLBACK]
    print(f'\nWrote {len(mapping)} SVGs to {ICONS_DIR}')
    print(f'Manifest: {MANIFEST}')
    print(f'\nTop 10 icons by usage:')
    for name, n in counts.most_common(10):
        print(f'  {n:4}  {name}')
    print(f'\n{len(fallback_keys)} key(s) fell back to "{FALLBACK}":')
    for k in fallback_keys[:25]:
        print(f'  {k}')
    if len(fallback_keys) > 25:
        print(f'  ... and {len(fallback_keys)-25} more')


if __name__ == '__main__':
    main()
