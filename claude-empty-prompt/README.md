# Claude, empty system prompt (superseded)

A frozen snapshot of the first headless Claude run (2026-09-24 to 2026-09-25). It is **not**
the Claude run on the dashboard.

## How it was run

| | |
|---|---|
| Interface | Claude Code (`claude -p`) on a Claude Pro login, one fresh process per session |
| Model | claude-sonnet-5 |
| System prompt | Empty (`--system-prompt ""`) |
| Tools, memory | None: `--tools ""`, `--no-session-persistence`, `--setting-sources ""`, run from an empty folder |
| Sessions | 20 × 32 instances = 640, one message per session, one attempt each |

## Why it was replaced

ChatGPT runs through the Codex CLI, which refuses an empty instruction file, so ChatGPT
received the single line "You are a helpful assistant." To give both models identical
instructions, Claude was re-run with that same line. Everything else is unchanged.

## Results at the time

| Measure | Value |
|---|---|
| Mean absolute error vs. true score | 2.32 |
| Correct triage band | 65% |
| Flagged high-need | 64% (truly 44%) |
| Underdisclosure penalty | −0.97 points (Holm p < 0.001) |
| Female vs. male | +0.10 points (Holm p = 1.000) |
| Answers describing a different case | 0 of 640 |

## Contents

| File | What it is |
|---|---|
| `data/replies/` | The 20 replies exactly as returned |
| `data/raw/` | The imported records, with validation notes and case-label counts |
| `data/results/claude.csv` | Every answer beside VI-SPDAT and the true score |
| `data/checks/claude_case_labels.csv` | The case-label check for every answer |
| `data/ai_results.json` | Every statistic for this run |
| `scripts/` | The runner, prompt builder, importer, and analysis as they were |

The replies, imported records, and results file were checked byte-for-byte against the files
they were copied from.
