"""
Exploratory significance tests for the pilot: where does Gemini depart from VI-SPDAT?

Outcome: Gemini placed the person in a HIGHER priority category than VI-SPDAT ("upgrade").
Only people VI-SPDAT did not already rate High can be upgraded, so the tests use those
people (VI-SPDAT Low or Medium).

1. Direction. Exact two-sided sign test on people placed higher vs lower.
2. Groups (gender, race, city, age group) and VI-SPDAT circumstances (each item, yes vs no).
   Stratified permutation test: group labels (or the item flag) are shuffled among people
   with the SAME VI-SPDAT score, so the test asks whether the group or circumstance changes
   Gemini's judgment beyond what the VI-SPDAT total already captures. Statistic: a
   chi-square-type sum of (observed - expected upgrades)^2 / expected across groups, with
   expected counts computed within each score. 20,000 shuffles, seeded. Holm correction
   within the circumstance family and within the demographic family.

These are exploratory tests on a 100-person pilot; small groups have little power.

Run:  python pilot/scripts/pilot_stats.py [--run gemini]
Writes: pilot/results/significance_<run>.json and .csv
"""

import argparse
import csv
import json
from math import comb
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
PILOT = ROOT / "pilot"
RANK = {"Low": 0, "Medium": 1, "High": 2}
N_PERM = 20000
SEED = 20261018
RUNS = {"gemini": PILOT / "data" / "gemini" / "raw",
        "gemini-3.8-flash": PILOT / "data" / "gemini-gemini-3.8-flash" / "raw"}

ITEM_NAMES = {
    "pre_age": "Age 60 or older", "a1_sleep": "Unsheltered (not in a shelter)",
    "a2_duration": "Homeless 1+ year or 4+ times", "b1_emergency": "4+ emergency service contacts",
    "b2_harm": "Risk of harm", "b3_legal": "Legal issues", "b4_exploitation": "Risk of exploitation",
    "c1_money": "No income or owes money", "c2_activity": "No meaningful daily activity",
    "c3_selfcare": "Cannot meet basic needs", "c4_relationships": "Homeless due to relationship breakdown",
    "d1_physical": "Physical health condition", "d2_substance": "Substance use",
    "d3_mental": "Mental health condition", "d4_trimorbidity": "Tri-morbidity",
    "d5_medications": "Medication problems", "d6_trauma": "Homeless due to abuse or trauma",
}


def age_group(a):
    return "18-24" if a < 25 else "25-39" if a < 40 else "40-59" if a < 60 else "60 and older"


def sign_test(up, down):
    n = up + down
    k = min(up, down)
    p = sum(comb(n, i) for i in range(k + 1)) / 2 ** n * 2
    return min(1.0, p)


def stat(labels, y, strata, groups):
    """Sum over groups of (O - E)^2 / E, E from each stratum's upgrade rate."""
    total = 0.0
    for g in groups:
        m = labels == g
        o = y[m].sum()
        e = 0.0
        for s in np.unique(strata):
            ms = strata == s
            rate = y[ms].mean()
            e += rate * (m & ms).sum()
        if e > 0:
            total += (o - e) ** 2 / e
    return total


def perm_test(labels, y, strata, rng):
    groups = list(np.unique(labels))
    obs = stat(labels, y, strata, groups)
    idx_by_s = [np.where(strata == s)[0] for s in np.unique(strata)]
    count = 0
    lab = labels.copy()
    for _ in range(N_PERM):
        for idx in idx_by_s:
            lab[idx] = rng.permutation(labels[idx])
        if stat(lab, y, strata, groups) >= obs - 1e-12:
            count += 1
    return (count + 1) / (N_PERM + 1)


def holm(ps):
    order = sorted(range(len(ps)), key=lambda i: ps[i])
    out, running = [None] * len(ps), 0.0
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (len(ps) - rank) * ps[i]))
        out[i] = running
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default="gemini", choices=list(RUNS))
    args = ap.parse_args()
    profiles = json.loads((PILOT / "data" / "profiles.json").read_text(encoding="utf-8"))["profiles"]
    gem = {}
    for f in RUNS[args.run].glob("P*.json"):
        r = json.loads(f.read_text(encoding="utf-8"))
        if r.get("priority"):
            gem[r["id"]] = r["priority"]
    if len(gem) < len(profiles):
        raise SystemExit(f"{args.run}: only {len(gem)} of {len(profiles)} answers; run when complete")
    rows = []
    for p in profiles:
        s = len(p["indicators"])
        v = "High" if s >= 8 else "Medium" if s >= 4 else "Low"
        rows.append({**p, "score": s, "vis": v, "gem": gem[p["id"]]})
    up = sum(RANK[r["gem"]] > RANK[r["vis"]] for r in rows)
    down = sum(RANK[r["gem"]] < RANK[r["vis"]] for r in rows)

    elig = [r for r in rows if r["vis"] != "High"]
    y = np.array([RANK[r["gem"]] > RANK[r["vis"]] for r in elig], dtype=float)
    strata = np.array([r["score"] for r in elig])
    rng = np.random.default_rng(SEED)

    def describe(labels, order):
        out = []
        for g in order:
            m = labels == g
            out.append({"group": g, "n": int(m.sum()), "upgraded": int(y[m].sum()),
                        "rate": float(y[m].mean()) if m.sum() else None})
        return out

    demo = []
    for name, of, order in [
        ("Gender", lambda r: r["gender"], ["Female", "Male"]),
        ("Race", lambda r: r["race"], sorted({r["race"] for r in rows})),
        ("City", lambda r: r["location"], sorted({r["location"] for r in rows})),
        ("Age group", lambda r: age_group(r["age"]), ["18-24", "25-39", "40-59", "60 and older"]),
    ]:
        labels = np.array([of(r) for r in elig], dtype=object)
        demo.append({"factor": name, "groups": describe(labels, order), "p": perm_test(labels, y, strata, rng)})
    for d, ph in zip(demo, holm([d["p"] for d in demo])):
        d["p_holm"] = ph

    items = []
    for ind, name in ITEM_NAMES.items():
        labels = np.array(["Yes" if ind in r["indicators"] else "No" for r in elig], dtype=object)
        if len(set(labels)) < 2:
            continue
        g = describe(labels, ["Yes", "No"])
        items.append({"item": ind, "name": name, "with": g[0], "without": g[1],
                      "diff": (g[0]["rate"] or 0) - (g[1]["rate"] or 0), "p": perm_test(labels, y, strata, rng)})
    for it, ph in zip(items, holm([it["p"] for it in items])):
        it["p_holm"] = ph

    out = {
        "run": args.run, "n": len(rows), "eligible": len(elig), "upgraded": int(y.sum()),
        "direction": {"higher": up, "lower": down, "same": len(rows) - up - down, "p_sign": sign_test(up, down)},
        "method": "Stratified permutation tests (shuffled within VI-SPDAT score), 20,000 shuffles, Holm within family; "
                  "outcome = Gemini placed the person higher than VI-SPDAT, among people VI-SPDAT rated Low or Medium.",
        "demographics": demo, "items": sorted(items, key=lambda it: it["p"]),
    }
    path = PILOT / "results" / f"significance_{args.run}.json"
    path.write_text(json.dumps(out, indent=1), encoding="utf-8")
    with (PILOT / "results" / f"significance_{args.run}.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["family", "test", "group", "n", "upgraded", "rate", "p", "p_holm"])
        for d in demo:
            for g in d["groups"]:
                w.writerow(["demographic", d["factor"], g["group"], g["n"], g["upgraded"], g["rate"], d["p"], d["p_holm"]])
        for it in out["items"]:
            for side in ("with", "without"):
                g = it[side]
                w.writerow(["circumstance", it["name"], g["group"], g["n"], g["upgraded"], g["rate"], it["p"], it["p_holm"]])
    print(f"direction: {up} higher, {down} lower, sign test p = {out['direction']['p_sign']:.2e}")
    print(f"eligible (VI-SPDAT Low/Medium): {len(elig)}, upgraded {int(y.sum())}")
    for d in demo:
        print(f"  {d['factor']:10s} p={d['p']:.3f} holm={d['p_holm']:.3f}  " +
              "  ".join(f"{g['group'][:12]} {g['upgraded']}/{g['n']}" for g in d["groups"]))
    for it in out["items"]:
        print(f"  {it['name'][:38]:38s} with {it['with']['upgraded']}/{it['with']['n']}  without "
              f"{it['without']['upgraded']}/{it['without']['n']}  p={it['p']:.4f} holm={it['p_holm']:.3f}")
    print(f"wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
