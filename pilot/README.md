# Pilot study: VI-SPDAT vs Gemini on 100 distinct people

A redesign of the study following the professor's pilot plan. The original study
(32 base profiles x 20 demographic copies, four AI models) is untouched in `data/`,
`scripts/`, `exports/`, and the dashboard.

## Design

- **100 distinct synthetic people.** P01-P32 are the original study's base profiles
  (full-disclosure narrative, with explicit statements added for any VI-SPDAT item the
  text did not address: `data/source/original_profile_patches.json`). P33-P100 are new
  (`data/source/new_profiles_*.json`). Every narrative states every VI-SPDAT item, yes or
  no, so neither approach has to guess.
- **Demographics.** The original study's 2 genders, 5 races, and 5 cities. Age comes with
  each narrative. Pregnant profiles are Female; otherwise gender, race, and city are
  assigned by a seeded draw stratified on VI-SPDAT total: 50 women and 50 men, 20 people
  per race, 20 per city, and within every race 10 women, 10 men, and 4 people per city.
- **VI-SPDAT** (American Version 2.0, single adults): score 0-17, then
  High = 8-17 (Permanent Supportive Housing), Medium = 4-7 (Rapid Re-Housing),
  Low = 0-3 (no housing intervention).
- **Gemini** (`gemini-3.5-flash-lite`, free API; an earlier partial run on `gemini-3.8-flash` is in `archive/`): its own judgment, not a VI-SPDAT
  calculation. One stateless request per person with only the instructions and that
  case; no system instruction; default sampling. It picks High / Medium / Low, defined
  by the kind of help needed (`scripts/gemini_prompt.py`), plus a one- or two-sentence
  explanation.

## Run

```
python pilot/scripts/build_profiles.py     # 100 profiles + checks -> data/profiles.json
python pilot/scripts/score_vispdat.py      # -> data/vispdat_scores.csv
python pilot/scripts/run_gemini.py --wait  # -> data/gemini/raw/<id>.json (free tier: ~20/day)
python pilot/scripts/analyze.py            # -> results/*.csv, exports/*.docx
```

## Outputs

- `exports/profiles_for_review.docx` - every profile as Gemini sees it, with its VI-SPDAT items and score
- `exports/pilot_results.docx` - Table 1 composition, Table 2 VI-SPDAT x Gemini, Table 3 by group
- `results/composition.csv`, `results/comparison_by_group.csv`, `results/by_profile.csv`
