"""
Who would get the housing? Share of referrals going to each demographic group, VI-SPDAT vs. an AI run.

The design is balanced: within every base profile, each gender, race, city, and disclosure condition
appears equally often, so a tool with no demographic tendency gives every group its equal share
(50% per gender, 20% per race, 20% per city, 50% per disclosure condition).

Two allocations:
  PSH referral   every record scoring 8 or more (the VI-SPDAT's Permanent Supportive Housing band)
  Top 25%        only the 160 highest-scoring of the 640 records can be housed; ties at the cutoff
                 are broken at random (averaged over 2,000 draws), which is how a fixed number of
                 slots would be filled

Test: permutation. The group labels are shuffled within each base profile (keeping the design
intact) 10,000 times; p is the share of shuffles whose departure from equal shares (chi-square
statistic) is at least as large as the one observed.

Run:    python scripts/allocation_shares.py --run gemini
Writes: data/ai/results/allocation_shares_<run>.csv
"""

import argparse
import csv
import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "data" / "ai" / "results"
ap = argparse.ArgumentParser()
ap.add_argument("--run", default="gemini")
ap.add_argument("--top", type=float, default=0.25, help="share of records that can be housed")
args = ap.parse_args()
label = next(m["label"] for m in json.loads((ROOT / "data" / "ai" / "models.json").read_text(encoding="utf-8"))["models"]
             if m["key"] == args.run)

df = pd.DataFrame(list(csv.DictReader((RES / f"{args.run}.csv").open(encoding="utf-8-sig"))))
for c in ("score", "vispdat_score"):
    df[c] = df[c].astype(int)
rng = np.random.default_rng(20261004)
k = int(round(args.top * len(df)))

SHORT = {"American Indian, Alaska Native, or Indigenous": "American Indian or Alaska Native",
         "Asian or Asian American": "Asian", "Black, African American, or African": "Black",
         "Hispanic/Latino/e/a": "Hispanic or Latino", "White": "White"}
df["race"] = df["race"].map(SHORT)
df["location"] = df["location"].str.replace(r", [A-Z][a-z]+( [A-Z][a-z]+)?$", "", regex=True)
FACTORS = [("gender", "Gender"), ("race", "Race"), ("location", "City"), ("disclosure", "Disclosure")]


def top_weights(scores):
    """Expected chance each record is among the top k, ties at the cutoff split evenly."""
    s = np.asarray(scores)
    order = np.sort(s)[::-1]
    cut = order[k - 1]
    above = s > cut
    at = s == cut
    need = k - above.sum()
    w = above.astype(float)
    w[at] = need / at.sum()
    return w


def shares(groups, weights):
    g = pd.Series(weights).groupby(np.asarray(groups)).sum()
    return g / g.sum()


def chi(groups, weights, levels):
    tot = weights.sum()
    exp = tot / len(levels)
    obs = pd.Series(weights).groupby(np.asarray(groups)).sum().reindex(levels, fill_value=0).values
    return ((obs - exp) ** 2 / exp).sum()


def perm_p(field, weights, n=10000):
    levels = sorted(df[field].unique())
    obs = chi(df[field].values, weights, levels)
    prof = df["profile"].values
    idx_by_prof = [np.where(prof == p)[0] for p in np.unique(prof)]
    labels = df[field].values.copy()
    count = 0
    for _ in range(n):
        lab = labels.copy()
        for idx in idx_by_prof:
            lab[idx] = labels[idx][rng.permutation(len(idx))]
        if chi(lab, weights, levels) >= obs - 1e-12:
            count += 1
    return (count + 1) / (n + 1)


tools = {"VI-SPDAT": df["vispdat_score"].values, label: df["score"].values}
psh = {t: (s >= 8).astype(float) for t, s in tools.items()}
top = {t: top_weights(s) for t, s in tools.items()}

rows = []
for field, fname in FACTORS:
    levels = sorted(df[field].unique())
    fair = 1 / len(levels)
    p_psh = {t: perm_p(field, psh[t]) if t != "VI-SPDAT" else 1.0 for t in tools}
    p_top = {t: perm_p(field, top[t]) if t != "VI-SPDAT" else 1.0 for t in tools}
    for lvl in levels:
        row = {"factor": fname, "group": lvl, "equal_share": fair}
        for t in tools:
            row[f"{t} PSH share"] = shares(df[field].values, psh[t])[lvl]
            row[f"{t} top share"] = shares(df[field].values, top[t])[lvl]
        rows.append(row)
    rows.append({"factor": fname, "group": "p (permutation)", "equal_share": None,
                 **{f"{t} PSH share": p_psh[t] for t in tools}, **{f"{t} top share": p_top[t] for t in tools}})

out = pd.DataFrame(rows)
out.to_csv(RES / f"allocation_shares_{args.run}.csv", index=False, encoding="utf-8-sig")
print(f"PSH referrals: VI-SPDAT {int(psh['VI-SPDAT'].sum())}, {label} {int(psh[label].sum())} of {len(df)}; top {args.top:.0%} = {k} records")
for _, r in out.iterrows():
    if r["group"] == "p (permutation)":
        print(f"   {'p':34}  PSH: {label} p = {r[f'{label} PSH share']:.3f}   top: {label} p = {r[f'{label} top share']:.3f}")
    else:
        print(f"{r['factor']:10} {r['group']:34} equal {100*r['equal_share']:4.1f}%  PSH: VI {100*r['VI-SPDAT PSH share']:5.1f}%  {label[:6]} {100*r[f'{label} PSH share']:5.1f}%   top: VI {100*r['VI-SPDAT top share']:5.1f}%  {label[:6]} {100*r[f'{label} top share']:5.1f}%")
