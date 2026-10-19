"""
Build the 100 pilot profiles: pilot/data/profiles.json.

Sources
  P01-P32  the original study's base profiles (data/base_profiles.json), full-disclosure
           narrative only. Each becomes one person instead of 20 demographic copies.
  P33-P100 new profiles in pilot/data/source/new_profiles_*.json.

Every profile is one distinct person with an age, gender, race, and location (the
original study's 2 genders, 5 races, and 5 cities). Age comes with
the narrative. Gender is fixed where the narrative requires it (pregnancy); otherwise
gender and race are assigned by a seeded, stratified draw: profiles are sorted by
VI-SPDAT total and dealt out in blocks, so each race and gender gets a similar mix of
need. That keeps a group difference from simply reflecting who got the sicker cases.

Checks (the build stops if any fail)
  - age agrees with the 60+ indicator; tri-morbidity agrees with its parts;
    only female profiles carry a pregnancy
  - no gendered, racial, religious, or place wording in the narrative
    (the demographic line is the only place gender and race appear)
  - every VI-SPDAT item is addressed in the narrative, yes or no, so neither
    approach has to guess

Run:  python pilot/scripts/build_profiles.py
"""

import json
import random
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PILOT = ROOT / "pilot"
SEED = 20261014

GENDERS = ["Male", "Female"]
# The same categories as the original study (scripts/make_schedule.py).
RACES = [
    "American Indian, Alaska Native, or Indigenous",
    "Asian or Asian American",
    "Black, African American, or African",
    "Hispanic/Latino/e/a",
    "White",
]
LOCATIONS = [
    "Los Angeles, California",
    "Cincinnati, Ohio",
    "Chicago, Illinois",
    "Atlanta, Georgia",
    "New York City, New York",
]
FIELDS = ["background", "path", "housing", "finances", "health", "safety", "ties",
          "routine", "goals", "services", "demeanor"]
DERIVED_PARTS = ("d1_physical", "d2_substance", "d3_mental")

LEAKAGE = {
    "gendered": r"\b(he|she|him|her|his|hers|himself|herself|man|woman|men|women|male|female|mother|father|"
                r"son|daughter|brother|sister|husband|wife|boyfriend|girlfriend|mr|mrs|ms|aunt|uncle|niece|"
                r"nephew|grandmother|grandfather|foreman|foremen|seaman|brother-in-law)\b",
    "racial or national": r"\b(black|white|asian|latino|latina|latinx|hispanic|indigenous|native|tribal|"
                          r"reservation|african|immigrant|accent|english|spanish|citizenship|visa)\b",
    "religious": r"\b(church|mosque|temple|synagogue|pastor|priest|imam|rabbi|prayer)\b",
    "place or climate": r"\b(winter|summer|snow|freezing|cold nights|heat wave|subway|beach|ocean|"
                        r"california|ohio|illinois|georgia|new york|chicago|cincinnati|los angeles|atlanta|"
                        r"hurricane|wildfire)\b",
}

# Each VI-SPDAT item must be addressed (yes or no) in the named narrative fields.
COVERAGE = {
    "a1_sleep": (["housing"], r"sleeping|staying|living"),
    "a2_duration": (["housing"], r"first time|time without housing|never been homeless|homeless (continuously|for|on and off)"),
    "b1_emergency": (["safety"], r"emergency room"),
    "b2_harm": (["safety"], r"attack|assault|beaten|hurt|threat|stabbed|hit\b|jumped|punched|kicked|knocked"),
    "b3_legal": (["safety"], r"legal|charge|court"),
    "b4_exploitation": (["safety"], r"pressur|trick|forc|trades? sex|exchange|carry|favors|hold|made to|run errands"),
    "c1_money": (["finances"], r"debt|owes|owed|owing|bill|loan|collections|judgments|garnished"),
    "c2_activity": (["routine"], r"."),
    "c3_selfcare": (["health", "routine"], r"wash|bath|shower|basic needs|meals|clean"),
    "c4_relationships": (["path", "ties"], r"relationship|partner|family|relatives|breakup|divorce|spouse|put them out|relative"),
    "d1_physical": (["health"], r"conditions?|chronic|disab|pregnan|hiv|disease|amputation|stroke|cirrhosis|copd|"
                                r"arthritis|injury|lupus|sclerosis|asthma|emphysema|lung|heart|kidney|liver"),
    "d2_substance": (["health"], r"drink|drug|alcohol|heroin|opioid|cocaine|methamphetamine|crack|stimulant"),
    "d3_mental": (["health"], r"mental|depress|schizo|bipolar|anxiety|stress disorder|ptsd|psych|panic|dementia|memory|"
                              r"brain|cognitive"),
    "d5_medications": (["health"], r"prescri|medication|inhaler"),
    "d6_trauma": (["path"], r"abuse|trauma|names the"),
}


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def total(p):
    return len(p["indicators"])


def main():
    old = load(ROOT / "data" / "base_profiles.json")["profiles"]
    patches = load(PILOT / "data" / "source" / "original_profile_patches.json")["patches"]
    new = []
    for f in sorted((PILOT / "data" / "source").glob("new_profiles_*.json")):
        new.extend(load(f)["profiles"])

    profiles = []
    for p in old:
        narrative = dict(p["narrative"])
        for field, text in patches.get(p["id"], {}).items():
            narrative[field] = text
        profiles.append({"id": p["id"], "label": p["label"], "age": p["age"], "source": "original study",
                         "indicators": p["indicators"], "narrative": narrative})
    for p in new:
        profiles.append({"id": p["id"], "label": p["label"], "age": p["age"], "source": "new",
                         "indicators": p["indicators"], "narrative": p["narrative"],
                         **({"gender": p["gender"]} if "gender" in p else {})})

    errors = []
    ids = [p["id"] for p in profiles]
    if len(profiles) != 100 or len(set(ids)) != 100:
        errors.append(f"expected 100 unique profiles, found {len(profiles)} ({len(set(ids))} unique)")

    for p in profiles:
        pid, flags, nar = p["id"], set(p["indicators"]), p["narrative"]
        missing = [f for f in FIELDS if not nar.get(f, "").strip()]
        if missing:
            errors.append(f"{pid}: missing narrative fields {missing}")
        if ("pre_age" in flags) != (p["age"] >= 60):
            errors.append(f"{pid}: age {p['age']} disagrees with the 60+ indicator")
        if ("d4_trimorbidity" in flags) != all(x in flags for x in DERIVED_PARTS):
            errors.append(f"{pid}: tri-morbidity disagrees with its parts")
        pregnant = re.search(r"pregnan", nar.get("health", ""), re.I) and not re.search(r"not pregnant", nar["health"], re.I)
        if pregnant and p.get("gender") != "Female":
            errors.append(f"{pid}: pregnancy in a profile whose gender is not fixed as Female")
        for field, text in nar.items():
            for kind, pattern in LEAKAGE.items():
                m = re.search(pattern, text, re.I)
                if m:
                    errors.append(f"{pid}: {kind} wording in {field}: '{m.group(0)}'")
        for item, (fields, pattern) in COVERAGE.items():
            text = " ".join(nar.get(f, "") for f in fields)
            if not re.search(pattern, text, re.I):
                errors.append(f"{pid}: narrative does not address {item} (in {'/'.join(fields)})")

    if errors:
        print(f"{len(errors)} problem(s):")
        for e in errors:
            print("  " + e)
        sys.exit(1)

    # Stratified demographic draw. Race: sort everyone by VI-SPDAT total and deal races out in
    # blocks of five, so every race gets the same mix of need. Then, within each race (again
    # sorted by total), deal cities in blocks of five, so every race has 4 people in each city.
    rng = random.Random(SEED)
    order = sorted(profiles, key=lambda p: (total(p), p["id"]))
    for block_start in range(0, len(order), len(RACES)):
        block = order[block_start:block_start + len(RACES)]
        races = RACES[:]
        rng.shuffle(races)
        for p, r in zip(block, races):
            p["race"] = r
    for race in RACES:
        group = [p for p in order if p["race"] == race]
        for block_start in range(0, len(group), len(LOCATIONS)):
            cities = LOCATIONS[:]
            rng.shuffle(cities)
            for p, c in zip(group[block_start:block_start + len(LOCATIONS)], cities):
                p["location"] = c
    # Gender: every race x city cell (4 people) gets 2 women and 2 men, paired by VI-SPDAT total,
    # so gender is balanced within every race (10/10) and every city (10/10).
    for race in RACES:
        for city in LOCATIONS:
            cell = sorted((p for p in profiles if p["race"] == race and p["location"] == city),
                          key=lambda p: (total(p), p["id"]))
            for pair in (cell[:2], cell[2:]):
                fixed = [p for p in pair if "gender" in p]
                if len(fixed) == 2:
                    raise SystemExit(f"two fixed-gender profiles paired in {race} / {city}")
                genders = GENDERS[:]
                rng.shuffle(genders)
                if fixed:
                    taken = fixed[0]["gender"]
                    genders = [taken] + [g for g in GENDERS if g != taken]
                    pair = fixed + [p for p in pair if p is not fixed[0]]
                for p, g in zip(pair, genders):
                    p.setdefault("gender", g)

    for p in profiles:
        p["demographic_line"] = (f"Age {p['age']}. Gender: {p['gender']}. Race: {p['race']}. "
                                 f"Location: {p['location']}.")

    keyed = ["id", "label", "source", "age", "gender", "race", "location", "demographic_line", "indicators", "narrative"]
    out = {
        "note": "100 distinct synthetic people for the Gemini pilot. P01-P32 adapted from the original study's "
                "base profiles (full-disclosure narrative); P33-P100 new. Gender and race assigned by a seeded "
                "draw stratified on VI-SPDAT total, except pregnant profiles, which are Female. Location assigned the same way within each race; each race x city cell has 2 women and 2 men.",
        "seed": SEED,
        "profiles": [{k: p[k] for k in keyed} for p in sorted(profiles, key=lambda p: int(p["id"][1:]))],
    }
    (PILOT / "data" / "profiles.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    g = Counter(p["gender"] for p in profiles)
    r = Counter(p["race"] for p in profiles)
    print(f"wrote pilot/data/profiles.json: {len(profiles)} profiles pass every check")
    print("  gender:", dict(g))
    print("  race:  ", dict(r))
    print("  city:  ", dict(Counter(p["location"] for p in profiles)))
    print("  race x city cells:", sorted(set(Counter((p["race"], p["location"]) for p in profiles).values())),
          " race x gender cells:", sorted(set(Counter((p["race"], p["gender"]) for p in profiles).values())),
          " city x gender cells:", sorted(set(Counter((p["location"], p["gender"]) for p in profiles).values())))


if __name__ == "__main__":
    main()
