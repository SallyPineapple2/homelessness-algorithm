"""
Run the ChatGPT sessions through the Codex CLI on a ChatGPT login, one fresh process per session.

This is the ChatGPT counterpart of scripts/run_claude.py: no paid API key, and each session is
stripped down to a plain model call. For every session:

  a brand-new CODEX_HOME   holding only a copy of the sign-in file, so no memories, past
                           threads, skills, or settings from earlier Codex use can load; it is
                           deleted after the session (the refreshed sign-in is copied back first)
  model_instructions_file  Codex's own coding-agent instructions are replaced with one line
  --disable ...            shell, code execution, browser, computer use, apps, plugins, image
                           generation, memories, and the other optional tools are switched off;
                           skills are not loaded; web search is off; the sandbox is read-only
  --ignore-user-config, --ignore-rules
  a neutral, empty folder  no AGENTS.md, and a working-directory path that says nothing about
                           the study

Codex still adds a few lines it cannot drop: the read-only sandbox description, a note not to
start sub-agents, and the folder path, shell, date, and time zone. They are the same in every
session and for every case. No email address, memory, or earlier chat reaches the model. Each
session's full record of what was sent is kept in data/ai/checks/chatgpt_sent/ as evidence.

Each session is the same single unsplit message the Claude and Gemini runs use
(ai_prompt.session_parts, parts=1), written to paste/replies/chatgpt-codex/session-NN.txt with a
"Model:" line. One attempt per session: whatever comes back is kept as returned. A session
whose reply file already holds a reply is skipped, so the script can be stopped and restarted;
when the plan's usage limit is reached it stops and resumes from that session next time.

--effort sets how much the model reasons before answering (Codex's model_reasoning_effort). The
main run leaves it at the default; a run with an effort is saved under its own key
(chatgpt-codex-<effort>) so the two can be compared.

Run:  python scripts/run_chatgpt.py --sessions 1        (one session, to test)
      python scripts/run_chatgpt.py                     (all remaining sessions)
      python scripts/run_chatgpt.py --effort high       (a separate run with deeper reasoning)
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from ai_prompt import session_parts

ROOT = Path(__file__).resolve().parents[1]
KEY = "chatgpt-codex"
EFFORT = None
REPLIES = ROOT / "paste" / "replies" / KEY
RAW = ROOT / "data" / "ai" / "raw" / KEY
SENT = ROOT / "data" / "ai" / "checks" / "chatgpt_sent"
SCHEDULE = ROOT / "data" / "ai" / "paste_schedule.json"
TMP = Path(tempfile.gettempdir())
BLANK = TMP / "blank"
AUTH = TMP / "codex-auth" / "auth.json"      # the sign-in, copied once from ~/.codex
INSTRUCTIONS = TMP / "codex-instructions.txt"

INTERFACE = "Codex CLI on a ChatGPT login, single message"
CODEX = Path(os.environ["LOCALAPPDATA"]) / "Microsoft" / "WinGet" / "Packages" / \
    "OpenAI.Codex_Microsoft.Winget.Source_8wekyb3d8bbwe" / "codex-x86_64-pc-windows-msvc.exe"
DISABLED = ["shell_tool", "unified_exec", "apps", "plugins", "browser_use", "browser_use_external",
            "computer_use", "image_generation", "multi_agent", "goals", "view_image", "sleep_tool",
            "skill_search", "tool_suggest", "hooks", "in_app_browser", "remote_plugin", "memories",
            "code_mode_host"]
LIMIT_WORDS = ("usage limit", "rate limit", "limit reached", "rate_limit", "quota")


def log(message):
    print(message, flush=True)


class UsageLimitReached(Exception):
    """The ChatGPT plan's Codex usage limit is used up until it resets."""


def flags(out_file):
    args = ["exec", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check",
            "-s", "read-only", "-C", str(BLANK), "--enable", "skip_host_skill_discovery",
            "-c", 'web_search="disabled"', "-c", "skills.bundled.enabled=false",
            "-c", f"model_instructions_file='{INSTRUCTIONS.as_posix()}'",
            "-c", "suppress_unstable_features_warning=true", "-o", str(out_file)]
    if EFFORT:
        args += ["-c", f'model_reasoning_effort="{EFFORT}"']
    for feature in DISABLED:
        args += ["--disable", feature]
    return args + ["-"]


def sent_record(home):
    """What was sent (from the session record) and the model that answered."""
    files = list((home / "sessions").rglob("*.jsonl"))
    if not files:
        return None, []
    events = [json.loads(line) for line in files[0].read_text(encoding="utf-8").splitlines() if line.strip()]
    model = next((e["payload"].get("model") for e in events if e.get("type") == "turn_context"), None)
    return model, events


def send(text, session_no, tries=3):
    """One Codex run in a brand-new home folder; waits out temporary errors."""
    BLANK.mkdir(exist_ok=True)
    if any(BLANK.iterdir()):
        sys.exit(f"{BLANK} must be empty so no project files or notes are picked up")
    for attempt in range(1, tries + 1):
        home = Path(tempfile.mkdtemp(prefix="codex-session-"))
        try:
            shutil.copy(AUTH, home / "auth.json")
            out_file = home / "last_message.txt"
            proc = subprocess.run([str(CODEX), *flags(out_file)], input=text, capture_output=True,
                                  text=True, encoding="utf-8", cwd=BLANK, timeout=1800,
                                  env={**os.environ, "CODEX_HOME": str(home)})
            if (home / "auth.json").exists():
                shutil.copy(home / "auth.json", AUTH)  # keep the refreshed sign-in
            reply = out_file.read_text(encoding="utf-8").strip() if out_file.exists() else ""
            model, events = sent_record(home)
            if proc.returncode == 0 and reply:
                SENT.mkdir(parents=True, exist_ok=True)
                with (SENT / f"session-{session_no:02d}.jsonl").open("w", encoding="utf-8") as fh:
                    for e in events:
                        fh.write(json.dumps(e, ensure_ascii=False) + "\n")
                return model or "unknown", reply
            message = (proc.stderr + proc.stdout)[-600:]
        finally:
            shutil.rmtree(home, ignore_errors=True)
        if any(w in message.lower() for w in LIMIT_WORDS):
            raise UsageLimitReached(message[-200:])
        if attempt == tries:
            raise RuntimeError(message[-300:] or f"codex exited with {proc.returncode}")
        wait = 60 * attempt
        log(f"    waiting {wait}s after: {message[-120:]}")
        time.sleep(wait)


def import_status(session_no):
    """Run the normal importer (named here in case the app is not on the roster yet)."""
    subprocess.run([sys.executable, str(ROOT / "scripts" / "import_replies.py"),
                    "--app", f"{KEY}={INTERFACE}"], check=True, capture_output=True, text=True)
    return json.loads((RAW / f"session-{session_no:02d}.json").read_text(encoding="utf-8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sessions", help="e.g. 1 or 1-5,8 (default: all)")
    ap.add_argument("--effort", help="reasoning effort, e.g. high (default: the model's own default)")
    args = ap.parse_args()
    global KEY, EFFORT, REPLIES, RAW, SENT, INTERFACE
    if args.effort:
        EFFORT = args.effort
        KEY = f"chatgpt-codex-{EFFORT}"
        INTERFACE = f"{INTERFACE}, reasoning effort {EFFORT}"
        REPLIES = ROOT / "paste" / "replies" / KEY
        RAW = ROOT / "data" / "ai" / "raw" / KEY
        SENT = ROOT / "data" / "ai" / "checks" / f"chatgpt_sent_{EFFORT}"

    if not AUTH.exists():
        AUTH.parent.mkdir(exist_ok=True)
        shutil.copy(Path.home() / ".codex" / "auth.json", AUTH)
    INSTRUCTIONS.write_text("You are a helpful assistant.", encoding="utf-8")

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
            version, reply = send(text, n)
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
