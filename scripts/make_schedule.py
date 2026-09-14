"""
Build the randomized run schedule for the VI-SPDAT / LLM comparison.

Each base profile is cloned across 2 genders x 5 HUD race categories x 5 US
locations, and every clone is scored under full disclosure and
underdisclosure: 100 conditions per base profile.

Design constraints:
  1. No two clones of the same base profile may appear in one session, so a
     model cannot notice that it is re-scoring the same case with the
     demographics swapped.
  2. Presentation order is randomized within every session, so position in
     the run cannot be confounded with condition.
  3. Every base profile must still be seen under all 100 conditions exactly
     once.

Constraints 1 and 3 together give a cyclic Latin square: 100 sessions of 32
instances. Base profile i in session s takes condition (i + s) mod 100, so
each profile appears exactly once per session and cycles through every
condition across the 100 sessions. Order is then shuffled inside each session.

Run:  python scripts/make_schedule.py
Writes: data/run_schedule.json
"""

import json
import random
from pathlib import Path

SEED = 20260913  # fixed so the schedule is reproducible

ROOT = Path(__file__).resolve().parents[1]
PROFILES = ROOT / "data" / "base_profiles.json"
OUT = ROOT / "data" / "run_schedule.json"

GENDERS = ["Male", "Female"]

RACES = [
    "American Indian, Alaska Native, or Indigenous",
    "Asian or Asian American",
    "Black, African American, or African",
    "Hispanic/Latino/e/a",
    "White",
]

# One city in each of the four US Census regions, plus a second in the Midwest.
LOCATIONS = [
    "Los Angeles, California",   # West
    "Cincinnati, Ohio",          # Midwest
    "Chicago, Illinois",         # Midwest
    "Atlanta, Georgia",          # South
    "New York City, New York",   # Northeast
]

DISCLOSURE = ["Full disclosure", "Underdisclosure"]


def build_conditions():
    """The 100 demographic x location x disclosure conditions, in a fixed order."""
    return [
        {"gender": g, "race": r, "location": loc, "disclosure": d}
        for g in GENDERS
        for r in RACES
        for loc in LOCATIONS
        for d in DISCLOSURE
    ]


def build_schedule(profile_ids, conditions, rng):
    n_sessions = len(conditions)
    sessions = []

    for s in range(n_sessions):
        items = [
            {"profile": pid, **conditions[(i + s) % len(conditions)]}
            for i, pid in enumerate(profile_ids)
        ]
        rng.shuffle(items)
        for position, item in enumerate(items, start=1):
            item["position"] = position
        sessions.append({"session": s + 1, "items": items})

    return sessions


def verify(sessions, profile_ids, conditions):
    """Fail loudly rather than ship a schedule that breaks the design."""
    n_cond = len(conditions)

    for sess in sessions:
        seen = [it["profile"] for it in sess["items"]]
        assert len(seen) == len(profile_ids), f"session {sess['session']} wrong size"
        assert len(set(seen)) == len(seen), (
            f"session {sess['session']} repeats a base profile — clones collide"
        )
        positions = sorted(it["position"] for it in sess["items"])
        assert positions == list(range(1, len(profile_ids) + 1))

    # every profile sees every condition exactly once across the run
    for pid in profile_ids:
        seen = []
        for sess in sessions:
            for it in sess["items"]:
                if it["profile"] == pid:
                    seen.append((it["gender"], it["race"], it["location"], it["disclosure"]))
        assert len(seen) == n_cond, f"{pid} has {len(seen)} instances, expected {n_cond}"
        assert len(set(seen)) == n_cond, f"{pid} does not cover every condition once"

    total = sum(len(s["items"]) for s in sessions)
    assert total == len(profile_ids) * n_cond
    return total


def main():
    rng = random.Random(SEED)
    profile_ids = [p["id"] for p in json.loads(PROFILES.read_text(encoding="utf-8"))["profiles"]]
    conditions = build_conditions()

    sessions = build_schedule(profile_ids, conditions, rng)
    total = verify(sessions, profile_ids, conditions)

    payload = {
        "note": (
            "Randomized run schedule. Each session holds one instance of every base "
            "profile, so no two clones of the same profile are ever scored in the same "
            "session. Presentation order is shuffled within each session. Across the "
            f"{len(sessions)} sessions every base profile is seen under all {len(conditions)} "
            "conditions (gender x race x location x disclosure) exactly once."
        ),
        "protocol": (
            "The full design: every clone under both disclosure conditions. VI-SPDAT is "
            "scored over all of it. The AI arm uses the smaller paste schedule in "
            "data/ai/paste_schedule.json."
        ),
        "seed": SEED,
        "sessions_count": len(sessions),
        "items_per_session": len(profile_ids),
        "instances_total": total,
        "locations": LOCATIONS,
        "conditions": conditions,
        "sessions": sessions,
    }

    OUT.write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(sessions)} sessions x {len(profile_ids)} items = {total} instances")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
