"""
Collect the allocation comparisons into one data file for dashboard v2 (v2/index.html).

For every AI run that has both result files, it reads
  data/ai/results/equal_capacity_<run>.csv          (scripts/equal_capacity.py)
  data/ai/results/allocation_comparison_<run>.csv   (scripts/allocation_comparison.py)
and writes data/v2/allocation.json. The original dashboard's data is not touched.

Run:  python scripts/build_v2_data.py
"""

import csv
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "data" / "ai" / "results"
OUT = ROOT / "data" / "v2"
OUT.mkdir(parents=True, exist_ok=True)
roster = json.loads((ROOT / "data" / "ai" / "models.json").read_text(encoding="utf-8"))["models"]


def read(path):
    with path.open(encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


def num(v):
    try:
        f = float(v)
        return None if np.isnan(f) else f
    except (TypeError, ValueError):
        return None


models = []
for m in roster:
    key, label = m["key"], m["label"]
    eq_path, ac_path = RES / f"equal_capacity_{key}.csv", RES / f"allocation_comparison_{key}.csv"
    if not (eq_path.exists() and ac_path.exists()):
        continue
    eq, ac = read(eq_path), read(ac_path)
    capacity = []
    for r in eq:
        capacity.append({
            "section": r["section"], "characteristic": r["characteristic"], "group": r["group"],
            "fair": num(r["fair"]), "vispdat": num(r["VI-SPDAT"]), "ai": num(r[label]),
            "dev_vispdat": num(r["dev_VI-SPDAT"]), "dev_ai": num(r[f"dev_{label}"]),
            "p_vispdat": num(r["p_VI-SPDAT"]), "p_ai": num(r[f"p_{label}"]),
        })
    rates = []
    for r in ac:
        profile = r["section"] == "Profile"
        rates.append({
            "section": r["section"], "characteristic": r["characteristic"], "group": r["group"],
            "records": int(float(r["records"])), "truly": num(r["truly"]),
            "vispdat": num(r["VI-SPDAT"]), "ai": num(r[label]),
            "p_vispdat": num(r["p_vis_holm"] if profile else r["p_vis"]),
            "p_ai": num(r["p_ai_holm"] if profile else r["p_ai"]),
        })
    # overall numbers for this run (from its record file)
    recs = read(RES / f"{key}.csv")
    truth = np.array([int(x["true_score"]) >= 8 for x in recs])
    vis = np.array([int(x["vispdat_score"]) >= 8 for x in recs])
    ai = np.array([int(x["score"]) >= 8 for x in recs])
    k = int(truth.sum())

    def places(scores):
        s = np.asarray(scores)
        cut = np.sort(s)[::-1][k - 1]
        w = (s > cut).astype(float)
        at = s == cut
        w[at] = (k - (s > cut).sum()) / at.sum()
        return w

    pv = places([int(x["vispdat_score"]) for x in recs])
    pa = places([int(x["score"]) for x in recs])
    models.append({
        "key": key, "label": label, "family": m.get("family"),
        "records": len(recs), "truly_need": k, "capacity": k,
        "referred_vispdat": int(vis.sum()), "referred_ai": int(ai.sum()),
        "capacity_to_truly_vispdat": round(float((pv * truth).sum()), 1),
        "capacity_to_truly_ai": round(float((pa * truth).sum()), 1),
        "capacity": capacity, "rates": rates,
    })

data = {
    "note": ("Housing = referral to Permanent Supportive Housing (score 8 or more). Truly needs housing = true score "
             "8 or more. Equal capacity: both tools fill the same number of places (the number who truly need "
             "housing) with their highest scores; ties at the cutoff share places evenly. Fair share: population "
             "share for race, gender, city, and disclosure; share of everyone who truly needs housing for profile "
             "characteristics. p: permutation tests (demographic labels shuffled within base profile; profile "
             "characteristics reassigned across the 32 base profiles, Holm-corrected)."),
    "models": models,
}
(OUT / "allocation.json").write_text(json.dumps(data, indent=1), encoding="utf-8")
print(f"wrote data/v2/allocation.json with {len(models)} AI runs: " + ", ".join(m["label"] for m in models))
