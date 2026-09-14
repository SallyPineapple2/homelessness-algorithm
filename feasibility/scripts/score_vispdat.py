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

Each schedule item is scored from its clone in data/clones.json, using the
answers that clone reports under the item's disclosure condition. The
underdisclosure condition does move the score: the respondent withholds the
indicators people most often conceal. The mask is fixed per base profile (see
scripts/make_clones.py), so underdisclosure cannot manufacture a demographic
difference on its own.

Every result carries its score, triage band, rank on the priority list, and a
plain-language reason listing what was counted and what was withheld.

Run:  python scripts/make_clones.py   (first, if clones.json is missing)
      python scripts/score_vispdat.py
Writes: data/vispdat_results.json, data/vispdat_results.csv
"""

import csv
import json
from collections import defaultdict
from pathlib import Path

from scipy import stats

ROOT = Path(__file__).resolve().parents[1]
INSTRUMENT = ROOT / "data" / "vispdat_instrument.json"
CLONES = ROOT / "data" / "clones.json"
SCHEDULE = ROOT / "data" / "run_schedule.json"
OUT = ROOT / "data" / "vispdat_results.json"
OUT_CSV = ROOT / "data" / "vispdat_results.csv"

DERIVED = {"d4_trimorbidity": ("d1_physical", "d2_substance", "d3_mental")}


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def build_index(instrument):
    """indicator id -> domain key, plus domain maxima, names, and order."""
    ind2dom, dom_max, names, order = {}, {}, {}, []
    for d in instrument["domains"]:
        dom_max[d["key"]] = d["max"]
        for i in d["indicators"]:
            ind2dom[i["id"]] = d["key"]
            names[i["id"]] = i["name"]
            order.append(i["id"])
    return ind2dom, dom_max, names, order


def apply_derived(flags):
    """Re-derive tri-morbidity from its components, per the tool's rule."""
    flags = set(flags)
    for derived, components in DERIVED.items():
        if all(c in flags for c in components):
            flags.add(derived)
        else:
            flags.discard(derived)
    return flags


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


def explain(total, flags, full_flags, withheld, instrument, names, order, bands):
    """Plain-language reason for a score: band, what counted, what was withheld."""
    band = band_of(total, bands)
    i = bands.index(band)
    parts = [f"Scored {total} of 17: {band['name']} ({band['min']}-{band['max']})."]

    if i + 1 < len(bands) and total == band["max"]:
        parts.append(f"One point short of {bands[i + 1]['name']}.")
    elif i > 0 and total == band["min"]:
        parts.append(f"At the threshold; one point less would drop it to {bands[i - 1]['name']}.")

    counted = []
    for d in instrument["domains"]:
        hits = [names[x["id"]] for x in d["indicators"] if x["id"] in flags]
        if hits:
            counted.append(f"{d['name']} {len(hits)}/{d['max']} ({', '.join(hits)})")
    parts.append("Counted: " + "; ".join(counted) + "." if counted else "No indicators counted.")

    if withheld:
        lost = [names[x] for x in order if x in withheld]
        text = "Withheld in interview, not counted: " + ", ".join(lost)
        if any(d in full_flags and d not in flags for d in DERIVED):
            text += "; tri-morbidity no longer derives as a result"
        parts.append(text + f". Full disclosure scores {len(full_flags)}.")

    return " ".join(parts)


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
    clone_data = load(CLONES)
    schedule = load(SCHEDULE)
    bands = instrument["bands"]
    ind2dom, dom_max, names, order = build_index(instrument)

    clones = {(c["base_profile"], c["gender"], c["race"]): c for c in clone_data["clones"]}

    # ---- score every instance in the schedule ----
    results = []
    for sess in schedule["sessions"]:
        for item in sess["items"]:
            clone = clones[(item["profile"], item["gender"], item["race"])]
            answers = clone["interview"][item["disclosure"]]
            flags = apply_derived(answers["reported"])
            full_flags = apply_derived(clone["interview"]["Full disclosure"]["reported"])
            total, per_domain = score(flags, ind2dom, dom_max)
            results.append({
                "session": sess["session"],
                "position": item["position"],
                "clone_id": clone["clone_id"],
                "profile": item["profile"],
                "gender": item["gender"],
                "race": item["race"],
                "disclosure": item["disclosure"],
                "score": total,
                "band": band_of(total, bands)["name"],
                "domains": per_domain,
                "scored_indicators": [x for x in order if x in flags],
                "withheld": answers["withheld"],
                "reason": explain(
                    total, flags, full_flags, answers["withheld"],
                    instrument, names, order, bands,
                ),
            })

    # ---- look up table: (profile, gender, race, disclosure) -> score ----
    by_key = {
        (r["profile"], r["gender"], r["race"], r["disclosure"]): r["score"]
        for r in results
    }
    profile_ids = list(dict.fromkeys(c["base_profile"] for c in clone_data["clones"]))
    races = [c["race"] for c in schedule["conditions"]]
    races = list(dict.fromkeys(races))

    # ---- priority ranking ----
    # A CES by-name list orders people by score, highest first. VI-SPDAT has no
    # tie-breaker, so equal scores share a rank (competition ranking: 1, 2, 2, 4).
    # Each disclosure condition is its own list of 320. An underdisclosed
    # instance is also placed on the full-disclosure list, which is where a
    # person who withheld actually competes: against people who did not.
    scores_by_disclosure = defaultdict(list)
    for r in results:
        scores_by_disclosure[r["disclosure"]].append(r["score"])
    full_scores = scores_by_disclosure["Full disclosure"]
    for r in results:
        same = scores_by_disclosure[r["disclosure"]]
        r["rank"] = 1 + sum(s > r["score"] for s in same)
        r["rank_of"] = len(same)
        r["tied"] = sum(s == r["score"] for s in same)
        if r["disclosure"] == "Underdisclosure":
            own_full = by_key[(r["profile"], r["gender"], r["race"], "Full disclosure")]
            r["rank_among_full_disclosure"] = 1 + sum(s > r["score"] for s in full_scores)
            r["places_lost"] = r["rank_among_full_disclosure"] - (1 + sum(s > own_full for s in full_scores))

    # Clones of one profile under one condition should share a score and rank.
    groups = defaultdict(set)
    for r in results:
        groups[(r["profile"], r["disclosure"])].add((r["score"], r["rank"]))
    divergent_groups = sum(len(v) > 1 for v in groups.values())

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

    under = [r for r in results if r["disclosure"] == "Underdisclosure"]
    mean_places_lost = round(sum(r["places_lost"] for r in under) / len(under), 2)

    payload = {
        "model": "VI-SPDAT (Single Adults, American Version 2.0) — published additive scoring",
        "note": (
            "Control arm. Race is not an input to any VI-SPDAT scoring rule, and the only "
            "gender-dependent item in v2.0 is the pregnancy question, which no base profile "
            "sets. Any demographic difference here would be an error in the data, not a "
            "property of the tool."
        ),
        "underdisclosure_model": clone_data["underdisclosure_model"],
        "rank_method": (
            "Priority rank within each disclosure condition (320 instances), highest score "
            "first. VI-SPDAT has no tie-breaker, so equal scores share a rank (1, 2, 2, 4) and "
            "'tied' counts the instances at that score. Underdisclosed instances are also "
            "placed on the full-disclosure list ('rank_among_full_disclosure'); 'places_lost' "
            "is how far that is below the same clone's full-disclosure rank."
        ),
        "instances_scored": len(results),
        "clone_groups_with_divergent_rank": divergent_groups,
        "means_by_race": mean_by("race"),
        "means_by_gender": mean_by("gender"),
        "means_by_disclosure": mean_by("disclosure"),
        "means_by_race_disclosure": means_by_race_disclosure,
        "band_changes_from_underdisclosure": moved,
        "band_changes_possible": len(profile_ids) * 2 * len(races),
        "mean_places_lost_from_underdisclosure": mean_places_lost,
        "tests": tests,
        "results": results,
    }

    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    columns = [
        "session", "position", "clone_id", "profile", "gender", "race", "disclosure",
        "score", "band", "rank", "rank_of", "tied", "rank_among_full_disclosure",
        "places_lost", "withheld", "reason",
    ]
    with OUT_CSV.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for r in results:
            writer.writerow({**r, "withheld": " ".join(r["withheld"])})

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
    print(f"mean places lost on the priority list from underdisclosure: {mean_places_lost}")
    print(f"clone groups whose ten clones disagree on score or rank: {divergent_groups}")
    print("\npaired t-tests:")
    for t in tests:
        tv = "    n/a" if t["t"] is None else f"{t['t']:7.3f}"
        sig = "YES" if t["significant"] else "no"
        print(f"  {t['comparison']:<48} diff {t['mean_diff']:+7.4f}  t {tv}  p {t['p']:.4g}  sig {sig}")
    print(f"\nwrote {OUT.relative_to(ROOT)} and {OUT_CSV.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
