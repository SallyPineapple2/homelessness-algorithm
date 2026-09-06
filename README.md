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

## Dashboard Contents

1. **Research question** and hypothesis
2. **Background** — how CES and VI-SPDAT work, and the documented racial bias
3. **Data source** — the published VI-SPDAT methodology record
4. **Method** — synthetic population design and study scale
5. **The 32 base profiles** — the full profile set, with a distribution chart
   showing how they spread across the three VI-SPDAT triage bands, plus a
   filterable table of every profile and its domain scores
6. **Planned results** — the empty chart and paired t-test table the results will
   fill, with an optional example-values preview behind a toggle
7. **Expected contribution and limitations**

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

That is 16 vulnerability indicators across the four domains, plus one
pre-survey point for age. Tri-morbidity is a *derived* indicator: it scores only
where physical health, substance use, and mental health all score.

### The base profiles

`data/base_profiles.json` holds 32 demographically neutral case descriptions
recorded at the indicator level — which indicators are flagged, not what the
score is. Domain subtotals and totals are computed from those flags using the
rules above, so a profile cannot carry a score its own answers do not produce.

Design choices:

- **Full coverage.** Every total from 0 to 17 is represented.
- **Thresholds oversampled.** Three profiles score 3 and three score 4 (the
  Rapid Re-Housing boundary); three score 7 and three score 8 (the Permanent
  Supportive Housing boundary). A one-point demographic shift there changes
  which intervention a person is referred to.
- **Composition varied.** Profiles sharing a total load onto different domains,
  so the models can be tested on composition as well as magnitude. VI-SPDAT is
  purely additive and cannot distinguish them; an LLM might.

Because each profile is cloned across 2 genders × 5 HUD race categories and
tested under both full disclosure and underdisclosure, the design produces 640
profile instances and 1,280 scores across both models.

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
