"""
Ask Gemini for its own housing-priority judgment on each of the 100 pilot profiles.

Each profile is one stateless request (generate_content, not a chat) containing only
the instructions and that one case summary, so no profile can influence another and
nothing carries over between requests. No system instruction is set and sampling is
left at the model's defaults, the same as the original study's Gemini arm. Profiles
are sent in a fixed shuffled order (seeded) so that drift over the days of the run
is not lined up with profile number or need level.

Every reply is saved to pilot/data/gemini/raw/<id>.json with the exact prompt, the
reply text, the model version, and the time. A profile that already has a valid
reply is skipped, so the script can be stopped and rerun. A reply that cannot be
read is moved to pilot/data/gemini/failed/ and the profile is tried again on the
next run.

The free tier allows a limited number of requests per day. When the daily quota is
used up the script stops, or with --wait sleeps until the quota resets (midnight
Pacific time) and carries on.

The key is read from GEMINI_API_KEY in the environment or the git-ignored .env file.

Run:  python pilot/scripts/run_gemini.py --limit 1        (one profile, to test)
      python pilot/scripts/run_gemini.py --wait           (everything, across days)
"""

import argparse
import csv
import hashlib
import json
import os
import random
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gemini_prompt import (INSTRUCTIONS, REPLY_FORMAT, REPLY_FORMAT_SCORED, SCORED_EXTRA,  # noqa: E402
                           case_text, parse_reply, parse_urgency, prompt)

ROOT = Path(__file__).resolve().parents[2]
PILOT = ROOT / "pilot"
RAW = PILOT / "data" / "gemini" / "raw"
FAILED = PILOT / "data" / "gemini" / "failed"
MODEL = "gemini-3.5-flash-lite"  # lighter model with a larger free daily allowance (user choice, 2026-10-15)
ORDER_SEED = 20261014
INSTRUCTIONS_SHA = hashlib.sha256((INSTRUCTIONS + REPLY_FORMAT).encode("utf-8")).hexdigest()


def log(message):
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{stamp}] {message}", flush=True)


def load_key():
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("GEMINI_API_KEY="):
                os.environ.setdefault("GEMINI_API_KEY", line.split("=", 1)[1].strip())
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        sys.exit("GEMINI_API_KEY is not set in .env")
    return key


class DailyQuotaReached(Exception):
    pass


THINKING = None  # None = the model's default; "high" = high reasoning (--thinking high)
VARIANT = "category"  # "scored" also asks for a 1-100 urgency rating (--variant scored)


OVERLOAD_WAITS = [300, 600, 1200]  # seconds; then every 20 minutes


def send(client, text, tries=30):
    """One stateless request, waiting out per-minute limits and overloads."""
    for attempt in range(1, tries + 1):
        try:
            from google.genai import types
            config = (types.GenerateContentConfig(thinking_config=types.ThinkingConfig(thinking_level=THINKING))
                      if THINKING else None)
            return client.models.generate_content(model=MODEL, contents=text, config=config)
        except Exception as exc:  # noqa: BLE001 - the SDK raises several error types
            message = str(exc)
            if "429" in message or "RESOURCE_EXHAUSTED" in message:
                quota = re.findall(r"quotaId'?\"?:\s*['\"]([^'\"]+)", message)
                if any("PerDay" in q for q in quota):
                    raise DailyQuotaReached(", ".join(quota)) from exc
                retry = re.findall(r"retryDelay'?\"?:\s*['\"](\d+)", message)
                wait = int(retry[0]) + 5 if retry else min(120, 15 * attempt)
                log(f"  rate limited; waiting {wait}s")
                time.sleep(wait)
                continue
            if attempt == tries or not any(c in message.upper() for c in
                                            ("500", "503", "UNAVAILABLE", "DEADLINE", "TIMEOUT", "TIMED OUT")):
                raise
            # Overload retries count against the free daily quota, so back off in minutes, not seconds.
            wait = OVERLOAD_WAITS[min(attempt, len(OVERLOAD_WAITS)) - 1]
            log(f"  waiting {wait}s after: {message[:90]}")
            time.sleep(wait)


def seconds_until_reset():
    now = datetime.now(ZoneInfo("America/Los_Angeles"))
    reset = (now + timedelta(days=1)).replace(hour=0, minute=5, second=0, microsecond=0)
    return (reset - now).total_seconds()


def set_model(model, thinking=None, variant="category"):
    """Point the run at one model, reasoning level, and prompt variant. Each keeps its own folder."""
    global MODEL, RAW, FAILED, THINKING, VARIANT
    if model != MODEL or thinking or variant != "category":
        base = PILOT / "data" / (f"gemini-{model}" + (f"-thinking-{thinking}" if thinking else "")
                                 + ("-scored" if variant == "scored" else ""))
        MODEL, RAW, FAILED, THINKING, VARIANT = model, base / "raw", base / "failed", thinking, variant


def is_valid(pid):
    path = RAW / f"{pid}.json"
    return path.exists() and json.loads(path.read_text(encoding="utf-8")).get("priority") is not None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, help="stop after this many requests")
    ap.add_argument("--wait", action="store_true", help="sleep through daily quota resets until done")
    ap.add_argument("--model", default=MODEL,
                    help="another Gemini model; its replies go to pilot/data/gemini-<model>/ (default run stays in "
                         "pilot/data/gemini/)")
    ap.add_argument("--thinking", choices=["low", "medium", "high"],
                    help="reasoning level; the run goes to its own folder, e.g. gemini-<model>-thinking-high/")
    ap.add_argument("--variant", choices=["category", "scored"], default="category",
                    help="'scored' also asks for a 1-100 urgency rating, for tie-breaks when places are limited")
    args = ap.parse_args()
    set_model(args.model, args.thinking, args.variant)

    from google import genai
    from google.genai import types

    client = genai.Client(api_key=load_key(), http_options=types.HttpOptions(timeout=180_000))
    profiles = json.loads((PILOT / "data" / "profiles.json").read_text(encoding="utf-8"))["profiles"]
    with (PILOT / "data" / "vispdat_scores.csv").open(encoding="utf-8") as fh:
        vispdat = {r["id"]: r for r in csv.DictReader(fh)}  # recorded alongside, never sent to Gemini
    order = profiles[:]
    random.Random(ORDER_SEED).shuffle(order)
    RAW.mkdir(parents=True, exist_ok=True)

    sent = 0
    todo = [p for p in order if not is_valid(p["id"])]
    log(f"{len(profiles) - len(todo)} of {len(profiles)} profiles already have a valid reply; {len(todo)} to go")
    for p in todo:
        if args.limit is not None and sent >= args.limit:
            break
        text = prompt(p, VARIANT)
        # Every request carries the identical instructions and reply format; only the case differs.
        expected = ("\n\n".join([INSTRUCTIONS + "\n\n" + SCORED_EXTRA, case_text(p), REPLY_FORMAT_SCORED]) + "\n"
                    if VARIANT == "scored" else "\n\n".join([INSTRUCTIONS, case_text(p), REPLY_FORMAT]) + "\n")
        if text != expected:
            sys.exit(f"{p['id']}: prompt does not match the fixed template")
        while True:
            try:
                started = time.time()
                response = send(client, text)
                break
            except DailyQuotaReached as exc:
                if not args.wait:
                    log(f"daily quota reached ({exc}); run again after midnight Pacific time to continue")
                    return
                wait = seconds_until_reset()
                log(f"daily quota reached; sleeping {wait / 3600:.1f} h until the reset")
                time.sleep(wait)
        sent += 1
        reply = (response.text or "").strip()
        priority, explanation, problems = parse_reply(reply)
        urgency = parse_urgency(reply) if VARIANT == "scored" else None
        if VARIANT == "scored" and urgency is None:
            problems = problems + ["urgency is not a whole number from 1 to 100"]
            priority = None
        record = {
            "id": p["id"],
            "model": MODEL,
            "thinking_level": THINKING or "model default",
            "variant": VARIANT,
            "model_version": getattr(response, "model_version", None) or MODEL,
            "requested_at": datetime.fromtimestamp(started, timezone.utc).isoformat(timespec="seconds"),
            "seconds": round(time.time() - started, 1),
            "prompt_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            "instructions_sha256": hashlib.sha256(text.replace(case_text(p), "").encode("utf-8")).hexdigest() if VARIANT == "scored" else INSTRUCTIONS_SHA,
            "vispdat_score": vispdat[p["id"]]["score"],
            "vispdat_priority": vispdat[p["id"]]["priority"],
            "prompt": text,
            "reply": reply,
            "priority": priority,
            "urgency": urgency,
            "explanation": explanation,
            "problems": problems,
            "usage": {k: getattr(response.usage_metadata, k, None) for k in
                      ("prompt_token_count", "thoughts_token_count", "candidates_token_count", "total_token_count")}
            if getattr(response, "usage_metadata", None) else None,
        }
        if priority is None:
            FAILED.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            (FAILED / f"{p['id']}-{stamp}.json").write_text(json.dumps(record, indent=1, ensure_ascii=False),
                                                            encoding="utf-8")
            log(f"{p['id']}: unreadable reply ({'; '.join(problems)}); saved to failed/, will retry next run")
            continue
        (RAW / f"{p['id']}.json").write_text(json.dumps(record, indent=1, ensure_ascii=False), encoding="utf-8")
        done = sum(is_valid(q["id"]) for q in profiles)
        log(f"{p['id']}: Gemini {priority}, VI-SPDAT {record['vispdat_priority']} "
            f"(score {record['vispdat_score']}) ({done}/{len(profiles)} done)")
    left = sum(not is_valid(q["id"]) for q in profiles)
    log("all profiles have a valid reply" if not left else f"{left} profiles still to go")


if __name__ == "__main__":
    main()
