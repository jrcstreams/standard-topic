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
# Only compute this if evergreenOrder is not already written (idempotency: ref_pre
# would be empty after the first run strips the file, corrupting the order).
if "evergreenOrder" not in asg_doc:
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
else:
    evergreen_order = asg_doc["evergreenOrder"]

# 4) Initialize exclusions if absent.
asg_doc.setdefault("evergreenExclusions", {})

json.dump(directory, open(DIR, "w"), ensure_ascii=False, indent=2)
json.dump(asg_doc, open(ASG, "w"), ensure_ascii=False, indent=2)

# Report
by_group = Counter(by_id[i]["group"] for i in evergreen_ids)
print("evergreen by group:", dict(by_group))
print("evergreenOrder (first 8):", evergreen_order[:8])
print("done.")
