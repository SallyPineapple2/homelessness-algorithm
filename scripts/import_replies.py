"""
Check the replies pasted into paste/replies/ and import them for analysis.

For every app and session it reads paste/replies/<app>/session-NN.txt and
writes data/ai/raw/<app>/session-NN.json, recording the reply exactly as
pasted, the model version from its optional first line ("Model: ..."), any
problems (which keep the reply out of the analysis) and warnings (which don't),
whether its ranks form a complete 1-32 order, and the parsed cases. It then
prints a progress grid so you can see which sessions are done and which need
redoing.

Every reply also goes through the case-label check (scripts/check_case_labels.py).
If any answer describes a different person than its case number says, the score
would be credited to the wrong race, gender, and city, so the session is marked
for redoing. The answers themselves are never changed.

A reply file containing only the word REFUSED records that the app declined.

Run:  python scripts/import_replies.py
"""

import hashlib
import json
import re
from collections import Counter
from pathlib import Path

from ai_prompt import RANK_WARNING, validate_reply
from check_case_labels import label_verdicts, session_cases

ROOT = Path(__file__).resolve().parents[1]
SCHEDULE = ROOT / "data" / "ai" / "paste_schedule.json"
CLONES = ROOT / "data" / "clones.json"
MODELS = ROOT / "data" / "ai" / "models.json"
PROMPTS = ROOT / "paste" / "prompts"
REPLIES = ROOT / "paste" / "replies"
RAW = ROOT / "data" / "ai" / "raw"

MODEL_LINE = re.compile(r"^\s*model\s*:\s*(.+?)\s*$", re.IGNORECASE)


def read_reply(path):
    """(version, reply text) with the optional 'Model:' first line split off."""
    text = path.read_text(encoding="utf-8-sig") if path.exists() else ""
    lines = text.strip().splitlines()
    if lines and MODEL_LINE.match(lines[0]):
        return MODEL_LINE.match(lines[0]).group(1), "\n".join(lines[1:]).strip()
    return None, text.strip()


def label_problem(cases, sess, clones_by_key):
    """(counts, problem or None) from the case-label check."""
    verdicts = label_verdicts(cases, session_cases(sess, clones_by_key))
    counts = Counter(v["verdict"] for v in verdicts)
    mixed = [v for v in verdicts if v["verdict"] == "mixed up"]
    if not mixed:
        return dict(counts), None
    ex = mixed[0]
    actual = " or ".join(f"case {k}" for k in ex["fits"][:2])
    return dict(counts), (
        f"{len(mixed)} of {len(verdicts)} answers describe a different person than their case number "
        f"(e.g. the answer labeled case {ex['entry']['case']} describes {actual}) - redo this session in a new chat"
    )


def main():
    schedule = json.loads(SCHEDULE.read_text(encoding="utf-8"))
    clones = json.loads(CLONES.read_text(encoding="utf-8"))["clones"]
    clones_by_key = {(c["base_profile"], c["gender"], c["race"], c["location"]): c for c in clones}
    # entries with a "source" are analyses derived from another model's replies, not apps
    apps = [a for a in json.loads(MODELS.read_text(encoding="utf-8"))["models"] if not a.get("source")]
    n = schedule["items_per_session"]

    report = []
    for app in apps:
        seen_replies = {}
        rows = []
        for sess in schedule["sessions"]:
            name = f"session-{sess['session']:02d}"
            version, reply = read_reply(REPLIES / app["key"] / f"{name}.txt")
            raw_path = RAW / app["key"] / f"{name}.json"

            if not reply:
                if raw_path.exists():
                    raw_path.unlink()  # the reply was cleared; drop the stale import
                rows.append((sess["session"], "empty", [], []))
                continue

            labels = None
            if reply.strip().upper() == "REFUSED":
                cases, problems, warnings = [], ["the app refused"], []
            else:
                cases, problems, warnings = validate_reply(reply, n)
                digest = hashlib.sha256(
                    json.dumps(sorted((c.get("case"), c.get("score")) for c in cases)).encode()
                ).hexdigest()
                if not problems and digest in seen_replies:
                    problems = [f"identical to session {seen_replies[digest]} - the same reply was pasted twice"]
                seen_replies.setdefault(digest, sess["session"])
                if not problems:
                    labels, mixed = label_problem(cases, sess, clones_by_key)
                    if mixed:
                        problems = [mixed]
            if version is None:
                warnings = warnings + ["no 'Model:' line, so the version that answered is not recorded"]

            prompt = "".join(p.read_text(encoding="utf-8") for p in sorted((PROMPTS / name).glob("part-*.txt")))
            record = {
                "model_key": app["key"],
                "interface": app["interface"],
                "session": sess["session"],
                "model_version": version,
                "prompt_sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
                "valid": not problems,
                "ranks_valid": not problems and not any(w.startswith(RANK_WARNING) for w in warnings),
                "case_labels": labels,
                "problems": problems,
                "warnings": warnings,
                "cases": cases if not problems else [],
                # kept for the label-check report even when the session is excluded
                "checked_cases": cases if problems and labels else [],
                "reply_text": reply,
            }
            raw_path.parent.mkdir(parents=True, exist_ok=True)
            raw_path.write_text(json.dumps(record, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
            rows.append((sess["session"], "ok" if not problems else "redo", problems, warnings))
        report.append((app, rows))

    for app, rows in report:
        done = sum(status == "ok" for _, status, _, _ in rows)
        grid = " ".join(
            f"{s:02d}{'+' if status == 'ok' else ('!' if status == 'redo' else '.')}" for s, status, _, _ in rows
        )
        print(f"\n{app['label']}: {done} of {len(rows)} sessions done")
        print("  " + grid)
        for s, status, problems, warnings in rows:
            for p in problems:
                print(f"  session {s:02d} REDO: {p}")
            for w in warnings:
                print(f"  session {s:02d} note: {w}")
    print("\n+ done   ! needs redoing   . not pasted yet   (notes do not need redoing)")


if __name__ == "__main__":
    main()
