"""
Score every instance in the run schedule with the published VI-SPDAT algorithm.

This is the control arm of the study. VI-SPDAT is a deterministic additive
scorer: it sums flagged indicators. Race is not an input to any scoring rule,
and the only gender-dependent item in v2.0 is Q20 (pregnancy, female
respondents only), which none of the base profiles set. The VI-SPDAT arm is
therefore expected to show exactly zero variation across race and gender —
that is the mechanical baseline the LLM arm gets compared against, and it
locates any real-world VI-SPDAT bias in the interview rather than the
arithmetic.

The underdisclosure condition does move the score. It withholds the indicators
people most often conceal out of fear of judgement, and the same mask is
applied to all ten clones of a profile, so underdisclosure cannot manufacture
a demographic difference on its own.

Run:  python scripts/score_vispdat.py
Writes: data/vispdat_results.json
"""

import json
from collections import defaultdict
from pathlib import Path

from scipy import stats

ROOT = Path(__file__).resolve().parents[1]
INSTRUMENT = ROOT / "data" / "vispdat_instrument.json"
PROFILES = ROOT / "data" / "base_profiles.json"
SCHEDULE = ROOT / "data" / "run_schedule.json"
OUT = ROOT / "data" / "vispdat_results.json"

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


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def build_index(instrument):
    """indicator id -> domain key, plus domain maxima."""
    ind2dom, dom_max, order = {}, {}, []
    for d in instrument["domains"]:
        dom_max[d["key"]] = d["max"]
        for i in d["indicators"]:
            ind2dom[i["id"]] = d["key"]
            order.append(i["id"])
    return ind2dom, dom_max, order


def apply_derived(flags):
    """Re-derive tri-morbidity from its components, per the tool's rule."""
    flags = set(flags)
    for derived, components in DERIVED.items():
        if all(c in flags for c in components):
            flags.add(derived)
        else:
            flags.discard(derived)
    return flags


def withhold(flags):
    """Drop the most-concealed indicators this profile actually reports."""
    present = [i for i in SENSITIVE_ORDER if i in flags]
    dropped = set(present[:WITHHOLD_N])
    return apply_derived(set(flags) - dropped), sorted(dropped)


def score(flags, ind2dom, dom_max):
    """VI-SPDAT is additive: the score is the count of flagged indicators."""
    per_domain = defaultdict(int)
    for f in flags:
        per_domain[ind2dom[f]] += 1
    for key, value in per_domain.items():
        assert value <= dom_max[key], f"domain {key} over maximum"
    return sum(per_domain.values()), dict(per_domain)


def band_of(total, bands):
    for b in bands:
        if b["min"] <= total <= b["max"]:
            return b
    raise ValueError(total)


def paired_t(pairs, label):
    """Paired t-test over (a, b) score pairs, one pair per base profile."""
    a = [x for x, _ in pairs]
    b = [y for _, y in pairs]
    diffs = [x - y for x, y in pairs]
    n = len(diffs)
    mean_diff = sum(diffs) / n

    if all(d == 0 for d in diffs):
        # Every pair identical: the t-statistic is 0/0. Report it as no
        # difference rather than letting a NaN through.
        return {
            "comparison": label,
            "n": n,
            "df": n - 1,
            "mean_diff": 0.0,
            "t": None,
            "p": 1.0,
            "significant": False,
            "note": "all pairs identical — no variance to test",
        }

    result = stats.ttest_rel(a, b)
    return {
        "comparison": label,
        "n": n,
        "df": n - 1,
        "mean_diff": round(mean_diff, 4),
        "t": round(float(result.statistic), 4),
        "p": round(float(result.pvalue), 6),
        "significant": bool(result.pvalue < 0.05),
        "note": None,
    }


def main():
    instrument = load(INSTRUMENT)
    profiles = {p["id"]: p for p in load(PROFILES)["profiles"]}
    schedule = load(SCHEDULE)
    bands = instrument["bands"]
    ind2dom, dom_max, _ = build_index(instrument)

    # ---- score every instance in the schedule ----
    results = []
    for sess in schedule["sessions"]:
        for item in sess["items"]:
            profile = profiles[item["profile"]]
            base_flags = apply_derived(profile["indicators"])
            partial = item["disclosure"] == "Underdisclosure"
            flags, dropped = withhold(base_flags) if partial else (base_flags, [])
            total, per_domain = score(flags, ind2dom, dom_max)
            results.append({
                "session": sess["session"],
                "position": item["position"],
                "profile": item["profile"],
                "gender": item["gender"],
                "race": item["race"],
                "disclosure": item["disclosure"],
                "score": total,
                "band": band_of(total, bands)["name"],
                "domains": per_domain,
                "withheld": dropped,
            })

    # ---- look up table: (profile, gender, race, disclosure) -> score ----
    by_key = {
        (r["profile"], r["gender"], r["race"], r["disclosure"]): r["score"]
        for r in results
    }
    profile_ids = list(profiles)
    races = [c["race"] for c in schedule["conditions"]]
    races = list(dict.fromkeys(races))

    # ---- paired t-tests, one pair per base profile ----
    tests = []

    # race, each against White, holding gender and disclosure balanced
    for race in races:
        if race == "White":
            continue
        pairs = []
        for pid in profile_ids:
            for g in ("Male", "Female"):
                for d in ("Full disclosure", "Underdisclosure"):
                    pairs.append((by_key[(pid, g, race, d)], by_key[(pid, g, "White", d)]))
        tests.append(paired_t(pairs, f"{race} vs. White"))

    # gender
    pairs = []
    for pid in profile_ids:
        for race in races:
            for d in ("Full disclosure", "Underdisclosure"):
                pairs.append((by_key[(pid, "Female", race, d)], by_key[(pid, "Male", race, d)]))
    tests.append(paired_t(pairs, "Female vs. Male"))

    # disclosure
    pairs = []
    for pid in profile_ids:
        for race in races:
            for g in ("Male", "Female"):
                pairs.append((
                    by_key[(pid, g, race, "Underdisclosure")],
                    by_key[(pid, g, race, "Full disclosure")],
                ))
    tests.append(paired_t(pairs, "Underdisclosure vs. full disclosure"))

    # ---- means for the chart ----
    def mean_by(field):
        buckets = defaultdict(list)
        for r in results:
            buckets[r[field]].append(r["score"])
        return {k: round(sum(v) / len(v), 4) for k, v in buckets.items()}

    means_by_race_disclosure = {}
    for race in races:
        row = {}
        for d in ("Full disclosure", "Underdisclosure"):
            vals = [r["score"] for r in results if r["race"] == race and r["disclosure"] == d]
            row[d] = round(sum(vals) / len(vals), 4)
        means_by_race_disclosure[race] = row

    # band movement caused by underdisclosure
    moved = 0
    for pid in profile_ids:
        for g in ("Male", "Female"):
            for race in races:
                full = by_key[(pid, g, race, "Full disclosure")]
                part = by_key[(pid, g, race, "Underdisclosure")]
                if band_of(full, bands)["id"] != band_of(part, bands)["id"]:
                    moved += 1

    payload = {
        "model": "VI-SPDAT (Single Adults, American Version 2.0) — published additive scoring",
        "note": (
            "Control arm. Race is not an input to any VI-SPDAT scoring rule, and the only "
            "gender-dependent item in v2.0 is the pregnancy question, which no base profile "
            "sets. Any demographic difference here would be an error in the data, not a "
            "property of the tool."
        ),
        "underdisclosure_model": (
            f"Withholds up to {WITHHOLD_N} of the most commonly concealed indicators a profile "
            "reports, in this order: " + ", ".join(SENSITIVE_ORDER) + ". Tri-morbidity is "
            "re-derived afterwards, so concealing substance use or mental health also removes it. "
            "The same mask is applied to all ten clones of a profile."
        ),
        "instances_scored": len(results),
        "means_by_race": mean_by("race"),
        "means_by_gender": mean_by("gender"),
        "means_by_disclosure": mean_by("disclosure"),
        "means_by_race_disclosure": means_by_race_disclosure,
        "band_changes_from_underdisclosure": moved,
        "band_changes_possible": len(profile_ids) * 2 * len(races),
        "tests": tests,
        "results": results,
    }

    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # ---- console summary ----
    print(f"scored {len(results)} instances\n")
    print("mean score by race:")
    for k, v in payload["means_by_race"].items():
        print(f"  {v:6.3f}  {k}")
    print("\nmean score by gender:")
    for k, v in payload["means_by_gender"].items():
        print(f"  {v:6.3f}  {k}")
    print("\nmean score by disclosure:")
    for k, v in payload["means_by_disclosure"].items():
        print(f"  {v:6.3f}  {k}")
    print(f"\nband changes caused by underdisclosure: {moved} of {payload['band_changes_possible']}")
    print("\npaired t-tests:")
    for t in tests:
        tv = "     —" if t["t"] is None else f"{t['t']:7.3f}"
        sig = "YES" if t["significant"] else "no"
        print(f"  {t['comparison']:<48} diff {t['mean_diff']:+7.4f}  t {tv}  p {t['p']:.4g}  sig {sig}")
    print(f"\nwrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
