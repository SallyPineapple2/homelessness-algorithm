"""
Who would get the housing, by personal characteristic: VI-SPDAT vs. an AI run.

The characteristics are the VI-SPDAT indicators written into each base profile (for example Money
Management for finances, Physical Health for illness). They were not assigned equally and they come
with different levels of real need, so a fair tool should treat people with and without a
characteristic the same *at the same level of real need* (true score 8 or more = truly high-need,
the Permanent Supportive Housing band). Two rates, for people with vs. without the characteristic:

  caught         of the truly high-need, the share the tool refers to housing
  over-referred  of those NOT truly high-need, the share the tool still refers

A tendency in favor of a characteristic shows up as a higher over-referral rate (and/or catch
rate) for people who have it; a tendency against it as lower rates.

Test (AI run): the characteristic belongs to the base profile, so a profile's records are not
independent. A permutation test reassigns the characteristic across the 32 base profiles (same
number of profiles) 10,000 times; p is the share of reassignments with a difference at least as
large as observed. Holm correction across characteristics.

Run:    python scripts/allocation_by_trait.py --run gemini
Writes: data/ai/results/allocation_by_trait_<run>.csv
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
ap.add_argument("--n", type=int, default=10000)
args = ap.parse_args()

roster = json.loads((ROOT / "data" / "ai" / "models.json").read_text(encoding="utf-8"))["models"]
label = next(m["label"] for m in roster if m["key"] == args.run)
profiles = {p["id"]: p for p in json.loads((ROOT / "data" / "base_profiles.json").read_text(encoding="utf-8"))["profiles"]}
inst = json.loads((ROOT / "data" / "vispdat_instrument.json").read_text(encoding="utf-8"))
TRAITS = [(i["id"], i["name"], d["name"]) for d in inst["domains"] for i in d["indicators"]]

df = pd.DataFrame(list(csv.DictReader((RES / f"{args.run}.csv").open(encoding="utf-8-sig"))))
for c in ("score", "vispdat_score", "true_score"):
    df[c] = df[c].astype(int)
truth = (df.true_score >= 8).values
vis = (df.vispdat_score >= 8).values
ai = (df.score >= 8).values
prof_ids = np.array(sorted(df.profile.unique()))
rec_prof = df.profile.values
rng = np.random.default_rng(20261006)


def rate(refer, mask):
    return refer[mask].mean() if mask.any() else np.nan


def diffs(has, refer):
    """(caught with - caught without, over-referred with - over-referred without)"""
    c = rate(refer, has & truth) - rate(refer, ~has & truth)
    o = rate(refer, has & ~truth) - rate(refer, ~has & ~truth)
    return c, o


def holm(ps):
    ps = [1.0 if np.isnan(p) else p for p in ps]
    order = np.argsort(ps)
    adj, run = [0.0] * len(ps), 0.0
    for rank, i in enumerate(order):
        run = max(run, min(1.0, (len(ps) - rank) * ps[i]))
        adj[i] = run
    return adj


rows, seen = [], {}
for tid, tname, dname in TRAITS:
    with_p = [p for p in prof_ids if tid in profiles[p]["indicators"]]
    if not with_p or len(with_p) == len(prof_ids):
        continue
    key = frozenset(with_p)
    if key in seen:  # same profiles as an earlier trait (Mental Health and Tri-Morbidity): one test
        rows[seen[key]]["trait"] += f" / {tname}"
        continue
    has = np.isin(rec_prof, with_p)
    obs_c, obs_o = diffs(has, ai)
    hits_c = hits_o = valid_c = valid_o = 0
    for _ in range(args.n):
        perm = rng.choice(prof_ids, size=len(with_p), replace=False)
        c, o = diffs(np.isin(rec_prof, perm), ai)
        if not np.isnan(c) and not np.isnan(obs_c):
            valid_c += 1
            hits_c += abs(c) >= abs(obs_c) - 1e-12
        if not np.isnan(o) and not np.isnan(obs_o):
            valid_o += 1
            hits_o += abs(o) >= abs(obs_o) - 1e-12
    seen[key] = len(rows)
    rows.append({
        "trait": tname, "domain": dname, "profiles": len(with_p),
        "truly_high_need_with": int((has & truth).sum()), "not_high_need_with": int((has & ~truth).sum()),
        "vis_caught_with": rate(vis, has & truth), "vis_caught_without": rate(vis, ~has & truth),
        "ai_caught_with": rate(ai, has & truth), "ai_caught_without": rate(ai, ~has & truth),
        "ai_over_with": rate(ai, has & ~truth), "ai_over_without": rate(ai, ~has & ~truth),
        "vis_over_with": rate(vis, has & ~truth), "vis_over_without": rate(vis, ~has & ~truth),
        "ai_caught_diff": obs_c, "ai_over_diff": obs_o,
        "p_caught": (hits_c + 1) / (valid_c + 1) if valid_c else np.nan,
        "p_over": (hits_o + 1) / (valid_o + 1) if valid_o else np.nan,
    })
for key_p in ("p_caught", "p_over"):
    for r, pa in zip(rows, holm([r[key_p] for r in rows])):
        r[key_p + "_holm"] = pa

out = pd.DataFrame(rows).sort_values("ai_over_diff", ascending=False, na_position="last")
out.to_csv(RES / f"allocation_by_trait_{args.run}.csv", index=False, encoding="utf-8-sig")
pct = lambda v: "  —  " if pd.isna(v) else f"{100*v:4.0f}%"
print(f"truly high-need {truth.sum()}, VI-SPDAT referrals {vis.sum()}, {label} referrals {ai.sum()} (of {len(df)})")
print(f"{'trait':38} prof | CAUGHT VI with/without | {label[:6]} with/without | OVER-REFERRED {label[:6]} with/without | p_over holm | p_caught holm")
for _, r in out.iterrows():
    print(f"{r.trait[:38]:38} {r.profiles:3}  | {pct(r.vis_caught_with)} {pct(r.vis_caught_without)} | {pct(r.ai_caught_with)} {pct(r.ai_caught_without)} | "
          f"{pct(r.ai_over_with)} {pct(r.ai_over_without)} | {r.p_over:.3f} {r.p_over_holm:.3f} | {r.p_caught:.3f} {r.p_caught_holm:.3f}")
