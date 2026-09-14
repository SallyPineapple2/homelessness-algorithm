"""
Build the demographic clones of every base profile.

Each of the 32 base profiles is cloned across 2 genders x 5 HUD race
categories, giving 10 clones per profile and 320 in total. A clone is the
base profile with one added demographic line; every narrative field is copied
verbatim, so the stated gender and race are the only things that differ
between a profile's ten clones.

Each clone also records what the respondent reports in the interview under
both disclosure conditions. Under underdisclosure the respondent withholds up
to WITHHOLD_N of the indicators people most often conceal, most-concealed
first. The mask depends only on the base profile, so all ten clones withhold
the same things and underdisclosure cannot manufacture a demographic
difference on its own.

Reported indicators are the answers given, so the derived tri-morbidity
indicator is never listed; the scorer derives it.

Run:  python scripts/make_clones.py
Writes: data/clones.json
"""

import json
from pathlib import Path

from make_schedule import DISCLOSURE, GENDERS, RACES

ROOT = Path(__file__).resolve().parents[1]
PROFILES = ROOT / "data" / "base_profiles.json"
OUT = ROOT / "data" / "clones.json"

NARRATIVE_FIELDS = [
    "background", "path", "finances", "ties",
    "routine", "goals", "services", "demeanor", "vignette",
]

GENDER_CODES = {"Male": "M", "Female": "F"}

RACE_CODES = {
    "American Indian, Alaska Native, or Indigenous": "AIAN",
    "Asian or Asian American": "ASIAN",
    "Black, African American, or African": "BLACK",
    "Hispanic/Latino/e/a": "HISPANIC",
    "White": "WHITE",
}

# Indicators most often withheld out of stigma or fear of consequences,
# most-concealed first. Under the underdisclosure condition the first
# WITHHOLD_N of these that a profile actually has are dropped.
SENSITIVE_ORDER = [
    "b4_exploitation",   # sex work, running drugs
    "d2_substance",      # drinking, drug use
    "d6_trauma",         # abuse and trauma
    "d3_mental",         # mental health
    "b3_legal",          # open charges, fines
    "b2_harm",           # violence, self-harm
    "d5_medications",    # selling or not taking medication
    "c4_relationships",  # abusive or broken-down relationship
]
WITHHOLD_N = 3

DERIVED = {"d4_trimorbidity": ("d1_physical", "d2_substance", "d3_mental")}


def interview(indicators):
    """What the respondent reports under each disclosure condition."""
    answered = [i for i in indicators if i not in DERIVED]
    withheld = [i for i in SENSITIVE_ORDER if i in answered][:WITHHOLD_N]
    return {
        "Full disclosure": {"reported": answered, "withheld": []},
        "Underdisclosure": {
            "reported": [i for i in answered if i not in withheld],
            "withheld": withheld,
        },
    }


def demographic_line(age, gender, race):
    return f"Age {age}. Gender: {gender}. Race: {race}."


def build_clones(profiles):
    clones = []
    for p in profiles:
        answers = interview(p["indicators"])
        for g in GENDERS:
            for r in RACES:
                clones.append({
                    "clone_id": f"{p['id']}-{GENDER_CODES[g]}-{RACE_CODES[r]}",
                    "base_profile": p["id"],
                    "base_label": p["label"],
                    "gender": g,
                    "race": r,
                    "age": p["age"],
                    "demographic_line": demographic_line(p["age"], g, r),
                    "narrative": {f: p[f] for f in NARRATIVE_FIELDS},
                    "interview": answers,
                })
    return clones


def verify(clones, profiles):
    """Fail loudly rather than ship clones that break the design."""
    by_id = {p["id"]: p for p in profiles}
    ids = [c["clone_id"] for c in clones]
    assert len(set(ids)) == len(ids), "duplicate clone id"
    assert len(clones) == len(profiles) * len(GENDERS) * len(RACES)

    for pid, p in by_id.items():
        flags = set(p["indicators"])
        for derived, parts in DERIVED.items():
            assert (derived in flags) == all(x in flags for x in parts), (
                f"{pid}: {derived} disagrees with its components"
            )
        assert ("pre_age" in flags) == (p["age"] >= 60), f"{pid}: age and pre_age disagree"

        siblings = [c for c in clones if c["base_profile"] == pid]
        cells = {(c["gender"], c["race"]) for c in siblings}
        assert cells == {(g, r) for g in GENDERS for r in RACES}, f"{pid}: missing a demographic cell"

        for c in siblings:
            # Only the demographic line may differ from the base profile.
            assert c["age"] == p["age"]
            assert c["narrative"] == {f: p[f] for f in NARRATIVE_FIELDS}, (
                f"{c['clone_id']}: narrative differs from the base profile"
            )
            assert c["interview"] == siblings[0]["interview"], (
                f"{c['clone_id']}: disclosure mask differs from its siblings"
            )
            assert set(c["interview"]) == set(DISCLOSURE)
            full = c["interview"]["Full disclosure"]["reported"]
            assert set(full) == flags - set(DERIVED), f"{c['clone_id']}: full disclosure loses an answer"


def main():
    profiles = json.loads(PROFILES.read_text(encoding="utf-8"))["profiles"]
    clones = build_clones(profiles)
    verify(clones, profiles)

    payload = {
        "note": (
            "Demographic clones of the 32 base profiles: 2 genders x 5 HUD race categories, "
            "10 clones per profile. Every narrative field is copied verbatim from the base "
            "profile; the demographic line is the only field that differs between clones."
        ),
        "underdisclosure_model": (
            f"Under underdisclosure the respondent withholds up to {WITHHOLD_N} of the most "
            "commonly concealed indicators they have, in this order: "
            + ", ".join(SENSITIVE_ORDER)
            + ". The mask depends only on the base profile, so all ten clones withhold the same "
            "indicators. Reported answers never list tri-morbidity; it is derived at scoring."
        ),
        "clones_count": len(clones),
        "clones_per_profile": len(GENDERS) * len(RACES),
        "clones": clones,
    }

    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(profiles)} profiles x {len(GENDERS) * len(RACES)} demographic cells = {len(clones)} clones")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
