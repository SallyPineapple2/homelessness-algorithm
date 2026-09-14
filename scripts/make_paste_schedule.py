"""
Build the paste schedule for the AI arm: a smaller, balanced design that is
pasted by hand into the free Claude, ChatGPT, and Gemini chat apps.

The full design (scripts/make_schedule.py) gives every base profile all 100
conditions, which would mean 100 pastes per app. This design gives every
profile 20 conditions, chosen so each factor can still be tested on its own:

  * gender x race x disclosure is fully crossed (2 x 5 x 2 = 20 runs), so every
    race vs. White, Female vs. Male, and disclosure comparison pairs a profile
    with itself;
  * location is assigned so each city appears 4 times per profile, twice per
    gender and twice per disclosure condition, and no race meets the same city
    twice within a profile. The starting city rotates across profiles.

What it gives up: whether a race effect differs by city (race x location)
cannot be estimated, because each profile sees only 20 of the 25 race-city
pairs.

Sessions follow the same cyclic Latin square as the full schedule: profile i
in session s takes run (i + s) mod 20, so each session holds one instance of
every profile, and presentation order is shuffled inside each session.

Run:  python scripts/make_paste_schedule.py
Writes: data/ai/paste_schedule.json
"""

import json
import random
from collections import Counter
from pathlib import Path

from make_schedule import DISCLOSURE, GENDERS, LOCATIONS, RACES

SEED = 20260913  # fixed so the schedule is reproducible

ROOT = Path(__file__).resolve().parents[1]
PROFILES = ROOT / "data" / "base_profiles.json"
OUT = ROOT / "data" / "ai" / "paste_schedule.json"


def profile_runs(profile_index):
    """The 20 conditions one profile is seen under, in a fixed order."""
    runs = []
    for g, gender in enumerate(GENDERS):
        for r, race in enumerate(RACES):
            for d, disclosure in enumerate(DISCLOSURE):
                # 2g + d takes four distinct values, so a race never repeats a city
                loc = LOCATIONS[(r + 2 * g + d + profile_index) % len(LOCATIONS)]
                runs.append({"gender": gender, "race": race, "location": loc, "disclosure": disclosure})
    return runs


def build_schedule(profile_ids, rng):
    runs = {pid: profile_runs(i) for i, pid in enumerate(profile_ids)}
    n_runs = len(next(iter(runs.values())))
    sessions = []
    for s in range(n_runs):
        items = [{"profile": pid, **runs[pid][(i + s) % n_runs]} for i, pid in enumerate(profile_ids)]
        rng.shuffle(items)
        for position, item in enumerate(items, start=1):
            item["position"] = position
        sessions.append({"session": s + 1, "items": items})
    return sessions


def verify(sessions, profile_ids):
    """Fail loudly rather than ship a schedule that breaks the design."""
    for sess in sessions:
        seen = [it["profile"] for it in sess["items"]]
        assert len(set(seen)) == len(seen) == len(profile_ids), f"session {sess['session']} repeats a profile"
        assert sorted(it["position"] for it in sess["items"]) == list(range(1, len(profile_ids) + 1))

    n_loc = len(LOCATIONS)
    for pid in profile_ids:
        items = [it for s in sessions for it in s["items"] if it["profile"] == pid]
        crossed = {(it["gender"], it["race"], it["disclosure"]) for it in items}
        assert len(items) == len(crossed) == len(GENDERS) * len(RACES) * len(DISCLOSURE), (
            f"{pid}: gender x race x disclosure is not fully crossed"
        )
        per_loc = Counter(it["location"] for it in items)
        assert set(per_loc.values()) == {len(items) // n_loc}, f"{pid}: cities unbalanced"
        for field in ("gender", "disclosure"):
            pairs = Counter((it[field], it["location"]) for it in items)
            assert len(pairs) == 2 * n_loc and set(pairs.values()) == {len(items) // (2 * n_loc)}, (
                f"{pid}: cities unbalanced against {field}"
            )
        race_city = Counter((it["race"], it["location"]) for it in items)
        assert max(race_city.values()) == 1, f"{pid}: a race meets the same city twice"

    return sum(len(s["items"]) for s in sessions)


def main():
    rng = random.Random(SEED)
    profile_ids = [p["id"] for p in json.loads(PROFILES.read_text(encoding="utf-8"))["profiles"]]
    sessions = build_schedule(profile_ids, rng)
    total = verify(sessions, profile_ids)

    payload = {
        "note": (
            "Paste schedule for the AI arm. Each session holds one instance of every base profile and "
            "is pasted into a new chat in each app. Across the sessions every profile is seen under a "
            "fully crossed gender x race x disclosure design, with cities balanced against gender and "
            "disclosure."
        ),
        "protocol": (
            "Paste each session into a new chat with memory turned off, and paste the same text into "
            "every app. See paste/README.md."
        ),
        "seed": SEED,
        "sessions_count": len(sessions),
        "items_per_session": len(profile_ids),
        "instances_total": total,
        "sessions": sessions,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(sessions)} sessions x {len(profile_ids)} items = {total} instances per app")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
