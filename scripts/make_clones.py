"""
Build the demographic clones of every base profile.

Each of the 32 base profiles is cloned across 2 genders x 5 HUD race
categories x 5 US locations, giving 50 clones per profile and 1,600 in total.
A clone is the base profile with one added demographic line; every narrative
field is copied verbatim, so the stated gender, race, and location are the only
things that differ between a profile's clones.

Each clone records what the respondent reports under both disclosure
conditions: the indicators given in the interview, the indicators withheld,
and the narrative a reader would have on record. Under underdisclosure the
respondent withholds up to WITHHOLD_N of the indicators people most often
conceal, and the profile's underdisclosure text replaces every narrative field
that would reveal them. The mask depends only on the base profile, so every
clone of a profile withholds the same things and underdisclosure cannot
manufacture a demographic difference on its own.

Reported indicators never list the derived tri-morbidity indicator; the scorer
derives it.

Run:  python scripts/make_clones.py
Writes: data/clones.json
"""

import json
from pathlib import Path

from make_schedule import DISCLOSURE, GENDERS, LOCATIONS, RACES

ROOT = Path(__file__).resolve().parents[1]
PROFILES = ROOT / "data" / "base_profiles.json"
OUT = ROOT / "data" / "clones.json"

NARRATIVE_FIELDS = [
    "background", "path", "housing", "finances", "health", "safety",
    "ties", "routine", "goals", "services", "demeanor",
]

GENDER_CODES = {"Male": "M", "Female": "F"}

RACE_CODES = {
    "American Indian, Alaska Native, or Indigenous": "AIAN",
    "Asian or Asian American": "ASIAN",
    "Black, African American, or African": "BLACK",
    "Hispanic/Latino/e/a": "HISPANIC",
    "White": "WHITE",
}

LOCATION_CODES = {
    "Los Angeles, California": "LA",
    "Cincinnati, Ohio": "CIN",
    "Chicago, Illinois": "CHI",
    "Atlanta, Georgia": "ATL",
    "New York City, New York": "NYC",
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


def withheld_for(indicators):
    """The indicators this profile withholds under underdisclosure."""
    return [i for i in SENSITIVE_ORDER if i in indicators][:WITHHOLD_N]


def interview(profile):
    """What the respondent reports, and what is on record, under each condition."""
    answered = [i for i in profile["indicators"] if i not in DERIVED]
    withheld = withheld_for(answered)
    full = {f: profile["narrative"][f] for f in NARRATIVE_FIELDS}
    under = {**full, **profile.get("underdisclosure", {})}
    return {
        "Full disclosure": {"reported": answered, "withheld": [], "narrative": full},
        "Underdisclosure": {
            "reported": [i for i in answered if i not in withheld],
            "withheld": withheld,
            "narrative": under,
        },
    }


def demographic_line(age, gender, race, location):
    return f"Age {age}. Gender: {gender}. Race: {race}. Location: {location}."


def build_clones(profiles):
    clones = []
    for p in profiles:
        answers = interview(p)
        for g in GENDERS:
            for r in RACES:
                for loc in LOCATIONS:
                    clones.append({
                        "clone_id": f"{p['id']}-{GENDER_CODES[g]}-{RACE_CODES[r]}-{LOCATION_CODES[loc]}",
                        "base_profile": p["id"],
                        "gender": g,
                        "race": r,
                        "location": loc,
                        "age": p["age"],
                        "demographic_line": demographic_line(p["age"], g, r, loc),
                        "interview": answers,
                    })
    return clones


def verify(clones, profiles):
    """Fail loudly rather than ship clones that break the design."""
    by_id = {p["id"]: p for p in profiles}
    ids = [c["clone_id"] for c in clones]
    assert len(set(ids)) == len(ids), "duplicate clone id"
    assert len(clones) == len(profiles) * len(GENDERS) * len(RACES) * len(LOCATIONS)

    for pid, p in by_id.items():
        flags = set(p["indicators"])
        siblings = [c for c in clones if c["base_profile"] == pid]
        cells = {(c["gender"], c["race"], c["location"]) for c in siblings}
        assert cells == {(g, r, loc) for g in GENDERS for r in RACES for loc in LOCATIONS}, (
            f"{pid}: missing a demographic cell"
        )

        expected_full = {f: p["narrative"][f] for f in NARRATIVE_FIELDS}
        expected_under = {**expected_full, **p.get("underdisclosure", {})}
        for c in siblings:
            # Only the demographic line may differ between a profile's clones.
            assert c["age"] == p["age"]
            assert c["interview"] == siblings[0]["interview"], (
                f"{c['clone_id']}: interview differs from its siblings"
            )
            assert set(c["interview"]) == set(DISCLOSURE)
            full = c["interview"]["Full disclosure"]
            under = c["interview"]["Underdisclosure"]
            assert set(full["reported"]) == flags - set(DERIVED), f"{c['clone_id']}: full disclosure loses an answer"
            assert full["narrative"] == expected_full, f"{c['clone_id']}: narrative differs from base"
            assert under["narrative"] == expected_under, f"{c['clone_id']}: underdisclosure narrative differs"
            assert not set(under["withheld"]) & set(under["reported"])


def main():
    profiles = json.loads(PROFILES.read_text(encoding="utf-8"))["profiles"]
    clones = build_clones(profiles)
    verify(clones, profiles)

    per_profile = len(GENDERS) * len(RACES) * len(LOCATIONS)
    payload = {
        "note": (
            f"Demographic clones of the {len(profiles)} base profiles: 2 genders x 5 HUD race "
            f"categories x 5 US locations, {per_profile} clones per profile. Every narrative field is "
            "copied verbatim from the base profile; the demographic line is the only field that "
            "differs between clones."
        ),
        "underdisclosure_model": (
            f"Under underdisclosure the respondent withholds up to {WITHHOLD_N} of the most "
            "commonly concealed indicators they have, in this order: "
            + ", ".join(SENSITIVE_ORDER)
            + ". The mask depends only on the base profile, so every clone withholds the same "
            "indicators, and the narrative on record omits them. Reported answers never list "
            "tri-morbidity; it is derived at scoring."
        ),
        "locations": LOCATIONS,
        "clones_count": len(clones),
        "clones_per_profile": per_profile,
        "clones": clones,
    }

    OUT.write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(profiles)} profiles x {per_profile} demographic cells = {len(clones)} clones")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
