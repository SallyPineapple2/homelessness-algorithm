"""
Run the Claude sessions through Claude Code on a Claude Pro login, one fresh process per session.

There is no free Claude API, so each session is sent with `claude -p` (headless Claude Code),
stripped down to a plain model call:

  --system-prompt ""          Claude Code's own coding-assistant prompt is replaced with nothing
  --tools ""                  no tools, so the model can only read the message and answer
  --no-session-persistence    the chat is not saved, so no later session can resume it
  --setting-sources ""        user, project, and local settings are not loaded
  --strict-mcp-config         no MCP servers
  --disable-slash-commands    no skills
  a neutral, empty folder     no CLAUDE.md, no auto-memory, and a working-directory path that
                              says nothing about the study

Claude Code still adds a few lines it cannot drop on a Pro login (--bare needs an API key): the
account email, the neutral folder path, the model name, and the date. They are the same in every
session and for every case. A test on 2026-09-24 asking the model to quote everything it had been
given confirmed that nothing else reaches it.

Each session is the same single unsplit message the Gemini run uses (ai_prompt.session_parts,
parts=1), written to paste/replies/claude/session-NN.txt with a "Model:" line; from there the
normal pipeline takes over. One attempt per session: whatever comes back is kept as returned. A
session whose reply file already holds a reply is skipped, so the script can be stopped and
restarted; when the Pro usage limit is reached it stops and resumes from that session next time.

Run:  python scripts/run_claude.py --sessions 1        (one session, to test)
      python scripts/run_claude.py                     (all remaining sessions)
"""

import argparse
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from ai_prompt import session_parts

ROOT = Path(__file__).resolve().parents[1]
REPLIES = ROOT / "paste" / "replies" / "claude"
RAW = ROOT / "data" / "ai" / "raw" / "claude"
SCHEDULE = ROOT / "data" / "ai" / "paste_schedule.json"
BLANK = Path(tempfile.gettempdir()) / "blank"

MODEL = "claude-sonnet-5"
INTERFACE = "Claude Code on Claude Pro, single message"
FLAGS = ["-p", "--model", MODEL, "--system-prompt", "", "--tools", "", "--no-session-persistence",
         "--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands",
         "--output-format", "json"]
LIMIT_WORDS = ("usage limit", "limit reached", "rate limit", "5-hour limit", "weekly limit")


def log(message):
    print(message, flush=True)


class UsageLimitReached(Exception):
    """The Pro plan's usage limit is used up until it resets."""


def send(text, tries=4):
    """One headless Claude Code call from the blank folder; waits out temporary overload."""
    BLANK.mkdir(exist_ok=True)
    if any(BLANK.iterdir()):
        sys.exit(f"{BLANK} must be empty so no project files or notes are picked up")
    for attempt in range(1, tries + 1):
        proc = subprocess.run(["claude", *FLAGS], input=text, capture_output=True, text=True,
                              encoding="utf-8", cwd=BLANK, timeout=1800)
        try:
            out = json.loads(proc.stdout)
        except json.JSONDecodeError:
            out = {"is_error": True, "result": (proc.stdout + proc.stderr).strip()}
        message = str(out.get("result") or "")
        if not out.get("is_error") and proc.returncode == 0:
            models = [m for m in out.get("modelUsage", {}) if m.startswith(MODEL)]
            return (models[0] if models else MODEL), message.strip()
        if any(w in message.lower() for w in LIMIT_WORDS):
            raise UsageLimitReached(message[:200])
        if attempt == tries:
            raise RuntimeError(message[:300] or f"claude exited with {proc.returncode}")
        wait = 60 * attempt
        log(f"    waiting {wait}s after: {message[:90]}")
        time.sleep(wait)


def import_status(session_no):
    """Run the normal importer (Claude is off the analysis roster, so it is named here)."""
    subprocess.run([sys.executable, str(ROOT / "scripts" / "import_replies.py"),
                    "--app", f"claude={INTERFACE}"], check=True, capture_output=True, text=True)
    return json.loads((RAW / f"session-{session_no:02d}.json").read_text(encoding="utf-8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sessions", help="e.g. 1 or 1-5,8 (default: all)")
    args = ap.parse_args()

    schedule = json.loads(SCHEDULE.read_text(encoding="utf-8"))
    sessions = {s["session"]: s for s in schedule["sessions"]}
    clones = json.loads((ROOT / "data" / "clones.json").read_text(encoding="utf-8"))["clones"]
    clones_by_key = {(c["base_profile"], c["gender"], c["race"], c["location"]): c for c in clones}
    wanted = list(range(1, schedule["sessions_count"] + 1))
    if args.sessions:
        wanted = []
        for chunk in args.sessions.split(","):
            a, _, b = chunk.partition("-")
            wanted.extend(range(int(a), int(b or a) + 1))

    REPLIES.mkdir(parents=True, exist_ok=True)
    for n in wanted:
        reply_path = REPLIES / f"session-{n:02d}.txt"
        if reply_path.exists() and reply_path.read_text(encoding="utf-8").strip():
            log(f"session {n:02d}: already has a reply, skipped")
            continue
        started = time.time()
        log(f"session {n:02d}: started")
        text = session_parts(sessions[n], clones_by_key, parts=1)[0]
        try:
            version, reply = send(text)
        except UsageLimitReached as exc:
            log(f"USAGE LIMIT REACHED ({exc}). Stopping at session {n:02d}; run the same command "
                "again after the limit resets and it resumes from here.")
            return
        reply_path.write_text(f"Model: {version} ({INTERFACE})\n{reply}\n", encoding="utf-8")
        rec = import_status(n)
        took = time.time() - started
        if rec["valid"]:
            log(f"session {n:02d}: ok in {took:.0f}s (labels {rec.get('case_labels')}; "
                f"warnings: {len(rec['warnings'])})")
        else:
            log(f"session {n:02d}: kept as returned but not valid ({took:.0f}s) - "
                f"{'; '.join(rec['problems'])[:200]}")


if __name__ == "__main__":
    main()
