"""
Write the paste packets for the AI arm.

  paste/prompts/session-NN/part-K.txt   the messages to paste, in order, into one chat
  paste/replies/<app>/session-NN.txt    an empty file to paste each final reply into

Free chat apps limit how long one message can be, so each session is split into
--parts messages (default 2). If an app still says a message is too long, re-run
with --parts 3. Prompts are regenerated each time; existing reply files are never
overwritten, so re-running this is safe.

Run:  python scripts/make_paste_packets.py [--parts N]
"""

import argparse
import json
import shutil
from pathlib import Path

from ai_prompt import session_parts

ROOT = Path(__file__).resolve().parents[1]
SCHEDULE = ROOT / "data" / "ai" / "paste_schedule.json"
CLONES = ROOT / "data" / "clones.json"
MODELS = ROOT / "data" / "ai" / "models.json"
PROMPTS = ROOT / "paste" / "prompts"
REPLIES = ROOT / "paste" / "replies"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--parts", type=int, default=2, help="messages per session")
    args = ap.parse_args()

    schedule = json.loads(SCHEDULE.read_text(encoding="utf-8"))
    clones = json.loads(CLONES.read_text(encoding="utf-8"))["clones"]
    clones_by_key = {(c["base_profile"], c["gender"], c["race"], c["location"]): c for c in clones}
    apps = [m["key"] for m in json.loads(MODELS.read_text(encoding="utf-8"))["models"] if not m.get("source")]

    # prompts are generated output: clear them so no stale part is left behind
    if PROMPTS.exists():
        shutil.rmtree(PROMPTS)
    sizes = []
    for sess in schedule["sessions"]:
        folder = PROMPTS / f"session-{sess['session']:02d}"
        folder.mkdir(parents=True)
        for k, text in enumerate(session_parts(sess, clones_by_key, args.parts), start=1):
            (folder / f"part-{k}.txt").write_text(text, encoding="utf-8")
            sizes.append(len(text))

    created = 0
    for app in apps:
        folder = REPLIES / app
        folder.mkdir(parents=True, exist_ok=True)
        for sess in schedule["sessions"]:
            path = folder / f"session-{sess['session']:02d}.txt"
            if not path.exists():
                path.write_text("", encoding="utf-8")
                created += 1

    print(f"wrote {len(schedule['sessions'])} sessions x {args.parts} parts to {PROMPTS.relative_to(ROOT)} "
          f"(longest message {max(sizes):,} characters)")
    print(f"created {created} empty reply files under {REPLIES.relative_to(ROOT)} (existing files left untouched)")


if __name__ == "__main__":
    main()
