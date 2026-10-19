"""
Record whether a Gemini model spends reasoning ("thinking") tokens under the study's
exact settings: the same prompt, no system instruction, default config. Saves Google's
usage report for each request so the claim can be checked later.

These requests are a methods check only; their answers are not analyzed.

Run:  python pilot/scripts/check_thinking.py --model gemini-3.5-flash-lite --n 3
Writes: pilot/results/thinking_check_<model>.json
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_gemini as rg  # noqa: E402
from gemini_prompt import prompt  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--n", type=int, default=3)
    args = ap.parse_args()
    from google import genai
    from google.genai import types
    client = genai.Client(api_key=rg.load_key(), http_options=types.HttpOptions(timeout=180_000))
    profiles = json.loads((rg.PILOT / "data" / "profiles.json").read_text(encoding="utf-8"))["profiles"][:args.n]
    rg.set_model(args.model)
    out = []
    for p in profiles:
        r = rg.send(client, prompt(p))
        u = r.usage_metadata
        out.append({
            "id": p["id"], "model": args.model, "config": "study default (no system instruction, no thinking setting)",
            "requested_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "prompt_tokens": u.prompt_token_count, "thinking_tokens": u.thoughts_token_count,
            "answer_tokens": u.candidates_token_count, "total_tokens": u.total_token_count,
        })
        print(out[-1])
    path = rg.PILOT / "results" / f"thinking_check_{args.model}.json"
    path.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"wrote {path.relative_to(rg.ROOT)}")


if __name__ == "__main__":
    main()
