"""
Fixed capacity: if there are only as many High and Medium places as VI-SPDAT assigns,
who gets them under each approach?

Places: 35 High (Permanent Supportive Housing) and 40 Medium (Rapid Re-Housing), the
numbers VI-SPDAT assigns to these 100 people.

  VI-SPDAT  fills High places with its highest scores, then Medium places with the next.
            (Its cut-offs fall exactly on 35 and 40, so there are no ties.)
  Gemini    the tie-break run (scripts/gemini_prompt.py, variant "scored"): people are
            ordered by Gemini's category, then by its 1-100 urgency rating. High places go
            to the top 35, Medium places to the next 40. People tied at a cut-off share the
            remaining places evenly (each gets the same fraction).
  Lottery   for reference, the main run (category only): Gemini's High group shares the
            High places evenly, the rest fill Medium places first, then Gemini's Medium group.

Per group it reports the expected number of High and Medium places, and a stratified
permutation test (labels shuffled among people with the same VI-SPDAT score) of whether
Gemini's High places are spread across a demographic factor differently from chance.

Run:  python pilot/scripts/fixed_capacity.py
Writes: pilot/results/fixed_capacity.json, pilot/results/fixed_capacity.csv
"""

import csv
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
PILOT = ROOT / "pilot"
RANK = {"Low": 0, "Medium": 1, "High": 2}
N_PERM = 20000
SEED = 20261018
ITEMS = {
    "a1_sleep": "Unsheltered", "a2_duration": "Homeless 1+ year or 4+ times", "b1_emergency": "4+ emergency contacts",
    "b2_harm": "Risk of harm", "b3_legal": "Legal issues", "b4_exploitation": "Risk of exploitation",
    "c1_money": "No income or owes money", "c2_activity": "No meaningful daily activity",
    "c3_selfcare": "Cannot meet basic needs", "c4_relationships": "Homeless due to relationship breakdown",
    "d1_physical": "Physical health condition", "d2_substance": "Substance use", "d3_mental": "Mental health condition",
    "d5_medications": "Medication problems", "d6_trauma": "Homeless due to abuse or trauma", "pre_age": "Age 60 or older",
}


def load_run(folder):
    out = {}
    for f in (PILOT / "data" / folder / "raw").glob("P*.json"):
        r = json.loads(f.read_text(encoding="utf-8"))
        if r.get("priority"):
            out[r["id"]] = r
    return out


def fill(order_key, ids, places):
    """
    Expected places per person, filling each level from the top of the order. People tied
    at a cut-off share what is left evenly; whatever chance a person did not use at one
    level carries to the next, still ahead of everyone ranked below them.
    """
    mass = {i: 1.0 for i in ids}
    result = []
    for cap in places:
        alloc = {i: 0.0 for i in ids}
        left = float(cap)
        for k in sorted({order_key[i] for i in ids}, reverse=True):
            if left <= 1e-12:
                break
            tier = [i for i in ids if order_key[i] == k and mass[i] > 1e-12]
            need = sum(mass[i] for i in tier)
            if not need:
                continue
            frac = min(1.0, left / need)
            for i in tier:
                alloc[i] = mass[i] * frac
            left -= need * frac
        for i in ids:
            mass[i] -= alloc[i]
        result.append(alloc)
    return result


def age_group(a):
    return "18-24" if a < 25 else "25-39" if a < 40 else "40-59" if a < 60 else "60 and older"


def main():
    profiles = json.loads((PILOT / "data" / "profiles.json").read_text(encoding="utf-8"))["profiles"]
    ids = [p["id"] for p in profiles]
    P = {p["id"]: p for p in profiles}
    score = {i: len(P[i]["indicators"]) for i in ids}
    vis_cat = {i: "High" if score[i] >= 8 else "Medium" if score[i] >= 4 else "Low" for i in ids}
    n_high = sum(v == "High" for v in vis_cat.values())
    n_med = sum(v == "Medium" for v in vis_cat.values())

    scored = load_run("gemini-gemini-3.5-flash-lite-scored")
    main_run = load_run("gemini")
    if len(scored) < len(ids) or len(main_run) < len(ids):
        raise SystemExit(f"need all answers: scored {len(scored)}, main {len(main_run)}")

    # VI-SPDAT: by score
    v_high, v_med = fill(score, ids, [n_high, n_med])
    # Gemini tie-break run: category, then urgency
    gkey = {i: RANK[scored[i]["priority"]] * 1000 + scored[i]["urgency"] for i in ids}
    g_high, g_med = fill(gkey, ids, [n_high, n_med])
    # Lottery: category only (main run)
    lkey = {i: RANK[main_run[i]["priority"]] for i in ids}
    l_high, l_med = fill(lkey, ids, [n_high, n_med])

    to_vis_high = lambda alloc: sum(alloc[i] for i in ids if vis_cat[i] == "High")
    summary = {
        "places": {"High": n_high, "Medium": n_med},
        "high_places_to_vispdat_high": {"tie_break": round(to_vis_high(g_high), 1), "lottery": round(to_vis_high(l_high), 1)},
        "high_places_to_vispdat_medium": {"tie_break": round(sum(g_high[i] for i in ids if vis_cat[i] == "Medium"), 1),
                                          "lottery": round(sum(l_high[i] for i in ids if vis_cat[i] == "Medium"), 1)},
        "high_places_to_vispdat_low": {"tie_break": round(sum(g_high[i] for i in ids if vis_cat[i] == "Low"), 1),
                                       "lottery": round(sum(l_high[i] for i in ids if vis_cat[i] == "Low"), 1)},
        "scored_vs_main_same_category": sum(scored[i]["priority"] == main_run[i]["priority"] for i in ids),
        "scored_high": sum(scored[i]["priority"] == "High" for i in ids),
        "urgency_spearman_with_vispdat": None,
    }
    u = np.array([scored[i]["urgency"] for i in ids], dtype=float)
    s = np.array([score[i] for i in ids], dtype=float)
    rank = lambda x: np.argsort(np.argsort(x)).astype(float)
    summary["urgency_spearman_with_vispdat"] = round(float(np.corrcoef(rank(u), rank(s))[0, 1]), 3)

    factors = [
        ("Gender", lambda i: P[i]["gender"]), ("Race", lambda i: P[i]["race"]),
        ("City", lambda i: P[i]["location"]), ("Age group", lambda i: age_group(P[i]["age"])),
    ] + [(name, (lambda k: lambda i: "Yes" if k in P[i]["indicators"] else "No")(k)) for k, name in ITEMS.items()]

    rng = np.random.default_rng(SEED)
    strata = np.array([score[i] for i in ids])
    gh = np.array([g_high[i] for i in ids])

    def spread_stat(labels):
        # sum over groups of (Gemini High places - VI-SPDAT-matched expectation)^2 / expectation
        tot = 0.0
        for g in set(labels):
            m = labels == g
            e = sum(gh[strata == st].mean() * (m & (strata == st)).sum() for st in np.unique(strata))
            if e > 0:
                tot += (gh[m].sum() - e) ** 2 / e
        return tot

    rows, tests = [], []
    for fname, of in factors:
        labels = np.array([of(i) for i in ids], dtype=object)
        obs = spread_stat(labels)
        lab = labels.copy()
        cnt = 0
        for _ in range(N_PERM):
            for st in np.unique(strata):
                idx = np.where(strata == st)[0]
                lab[idx] = rng.permutation(labels[idx])
            cnt += spread_stat(lab) >= obs - 1e-12
        p = (cnt + 1) / (N_PERM + 1)
        tests.append({"factor": fname, "p": p, "family": "demographic" if fname in ("Gender", "Race", "City", "Age group") else "circumstance"})
        for g in sorted(set(labels), key=str):
            m = [i for i in ids if of(i) == g]
            rows.append({
                "factor": fname, "group": g, "n": len(m),
                "vispdat_high": round(sum(v_high[i] for i in m), 2), "gemini_high": round(sum(g_high[i] for i in m), 2),
                "lottery_high": round(sum(l_high[i] for i in m), 2),
                "vispdat_medium": round(sum(v_med[i] for i in m), 2), "gemini_medium": round(sum(g_med[i] for i in m), 2),
                "lottery_medium": round(sum(l_med[i] for i in m), 2),
            })
    for fam in ("demographic", "circumstance"):
        ts = [t for t in tests if t["family"] == fam]
        order = sorted(range(len(ts)), key=lambda k: ts[k]["p"])
        run = 0.0
        for r, k in enumerate(order):
            run = max(run, min(1.0, (len(ts) - r) * ts[k]["p"]))
            ts[k]["p_holm"] = run

    people = [{"id": i, "vispdat_score": score[i], "vispdat": vis_cat[i], "gemini": scored[i]["priority"],
               "urgency": scored[i]["urgency"], "gemini_high_place": round(g_high[i], 3),
               "gemini_medium_place": round(g_med[i], 3)} for i in ids]
    out = {"summary": summary, "groups": rows, "tests": tests, "people": people,
           "method": "Places fixed at VI-SPDAT's 35 High and 40 Medium. Gemini fills them in order of category, then 1-100 "
                     "urgency (tie-break run); ties at a cut-off share places evenly. Tests: stratified permutation "
                     "(shuffled within VI-SPDAT score), 20,000 shuffles, Holm within family."}
    (PILOT / "results" / "fixed_capacity.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    with (PILOT / "results" / "fixed_capacity.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    print(json.dumps(summary, indent=1))
    for t in tests:
        print(f"  {t['factor']:40s} p={t['p']:.4f} holm={t['p_holm']:.3f}")
    for r in rows:
        if r["factor"] in ("Gender", "Race", "City", "Age group", "Substance use", "Mental health condition",
                           "Homeless due to relationship breakdown"):
            print(f"  {r['factor'][:14]:14s} {str(r['group'])[:24]:24s} n={r['n']:3d}  High: VI {r['vispdat_high']:5.1f}  "
                  f"Gemini {r['gemini_high']:5.1f}  lottery {r['lottery_high']:5.1f}")


if __name__ == "__main__":
    main()
