"""
Analyse the limited-places run (run_gemini_pool.py): the same 100 applicants, the same 35 High
and 40 Medium places, filled by VI-SPDAT (highest scores first) and by Gemini (its own
assignment, repeated in several rounds with the applicants in a different order each time).

Reports: agreement per round, how stable Gemini's assignment is across rounds, who gets the
places by group, and stratified permutation tests (labels shuffled among people with the
same VI-SPDAT score) of whether Gemini's High places are spread across a demographic factor
or circumstance differently from chance. Holm correction within each family.

Run:  python pilot/scripts/analyze_pool.py [--model gemini-3.8-flash]
Writes: pilot/results/pool_<model>.json, pilot/results/pool_<model>_groups.csv
"""

import argparse
import re
import csv
import itertools
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fixed_capacity import ITEMS, age_group, fill  # noqa: E402

PILOT = Path(__file__).resolve().parents[1]
CATS = ["High", "Medium", "Low"]
RANK = {"Low": 0, "Medium": 1, "High": 2}
N_PERM, SEED = 20000, 20261101


def kappa(obs):
    """Linear-weighted kappa from a {(vispdat, gemini): count} table (counts may be fractional)."""
    n = sum(obs.values())
    rv = {a: sum(obs[(a, b)] for b in CATS) for a in CATS}
    rg = {b: sum(obs[(a, b)] for a in CATS) for b in CATS}
    num = sum(abs(RANK[a] - RANK[b]) / 2 * obs[(a, b)] / n for a in CATS for b in CATS)
    den = sum(abs(RANK[a] - RANK[b]) / 2 * rv[a] / n * rg[b] / n for a in CATS for b in CATS)
    return 1 - num / den if den else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="gemini-3.8-flash")
    ap.add_argument("--high", type=int, default=35)
    ap.add_argument("--medium", type=int, default=40)
    args = ap.parse_args()
    tag = "" if (args.high, args.medium) == (35, 40) else f"-h{args.high}m{args.medium}"
    profiles = json.loads((PILOT / "data" / "profiles.json").read_text(encoding="utf-8"))["profiles"]
    P = {p["id"]: p for p in profiles}
    ids = [p["id"] for p in profiles]
    score = {i: len(P[i]["indicators"]) for i in ids}
    # VI-SPDAT fills the places by score; people tied at a cut-off share the places evenly
    v_high, v_med = fill(score, ids, [args.high, args.medium])
    vp = {i: {"High": v_high[i], "Medium": v_med[i], "Low": 1 - v_high[i] - v_med[i]} for i in ids}
    vis = {i: max(CATS, key=lambda c: vp[i][c]) for i in ids}
    rounds = [json.loads(f.read_text(encoding="utf-8"))
              for f in sorted((PILOT / "data" / f"gemini-pool-{args.model}{tag}" / "raw").glob("round*.json"), key=lambda f: int(re.search(r"(\d+)", f.stem).group(1)))]
    R = len(rounds)
    gem = [{i: r["assignments"][i]["priority"] for i in ids} for r in rounds]

    per_round = []
    for k, g in enumerate(gem, start=1):
        tab = {(a, b): sum(vp[i][a] for i in ids if g[i] == b) for a in CATS for b in CATS}
        per_round.append({
            "round": k, "same": round(sum(tab[(c, c)] for c in CATS), 1),
            "higher": round(sum(v for (a, b), v in tab.items() if RANK[b] > RANK[a]), 1),
            "lower": round(sum(v for (a, b), v in tab.items() if RANK[b] < RANK[a]), 1),
            "kappa": round(kappa(tab), 3),
            "crosstab": {f"{a}->{b}": round(tab[(a, b)], 1) for a in CATS for b in CATS},
            "high_to_vispdat_high": round(tab[("High", "High")], 1),
        })
    pair_agree = [sum(a[i] == b[i] for i in ids) for a, b in itertools.combinations(gem, 2)]
    always = {c: sum(all(g[i] == c for g in gem) for i in ids) for c in CATS}
    stable = sum(len({g[i] for g in gem}) == 1 for i in ids)

    # Consensus: order people by their mean category over the rounds, then fill the places
    mean_rank = {i: sum(RANK[g[i]] for g in gem) / R for i in ids}
    g_high, g_med = fill(mean_rank, ids, [args.high, args.medium])
    consensus = {f"{a}->{b}": 0.0 for a in CATS for b in CATS}
    for i in ids:
        probs = {"High": g_high[i], "Medium": g_med[i], "Low": 1 - g_high[i] - g_med[i]}
        for a in CATS:
            for b in CATS:
                consensus[f"{a}->{b}"] += vp[i][a] * probs[b]
    consensus = {k: round(v, 1) for k, v in consensus.items()}

    # High places per person: share of rounds in which Gemini put them in High
    gh_share = {i: sum(g[i] == "High" for g in gem) / R for i in ids}
    gm_share = {i: sum(g[i] == "Medium" for g in gem) / R for i in ids}

    factors = [("Gender", lambda i: P[i]["gender"]), ("Race", lambda i: P[i]["race"]),
               ("City", lambda i: P[i]["location"]), ("Age group", lambda i: age_group(P[i]["age"]))] + \
              [(name, (lambda k: lambda i: "Yes" if k in P[i]["indicators"] else "No")(k)) for k, name in ITEMS.items()]
    rng = np.random.default_rng(SEED)
    strata = np.array([score[i] for i in ids])
    gh = np.array([gh_share[i] for i in ids])

    def spread(labels):
        tot = 0.0
        for g in set(labels):
            m = labels == g
            e = sum(gh[strata == st].mean() * (m & (strata == st)).sum() for st in np.unique(strata))
            if e > 0:
                tot += (gh[m].sum() - e) ** 2 / e
        return tot

    rows, tests, detail = [], [], {}
    ids_of = {name: k for k, name in ITEMS.items()}
    expected = {i: float(np.mean([gh_share[j] for j in ids if score[j] == score[i]])) for i in ids}
    for fname, of in factors:
        labels = np.array([of(i) for i in ids], dtype=object)
        obs, lab, cnt = spread(labels), labels.copy(), 0
        for _ in range(N_PERM):
            for st in np.unique(strata):
                idx = np.where(strata == st)[0]
                lab[idx] = rng.permutation(labels[idx])
            cnt += spread(lab) >= obs - 1e-12
        if fname in ids_of:
            w = [i for i in ids if of(i) == "Yes"]
            detail[fname] = {"id": ids_of[fname], "n": len(w), "observed": round(float(np.mean([gh_share[i] for i in w])), 3),
                             "expected": round(float(np.mean([expected[i] for i in w])), 3)}
        tests.append({"factor": fname, "p": (cnt + 1) / (N_PERM + 1),
                      "family": "demographic" if fname in ("Gender", "Race", "City", "Age group") else "circumstance"})
        for g in sorted(set(labels), key=str):
            m = [i for i in ids if of(i) == g]
            rows.append({"factor": fname, "group": g, "n": len(m),
                         "vispdat_high": round(sum(v_high[i] for i in m), 1), "gemini_high": round(sum(gh_share[i] for i in m), 1),
                         "vispdat_medium": round(sum(v_med[i] for i in m), 1), "gemini_medium": round(sum(gm_share[i] for i in m), 1),
                         "vispdat_low": round(sum(vp[i]["Low"] for i in m), 1),
                         "gemini_low": round(len(m) - sum(gh_share[i] + gm_share[i] for i in m), 1)})
    for fam in ("demographic", "circumstance"):
        ts = [t for t in tests if t["family"] == fam]
        run = 0.0
        for r, k in enumerate(sorted(range(len(ts)), key=lambda k: ts[k]["p"])):
            run = max(run, min(1.0, (len(ts) - r) * ts[k]["p"]))
            ts[k]["p_holm"] = run

    import statsmodels.api as sm
    fids = list(ITEMS) + ["d4_trimorbidity"]
    fname_of = dict(ITEMS, d4_trimorbidity="Tri-morbidity")
    X = np.array([[1.0 if f in P[i]["indicators"] else 0.0 for f in fids] for i in ids])
    keep = [k for k in range(len(fids)) if 0 < X[:, k].sum() < len(ids)]
    fit = sm.OLS(gh, sm.add_constant(X[:, keep])).fit(cov_type="HC3")
    ci = fit.conf_int()
    eff = [{"id": fids[k], "name": fname_of[fids[k]], "people": int(X[:, k].sum()), "effect": round(float(fit.params[j + 1]), 3),
            "ci_low": round(float(ci[j + 1][0]), 3), "ci_high": round(float(ci[j + 1][1]), 3), "p": float(fit.pvalues[j + 1])}
           for j, k in enumerate(keep)]
    run = 0.0
    for r, k in enumerate(sorted(range(len(eff)), key=lambda k: eff[k]["p"])):
        run = max(run, min(1.0, (len(eff) - r) * eff[k]["p"]))
        eff[k]["p_holm"] = run
    r2_all = round(float(fit.rsquared), 3)
    r2_score = round(float(sm.OLS(gh, sm.add_constant(np.array([score[i] for i in ids], dtype=float))).fit().rsquared), 3)
    by_score = [{"score": s_, "n": int((strata == s_).sum()), "high": round(float(gh[strata == s_].mean()), 3),
                 "medium": round(float(np.mean([gm_share[i] for i in ids if score[i] == s_])), 3)} for s_ in sorted(set(score.values()))]
    usage = [r["usage"] for r in rounds if r.get("usage")]
    out = {"model": args.model, "rounds": R, "model_versions": sorted({r["model_version"] for r in rounds}),
           "places": {"High": args.high, "Medium": args.medium, "Low": 100 - args.high - args.medium},
           "per_round": per_round,
           "round_to_round_same_category": {"mean": round(float(np.mean(pair_agree)), 1), "min": min(pair_agree), "max": max(pair_agree)},
           "same_category_in_every_round": stable, "high_in_every_round": always["High"],
           "consensus_crosstab_vispdat_to_gemini": consensus,
           "tokens_per_round": {k: int(np.mean([u[k] or 0 for u in usage])) for k in
                                ("prompt_token_count", "thoughts_token_count", "candidates_token_count")} if usage else None,
           "tests": tests, "circumstances": detail, "factor_effects": eff, "r2_factors": r2_all, "r2_score_only": r2_score,
           "by_score": by_score, "groups": rows,
           "people": [{"id": i, "vispdat_score": score[i], "vispdat": vis[i], "high_rounds": round(gh_share[i] * R),
                       "medium_rounds": round(gm_share[i] * R), "low_rounds": R - round(gh_share[i] * R) - round(gm_share[i] * R)}
                      for i in ids]}
    (PILOT / "results" / f"pool_{args.model}{tag}.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    with (PILOT / "results" / f"pool_{args.model}{tag}_groups.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    print(json.dumps({k: v for k, v in out.items() if k in ("rounds", "round_to_round_same_category", "r2_factors", "r2_score_only")}))
    for t in tests:
        print(f"  {t['family'][:5]} {t['factor']:40s} p={t['p']:.4f} holm={t['p_holm']:.3f}")
    for r in rows:
        if r["factor"] in ("Gender", "Race", "City", "Age group"):
            print(f"  {r['factor'][:8]:8s} {str(r['group'])[:30]:30s} n={r['n']:3d} High VI {r['vispdat_high']:5.1f} Gemini {r['gemini_high']:5.1f}"
                  f" | Med VI {r['vispdat_medium']:5.1f} Gemini {r['gemini_medium']:5.1f}")


if __name__ == "__main__":
    main()
