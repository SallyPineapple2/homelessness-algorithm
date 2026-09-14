"""
Check whether each AI answer is labeled with the case it actually describes.

A model returns {"case": N, "score": ..., "reason": ...} for every case. In a long
session it can write an answer about one person and label it with another
person's case number. This script checks the labels using facts, not wording:
nearly every reason states how long the person has been homeless ("Six weeks in
shelter", "Eleven years unsheltered") and sometimes their age. Duration and age
are never withheld under underdisclosure, and within one session they almost
always identify a single person.

For every answer:
  matches     the duration or age in the reason fits the labeled case
  mixed up    neither fits the labeled case, and a different case fits instead
  can't tell  the reason states no duration or age, or no case fits it

Nothing is changed: scores and reasons are reported exactly as given. Durations
that are time windows ("six visits in six months") are ignored, and two cases
that share a duration cannot be told apart, so the check undercounts mix-ups
rather than overcounting them. scripts/import_replies.py runs the same check on
every reply and asks for a session to be redone if any answer is mixed up.

Run:  python scripts/check_case_labels.py [app]      (default: every app with replies)
Writes: data/ai/checks/<app>_case_labels.csv
"""

import csv
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEDULE = ROOT / "data" / "ai" / "paste_schedule.json"
CLONES = ROOT / "data" / "clones.json"
MODELS = ROOT / "data" / "ai" / "models.json"
RAW = ROOT / "data" / "ai" / "raw"
OUT_DIR = ROOT / "data" / "ai" / "checks"

NUMBERS = {w: i for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen "
    "sixteen seventeen eighteen nineteen twenty".split())}
NUMBERS.update({"a": 1, "an": 1})
DURATION = re.compile(r"\b(\d{1,2}|" + "|".join(sorted(NUMBERS, key=len, reverse=True)) + r")[\s-]+(week|month|year)s?\b", re.I)
AGE = re.compile(r"\b(?:age[ds]?\s*|at\s+)(\d{2})\b|\b(\d{2})[\s-]*year[\s-]*old\b", re.I)

# "six visits in six months", "over the past six months": a time window, not how long
# someone has been homeless.
WINDOW = re.compile(r"\b(?:in|within|past|last|over)\s+(?:the\s+)?(?:past\s+|last\s+)?$", re.I)


def _to_duration(match):
    n = match.group(1).lower()
    return (int(n) if n.isdigit() else NUMBERS[n], match.group(2).lower())


def first_duration(text):
    """How long a case has been homeless: the first duration in its housing line."""
    m = DURATION.search(text)
    return _to_duration(m) if m else None


def reason_durations(text):
    """Every duration a reason states, skipping time windows like 'in six months'."""
    return {
        _to_duration(m) for m in DURATION.finditer(text)
        if not WINDOW.search(text[max(0, m.start() - 20):m.start()])
    }


def stated_age(text):
    m = AGE.search(text)
    return int(m.group(1) or m.group(2)) if m else None


def label_duration(d):
    return f"{d[0]} {d[1]}{'s' if d[0] != 1 else ''}"


def fits(case, durations, age):
    """Does a case agree with whatever the reason states?"""
    if durations and case["duration"] not in durations:
        return False
    if age and case["age"] != age:
        return False
    return True


def session_cases(session, clones_by_key):
    """Case number -> the facts the check compares against."""
    cases = {}
    for it in session["items"]:
        clone = clones_by_key[(it["profile"], it["gender"], it["race"], it["location"])]
        housing = clone["interview"][it["disclosure"]]["narrative"]["housing"]
        cases[it["position"]] = {
            "profile": it["profile"], "age": clone["age"], "housing": housing,
            "duration": first_duration(housing),
        }
    return cases


def label_verdicts(entries, cases):
    """One verdict per answer: matches, mixed up, or can't tell."""
    out = []
    for entry in sorted(entries, key=lambda c: c["case"]):
        reason = entry.get("reason") or ""
        durations, age = reason_durations(reason), stated_age(reason)
        labeled = cases[entry["case"]]
        # Conservative: an answer is only "mixed up" when neither its duration nor its
        # age fits the labeled case, and some other case in the session fits instead.
        labeled_fits = (not durations or labeled["duration"] in durations) or (bool(age) and labeled["age"] == age)
        others = sorted(k for k, c in cases.items() if k != entry["case"] and fits(c, durations, age))
        if not durations and not age:
            verdict, fit = "can't tell", []
        elif labeled_fits:
            verdict, fit = "matches", []
        elif others:
            verdict, fit = "mixed up", others
        else:
            verdict, fit = "can't tell", []
        out.append({"entry": entry, "durations": durations, "age": age, "verdict": verdict, "fits": fit})
    return out


def reattach(entries, cases):
    """
    Re-attach answers to the case their stated facts point to (the lenient rule).

    Using the same verdicts as the label check:
      matches     the duration or age fits its own case -> kept on its own case
      mixed up    its facts fit exactly one other case  -> moved to that case
      otherwise   no usable facts, no fitting case, or several other fitting cases -> dropped
    If two answers land on the same case, both are dropped, since there is no way to know
    which is right. Scores and reasons are never changed.

    Returns (re-attached answers, one decision per original answer).
    """
    decisions = []
    for v in label_verdicts(entries, cases):
        e = v["entry"]
        if v["verdict"] == "matches":
            target, how = e["case"], "kept: facts fit its own case"
        elif v["verdict"] == "mixed up" and len(v["fits"]) == 1:
            target, how = v["fits"][0], "moved to the case its facts identify"
        elif v["verdict"] == "mixed up":
            target, how = None, "dropped: facts fit more than one other case"
        elif not v["durations"] and not v["age"]:
            target, how = None, "dropped: states no duration or age"
        else:
            target, how = None, "dropped: facts fit no case"
        decisions.append({"entry": e, "target": target, "how": how})

    claims = Counter(d["target"] for d in decisions if d["target"])
    for d in decisions:
        if d["target"] and claims[d["target"]] > 1:
            d["target"], d["how"] = None, "dropped: another answer points to the same case"

    kept = [{**d["entry"], "case": d["target"], "labeled_case": d["entry"]["case"], "moved": d["target"] != d["entry"]["case"]}
            for d in decisions if d["target"]]
    return kept, decisions


def check_app(app, schedule, clones_by_key):
    rows, per_session = [], []
    for sess in schedule["sessions"]:
        path = RAW / app["key"] / f"session-{sess['session']:02d}.json"
        if not path.exists():
            continue
        rec = json.loads(path.read_text(encoding="utf-8"))
        entries = rec["cases"] or rec.get("checked_cases") or []
        if not entries:
            continue
        cases = session_cases(sess, clones_by_key)
        verdicts = label_verdicts(entries, cases)
        per_session.append((sess["session"], Counter(v["verdict"] for v in verdicts)))
        for v in verdicts:
            entry, labeled = v["entry"], cases[v["entry"]["case"]]
            rows.append({
                "session": sess["session"],
                "case": entry["case"],
                "score": entry["score"],
                "labeled_profile": labeled["profile"],
                "labeled_case_facts": f"Age {labeled['age']}. {labeled['housing']}",
                "reason": entry.get("reason") or "",
                "reason_says": "; ".join([label_duration(d) for d in sorted(v["durations"])] + ([f"age {v['age']}"] if v["age"] else [])),
                "verdict": v["verdict"],
                "reason_fits_case": " / ".join(
                    f"case {k} ({cases[k]['profile']}, age {cases[k]['age']}: {cases[k]['housing']})" for k in v["fits"]),
            })
    return rows, per_session


def main():
    schedule = json.loads(SCHEDULE.read_text(encoding="utf-8"))
    clones = json.loads(CLONES.read_text(encoding="utf-8"))["clones"]
    clones_by_key = {(c["base_profile"], c["gender"], c["race"], c["location"]): c for c in clones}
    apps = [a for a in json.loads(MODELS.read_text(encoding="utf-8"))["models"] if not a.get("source")]
    if len(sys.argv) > 1:
        apps = [a for a in apps if a["key"] == sys.argv[1]]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for app in apps:
        rows, per_session = check_app(app, schedule, clones_by_key)
        if not rows:
            continue
        out = OUT_DIR / f"{app['key']}_case_labels.csv"
        with out.open("w", encoding="utf-8-sig", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)

        total = Counter()
        print(f"\n{app['label']}: does each answer describe the case it is labeled with?")
        print("  session   matches   mixed up   can't tell")
        for s, c in per_session:
            total.update(c)
            print(f"    {s:02d}        {c['matches']:2d}        {c['mixed up']:2d}          {c["can't tell"]:2d}")
        print(f"  all       {total['matches']:3d}       {total['mixed up']:3d}         {total["can't tell"]:3d}")
        print(f"  wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
