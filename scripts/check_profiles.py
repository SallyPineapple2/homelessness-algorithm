"""
Validate data/base_profiles.json before it is cloned.

Checks, and refuses to pass if any fail:
  1. Structure: 32 profiles, every narrative field present and non-empty, age
     agrees with the pre-survey indicator, tri-morbidity agrees with its parts.
  2. Underdisclosure: a profile that withholds indicators has replacement text,
     one that withholds nothing has none, and the assembled underdisclosure
     narrative contains no wording tied to a withheld indicator.
  3. Leakage: no gendered, racial, religious, or national wording, no British
     spellings (a national signal), and no city, region, or climate detail that
     would clash with one of the clone locations.

Run:  python scripts/check_profiles.py
"""

import json
import re
import sys
from pathlib import Path

from make_clones import DERIVED, NARRATIVE_FIELDS, withheld_for

ROOT = Path(__file__).resolve().parents[1]
PROFILES = ROOT / "data" / "base_profiles.json"

# Wording that would reveal a withheld indicator in the underdisclosure text.
REVEALS = {
    "b4_exploitation": r"sex|trades? (sex|for)|exchange|pressur|forced to|forces them|coerc|packages|carry items|"
                       r"hold drugs|hold and deliver|run errands|favors|front drugs|hand over",
    "d2_substance": r"drink|drinking|alcohol|drugs?\b|heroin|stimulant|methamphetamine|detox|opioid|"
                    r"street supply|uses at night|uses through|positive drug|hangover|treatment program|sober",
    "d6_trauma": r"abus|trauma|violent|robbery|robbed|victim|ptsd|mass-casualty|sirens|escalation|"
                 r"beaten|fire killed|assault at work",
    "d3_mental": r"bipolar|schizo|depress|psychiatr|mental|ptsd|flat affect|pressured speech|confusion|"
                 r"loses track|cognitive",
    "b3_legal": r"\bcharges?\b(?! the phone)|court|fines\b|citation|restitution|warrant",
    "b2_harm": r"assault|attacked|beaten|hurt\b",
    "d5_medications": r"untaken|not taking|never filled|sells? (the |what )?prescri|refill|ran out|"
                      r"medication .*untaken",
    "c4_relationships": r"partner|breakup|relationship|relatives? (forced|took|controls)|family dispute|"
                        r"changed the locks|put them out|sibling who shared",
}

LEAKAGE = {
    "gendered": r"\b(he|she|him|her|his|hers|himself|herself|man|woman|men|women|male|female|mother|father|"
                r"son|daughter|brother|sister|husband|wife|boyfriend|girlfriend|mr|mrs|ms|aunt|uncle|niece|"
                r"nephew|grandmother|grandfather|foreman|foremen|seaman)\b",
    "racial or national": r"\b(black|white|asian|latino|latina|latinx|hispanic|indigenous|native|tribal|"
                          r"reservation|african|immigrant|accent|english|spanish|citizenship|visa)\b",
    "religious": r"\b(church|mosque|temple|synagogue|pastor|priest|imam|rabbi|prayer)\b",
    "british spelling": r"\b(a flat|the flat|fortnight|programme|centre|licence|cheque|neighbourhood|colour|harbour|"
                        r"recognise|counsellor|labour|enquired?|trolley|car parks?|queue|mum)\b",
    "place or climate": r"\b(winter|summer|snow|freezing|cold nights|heat wave|subway|beach|ocean|lake|"
                        r"california|ohio|illinois|georgia|new york|chicago|cincinnati|los angeles|atlanta|"
                        r"el train|hurricane|wildfire)\b",
}


def main():
    data = json.loads(PROFILES.read_text(encoding="utf-8"))
    profiles = data["profiles"]
    errors = []

    if len(profiles) != 32:
        errors.append(f"expected 32 profiles, found {len(profiles)}")

    for p in profiles:
        pid = p["id"]
        flags = set(p["indicators"])
        narrative = p.get("narrative", {})

        missing = [f for f in NARRATIVE_FIELDS if not narrative.get(f, "").strip()]
        if missing:
            errors.append(f"{pid}: missing narrative fields {missing}")
        if ("pre_age" in flags) != (p["age"] >= 60):
            errors.append(f"{pid}: age {p['age']} disagrees with pre_age")
        for derived, parts in DERIVED.items():
            if (derived in flags) != all(x in flags for x in parts):
                errors.append(f"{pid}: {derived} disagrees with its components")

        withheld = withheld_for(p["indicators"])
        overrides = p.get("underdisclosure", {})
        if withheld and not overrides:
            errors.append(f"{pid}: withholds {withheld} but has no underdisclosure text")
        if not withheld and overrides:
            errors.append(f"{pid}: withholds nothing but has underdisclosure text")
        bad_keys = set(overrides) - set(NARRATIVE_FIELDS)
        if bad_keys:
            errors.append(f"{pid}: unknown underdisclosure fields {sorted(bad_keys)}")

        under = {**narrative, **overrides}
        for ind in withheld:
            for field, text in under.items():
                m = re.search(REVEALS[ind], text, re.IGNORECASE)
                if m:
                    errors.append(f"{pid}: underdisclosure '{field}' reveals withheld {ind}: '{m.group(0)}'")

        texts = {**{f"narrative.{k}": v for k, v in narrative.items()},
                 **{f"underdisclosure.{k}": v for k, v in overrides.items()},
                 "label": p["label"], "vignette": p["vignette"]}
        for where, text in texts.items():
            for kind, pattern in LEAKAGE.items():
                m = re.search(pattern, text, re.IGNORECASE)
                if m:
                    errors.append(f"{pid}: {kind} wording in {where}: '{m.group(0)}'")

    if errors:
        print(f"{len(errors)} problem(s):")
        for e in errors:
            print("  " + e)
        sys.exit(1)
    print(f"{len(profiles)} profiles pass: structure, underdisclosure, and leakage checks")


if __name__ == "__main__":
    main()
