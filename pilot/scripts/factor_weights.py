"""
How much weight does each approach give each VI-SPDAT factor?

VI-SPDAT: every factor is worth exactly 1 point by design (tri-morbidity is a bonus point for
having physical, substance, and mental health together). A regression of the VI-SPDAT score on
the 17 factors recovers exactly 1.0 for each, which the script checks.

Gemini: its weights are not stated, so they are estimated. Gemini's 1-100 urgency rating (the
tie-break run, which also gives the category) is regressed on the same 17 factors (ordinary
least squares, HC3 robust standard errors). Each coefficient is how many urgency points the
factor adds, holding the other factors fixed.

To compare the two on one scale, each Gemini coefficient is also expressed relative to Gemini's
average factor weight ("relative weight": 1.0 = an average factor, as every VI-SPDAT factor is).
Tests:
  - joint F-test that all 17 Gemini weights are equal (VI-SPDAT's equal-weight rule)
  - per factor, whether its weight differs from Gemini's average weight (Holm-corrected)
  - per factor, whether it adds anything at all (coefficient different from 0; Holm-corrected)
  - a second model adding gender, race, city: do demographics move the rating once factors are known?

Factors co-occur in the profiles, so individual weights are imprecise with 100 people.

Run:  python pilot/scripts/factor_weights.py
Writes: pilot/results/factor_weights.csv, pilot/results/factor_weights.json
"""

import csv
import json
from pathlib import Path

import numpy as np
import statsmodels.api as sm
from statsmodels.stats.multitest import multipletests

ROOT = Path(__file__).resolve().parents[2]
PILOT = ROOT / "pilot"
NAMES = {
    "pre_age": "Age 60 or older", "a1_sleep": "Unsheltered", "a2_duration": "Homeless 1+ year or 4+ times",
    "b1_emergency": "4+ emergency service contacts", "b2_harm": "Risk of harm", "b3_legal": "Legal issues",
    "b4_exploitation": "Risk of exploitation", "c1_money": "No income or owes money",
    "c2_activity": "No meaningful daily activity", "c3_selfcare": "Cannot meet basic needs",
    "c4_relationships": "Homeless due to relationship breakdown", "d1_physical": "Physical health condition",
    "d2_substance": "Substance use", "d3_mental": "Mental health condition", "d4_trimorbidity": "Tri-morbidity",
    "d5_medications": "Medication problems", "d6_trauma": "Homeless due to abuse or trauma",
}


def main():
    profiles = json.loads((PILOT / "data" / "profiles.json").read_text(encoding="utf-8"))["profiles"]
    raw = {}
    for f in (PILOT / "data" / "gemini-gemini-3.5-flash-lite-scored" / "raw").glob("P*.json"):
        r = json.loads(f.read_text(encoding="utf-8"))
        raw[r["id"]] = r
    if len(raw) < len(profiles):
        raise SystemExit("tie-break run incomplete")
    keys = list(NAMES)
    X = np.array([[1.0 if k in p["indicators"] else 0.0 for k in keys] for p in profiles])
    y_gem = np.array([raw[p["id"]]["urgency"] for p in profiles], dtype=float)
    y_vis = X.sum(axis=1)

    Xc = sm.add_constant(X)
    vis = sm.OLS(y_vis, Xc).fit()
    assert np.allclose(vis.params[1:], 1.0), "VI-SPDAT weights should be exactly 1"

    gem = sm.OLS(y_gem, Xc).fit(cov_type="HC3")
    b, se, p0 = gem.params[1:], gem.bse[1:], gem.pvalues[1:]
    ci = gem.conf_int()[1:]
    mean_b = b.mean()

    # equal-weights test: all 17 coefficients equal (16 linear restrictions b_k - b_1 = 0)
    R = np.zeros((len(keys) - 1, len(keys) + 1))
    for k in range(1, len(keys)):
        R[k - 1, 1] = 1
        R[k - 1, k + 1] = -1
    eq = gem.f_test(R)

    # each weight vs Gemini's average weight
    p_avg = []
    for k in range(len(keys)):
        r = np.full(len(keys) + 1, -1.0 / len(keys))
        r[0] = 0
        r[k + 1] += 1
        p_avg.append(float(gem.t_test(r).pvalue))
    holm0 = multipletests(p0, method="holm")[1]
    holm_avg = multipletests(p_avg, method="holm")[1]

    # demographics on top of the factors
    races = sorted({p["race"] for p in profiles})
    cities = sorted({p["location"] for p in profiles})
    D = np.array([[1.0 if p["gender"] == "Female" else 0.0]
                  + [1.0 if p["race"] == r else 0.0 for r in races[:-1]]
                  + [1.0 if p["location"] == c else 0.0 for c in cities[:-1]] for p in profiles])
    full = sm.OLS(y_gem, sm.add_constant(np.hstack([X, D]))).fit(cov_type="HC3")
    nd = D.shape[1]
    Rd = np.zeros((nd, full.params.size))
    for j in range(nd):
        Rd[j, 1 + len(keys) + j] = 1
    demo = full.f_test(Rd)
    fem = 1 + len(keys)

    rows = []
    for k, key in enumerate(keys):
        rows.append({
            "factor": NAMES[key], "id": key, "people": int(X[:, k].sum()),
            "vispdat_weight": 1.0,
            "gemini_urgency_points": round(float(b[k]), 2), "ci_low": round(float(ci[k][0]), 2),
            "ci_high": round(float(ci[k][1]), 2), "p_vs_zero": float(p0[k]), "p_vs_zero_holm": float(holm0[k]),
            "gemini_relative_weight": round(float(b[k] / mean_b), 2),
            "p_vs_average": p_avg[k], "p_vs_average_holm": float(holm_avg[k]),
        })
    rows.sort(key=lambda r: -r["gemini_urgency_points"])
    out = {
        "outcome": "Gemini 1-100 urgency rating (tie-break run, gemini-3.5-flash-lite)",
        "n": len(profiles), "r_squared": round(float(gem.rsquared), 3), "intercept": round(float(gem.params[0]), 1),
        "mean_weight": round(float(mean_b), 2),
        "equal_weights_test": {"F": round(float(eq.fvalue), 2), "df": [int(eq.df_num), int(eq.df_denom)], "p": float(eq.pvalue)},
        "demographics_test": {"F": round(float(demo.fvalue), 2), "df": [int(demo.df_num), int(demo.df_denom)],
                              "p": float(demo.pvalue), "female_coef": round(float(full.params[fem]), 2),
                              "female_p": float(full.pvalues[fem])},
        "r_squared_vispdat_score_only": round(float(sm.OLS(y_gem, sm.add_constant(y_vis)).fit().rsquared), 3),
        "factors": rows,
    }
    (PILOT / "results" / "factor_weights.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    with (PILOT / "results" / "factor_weights.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    print(f"R^2 factors -> urgency: {out['r_squared']}  (VI-SPDAT total alone: {out['r_squared_vispdat_score_only']})")
    print(f"intercept {out['intercept']}, average factor weight {out['mean_weight']} urgency points")
    print(f"equal weights: F{tuple(out['equal_weights_test']['df'])} = {out['equal_weights_test']['F']}, p = {out['equal_weights_test']['p']:.4g}")
    print(f"demographics add: F{tuple(out['demographics_test']['df'])} = {out['demographics_test']['F']}, p = {out['demographics_test']['p']:.3f}")
    for r in rows:
        print(f"  {r['factor'][:38]:38s} n={r['people']:2d}  {r['gemini_urgency_points']:+6.2f} [{r['ci_low']:+6.2f},{r['ci_high']:+6.2f}]"
              f"  rel {r['gemini_relative_weight']:5.2f}  p0 {r['p_vs_zero']:.4f} (holm {r['p_vs_zero_holm']:.3f})"
              f"  p_avg {r['p_vs_average']:.4f} (holm {r['p_vs_average_holm']:.3f})")


if __name__ == "__main__":
    main()
