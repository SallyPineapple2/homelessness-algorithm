"""
Collect everything the pilot dashboard (pilot/index.html) shows into one file.

Only complete runs (all 100 profiles with a valid answer) are put on the dashboard;
a run still in progress is listed with its count but no answers.

Run:  python pilot/scripts/build_dashboard_data.py
Writes: pilot/data/dashboard.json
"""

import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gemini_prompt import INSTRUCTIONS, REPLY_FORMAT, SECTION_TITLES  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
PILOT = ROOT / "pilot"

RUNS = [
    {"key": "flash-lite", "label": "Gemini 3.5 Flash-Lite", "dir": PILOT / "data" / "gemini" / "raw",
     "note": "Lighter, faster model; no reasoning step by default."},
    {"key": "flash", "label": "Gemini 3.8 Flash", "dir": PILOT / "data" / "gemini-gemini-3.8-flash" / "raw",
     "note": "Stronger model; reasons before answering. Limited to about 20 requests a day."},
]


def main():
    inst = json.loads((ROOT / "data" / "vispdat_instrument.json").read_text(encoding="utf-8"))
    profiles = json.loads((PILOT / "data" / "profiles.json").read_text(encoding="utf-8"))["profiles"]
    with (PILOT / "data" / "vispdat_scores.csv").open(encoding="utf-8") as fh:
        vis = {r["id"]: r for r in csv.DictReader(fh)}

    runs = []
    for run in RUNS:
        answers = {}
        for f in sorted(run["dir"].glob("P*.json")) if run["dir"].exists() else []:
            rec = json.loads(f.read_text(encoding="utf-8"))
            if rec.get("priority"):
                answers[rec["id"]] = {"priority": rec["priority"], "explanation": rec.get("explanation"),
                                      "model_version": rec.get("model_version")}
        complete = len(answers) == len(profiles)
        runs.append({"key": run["key"], "label": run["label"], "note": run["note"], "done": len(answers),
                     "total": len(profiles), "complete": complete, "answers": answers if complete else {}})

    items = [{"id": i["id"], "name": i["name"], "domain": d["name"], "letter": d["letter"], "questions": i["questions"],
              "rule": i["rule"]} for d in inst["domains"] for i in d["indicators"]]
    out = {
        "instrument": {"version": inst["version"], "population": inst["population"], "copyright": inst["copyright"],
                       "bands": inst["bands"], "items": items},
        "prompt": {"instructions": INSTRUCTIONS, "reply_format": REPLY_FORMAT,
                   "sections": [t for _, t in SECTION_TITLES]},
        "runs": runs,
        "profiles": [{
            "id": p["id"], "label": p["label"], "source": p["source"], "age": p["age"], "gender": p["gender"],
            "race": p["race"], "location": p["location"], "demographic_line": p["demographic_line"],
            "indicators": p["indicators"], "score": int(vis[p["id"]]["score"]), "vispdat": vis[p["id"]]["priority"],
            "narrative": [[t, p["narrative"][k]] for k, t in SECTION_TITLES],
        } for p in profiles],
    }
    path = PILOT / "data" / "dashboard.json"
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KB): "
          + "; ".join(f"{r['label']} {r['done']}/{r['total']}{'' if r['complete'] else ' (in progress, not shown)'}"
                      for r in runs))


if __name__ == "__main__":
    main()
