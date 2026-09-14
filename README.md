# homelessness-algorithm

**Dashboard:** https://sallypineapple2.github.io/homelessness-algorithm/
*(live once GitHub Pages is enabled — see Setup below)*

A research dashboard for an individual project on algorithmic bias in the
Coordinated Entry System (CES).

## Research Question

> When analyzing the same set of client data, how do AI-based models perform
> compared with VI-SPDAT?

This project would evaluate the result for bias and accuracy against the actual
vulnerability of these individuals.

**Hypothesis:** My hypothesis is that the AI-based model would outperform
VI-SPDAT in terms of accuracy, but still remain slightly skewed against people
of color.

## Data Sources

**Primary source**

| Field | Value |
|---|---|
| Source | OrgCode Consulting Inc., accessed through Georgia Department of Community Affairs |
| Year | 2015 |
| Unit of analysis | Each unhoused participant's profile/data |
| Major variables | 16 vulnerability indicators/subscales (split into 4 domains), scored 0–17 |
| Access status | Public |

**Supporting research:** C4 Innovations, *"CES Racial Equity Analysis of
Assessment Data"*; the Coordinated Entry System Triage Tool Research and
Refinement report; OrgCode's December 2020 statement on VI-SPDAT.

## Repository layout

```
index.html, assets/          the dashboard (static HTML/CSS/JS, D3)
  assets/dashboard.js        method, profiles, schedule, model roster
  assets/results.js          results: charts, t-tests, bias matrix, accuracy

scripts/                     the pipeline, run in the order below
  check_profiles.py          validate base profiles (structure, underdisclosure, leakage)
  make_schedule.py           the full design: 3,200 instances
  make_clones.py             build the 1,600 demographic clones
  score_vispdat.py           score every instance with VI-SPDAT + paired t-tests
  make_paste_schedule.py     the smaller balanced design the AI apps read
  ai_prompt.py               the blind prompt text and the reply checks
  make_paste_packets.py      write the paste prompts and empty reply files
  import_replies.py          check pasted replies and import them
  analyze_ai.py              AI bias tests, accuracy, and rank agreement

paste/                       where the AI test is run by hand
  README.md                  step-by-step pasting instructions
  prompts/session-NN/part-K.txt  the messages to paste (20 sessions, 2 parts each)
  replies/<app>/session-NN.txt   paste each reply here (claude, chatgpt, gemini)

data/                        the current study — everything the dashboard reads
  vispdat_instrument.json    VI-SPDAT v2.0 indicators and scoring rules
  base_profiles.json         32 base profiles (indicator flags + narratives)
  clones.json                1,600 clones, each with both disclosure conditions
  run_schedule.json          the full design, 3,200 instances
  vispdat_results.json/.csv  VI-SPDAT arm: every instance + tests
  ai/models.json             the three AI apps
  ai/paste_schedule.json     20 sessions × 32 cases for the AI apps
  ai/raw/<app>/              every imported reply, exactly as pasted
  ai/results/<app>.csv       every AI score, rank, and reason
  ai_results.json            AI arm summary, with VI-SPDAT on the same cases

feasibility/                 the first run (race × gender only) — not on the dashboard
```

## Study design

### The scoring instrument

`data/vispdat_instrument.json` encodes the VI-SPDAT for Single Adults, American
Version 2.0 (©2015 OrgCode Consulting Inc. and Community Solutions): every
indicator, the questions it draws on, and its scoring rule as published.

| Domain | Max |
|---|---|
| Pre-Survey (age 60+) | 1 |
| A. History of Housing and Homelessness | 2 |
| B. Risks | 4 |
| C. Socialization and Daily Functions | 4 |
| D. Wellness | 6 |
| **Total** | **17** |

Tri-morbidity is a *derived* indicator: it scores only where physical health,
substance use, and mental health all score.

### The base profiles

`data/base_profiles.json` holds 32 demographically neutral profiles recorded at the
indicator level; totals are computed from the flags, never asserted.

- **Full coverage.** Every total from 0 to 17 is represented.
- **Thresholds oversampled.** Three profiles each score 3, 4, 7 and 8 — the Rapid
  Re-Housing and Permanent Supportive Housing boundaries.
- **Composition varied.** Profiles sharing a total load onto different domains.

Each profile carries **eleven narrative fields** — work and education, path into
homelessness, current housing, finances, health, safety, family ties, a typical day,
goals, service history, and interview demeanor. Every flagged indicator is described
in plain language in those fields and no unflagged one is implied, so a reader who
never sees the VI-SPDAT questions still has what is needed to judge vulnerability.
The researcher-facing `vignette` summary is never shown to a model.

Where a profile withholds information under underdisclosure, an `underdisclosure`
block replaces every field that would reveal it with what an assessor would have on
record if the person never mentioned it.

`scripts/check_profiles.py` refuses to pass a profile set unless every field is
present, age and tri-morbidity agree with the rules, no underdisclosure text mentions
a withheld indicator, and no field carries gendered, racial, national, or religious
wording, British spellings, or a city or climate detail that would clash with a clone
location.

### The clones

`scripts/make_clones.py` builds `data/clones.json`: every base profile × 2 genders ×
5 HUD race categories × 5 locations — **50 clones per profile, 1,600 in all**. Each has
an id such as `P18-F-BLACK-CHI` and one added line:

```
Age 37. Gender: Female. Race: Black, African American, or African. Location: Chicago, Illinois.
```

| Locations | Region |
|---|---|
| Los Angeles, California | West |
| Cincinnati, Ohio | Midwest |
| Chicago, Illinois | Midwest |
| Atlanta, Georgia | South |
| New York City, New York | Northeast |

Each clone records, for both disclosure conditions, the indicators reported, the
indicators withheld, and the narrative on record. Under underdisclosure the respondent
withholds up to three of the indicators people most often conceal (exploitation,
substance use, trauma, mental health, legal issues, harm, medications, relationships —
in that order). The mask depends only on the base profile, so all 50 clones withhold
the same things.

### Two designs

| | VI-SPDAT | Each AI app |
|---|---|---|
| Schedule | `data/run_schedule.json` | `data/ai/paste_schedule.json` |
| Instances | 3,200 — every clone, both disclosure conditions | 640 — 20 sessions × 32 cases |
| How it's run | computed | pasted by hand into the free app |

**The paste design.** Within each base profile, the 20 conditions fully cross gender ×
race × disclosure (2 × 5 × 2), so every race vs. White, Female vs. Male, and disclosure
comparison pairs a profile with itself. Cities are assigned so each appears four times
per profile, balanced across gender and disclosure, and no race meets the same city
twice. What it gives up: whether a race effect differs by city cannot be estimated.
Sessions are a cyclic Latin square (profile *i* in session *s* takes condition
*(i + s) mod 20*), so no session contains two clones of one profile, with order shuffled
inside each session. The generator verifies all of this before writing.

### Blind AI protocol

Each session is pasted into a **new chat**, as two messages because free apps cap message
length, in the free versions of **Claude**
(claude.ai), **ChatGPT** (chatgpt.com), and **Gemini** (gemini.google.com), with memory
turned off. The same text goes into all three. A model is **never shown the VI-SPDAT
questions**, indicators, domains, scoring rules, or bands, and never told what the study
measures. Cases are labeled only by position ("Case 7"). For every case it returns a
score from 0 to 17, a rank from 1 (most vulnerable) to 32, and a one-sentence reason, as
JSON.

`scripts/import_replies.py` checks every pasted reply — every case scored once, every
score a whole number from 0 to 17, ranks a complete 1–32 ordering, no reply pasted
twice — and records the model version from the reply file's `Model:` line. A reply that
fails is flagged for redoing and never imputed.

**True vulnerability** is each base profile's full-disclosure indicator total: what the
person actually has, whether or not they disclosed it.

## Running the pipeline

```bash
python scripts/check_profiles.py
python scripts/make_schedule.py
python scripts/make_clones.py
python scripts/score_vispdat.py
python scripts/make_paste_schedule.py
python scripts/make_paste_packets.py      # safe to re-run: never overwrites replies
```

Then paste the sessions by hand, following **`paste/README.md`**, and:

```bash
python scripts/import_replies.py          # progress grid + anything to redo
python scripts/analyze_ai.py              # updates the dashboard's AI results
```

## Results

### VI-SPDAT arm — complete

All 3,200 instances scored with the published additive algorithm.

| Comparison | Mean diff | t | p |
|---|---|---|---|
| Am. Indian / AK Native / Indigenous vs. White | 0.000 | n/a | 1.000 |
| Asian or Asian American vs. White | 0.000 | n/a | 1.000 |
| Black, African American, or African vs. White | 0.000 | n/a | 1.000 |
| Hispanic/Latino/e/a vs. White | 0.000 | n/a | 1.000 |
| Female vs. Male | 0.000 | n/a | 1.000 |
| Each of the five locations vs. the other four | 0.000 | n/a | 1.000 |
| **Underdisclosure vs. full disclosure** | **−1.938** | **−50.31** | **<0.001** |

Mean score was 6.406 for every race, both genders, and every city, and all 50 clones of
each profile shared one score and rank. Race and location are not inputs to any
VI-SPDAT rule, and the only gender-dependent item is the pregnancy question, which no
profile sets — so the documented racial bias in VI-SPDAT cannot originate in the
arithmetic. It has to enter through the interview.

Underdisclosure moved **500 of 1,600** clone combinations into a lower triage band and
dropped an underdisclosed case **178 places** on average when ranked against 1,600
people who disclosed everything. Against true vulnerability, VI-SPDAT's mean absolute
error is 0 under full disclosure and 1.94 points under underdisclosure.

Each result row carries `score`, `band`, `rank` (competition ranking within its
disclosure condition, ties shared), `rank_among_full_disclosure`, `places_lost`,
`scored_indicators`, `withheld`, and a plain-language `reason`.

### AI arm — ChatGPT (20 of 20 sessions, 640 instances)

Every ChatGPT reply is analyzed exactly as returned. The case-label check found that
**208 of 640 answers (33%)** describe a different person than the case number they carry,
in 14 of 20 sessions. Those scores are credited to the wrong race, gender, and city, which
pulls real demographic differences toward zero, so the bias tests below are weak evidence
of *no* bias. Claude and Gemini are not part of the current analysis.

**Accuracy against true vulnerability (same 640 instances)**

| | VI-SPDAT | ChatGPT |
|---|---|---|
| Mean absolute error (points) | 0.97 | 4.07 |
| Mean error (+ overrates) | −0.97 | **+2.90** |
| Correct triage band | 84% | 55% |
| Placed in a higher band than the truth | 0% | 38% |
| Placed in a lower band than the truth | 16% | 7% |
| Referred to Permanent Supportive Housing (44% truly eligible) | 34% | 67% |
| Correlation with the truth (r) | 0.95 | 0.59 |

**Bias (paired t-tests, Holm-adjusted across the ten demographic tests)**

| Comparison | ChatGPT diff. | 95% CI | p (Holm) |
|---|---|---|---|
| Am. Indian / AK Native / Indigenous vs. White | +0.05 | [−0.90, +1.01] | 1.000 |
| Asian or Asian American vs. White | +0.59 | [−0.31, +1.50] | 1.000 |
| Black, African American, or African vs. White | +0.13 | [−0.88, +1.15] | 1.000 |
| Hispanic/Latino/e/a vs. White | +0.20 | [−0.85, +1.25] | 1.000 |
| Female vs. Male | +0.21 | [−0.43, +0.84] | 1.000 |
| Each city vs. the other four | −0.52 to +0.55 | all intervals include 0 | 1.000 |
| **Underdisclosure vs. full disclosure** | **−0.67** | [−1.30, −0.04] | **0.038** |

No race, gender, or city difference was significant, and no group differed in referral
to Permanent Supportive Housing. VI-SPDAT shows exactly zero on every demographic test by
construction. Withholding stigmatized details cost ChatGPT 0.67 points, a third of
VI-SPDAT's 1.94. The same person's ChatGPT score varied with an average standard deviation
of 3.8 points across their demographic versions, and 31 of 32 profiles landed in more than
one triage band depending on the version.

### Sensitivity analysis — ChatGPT, re-attached

The same replies, with the 14 mislabeled sessions corrected by a lenient rule: an answer
whose stated facts (how long homeless, age) fit its own case stays; an answer whose facts
fit exactly one other case is moved there; everything else is dropped, and if two answers
land on the same case both are dropped. Of 448 answers in those sessions, 196 stayed, 65 were
moved, and 187 were dropped (91 collided on the same case, 86 fit more than one other case,
10 stated no usable facts). Scores and reasons are unchanged; 453 of 640 instances (71%)
remain. Decisions are listed in `data/ai/checks/chatgpt-reattached_decisions.csv`.

| | VI-SPDAT | ChatGPT, as returned | ChatGPT, re-attached |
|---|---|---|---|
| Instances | 640 | 640 | 453 |
| Mean absolute error | 0.97 | 4.07 | 2.94 |
| Mean error (+ overrates) | −0.97 | +2.90 | +2.80 |
| Correlation with the truth (r) | 0.95 | 0.59 | 0.88 |
| Correct triage band | 84% | 55% | 65% |
| Same person's score, SD across versions | — | 3.83 | 1.23 |
| Profiles landing in more than one band | 0 by demographics | 31 of 32 | 10 of 32 |
| Underdisclosure vs. full disclosure | −1.94 | −0.67 * | −0.53 * |
| Am. Indian / AK Native vs. White | 0.00 | +0.05 | +0.29 [−0.21, +0.80] |
| Asian vs. White | 0.00 | +0.59 | +0.25 [−0.10, +0.59] |
| Black vs. White | 0.00 | +0.13 | +0.08 [−0.39, +0.55] |
| Hispanic / Latino vs. White | 0.00 | +0.20 | +0.17 [−0.16, +0.50] |
| Female vs. Male | 0.00 | +0.21 | +0.19 [−0.13, +0.51] |

\* significant after Holm adjustment. No race or gender difference is significant in either
version; in the re-attached version every race and gender interval lies within about
±0.8 points of zero.

**City effects** (each city vs. the other four, points; Holm-adjusted across the ten
demographic tests). As returned, pairs are profiles seen under all 20 conditions. In the
re-attached version no profile keeps every condition, so each profile is compared with
itself within the same disclosure condition, using the answers it has.

| City | VI-SPDAT | ChatGPT, as returned | ChatGPT, re-attached |
|---|---|---|---|
| Los Angeles, CA | 0.00 | −0.52 [−1.55, +0.51] | −0.15 [−0.46, +0.16] |
| Cincinnati, OH | 0.00 | −0.16 [−1.20, +0.89] | −0.00 [−0.26, +0.25] |
| Chicago, IL | 0.00 | +0.25 [−0.54, +1.05] | +0.12 [−0.29, +0.53] |
| Atlanta, GA | 0.00 | +0.54 [−0.15, +1.24] | −0.05 [−0.44, +0.35] |
| New York City, NY | 0.00 | −0.12 [−0.86, +0.62] | +0.16 [−0.09, +0.41] |

No city effect is significant in any version. Within cities, the only unadjusted p < 0.05
results in the re-attached version (a +0.56 female–male gap in Chicago and a −0.67
underdisclosure penalty in Los Angeles) do not survive Holm adjustment.

Re-attaching removes most of the apparent inconsistency: once answers sit on the person they
describe, ChatGPT scores the same person within about a point regardless of race, gender, or
city. What remains is systematic over-scoring of about 2.8 points, which sends about 68% of
cases to Permanent Supportive Housing when 44% qualify.

### Feasibility study

`feasibility/` preserves the first run — 32 profiles with the original narratives,
320 race × gender clones, 640 instances, VI-SPDAT only — with its own README, data,
and reproducible scripts. It is kept for reference and is not shown on the dashboard.

## Setup / GitHub Pages

1. Repo settings → **Pages** → Source: **Deploy from a branch**
2. Branch: **main**, folder: **/(root)**
3. Save, then visit the published URL above

## Running locally

The page loads its data with `fetch`, so open it over HTTP rather than
double-clicking the file:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000`.

## Tech

Static HTML/CSS/JS with no build step, served from the repo root.
[D3.js](https://d3js.org/) v7 draws the charts. Colors use a validated
categorical/ordinal palette checked for colorblind separation and contrast, and
the page renders in both light and dark mode.
