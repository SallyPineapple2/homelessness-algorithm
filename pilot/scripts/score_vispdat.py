"""
Score the 100 pilot profiles with VI-SPDAT 2.0 (Single Adults).

Each flagged indicator is worth one point (16 indicators plus one pre-survey point
for age 60+, maximum 17), using the published rules in data/vispdat_instrument.json.
The total sets the recommended intervention, which becomes the priority category
compared with Gemini:

  0-3   No housing intervention        -> Low priority
  4-7   Rapid Re-Housing               -> Medium priority
  8-17  Permanent Supportive Housing   -> High priority

Run:  python pilot/scripts/score_vispdat.py
Writes: pilot/data/vispdat_scores.csv
"""

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PILOT = ROOT / "pilot"

PRIORITY = {1: "Low", 2: "Medium", 3: "High"}


def main():
    instrument = json.loads((ROOT / "data" / "vispdat_instrument.json").read_text(encoding="utf-8"))
    profiles = json.loads((PILOT / "data" / "profiles.json").read_text(encoding="utf-8"))["profiles"]
    domains = instrument["domains"]
    order = [i["id"] for d in domains for i in d["indicators"]]
    known = set(order)

    rows = []
    for p in profiles:
        flags = set(p["indicators"])
        unknown = flags - known
        if unknown:
            raise SystemExit(f"{p['id']}: unknown indicators {sorted(unknown)}")
        sub = {d["key"]: sum(1 for i in d["indicators"] if i["id"] in flags) for d in domains}
        score = sum(sub.values())
        band = next(b for b in instrument["bands"] if b["min"] <= score <= b["max"])
        rows.append({
            "id": p["id"], "age": p["age"], "gender": p["gender"], "race": p["race"], "location": p["location"],
            "score": score, "pre": sub["pre"], "a_history": sub["a"], "b_risks": sub["b"],
            "c_daily": sub["c"], "d_wellness": sub["d"],
            "recommendation": band["name"], "priority": PRIORITY[band["id"]],
            **{ind: int(ind in flags) for ind in order},
        })

    out = PILOT / "data" / "vispdat_scores.csv"
    with out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    counts = {k: sum(r["priority"] == k for r in rows) for k in ("High", "Medium", "Low")}
    print(f"wrote {out.relative_to(ROOT)}: {len(rows)} profiles; priority {counts}")


if __name__ == "__main__":
    main()
