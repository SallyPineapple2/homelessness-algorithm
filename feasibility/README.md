# Feasibility study — race × gender clones (VI-SPDAT only)

A frozen snapshot of the first demographic run. It is **not** shown on the dashboard;
the main study (with locations and rewritten narratives) lives in `../data/`.

## Design

| | |
|---|---|
| Base profiles | 32 (original narratives) |
| Clones | 320 — 2 genders × 5 HUD race categories per profile |
| Instances | 640 — every clone under full disclosure and underdisclosure |
| Schedule | 20 sessions × 32, cyclic Latin square, seed 20260906 |
| Model | VI-SPDAT Single Adults v2.0, published additive scoring |

## Contents

| File | What it is |
|---|---|
| `data/base_profiles.json` | The 32 profiles as they were for this run |
| `data/clones.json` | The 320 clones, each with its interview answers under both disclosure conditions |
| `data/run_schedule.json` | The 20-session running order |
| `data/vispdat_results.json` | Every scored instance plus means and paired t-tests |
| `data/vispdat_results.csv` | The same results as a spreadsheet: score, band, rank, reason |
| `scripts/` | The exact scripts that produced the files above |

Reproduce from this folder (the output matches the files here exactly):

```bash
python scripts/make_schedule.py
python scripts/make_clones.py
python scripts/score_vispdat.py
```

## Results

| Comparison | Mean diff | t | p |
|---|---|---|---|
| Am. Indian / AK Native / Indigenous vs. White | 0.000 | n/a | 1.000 |
| Asian or Asian American vs. White | 0.000 | n/a | 1.000 |
| Black, African American, or African vs. White | 0.000 | n/a | 1.000 |
| Hispanic/Latino/e/a vs. White | 0.000 | n/a | 1.000 |
| Female vs. Male | 0.000 | n/a | 1.000 |
| **Underdisclosure vs. full disclosure** | **−1.938** | **−22.47** | **<0.001** |

- Mean score was 6.406 for every race and both genders; all ten clones of every profile
  shared the same score and rank.
- Underdisclosure moved **100 of 320** profile-and-demographic combinations into a lower
  triage band, and dropped an instance **35.6 places** on average when ranked against people
  who disclosed everything.

## What this study showed about feasibility

1. **The clone pipeline works.** Clones are generated and verified mechanically; narratives
   are identical across a profile's clones.
2. **VI-SPDAT cannot show demographic bias in arithmetic alone** — race and gender are not
   inputs. The VI-SPDAT arm is a fixed baseline for the AI arm, not a bias test by itself.
3. **The narratives were not ready for a blind AI reading.** Several underdisclosure cases
   still described what was supposedly withheld (e.g. P18's routine mentions trading for a
   bed), health and safety facts lived only in the researcher's vignette, and the text used
   British spellings ("flat", "programme", "centre") — a national signal. The main study
   rewrites the narratives to fix all three.
