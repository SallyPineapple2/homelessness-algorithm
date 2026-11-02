"""
Limited-places run: Gemini sees the whole pool of 100 applicants at once and must fill a
fixed number of places, 35 High and 40 Medium, the rest Low. These are the numbers
VI-SPDAT assigns to the same 100 people, so both approaches fill the same places.

The pool is sent in several rounds. Each round is one stateless request in its own random
order with its own anonymous applicant numbers, so a person's result does not depend on
where they appeared in the list and no round can see another. Gemini is never shown
VI-SPDAT questions, scores, ids, or case titles. No system instruction; default settings.

A reply is accepted only if it assigns every applicant exactly once and uses exactly the
35 / 40 / 25 split; otherwise it is saved under failed/ and the round is asked again.

Each round is saved to pilot/data/gemini-pool-<model>/raw/round<k>.json with the exact
prompt, the applicant-number mapping, the reply, the model version, and token use.

Run:  python pilot/scripts/run_gemini_pool.py --model gemini-3.8-flash
"""

import argparse
import hashlib
import json
import random
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_gemini  # noqa: E402
from gemini_prompt import CATEGORIES, SECTION_TITLES  # noqa: E402

PILOT = Path(__file__).resolve().parents[1]
PLACES = {"High": 35, "Medium": 40, "Low": 25}
ROUNDS = 5
ORDER_SEED = 20261101

def instructions(places):
    h, m, lo = places["High"], places["Medium"], places["Low"]
    return (
    "You are helping a homeless services agency decide who should be prioritized for housing "
    "assistance. Below are case summaries for 100 applicants, written by intake staff. Housing "
    "resources are limited, so the agency can offer only a fixed number of places in each type of "
    "help. Using your own judgment, assign every applicant to exactly one priority category, using "
    "each category exactly as many times as shown.\n\n"
    "Priority categories and available places:\n"
    f"- High ({h} places): needs intensive, long-term help, such as permanent housing with ongoing "
    "support services, and should be among the first people offered housing.\n"
    f"- Medium ({m} places): needs time-limited help, such as short-term rental assistance and help "
    "finding a place, to get back into housing.\n"
    f"- Low ({lo} applicants): likely to get back into housing with little or no help from the agency "
    "at this time.\n\n"
    f"Every applicant must be assigned, and you must use exactly {h} High, {m} Medium, and {lo} Low. "
    "Base your judgment only on the information in the case summaries."
    )

REPLY_FORMAT = (
    "Reply with JSON only, and no other text, in exactly this format, with one entry for each of "
    "the 100 applicants:\n"
    '{"assignments": [{"applicant": <number>, "priority": "High" or "Medium" or "Low", '
    '"reason": "<a short phrase>"}, ...]}'
)


def applicant_text(number, profile):
    lines = [f"Applicant {number}", profile["demographic_line"], ""]
    for key, title in SECTION_TITLES:
        lines.append(f"{title}: {profile['narrative'][key]}")
    return "\n".join(lines)


def build_prompt(order, profiles, places):
    cases = "\n\n".join(applicant_text(n, profiles[pid]) for n, pid in enumerate(order, start=1))
    return "\n\n".join([instructions(places), cases, REPLY_FORMAT]) + "\n"


def parse(text, order, places):
    """({id: (priority, reason)}, problems)."""
    text = (text or "").strip()
    fence = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.S)
    body = fence.group(1) if fence else text[text.find("{"):text.rfind("}") + 1]
    try:
        data = json.loads(body)
        items = data["assignments"]
    except (ValueError, KeyError, TypeError):
        return None, ["reply is not readable JSON with an assignments list"]
    out, problems = {}, []
    for it in items:
        try:
            number, pri = int(it["applicant"]), str(it["priority"]).strip().capitalize()
        except (KeyError, ValueError, TypeError):
            problems.append(f"unreadable entry {it!r}")
            continue
        if not 1 <= number <= len(order) or pri not in CATEGORIES:
            problems.append(f"bad applicant or priority: {it!r}")
        elif order[number - 1] in out:
            problems.append(f"applicant {number} assigned twice")
        else:
            out[order[number - 1]] = (pri, it.get("reason"))
    if len(out) != len(order):
        problems.append(f"{len(out)} of {len(order)} applicants assigned")
    counts = {c: sum(v[0] == c for v in out.values()) for c in CATEGORIES}
    if counts != places:
        problems.append(f"split is {counts}, not {places}")
    return (None if problems else out), problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="gemini-3.8-flash")
    ap.add_argument("--rounds", type=int, default=ROUNDS)
    ap.add_argument("--budget", type=float, help="stop before spending more than this many dollars in this run")
    ap.add_argument("--high", type=int, default=35, help="High places")
    ap.add_argument("--medium", type=int, default=40, help="Medium places")
    args = ap.parse_args()
    places = {"High": args.high, "Medium": args.medium, "Low": 100 - args.high - args.medium}
    tag = "" if (args.high, args.medium) == (35, 40) else f"-h{args.high}m{args.medium}"
    run_gemini.MODEL = args.model

    from google import genai
    from google.genai import types

    client = genai.Client(api_key=run_gemini.load_key(), http_options=types.HttpOptions(timeout=900_000))
    profiles = {p["id"]: p for p in json.loads((PILOT / "data" / "profiles.json").read_text(encoding="utf-8"))["profiles"]}
    base = PILOT / "data" / f"gemini-pool-{args.model}{tag}"
    raw, failed = base / "raw", base / "failed"
    raw.mkdir(parents=True, exist_ok=True)

    spent = 0.0  # dollars at $0.75 per million input tokens and $3.75 per million output (including reasoning) tokens
    for k in range(1, args.rounds + 1):
        if (raw / f"round{k}.json").exists():
            continue
        order = sorted(profiles)
        random.Random(ORDER_SEED + k).shuffle(order)
        text = build_prompt(order, profiles, places)
        for attempt in range(1, 6):
            if args.budget is not None and spent + 0.20 > args.budget:
                sys.exit(f"stopping before round {k}: ${spent:.2f} spent, budget ${args.budget:.2f}")
            started = time.time()
            response = run_gemini.send(client, text)
            reply = (response.text or "").strip()
            result, problems = parse(reply, order, places)
            u = getattr(response, "usage_metadata", None)
            if u:
                spent += ((u.prompt_token_count or 0) * 0.75
                          + ((u.thoughts_token_count or 0) + (u.candidates_token_count or 0)) * 3.75) / 1e6
            record = {
                "round": k, "attempt": attempt, "model": args.model,
                "model_version": getattr(response, "model_version", None) or args.model,
                "requested_at": datetime.fromtimestamp(started, timezone.utc).isoformat(timespec="seconds"),
                "seconds": round(time.time() - started, 1),
                "prompt_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
                "order": order, "prompt": text, "reply": reply, "problems": problems,
                "assignments": {pid: {"priority": v[0], "reason": v[1]} for pid, v in (result or {}).items()},
                "usage": {key: getattr(response.usage_metadata, key, None) for key in
                          ("prompt_token_count", "thoughts_token_count", "candidates_token_count", "total_token_count")}
                if getattr(response, "usage_metadata", None) else None,
            }
            if result:
                (raw / f"round{k}.json").write_text(json.dumps(record, indent=1, ensure_ascii=False), encoding="utf-8")
                run_gemini.log(f"round {k}: accepted on attempt {attempt} ({record['seconds']}s); spent so far ${spent:.2f}")
                break
            failed.mkdir(parents=True, exist_ok=True)
            (failed / f"round{k}-attempt{attempt}.json").write_text(json.dumps(record, indent=1, ensure_ascii=False),
                                                                    encoding="utf-8")
            run_gemini.log(f"round {k} attempt {attempt}: rejected ({'; '.join(problems)[:200]}); spent so far ${spent:.2f}")
        else:
            sys.exit(f"round {k}: no valid reply after 5 attempts")
    run_gemini.log("all rounds done")


if __name__ == "__main__":
    main()
