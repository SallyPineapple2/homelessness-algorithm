# ChatGPT, pasted by hand (superseded)

A frozen snapshot of the first ChatGPT arm. It is **not** the ChatGPT run on the dashboard;
it was replaced by a scripted run (`scripts/run_chatgpt.py`) that sends each session the same
way Claude's are sent, so the two models are run under one method.

## How it was run

| | |
|---|---|
| Interface | chatgpt.com, free plan, pasted by hand (2026-09-13) |
| Sessions | 20 × 32 instances = 640, from `data/paste_schedule.json` |
| Message | Each session pasted as two parts in one new chat |
| Memory | The protocol said to use a temporary chat or turn memory off; the app's settings at the time were not recorded, so this cannot be confirmed |
| Model version | "ChatGPT Default", as reported on each reply |

## Why it was replaced

- **Memory could not be confirmed.** The scripted run shows exactly what reaches the model.
- **Answers were labeled with the wrong case.** The case-label check found 208 of 640
  answers (33%) describing a different person than their case number. That pulls every
  demographic gap toward zero.
- **Method matches Claude.** Claude was run headless on a subscription login, one message per
  session; the replacement runs ChatGPT the same way.

## Results at the time

| Analysis | Instances | Mean absolute error vs. true score | Significant (Holm) |
|---|---|---|---|
| ChatGPT, as returned | 640 | 4.07 | Underdisclosure vs. full disclosure (−0.67) |
| ChatGPT, re-attached | 453 | 2.94 | Underdisclosure vs. full disclosure |

## Contents

| File | What it is |
|---|---|
| `data/replies/` | The 20 replies exactly as pasted |
| `data/raw/` | The imported records, with validation notes and case-label counts |
| `data/results/chatgpt.csv` | Every answer as returned, beside VI-SPDAT and the true score |
| `data/results/chatgpt-reattached.csv` | The re-attached analysis |
| `data/checks/` | The case-label check for every answer, and the re-attach decisions |
| `data/ai_results.json` | Every statistic for both ChatGPT analyses |
| `data/paste_schedule.json`, `data/models.json` | The schedule and model roster used |
| `scripts/` | The prompt builder, importer, case-label checks, and analysis as they were |

The replies, imported records, and `chatgpt.csv` were checked byte-for-byte against the
files they were copied from. The scripts read from the main `data/` layout, so they document
the method rather than run from this folder.
