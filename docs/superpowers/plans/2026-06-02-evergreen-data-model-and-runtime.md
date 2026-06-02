# Evergreen Data Model + Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all 34 evergreen shortcuts one unified family that auto-appears on every topic + custom search (minus per-topic exclusions, in one global order), and remove the ~1,485 duplicated assignment rows — without changing the public site's appearance beyond the intended ordering.

**Architecture:** A one-off Python migration promotes the 15 still-duplicated universal shortcuts to `evergreen: true`, strips all 34 evergreens out of every topic + `_custom` assignment array (home untouched), and writes a global `evergreenOrder` plus an empty `evergreenExclusions` map into `shortcuts-assignments.json`. The runtime selection logic in `js/utils/data.js` is refactored into a pure, Node-testable `selectShortcutsForTopic(...)` that appends evergreens (ordered, minus exclusions) after a topic's own shortcuts.

**Tech Stack:** Vanilla ES modules (browser), Python 3 (migration), Node 18+ (`node:assert` test scripts), Playwright (integration spot-check). No test framework in repo — tests are standalone Node scripts under `tools/`.

This plan covers spec Phase 1 only. Phases 2–5 (admin redesign) are a separate plan.

---

### Task 1: Pure, testable shortcut selector in `data.js`

Extract the topic→shortcuts selection into a pure function that takes all data
explicitly (so it runs in Node with no fetch/DOM), supporting evergreen ordering and
per-topic exclusions. Rewire the existing `getShortcutsForTopic` to call it.

**Files:**
- Modify: `js/utils/data.js` (the `getShortcutsForTopic` block, currently ~line 114)
- Create: `tools/test_select_shortcuts.mjs`

- [ ] **Step 1: Write the failing test**

Create `tools/test_select_shortcuts.mjs`:

```javascript
import assert from 'node:assert/strict';
import { selectShortcutsForTopic } from '../js/utils/data.js';

const directory = [
  { id: 'ts-a', name: 'TS A', group: 'discover' },
  { id: 'ts-b', name: 'TS B', group: 'learn' },
  { id: 'ev-1', name: 'EV 1', group: 'discover', evergreen: true },
  { id: 'ev-2', name: 'EV 2', group: 'learn', evergreen: true },
  { id: 'ev-3', name: 'EV 3', group: 'analyze', evergreen: true },
];
const assignments = { topic1: ['ts-a', 'ts-b'], _custom: ['ts-a'], home: ['ts-a', 'ev-1'] };
const evergreenOrder = ['ev-2', 'ev-1', 'ev-3']; // deliberately not directory order
const evergreenExclusions = { topic1: ['ev-3'] };

// Topic: own shortcuts first (assignment order), then evergreens in evergreenOrder,
// minus the excluded one (ev-3).
const t = selectShortcutsForTopic({ directory, assignments, evergreenOrder, evergreenExclusions, topicSlug: 'topic1' });
assert.deepEqual(t.map(s => s.id), ['ts-a', 'ts-b', 'ev-2', 'ev-1']);

// Custom search: falls back to _custom assignment, gets all evergreens (no exclusions).
const c = selectShortcutsForTopic({ directory, assignments, evergreenOrder, evergreenExclusions, topicSlug: '_custom' });
assert.deepEqual(c.map(s => s.id), ['ts-a', 'ev-2', 'ev-1', 'ev-3']);

// Home: NO evergreen injection; only its explicit list (ev-1 here is explicit, not injected).
const h = selectShortcutsForTopic({ directory, assignments, evergreenOrder, evergreenExclusions, topicSlug: 'home' });
assert.deepEqual(h.map(s => s.id), ['ts-a', 'ev-1']);

// Dedup: an evergreen also listed explicitly in a topic isn't duplicated.
const dd = selectShortcutsForTopic({ directory, assignments: { topicX: ['ev-1'] }, evergreenOrder, evergreenExclusions: {}, topicSlug: 'topicX' });
assert.deepEqual(dd.map(s => s.id), ['ev-1', 'ev-2', 'ev-3']);

console.log('OK: selectShortcutsForTopic');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tools/test_select_shortcuts.mjs`
Expected: FAIL — `SyntaxError: ... does not provide an export named 'selectShortcutsForTopic'` (or an import error referencing it).

- [ ] **Step 3: Write minimal implementation**

In `js/utils/data.js`, replace the current `getShortcutsForTopic` function (the whole
block from `export function getShortcutsForTopic(topicSlug) {` through its closing `}`)
with:

```javascript
// Pure selector — all inputs explicit so it runs under Node with no DOM/fetch.
// Topic-specific shortcuts first (assignment order), then evergreen shortcuts in
// the global evergreenOrder, minus this topic's exclusions. Home gets no evergreen
// injection (it has no single topic for the {topic} placeholder). Deduped by id.
export function selectShortcutsForTopic({ directory, assignments, evergreenOrder, evergreenExclusions, topicSlug }) {
  const dirMap = {};
  (directory || []).forEach(s => { dirMap[s.id] = s; });
  const ids = (assignments && (assignments[topicSlug] || assignments['_custom'])) || [];
  const list = ids.map(id => dirMap[id]).filter(Boolean);

  if (topicSlug !== 'home') {
    const have = new Set(list.map(s => s.id));
    const excluded = new Set((evergreenExclusions && evergreenExclusions[topicSlug]) || []);
    const orderIdx = new Map((evergreenOrder || []).map((id, i) => [id, i]));
    const evergreens = (directory || [])
      .filter(s => s.evergreen && !have.has(s.id) && !excluded.has(s.id))
      .sort((a, b) => (orderIdx.has(a.id) ? orderIdx.get(a.id) : 1e9) - (orderIdx.has(b.id) ? orderIdx.get(b.id) : 1e9));
    evergreens.forEach(s => { list.push(s); have.add(s.id); });
  }
  return list;
}

export function getShortcutsForTopic(topicSlug) {
  return selectShortcutsForTopic({
    directory: shortcutsDirectory?.shortcuts || [],
    assignments: shortcutsAssignments?.assignments || {},
    evergreenOrder: shortcutsAssignments?.evergreenOrder || [],
    evergreenExclusions: shortcutsAssignments?.evergreenExclusions || {},
    topicSlug,
  });
}

export function getEvergreenOrder() {
  return shortcutsAssignments?.evergreenOrder || [];
}

export function getEvergreenExclusions() {
  return shortcutsAssignments?.evergreenExclusions || {};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tools/test_select_shortcuts.mjs`
Expected: `OK: selectShortcutsForTopic`

- [ ] **Step 5: Syntax-check the module**

Run: `node --check js/utils/data.js`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add js/utils/data.js tools/test_select_shortcuts.mjs
git commit -m "Add pure selectShortcutsForTopic with evergreen order + exclusions"
```

---

### Task 2: Migration script — promote the 15, strip 34, write order + exclusions

**Files:**
- Create: `tools/migrate_evergreen.py`
- Modify (via run): `data/shortcuts-directory.json`, `data/shortcuts-assignments.json`

- [ ] **Step 1: Write the migration script**

Create `tools/migrate_evergreen.py`:

```python
"""Promote the still-duplicated universal shortcuts to evergreen, strip all
evergreens out of topic + _custom assignment arrays (home untouched), and write
evergreenOrder + evergreenExclusions. Idempotent. Asserts total evergreen == 34."""
import json
from collections import Counter

ROOT = "/Users/johnchoudhari/Desktop/standard-topic"
DIR = f"{ROOT}/data/shortcuts-directory.json"
ASG = f"{ROOT}/data/shortcuts-assignments.json"
GROUP_ORDER = {"discover": 0, "learn": 1, "analyze": 2, "more": 3, "topic-specific": 4}
REFERENCE_TOPIC = "business-finance"  # carries the intended within-group order of the 15

directory = json.load(open(DIR))
asg_doc = json.load(open(ASG))
shortcuts = directory["shortcuts"]
by_id = {s["id"]: s for s in shortcuts}
assignments = asg_doc["assignments"]

topics = [slug for slug in assignments if slug not in ("home", "_custom")]
n_topics = len(topics)

# 1) Promote: any shortcut assigned to EVERY topic and not already evergreen.
counts = Counter()
for slug in topics:
    for sid in assignments[slug]:
        counts[sid] += 1
promote = [sid for sid, c in counts.items() if c == n_topics and not by_id.get(sid, {}).get("evergreen")]
for sid in promote:
    by_id[sid]["evergreen"] = True
print(f"promoted {len(promote)} shortcuts to evergreen")

evergreen_ids = [s["id"] for s in shortcuts if s.get("evergreen")]
assert len(evergreen_ids) == 34, f"expected 34 evergreen, got {len(evergreen_ids)}"
eg = set(evergreen_ids)

# 2) Strip evergreens from every topic + _custom array (NOT home).
stripped = 0
for slug, ids in assignments.items():
    if slug == "home":
        continue
    new = [i for i in ids if i not in eg]
    stripped += len(ids) - len(new)
    assignments[slug] = new
print(f"stripped {stripped} evergreen entries from topic/_custom arrays")

# 3) Build evergreenOrder: group order, then within a group the promoted ones in
#    their REFERENCE_TOPIC order, then the rest in directory order.
# Reference array was just stripped of evergreens in memory; re-read the file from
# disk (not yet written) to recover the pre-strip order of the promoted 15.
ref_pre = {sid: i for i, sid in enumerate(json.load(open(ASG))["assignments"].get(REFERENCE_TOPIC, []))}
dir_index = {s["id"]: i for i, s in enumerate(shortcuts)}

def sort_key(sid):
    s = by_id[sid]
    in_ref = ref_pre.get(sid, None)
    return (
        GROUP_ORDER.get(s.get("group"), 9),
        0 if in_ref is not None else 1,
        in_ref if in_ref is not None else dir_index[sid],
    )

evergreen_order = sorted(evergreen_ids, key=sort_key)
asg_doc["evergreenOrder"] = evergreen_order

# 4) Initialize exclusions if absent.
asg_doc.setdefault("evergreenExclusions", {})

json.dump(directory, open(DIR, "w"), ensure_ascii=False, indent=2)
json.dump(asg_doc, open(ASG, "w"), ensure_ascii=False, indent=2)

# Report
by_group = Counter(by_id[i]["group"] for i in evergreen_ids)
print("evergreen by group:", dict(by_group))
print("evergreenOrder (first 8):", evergreen_order[:8])
print("done.")
```

- [ ] **Step 2: Run the migration and verify output**

Run: `python3 tools/migrate_evergreen.py`
Expected output includes:
- `promoted 15 shortcuts to evergreen`
- `stripped 1485 evergreen entries from topic/_custom arrays` (≈; the exact number may differ by a few if `_custom` held fewer — accept any value > 1400)
- `evergreen by group: {'discover': 6, 'learn': 17, 'analyze': 11}`
- No `AssertionError`.

If the assertion fails (total ≠ 34), STOP — do not commit; the roster drifted and needs review.

- [ ] **Step 3: Validate JSON + spot-check a topic's resulting list**

Run:
```bash
python3 -c "import json; json.load(open('data/shortcuts-directory.json')); json.load(open('data/shortcuts-assignments.json')); print('json ok')"
python3 -c "
import json
a=json.load(open('data/shortcuts-assignments.json'))
print('evergreenOrder len:', len(a['evergreenOrder']))
print('business-finance topic-specific count:', len(a['assignments']['business-finance']))
print('discover evergreens in order:', [x for x in a['evergreenOrder'] if x in ('latest-news','latest-research-reports','trends','what-just-changed','the-cutting-edge','recent-milestones')])
"
```
Expected: `json ok`; `evergreenOrder len: 34`; business-finance topic-specific count is small (≈6); discover order shows `latest-news` then `latest-research-reports` then `trends` (Latest Research second, preserving the prior intent) followed by the three newer discover ids.

- [ ] **Step 4: Commit**

```bash
git add tools/migrate_evergreen.py data/shortcuts-directory.json data/shortcuts-assignments.json
git commit -m "Migrate: unify 34 evergreens (promote 15, strip dupes, add order+exclusions)"
```

---

### Task 3: Integration verification in the browser

Confirm the live selection renders identically in spirit: topic-specific first, then
evergreens, home unchanged, no console errors.

**Files:** none (verification only)

- [ ] **Step 1: Serve the site**

Run: `(python3 -m http.server 8753 >/tmp/st.log 2>&1 &) ; sleep 1 ; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8753/`
Expected: `200`

- [ ] **Step 2: Verify a topic page (fresh browser context, cache disabled)**

Use Playwright to load `http://localhost:8753/#/topic/fintech`, open the Discover/
Learn/Analyze accordions, and collect each section's shortcut names plus any
`pageerror`s. Expected: each section lists its topic-specific shortcut(s) FIRST, then
the evergreens; Discover begins with `Latest News and Developments`,
`Latest Research and Reports`, `Trends to Watch`; zero console/page errors.

- [ ] **Step 3: Verify custom search + home**

Load `http://localhost:8753/#/custom/photosynthesis` — expect the same evergreens
present (Discover/Learn/Analyze populated). Load `http://localhost:8753/#/` (home) —
expect its curated feed unchanged and NOT padded with the 34 evergreens. Zero errors.

- [ ] **Step 4: Stop the server**

Run: `pkill -f "http.server 8753"`

- [ ] **Step 5: Commit (if any verification tweak was needed)**

No code change expected. If a defect surfaced, fix in `js/utils/data.js`, re-run Task 1's
test (`node tools/test_select_shortcuts.mjs`), then commit with a descriptive message.

---

## Self-Review Notes

- **Spec coverage (Phase 1):** evergreen flag on 15 (Task 2), `evergreenOrder` +
  `evergreenExclusions` (Task 2), strip from topic/`_custom` arrays with home untouched
  (Task 2), runtime ordering "topic-specific then evergreen, minus exclusions" (Task 1),
  total-is-34 assertion (Task 2 Step 2), site renders unchanged except intended order
  (Task 3). Admin tabs / Web Sources / Prompt Generator are intentionally out of scope
  (separate plan).
- **Type consistency:** `selectShortcutsForTopic({ directory, assignments,
  evergreenOrder, evergreenExclusions, topicSlug })` signature is identical in the test
  (Task 1 Step 1) and implementation (Task 1 Step 3). JSON keys `evergreenOrder` /
  `evergreenExclusions` match between migration (Task 2) and getters (Task 1).
- **No placeholders:** all code is complete and runnable.
