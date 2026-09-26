"""
Second-opinion screen for case labels, for replies whose reasons state no duration or age.

Gemini's reasons are short and generic ("a healthy individual in a shelter"), so the
fact-based check in scripts/check_case_labels.py usually cannot tell whether an answer
describes the case it is labeled with. This script asks a separate model, in a fresh
request, to match each reason to a case file. It sees the session's 32 case files (age
and narrative, no demographic line) and the 32 reasons in shuffled order with their case
numbers removed, so it cannot simply copy the labels.

The screen does not decide anything by itself. Tested on ChatGPT's first attempt, where
the fact check knows the answers, it flagged all 76 known mix-ups in six test sessions but
also disagreed with about 4% of answers known to be correct. So every answer it flags is
written to a review file for a person to read beside the case, and nothing is excluded
unless a flag is confirmed.

Results are cached per session, so re-running only calls the model for new sessions.

Run:  python scripts/screen_case_labels.py gemini [--sessions 1-20]
Writes: data/ai/checks/<app>_label_screen.csv
"""

import argparse
import csv
import json
import os
import random
import sys
import time
from pathlib import Path

from check_case_labels import label_verdicts, session_cases

ROOT = Path(__file__).resolve().parents[1]
SCHEDULE = ROOT / "data" / "ai" / "paste_schedule.json"
CLONES = ROOT / "data" / "clones.json"
RAW = ROOT / "data" / "ai" / "raw"
CHECKS = ROOT / "data" / "ai" / "checks"

SCREEN_MODEL = "gemini-3.5-flash-lite"

SCHEMA = {
    "type": "object",
    "properties": {"matches": {"type": "array", "items": {
        "type": "object",
        "properties": {"note": {"type": "string"}, "case": {"type": "string"}},
        "required": ["note", "case"],
    }}},
    "required": ["matches"],
}


def load_key():
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("GEMINI_API_KEY="):
                os.environ.setdefault("GEMINI_API_KEY", line.split("=", 1)[1].strip())
    if not os.environ.get("GEMINI_API_KEY"):
        sys.exit("GEMINI_API_KEY is not set in .env")
    return os.environ["GEMINI_API_KEY"]


def case_files(session, clones_by_key):
    files = {}
    for it in sorted(session["items"], key=lambda i: i["position"]):
        c = clones_by_key[(it["profile"], it["gender"], it["race"], it["location"])]
        narrative = c["interview"][it["disclosure"]]["narrative"]
        files[it["position"]] = f"Age {c['age']}. " + " ".join(narrative.values())
    return files


def screen_session(client, types, session, entries, clones_by_key):
    """Labeled case number -> the case the screen model says the reason describes."""
    files = case_files(session, clones_by_key)
    order = entries[:]
    random.Random(1000 + session["session"]).shuffle(order)
    prompt = (
        "Records check. Below are 32 case files (C1 to C32) and 32 short notes (N1 to N32). Each note was "
        "written about one of the case files, but the notes are shuffled. For every note, identify the case "
        "file it describes, using the facts in the note (health, work, finances, living situation, safety, "
        "age, family). Several notes may describe the same case, and some cases may have no note; judge each "
        "note on its own.\n\nCASE FILES\n"
        + "\n\n".join(f"C{k}. {v}" for k, v in files.items())
        + "\n\nNOTES\n"
        + "\n".join(f"N{i + 1}. {e.get('reason') or ''}" for i, e in enumerate(order))
        + '\n\nReply with JSON: {"matches": [{"note": "N1", "case": "C7"}, ...]} with one entry per note.'
    )
    for attempt in range(1, 9):
        try:
            resp = client.models.generate_content(
                model=SCREEN_MODEL, contents=prompt,
                config=types.GenerateContentConfig(response_mime_type="application/json", response_json_schema=SCHEMA),
            )
            data = json.loads(resp.text)
            break
        except Exception as exc:  # noqa: BLE001
            if attempt == 8:
                raise
            print(f"    waiting after: {str(exc)[:90]}", flush=True)
            time.sleep(min(120, 15 * attempt))
    out = {}
    for m in data["matches"]:
        try:
            i = int(str(m["note"]).lstrip("Nn")) - 1
            out[order[i]["case"]] = int(str(m["case"]).lstrip("Cc"))
        except (ValueError, IndexError):
            continue
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("app")
    ap.add_argument("--sessions", help="e.g. 1-20 (default: every session with a valid reply)")
    args = ap.parse_args()

    from google import genai
    from google.genai import types

    client = genai.Client(api_key=load_key(), http_options=types.HttpOptions(timeout=180_000))
    schedule = json.loads(SCHEDULE.read_text(encoding="utf-8"))
    clones = json.loads(CLONES.read_text(encoding="utf-8"))["clones"]
    clones_by_key = {(c["base_profile"], c["gender"], c["race"], c["location"]): c for c in clones}
    wanted = None
    if args.sessions:
        wanted = set()
        for chunk in args.sessions.split(","):
            a, _, b = chunk.partition("-")
            wanted.update(range(int(a), int(b or a) + 1))

    cache_dir = CHECKS / "screen_cache" / args.app
    cache_dir.mkdir(parents=True, exist_ok=True)
    rows, flagged_total = [], 0
    for session in schedule["sessions"]:
        n = session["session"]
        raw = RAW / args.app / f"session-{n:02d}.json"
        if (wanted and n not in wanted) or not raw.exists():
            continue
        rec = json.loads(raw.read_text(encoding="utf-8"))
        entries = rec["cases"] or rec.get("checked_cases") or []
        if not entries:
            continue

        cache = cache_dir / f"session-{n:02d}.json"
        reply_key = rec["reply_text"][:200]
        cached = json.loads(cache.read_text(encoding="utf-8")) if cache.exists() else None
        if cached and cached.get("reply_key") == reply_key:
            screened = {int(k): v for k, v in cached["screened"].items()}
        else:
            screened = screen_session(client, types, session, entries, clones_by_key)
            cache.write_text(json.dumps({"reply_key": reply_key, "model": SCREEN_MODEL, "screened": screened}, indent=1),
                             encoding="utf-8")

        cases = session_cases(session, clones_by_key)
        facts = {v["entry"]["case"]: v["verdict"] for v in label_verdicts(entries, cases)}
        files = case_files(session, clones_by_key)
        flagged = 0
        for e in sorted(entries, key=lambda x: x["case"]):
            k = e["case"]
            s = screened.get(k)
            is_flagged = s is not None and s != k
            flagged += is_flagged
            rows.append({
                "session": n, "case": k, "score": e["score"],
                "labeled_profile": cases[k]["profile"],
                "reason": e.get("reason") or "",
                "screen_says_case": s,
                "flagged": "yes" if is_flagged else "",
                "fact_check": facts[k],
                "labeled_case_file": files[k][:400],
                "screen_case_file": files[s][:400] if is_flagged and s in files else "",
                "review": "",
            })
        flagged_total += flagged
        print(f"session {n:02d}: {flagged} of {len(entries)} answers flagged for review", flush=True)

    if rows:
        out = CHECKS / f"{args.app}_label_screen.csv"
        with out.open("w", encoding="utf-8-sig", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
        print(f"{flagged_total} answers flagged in total; wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
