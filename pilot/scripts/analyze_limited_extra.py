"""
Extra statistics for the limited-places study: uncertainty, reliability, robustness, and power.

Reads the 10 rounds (pilot/data/gemini-pool-gemini-3.8-flash/raw) and the profiles, and writes
pilot/results/pool_extra.json:

  agreement      consensus agreement with Wilson 95% CI; per-round mean and range; weighted kappa with
                 bootstrap CI (resampling people)
  correlation    Spearman rho and Kendall tau between the VI-SPDAT score and Gemini's average category,
                 bootstrap CI
  reliability    Fleiss' kappa across the 10 rounds (3 categories), bootstrap CI
  consensus      agreement under three ways of combining rounds
  forest         for every demographic group and circumstance: High-place share under VI-SPDAT and
                 under Gemini, the difference, and a bootstrap 95% CI
  per_round      for each circumstance and round: stratified permutation p (the same test as the main
                 analysis, run on that round alone), and how many rounds reach p < .05
  power          minimum difference in High-place rate detectable at 80% power for a group of n people
  cost           tokens and estimated dollar cost

Run:  python pilot/scripts/analyze_limited_extra.py
"""

import csv
import glob
import re
import json
import sys
from pathlib import Path

import numpy as np
from scipy import stats

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fixed_capacity import ITEMS, age_group  # noqa: E402

PILOT = Path(__file__).resolve().parents[1]
ROOT = PILOT.parent
CATS = ["High", "Medium", "Low"]
RANK = {"High": 2, "Medium": 1, "Low": 0}
B = 2000
N_PERM = 2000
SEED = 20261105


def wilson(k, n, z=1.96):
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(float(c - h), 4), round(float(c + h), 4)]


def weighted_kappa(a, b):
    """Linear-weighted kappa for two arrays of ranks 0-2."""
    n = len(a)
    obs = np.zeros((3, 3))
    for x, y in zip(a, b):
        obs[x, y] += 1
    obs /= n
    ra, rb = obs.sum(1), obs.sum(0)
    w = np.abs(np.subtract.outer(np.arange(3), np.arange(3))) / 2
    den = (w * np.outer(ra, rb)).sum()
    return 1 - (w * obs).sum() / den if den else np.nan


def fleiss(counts):
    """Fleiss' kappa; counts is subjects x categories with n raters per subject."""
    N, k = counts.shape
    n = counts[0].sum()
    p_j = counts.sum(0) / (N * n)
    P_i = (np.square(counts).sum(1) - n) / (n * (n - 1))
    P_bar, P_e = P_i.mean(), np.square(p_j).sum()
    return (P_bar - P_e) / (1 - P_e)


def ci(x):
    return [round(float(np.percentile(x, 2.5)), 4), round(float(np.percentile(x, 97.5)), 4)]


def main():
    rng = np.random.default_rng(SEED)
    profiles = json.loads((PILOT / "data" / "profiles.json").read_text(encoding="utf-8"))["profiles"]
    P = {p["id"]: p for p in profiles}
    ids = [p["id"] for p in profiles]
    N = len(ids)
    with (PILOT / "data" / "vispdat_scores.csv").open(encoding="utf-8") as fh:
        vis = {r["id"]: r for r in csv.DictReader(fh)}
    score = np.array([int(vis[i]["score"]) for i in ids])
    vcat = np.array([RANK[vis[i]["priority"]] for i in ids])
    meta = json.loads((ROOT / "limited" / "data" / "dashboard.json").read_text(encoding="utf-8"))
    ans = meta["runs"][0]["answers"]
    ccat = np.array([RANK[ans[i]["priority"]] for i in ids])
    rounds = [json.loads(Path(f).read_text(encoding="utf-8")) for f in sorted(glob.glob(str(PILOT / "data" / "gemini-pool-gemini-3.8-flash" / "raw" / "round*.json")), key=lambda f: int(re.search(r"round(\d+)", f).group(1)))]
    R = len(rounds)
    G = np.array([[RANK[r["assignments"][i]["priority"]] for i in ids] for r in rounds])  # rounds x people
    H = (G == 2).astype(float)
    gh = H.mean(0)
    mean_rank = G.mean(0)

    # ---- agreement
    same_c = int((ccat == vcat).sum())
    per_round_same = [int((G[r] == vcat).sum()) for r in range(R)]
    boots = []
    for _ in range(B):
        idx = rng.integers(0, N, N)
        boots.append(weighted_kappa(vcat[idx], ccat[idx]))
    agreement = {
        "consensus_same": same_c, "n": N, "consensus_ci": wilson(same_c, N),
        "per_round_mean": round(float(np.mean(per_round_same)), 2), "per_round_sd": round(float(np.std(per_round_same, ddof=1)), 2),
        "per_round_min": min(per_round_same), "per_round_max": max(per_round_same),
        "kappa_consensus": round(float(weighted_kappa(vcat, ccat)), 4), "kappa_ci": ci(boots),
        "kappa_per_round_mean": round(float(np.mean([weighted_kappa(vcat, G[r]) for r in range(R)])), 4),
    }

    # ---- correlation of VI-SPDAT score and Gemini's average category
    rho = stats.spearmanr(score, mean_rank)[0]
    tau = stats.kendalltau(score, mean_rank)[0]
    br, bt = [], []
    for _ in range(B):
        idx = rng.integers(0, N, N)
        br.append(stats.spearmanr(score[idx], mean_rank[idx])[0])
        bt.append(stats.kendalltau(score[idx], mean_rank[idx])[0])
    correlation = {"spearman": round(float(rho), 4), "spearman_ci": ci(br), "kendall": round(float(tau), 4), "kendall_ci": ci(bt)}

    # ---- reliability across rounds
    counts = np.array([[(G[:, i] == c).sum() for c in (2, 1, 0)] for i in range(N)], dtype=float)
    fk = fleiss(counts)
    fb = [fleiss(counts[rng.integers(0, N, N)]) for _ in range(B)]
    pair = [float((G[a] == G[b]).sum()) for a in range(R) for b in range(a + 1, R)]
    reliability = {"fleiss_kappa": round(float(fk), 4), "fleiss_ci": ci(fb), "pairwise_mean": round(float(np.mean(pair)), 2),
                   "pairwise_min": int(min(pair)), "pairwise_max": int(max(pair))}

    # ---- consensus rules
    modal = np.array([np.bincount(G[:, i], minlength=3).argmax() for i in range(N)])  # ties go to the lower category
    consensus = {
        "mean_rank_allocation": {"same": same_c, "note": "top 35 by average category High, next 40 Medium, rest Low (used on the dashboard)"},
        "single_round_mean": {"same": round(float(np.mean(per_round_same)), 1), "note": "average over the 10 rounds"},
        "most_common_category": {"same": int((modal == vcat).sum()), "note": "each person's most common category; counts not held to 35/40/25",
                                 "counts": {c: int((modal == RANK[c]).sum()) for c in CATS}},
    }

    # ---- forest: High-place share under VI-SPDAT and Gemini, by group
    v_high = (vcat == 2).astype(float)
    groups = []
    factors = [("Gender", lambda i: P[i]["gender"]), ("Race", lambda i: P[i]["race"]), ("City", lambda i: P[i]["location"]),
               ("Age group", lambda i: age_group(P[i]["age"]))]
    for fname, of in factors:
        for g in sorted({of(i) for i in ids}, key=str):
            m = np.array([of(i) == g for i in ids])
            groups.append(("demographic", fname, g, m))
    for key, name in ITEMS.items():
        m = np.array([key in P[i]["indicators"] for i in ids])
        groups.append(("circumstance", name, "Yes", m))
    forest = []
    for fam, fname, g, m in groups:
        idx = np.where(m)[0]
        d = gh[idx] - v_high[idx]
        bs = [d[rng.integers(0, len(d), len(d))].mean() for _ in range(B)]
        forest.append({"family": fam, "factor": fname, "group": g, "n": int(m.sum()), "vispdat_high": round(float(v_high[idx].mean()), 4),
                       "gemini_high": round(float(gh[idx].mean()), 4), "diff": round(float(d.mean()), 4), "ci": ci(bs)})

    # ---- per-round permutation tests for the circumstances
    strata = [np.where(score == s)[0] for s in np.unique(score)]
    per_round = {}
    for key, name in ITEMS.items():
        has = np.array([key in P[i]["indicators"] for i in ids])
        row = []
        for r in range(R):
            h = H[r]
            obs = h[has].mean()
            lab = has.copy()
            sims = np.empty(N_PERM)
            for s in range(N_PERM):
                for idx in strata:
                    lab[idx] = rng.permutation(has[idx])
                sims[s] = h[lab].mean()
            mu = sims.mean()
            row.append(round(float(((np.abs(sims - mu) >= abs(obs - mu) - 1e-12).sum() + 1) / (N_PERM + 1)), 4))
        per_round[name] = {"p": row, "rounds_p05": int(sum(x < 0.05 for x in row)), "median_p": round(float(np.median(row)), 4)}

    # ---- power: smallest detectable difference in High-place rate for a group of n people
    resid = np.concatenate([gh[idx] - gh[idx].mean() for idx in strata])
    sd = float(np.sqrt((resid ** 2).sum() / (N - len(strata))))
    power = {"residual_sd": round(sd, 4), "mde": [{"n": n, "points": round(100 * 2.8 * sd * np.sqrt(1 / n + 1 / (N - n)), 1)}
                                                  for n in (10, 15, 20, 25, 30, 40, 50)],
             "note": "Difference in High-place rate (percentage points) a group of n people would need, against everyone else with the same VI-SPDAT score, for 80% power at alpha = .05 (normal approximation)."}

    # ---- cost
    prices = {"input": 0.75, "output": 3.75}
    tin = sum(r["usage"]["prompt_token_count"] for r in rounds)
    tth = sum(r["usage"]["thoughts_token_count"] for r in rounds)
    tout = sum(r["usage"]["candidates_token_count"] for r in rounds)
    cost = {"rounds": R, "input_tokens": tin, "reasoning_tokens": tth, "output_tokens": tout,
            "usd": round((tin * prices["input"] + (tth + tout) * prices["output"]) / 1e6, 2),
            "prices": "USD per million tokens: input 0.75, output (including reasoning) 3.75; Gemini 3.8 Flash, introductory pricing"}
    rounds_meta = [{"round": r["round"], "requested_at": r["requested_at"], "seconds": r["seconds"], "attempt": r["attempt"],
                    "prompt_sha256": r["prompt_sha256"], "model_version": r["model_version"]} for r in rounds]

    out = {"seed": SEED, "bootstrap": B, "permutations": N_PERM, "agreement": agreement, "correlation": correlation,
           "reliability": reliability, "consensus": consensus, "forest": forest, "per_round": per_round, "power": power,
           "cost": cost, "rounds_meta": rounds_meta}
    (PILOT / "results" / "pool_extra.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(json.dumps({k: out[k] for k in ("agreement", "correlation", "reliability", "consensus", "power", "cost")}, indent=1)[:3500])
    print({k: v["rounds_p05"] for k, v in per_round.items()})


if __name__ == "__main__":
    main()
