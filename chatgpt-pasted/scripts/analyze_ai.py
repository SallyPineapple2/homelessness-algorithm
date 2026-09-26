"""
Analyze the AI arm against VI-SPDAT and against true vulnerability.

Each app's imported replies (data/ai/raw/<app>/, written by
scripts/import_replies.py) are mapped from (session, case number) back to the
scheduled instance in data/ai/paste_schedule.json. VI-SPDAT is scored on exactly
the same instances, and both arms go through the same analysis.

Per arm, the output holds:

  tests              Primary paired t-tests. Each race vs. White, Female vs. Male,
                     and underdisclosure vs. full disclosure pair a base profile with
                     itself; each city pairs a profile's mean in that city with its
                     mean in the other four. 95% CI, Cohen's d_z, and Holm-adjusted
                     p-values across the ten demographic tests.
  interaction_tests  Exploratory: race gaps within each gender, and whether the
                     underdisclosure penalty differs by race or by gender.
  cells              Mean deviation from each profile's own mean score, for race x
                     gender and race x disclosure. Subtracting the profile mean
                     removes differences in how vulnerable the profiles are.
  locations          Per city: the city effect, and the gender gap and disclosure
                     penalty within that city. (Race x city is not estimable here.)
  accuracy           Error against true vulnerability overall, by group, and by true
                     score (calibration), with under- and over-triage rates.
  profiles           Per base profile: mean, spread, and range across its versions.
  triage             Triage-band shares and Permanent Supportive Housing access by
                     group, with paired tests on PSH access.
  ranking            Agreement with the truth and with VI-SPDAT within sessions, and
                     whether the model's own ranks agree with its own scores.

True vulnerability is the base profile's full-disclosure indicator total. A
session that is missing or needs redoing is reported, never imputed; tests use
the complete pairs available. Ranks from replies whose ranks were not a complete
1-32 order are excluded from rank analyses; their scores are kept.

Run:  python scripts/analyze_ai.py
Writes: data/ai/results/<app>.csv, data/ai_results.json
"""

import csv
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

from scipy import stats

from make_schedule import DISCLOSURE, GENDERS, LOCATIONS, RACES
from score_vispdat import band_of, group_means
from check_case_labels import reattach, session_cases

ROOT = Path(__file__).resolve().parents[1]
INSTRUMENT = ROOT / "data" / "vispdat_instrument.json"
PROFILES = ROOT / "data" / "base_profiles.json"
CLONES = ROOT / "data" / "clones.json"
CHECKS = ROOT / "data" / "ai" / "checks"
SCHEDULE = ROOT / "data" / "ai" / "paste_schedule.json"
VISPDAT = ROOT / "data" / "vispdat_results.json"
MODELS = ROOT / "data" / "ai" / "models.json"
RAW = ROOT / "data" / "ai" / "raw"
RESULTS_DIR = ROOT / "data" / "ai" / "results"
ATTEMPTS = ROOT / "data" / "ai" / "attempts"
OUT = ROOT / "data" / "ai_results.json"

ALPHA = 0.05
FULL_RUNS = len(GENDERS) * len(RACES) * len(DISCLOSURE)
COLUMNS = [
    "session", "position", "profile", "gender", "race", "location", "disclosure", "score", "band",
    "rank", "ranks_valid", "reason", "model_version", "vispdat_score", "true_score",
]

BANDS = None  # set in main()


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def r4(x):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), 4)


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def band_id(score):
    return band_of(score, BANDS)["id"]


def safe_corr(fn, a, b):
    if len(a) < 3 or len(set(a)) < 2 or len(set(b)) < 2:
        return None
    return r4(fn(a, b)[0])


# ---------------------------------------------------------------- tests

def paired(pairs, label, family):
    """Paired t-test with a 95% CI and Cohen's d_z; pairs with a missing side are skipped."""
    pairs = [(a, b) for a, b in pairs if a is not None and b is not None]
    n = len(pairs)
    out = {"comparison": label, "family": family, "n": n, "df": None, "mean_diff": None, "ci_low": None,
           "ci_high": None, "sd_diff": None, "d_z": None, "t": None, "p": None, "p_holm": None,
           "significant": False, "significant_holm": False, "note": None}
    if n < 2:
        out["note"] = "not enough complete pairs"
        return out
    diffs = [a - b for a, b in pairs]
    md = sum(diffs) / n
    sd = math.sqrt(sum((d - md) ** 2 for d in diffs) / (n - 1))
    out.update({"df": n - 1, "mean_diff": r4(md), "sd_diff": r4(sd)})
    if sd == 0:
        out.update({"ci_low": r4(md), "ci_high": r4(md), "p": 1.0 if md == 0 else 0.0,
                    "significant": md != 0,
                    "note": "all pairs identical - no variance to test" if md == 0
                    else "every pair differs by the same amount - no variance to test"})
        return out
    se = sd / math.sqrt(n)
    tcrit = stats.t.ppf(1 - ALPHA / 2, n - 1)
    t = md / se
    p = 2 * stats.t.sf(abs(t), n - 1)
    out.update({"ci_low": r4(md - tcrit * se), "ci_high": r4(md + tcrit * se), "d_z": r4(md / sd),
                "t": r4(t), "p": round(float(p), 6), "significant": bool(p < ALPHA)})
    return out


def holm(tests):
    """Holm-Bonferroni adjustment across a family of tests, in place."""
    ranked = sorted((t["p"], i) for i, t in enumerate(tests) if t["p"] is not None)
    m, running = len(ranked), 0.0
    for k, (p, i) in enumerate(ranked):
        running = max(running, min(1.0, (m - k) * p))
        tests[i]["p_holm"] = round(running, 6)
        tests[i]["significant_holm"] = running < ALPHA
    for t in tests:
        if t["p"] is None:
            t["p_holm"] = None


def by_run(rows, value):
    return {(r["profile"], r["gender"], r["race"], r["disclosure"]): r[value] for r in rows}


def complete_profiles(rows):
    groups = defaultdict(list)
    for r in rows:
        groups[r["profile"]].append(r)
    return {p: rs for p, rs in groups.items() if len(rs) == FULL_RUNS}


MIN_COMPLETE_PROFILES = 16


def city_groups(rows):
    """
    Groups of runs to compare cities within, and how they were formed.

    The balanced method uses base profiles seen under all 20 conditions, where cities are
    balanced against gender and disclosure by design. When too few profiles are complete (as
    after re-attachment drops answers), each profile is split by disclosure condition and
    compared within that, using the runs available, so the disclosure effect cannot leak
    into a city comparison.
    """
    complete = complete_profiles(rows)
    if len(complete) >= MIN_COMPLETE_PROFILES:
        return list(complete.values()), "balanced: profiles seen under all 20 conditions"
    groups = defaultdict(list)
    for r in rows:
        groups[(r["profile"], r["disclosure"])].append(r)
    return list(groups.values()), "available runs: each profile compared within its disclosure condition"


def design_tests(rows, value="score"):
    v = by_run(rows, value).get
    profiles = sorted({r["profile"] for r in rows})
    tests = []
    for race in RACES:
        if race != "White":
            tests.append(paired(
                [(v((p, g, race, d)), v((p, g, "White", d))) for p in profiles for g in GENDERS for d in DISCLOSURE],
                f"{race} vs. White", "race"))
    tests.append(paired(
        [(v((p, "Female", r, d)), v((p, "Male", r, d))) for p in profiles for r in RACES for d in DISCLOSURE],
        "Female vs. Male", "gender"))
    groups, method = city_groups(rows)
    for loc in LOCATIONS:
        pairs = [
            (mean([r[value] for r in rs if r["location"] == loc]), mean([r[value] for r in rs if r["location"] != loc]))
            for rs in groups
        ]
        test = paired(pairs, f"{loc} vs. other locations", "location")
        test["method"] = method
        tests.append(test)
    tests.append(paired(
        [(v((p, g, r, "Underdisclosure")), v((p, g, r, "Full disclosure"))) for p in profiles for g in GENDERS for r in RACES],
        "Underdisclosure vs. full disclosure", "disclosure"))
    holm([t for t in tests if t["family"] in ("race", "gender", "location")])
    holm([t for t in tests if t["family"] == "disclosure"])
    return tests


def interaction_tests(rows):
    v = by_run(rows, "score").get
    profiles = sorted({r["profile"] for r in rows})

    def penalty(p, g, r):
        u, f = v((p, g, r, "Underdisclosure")), v((p, g, r, "Full disclosure"))
        return None if u is None or f is None else u - f

    tests = []
    for g in GENDERS:
        for race in RACES:
            if race != "White":
                tests.append(paired(
                    [(v((p, g, race, d)), v((p, g, "White", d))) for p in profiles for d in DISCLOSURE],
                    f"{race} vs. White, {g.lower()} cases only", "race_within_gender"))
    for race in RACES:
        if race != "White":
            tests.append(paired(
                [(penalty(p, g, race), penalty(p, g, "White")) for p in profiles for g in GENDERS],
                f"Underdisclosure penalty: {race} vs. White", "penalty_by_race"))
    tests.append(paired(
        [(penalty(p, "Female", r), penalty(p, "Male", r)) for p in profiles for r in RACES],
        "Underdisclosure penalty: Female vs. Male", "penalty_by_gender"))
    holm(tests)
    return tests


# ---------------------------------------------------------------- descriptive

def cells(rows, f1, levels1, f2, levels2):
    """Mean deviation from each profile's own mean, per cell of two factors."""
    prof = defaultdict(list)
    for r in rows:
        prof[r["profile"]].append(r["score"])
    pm = {p: sum(s) / len(s) for p, s in prof.items()}
    out = []
    for a in levels1:
        for b in levels2:
            sub = [r for r in rows if r[f1] == a and r[f2] == b]
            out.append({
                f1: a, f2: b, "n": len(sub),
                "mean_score": r4(mean([r["score"] for r in sub])),
                "mean_deviation": r4(mean([r["score"] - pm[r["profile"]] for r in sub])),
            })
    return out


def locations(rows, tests):
    complete = complete_profiles(rows)
    groups, method = city_groups(rows)
    out = []
    for loc in LOCATIONS:
        g_pairs, d_pairs = [], []
        # gender gaps are compared within the same groups as the city effect
        for rs in groups:
            here = [r for r in rs if r["location"] == loc]
            g_pairs.append((mean([r["score"] for r in here if r["gender"] == "Female"]),
                            mean([r["score"] for r in here if r["gender"] == "Male"])))
        # the disclosure penalty needs both conditions, so it always uses whole profiles
        by_profile = defaultdict(list)
        for r in rows:
            by_profile[r["profile"]].append(r)
        for rs in (complete.values() if len(complete) >= MIN_COMPLETE_PROFILES else by_profile.values()):
            here = [r for r in rs if r["location"] == loc]
            d_pairs.append((mean([r["score"] for r in here if r["disclosure"] == "Underdisclosure"]),
                            mean([r["score"] for r in here if r["disclosure"] == "Full disclosure"])))
        out.append({
            "location": loc,
            "mean_score": r4(mean([r["score"] for r in rows if r["location"] == loc])),
            "profiles_complete": len(complete),
            "city_method": method,
            "effect": next(t for t in tests if t["comparison"] == f"{loc} vs. other locations"),
            "gender_gap": paired(g_pairs, f"Female vs. Male in {loc}", "city_gender"),
            "disclosure_penalty": paired(d_pairs, f"Underdisclosure vs. full disclosure in {loc}", "city_disclosure"),
        })
    holm([c["gender_gap"] for c in out])
    holm([c["disclosure_penalty"] for c in out])
    return out


def accuracy_block(sub):
    if not sub:
        return None
    pred = [r["score"] for r in sub]
    true = [r["true_score"] for r in sub]
    n = len(sub)
    true_psh = [r for r in sub if band_id(r["true_score"]) == 3]
    true_none = [r for r in sub if band_id(r["true_score"]) == 1]
    return {
        "n": n,
        "mae": r4(sum(abs(p - t) for p, t in zip(pred, true)) / n),
        "rmse": r4(math.sqrt(sum((p - t) ** 2 for p, t in zip(pred, true)) / n)),
        "mean_error": r4(sum(p - t for p, t in zip(pred, true)) / n),
        "pearson_r": safe_corr(stats.pearsonr, pred, true),
        "band_agreement": r4(sum(band_id(p) == band_id(t) for p, t in zip(pred, true)) / n),
        "under_triage": r4(sum(band_id(p) < band_id(t) for p, t in zip(pred, true)) / n),
        "over_triage": r4(sum(band_id(p) > band_id(t) for p, t in zip(pred, true)) / n),
        "psh_missed": r4(mean([band_id(r["score"]) < 3 for r in true_psh])) if true_psh else None,
        "none_escalated": r4(mean([band_id(r["score"]) > 1 for r in true_none])) if true_none else None,
    }


def accuracy(rows):
    out = {"all": accuracy_block(rows)}
    for field, levels in (("disclosure", DISCLOSURE), ("race", RACES), ("gender", GENDERS), ("location", LOCATIONS)):
        out[f"by_{field}"] = {lvl: accuracy_block([r for r in rows if r[field] == lvl]) for lvl in levels}
    calibration = []
    for s in sorted({r["true_score"] for r in rows}):
        entry = {"true_score": s}
        for d, key in (("Full disclosure", "full"), ("Underdisclosure", "under")):
            sub = [r["score"] for r in rows if r["true_score"] == s and r["disclosure"] == d]
            entry[f"mean_{key}"] = r4(mean(sub))
            entry[f"n_{key}"] = len(sub)
        calibration.append(entry)
    out["calibration"] = calibration
    return out


def profile_summaries(rows, meta):
    out = []
    for pid in sorted({r["profile"] for r in rows}):
        rs = [r for r in rows if r["profile"] == pid]
        scores = [r["score"] for r in rs]
        m = sum(scores) / len(scores)
        sd = math.sqrt(sum((s - m) ** 2 for s in scores) / (len(scores) - 1)) if len(scores) > 1 else None
        under = [r["vispdat_score"] for r in rs if r["disclosure"] == "Underdisclosure"]
        out.append({
            "profile": pid,
            "label": meta[pid]["label"],
            "domains": meta[pid]["domains"],
            "true_score": rs[0]["true_score"],
            "vispdat_under": under[0] if under else None,
            "n": len(rs),
            "mean": r4(m),
            "mean_full": r4(mean([r["score"] for r in rs if r["disclosure"] == "Full disclosure"])),
            "mean_under": r4(mean([r["score"] for r in rs if r["disclosure"] == "Underdisclosure"])),
            "sd": r4(sd),
            "min": min(scores),
            "max": max(scores),
            "band_changes": len({band_id(s) for s in scores}) > 1,
        })
    return out


def triage(rows):
    rows = [{**r, "psh": 1 if band_id(r["score"]) == 3 else 0} for r in rows]
    truth = [band_id(r["true_score"]) for r in rows]
    out = {
        "truth_shares": {name: r4(truth.count(i) / len(truth)) for i, name in ((1, "none"), (2, "rrh"), (3, "psh"))},
        "psh_tests": [t for t in design_tests(rows, "psh") if t["family"] in ("race", "gender", "location", "disclosure")],
    }
    ordered = sorted(r["score"] for r in rows)
    for field, levels in (("race", RACES), ("gender", GENDERS), ("location", LOCATIONS), ("disclosure", DISCLOSURE)):
        groups = []
        for lvl in levels:
            sub = [r for r in rows if r[field] == lvl]
            ids = [band_id(r["score"]) for r in sub]
            psh_true = [r for r in sub if band_id(r["true_score"]) == 3]
            groups.append({
                field: lvl, "n": len(sub),
                "share_none": r4(ids.count(1) / len(ids)), "share_rrh": r4(ids.count(2) / len(ids)),
                "share_psh": r4(ids.count(3) / len(ids)),
                "psh_missed": r4(mean([band_id(r["score"]) < 3 for r in psh_true])) if psh_true else None,
                # position on one priority list of every instance, 1 = highest score, ties shared
                "mean_priority_position": r4(mean([1 + len(ordered) - _upper(ordered, r["score"]) for r in sub])),
            })
        out[f"by_{field}"] = groups
    out["priority_list_length"] = len(rows)
    return out


def _upper(sorted_scores, s):
    """Number of scores <= s."""
    lo, hi = 0, len(sorted_scores)
    while lo < hi:
        mid = (lo + hi) // 2
        if sorted_scores[mid] <= s:
            lo = mid + 1
        else:
            hi = mid
    return lo


def ranking(rows, is_model):
    sessions = defaultdict(list)
    for r in rows:
        sessions[r["session"]].append(r)
    out = {
        "score_truth_rho": r4(mean([safe_corr(stats.spearmanr, [r["score"] for r in rs], [r["true_score"] for r in rs])
                                    for rs in sessions.values()])),
    }
    if not is_model:
        return out
    valid = [rs for rs in sessions.values() if all(r["rank"] is not None for r in rs)]
    out["sessions_with_valid_ranks"] = len(valid)
    out["sessions_total"] = len(sessions)
    out["rank_truth_rho"] = r4(mean([safe_corr(stats.spearmanr, [-r["rank"] for r in rs], [r["true_score"] for r in rs])
                                     for rs in valid]))
    out["score_vispdat_rho"] = r4(mean([safe_corr(stats.spearmanr, [r["score"] for r in rs], [r["vispdat_score"] for r in rs])
                                        for rs in sessions.values()]))
    consistency = []
    for sid, rs in sorted(sessions.items()):
        raw = [(r["score"], r["rank_raw"]) for r in rs if isinstance(r.get("rank_raw"), int)]
        inversions = sum(1 for a in raw for b in raw if a[0] > b[0] and a[1] > b[1])
        tau = stats.kendalltau([s for s, _ in raw], [-k for _, k in raw])[0] if len(raw) > 2 else None
        consistency.append({"session": sid, "ranks_valid": all(r["rank"] is not None for r in rs),
                            "score_rank_tau": r4(tau), "inversions": inversions})
    out["self_consistency"] = consistency
    out["mean_score_rank_tau"] = r4(mean([c["score_rank_tau"] for c in consistency]))
    out["sessions_with_inversions"] = sum(c["inversions"] > 0 for c in consistency)
    return out


LABEL_VERDICTS = ("matches", "mixed up", "can't tell")


def label_summary(records):
    """Case-label check counts (scripts/check_case_labels.py) across a set of imported replies."""
    sessions, totals = [], {k: 0 for k in LABEL_VERDICTS}
    for rec in sorted(records, key=lambda r: r["session"]):
        counts = rec.get("case_labels")
        if not counts:
            continue
        for k in LABEL_VERDICTS:
            totals[k] += counts.get(k, 0)
        sessions.append({"session": rec["session"], **{k: counts.get(k, 0) for k in LABEL_VERDICTS}})
    checked = sum(totals.values())
    return {
        "sessions": sessions,
        "totals": totals,
        "answers_checked": checked,
        "share_mixed": r4(totals["mixed up"] / checked) if checked else None,
        "sessions_with_mixups": sum(s["mixed up"] > 0 for s in sessions),
    }


def label_check(model_key):
    """The check on the current replies, and on every archived attempt."""
    current = [load(p) for p in sorted((RAW / model_key).glob("session-*.json"))] if (RAW / model_key).exists() else []
    attempts = []
    for folder in sorted((ATTEMPTS / model_key).glob("attempt-*")) if (ATTEMPTS / model_key).exists() else []:
        records = [load(p) for p in sorted((folder / "raw").glob("session-*.json"))]
        attempts.append({"attempt": folder.name, **label_summary(records)})
    return {"current": label_summary(current), "attempts": attempts}


def summarize(rows, meta, is_model):
    means = group_means(rows)
    means.pop("means_by_race_location")  # not estimable in the paste design
    tests = design_tests(rows)
    return {
        "instances_scored": len(rows),
        "true_mean": r4(mean([r["true_score"] for r in rows])),
        **means,
        "tests": tests,
        "interaction_tests": interaction_tests(rows),
        "cells": {
            "race_gender": cells(rows, "race", RACES, "gender", GENDERS),
            "race_disclosure": cells(rows, "race", RACES, "disclosure", DISCLOSURE),
        },
        "locations": locations(rows, tests),
        "accuracy": accuracy(rows),
        "profiles": profile_summaries(rows, meta),
        "triage": triage(rows),
        "ranking": ranking(rows, is_model),
    }


# ---------------------------------------------------------------- main

def main():
    global BANDS
    instrument = load(INSTRUMENT)
    BANDS = instrument["bands"]
    ind2dom = {i["id"]: d["key"] for d in instrument["domains"] for i in d["indicators"]}
    meta = {}
    for p in load(PROFILES)["profiles"]:
        domains = {d["key"]: 0 for d in instrument["domains"]}
        for ind in p["indicators"]:
            domains[ind2dom[ind]] += 1
        meta[p["id"]] = {"label": p["label"], "domains": domains}

    schedule = load(SCHEDULE)
    vispdat = load(VISPDAT)
    roster = load(MODELS)["models"]

    true_by_profile = {r["profile"]: r["score"] for r in vispdat["results"] if r["disclosure"] == "Full disclosure"}
    vispdat_score = {(r["profile"], r["gender"], r["race"], r["location"], r["disclosure"]): r["score"]
                     for r in vispdat["results"]}

    def base_row(sess, item):
        key = (item["profile"], item["gender"], item["race"], item["location"], item["disclosure"])
        return {
            "session": sess["session"], "position": item["position"], "profile": item["profile"],
            "gender": item["gender"], "race": item["race"], "location": item["location"],
            "disclosure": item["disclosure"], "vispdat_score": vispdat_score[key],
            "true_score": true_by_profile[item["profile"]],
        }

    vispdat_rows = []
    for sess in schedule["sessions"]:
        for it in sess["items"]:
            row = base_row(sess, it)
            vispdat_rows.append({**row, "score": row["vispdat_score"], "rank": None, "rank_raw": None})
    vispdat_summary = {"label": "VI-SPDAT", **summarize(vispdat_rows, meta, is_model=False)}

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    CHECKS.mkdir(parents=True, exist_ok=True)
    clones_by_key = {(c["base_profile"], c["gender"], c["race"], c["location"]): c for c in load(CLONES)["clones"]}
    summaries = []
    for model in roster:
        # An entry with a "source" re-analyzes that app's replies instead of its own folder.
        source = model.get("source", model["key"])
        reattaching = model.get("transform") == "reattach"
        rows, failed, missing, versions, rank_invalid, mislabeled = [], [], 0, {}, [], []
        decision_log, tally = [], Counter()
        for sess in schedule["sessions"]:
            path = RAW / source / f"session-{sess['session']:02d}.json"
            if not path.exists():
                missing += 1
                continue
            rec = load(path)
            cases = rec["cases"]
            if not rec["valid"]:
                # Author's decision: a session whose only problem is mislabeled answers is analyzed
                # exactly as returned. The label check still reports how many answers are affected.
                label_only = rec.get("checked_cases") and all(
                    "different person than their case number" in p for p in rec["problems"])
                if not label_only:
                    failed.append({"session": sess["session"], "problems": rec["problems"]})
                    continue
                cases = rec["checked_cases"]
                mislabeled.append(sess["session"])
                if reattaching:
                    cases, decisions = reattach(cases, session_cases(sess, clones_by_key))
                    for d in decisions:
                        tally[d["how"]] += 1
                        decision_log.append({
                            "session": sess["session"], "labeled_case": d["entry"]["case"],
                            "score": d["entry"]["score"], "attached_to_case": d["target"] or "",
                            "decision": d["how"], "reason": d["entry"].get("reason") or "",
                        })
            # Ranks are ordered within the original labels, so re-attached sessions have none.
            reshuffled = reattaching and sess["session"] in mislabeled
            ranks_valid = not any(w.startswith("ranks") for w in rec.get("warnings", [])) and not reshuffled
            if not ranks_valid:
                rank_invalid.append(sess["session"])
            version = rec.get("model_version") or "not recorded"
            versions[version] = versions.get(version, 0) + 1
            by_case = {c["case"]: c for c in cases}
            for it in sess["items"]:
                c = by_case.get(it["position"])
                if c is None:
                    continue  # no answer could be placed on this case with certainty
                rows.append({
                    **base_row(sess, it),
                    "score": c["score"], "band": band_of(c["score"], BANDS)["name"],
                    "rank_raw": None if reshuffled else c.get("rank"), "rank": c.get("rank") if ranks_valid else None,
                    "ranks_valid": ranks_valid, "reason": c.get("reason"),
                    "model_version": rec.get("model_version"),
                    "label_status": ("moved" if c.get("moved") else "kept") if reshuffled else "as returned",
                })

        valid = len(schedule["sessions"]) - missing - len(failed)
        summary = {
            **{k: model[k] for k in ("key", "label", "family", "interface")},
            "sessions_total": len(schedule["sessions"]),
            "sessions_valid": valid,
            "sessions_needing_redo": failed,
            "sessions_not_pasted": missing,
            "sessions_with_invalid_ranks": rank_invalid,
            "sessions_with_label_mixups": mislabeled,
            "source": model.get("source"),
            "label_check": label_check(source),
            "reattachment": {
                "answers_in_mixed_sessions": sum(tally.values()),
                "kept": tally["kept: facts fit its own case"],
                "moved": tally["moved to the case its facts identify"],
                "dropped": sum(v for k, v in tally.items() if k.startswith("dropped")),
                "dropped_reasons": {k.removeprefix("dropped: "): v for k, v in tally.items() if k.startswith("dropped")},
            } if reattaching else None,
            "model_versions": versions,
            "status": "not run" if not rows else ("complete" if valid == len(schedule["sessions"]) else "partial"),
        }
        if reattaching:
            with (CHECKS / f"{model['key']}_decisions.csv").open("w", encoding="utf-8-sig", newline="") as fh:
                writer = csv.DictWriter(fh, fieldnames=["session", "labeled_case", "score", "attached_to_case", "decision", "reason"])
                writer.writeheader()
                writer.writerows(decision_log)
        csv_path = RESULTS_DIR / f"{model['key']}.csv"
        if rows:
            summary.update(summarize(rows, meta, is_model=True))
            with csv_path.open("w", encoding="utf-8-sig", newline="") as fh:
                writer = csv.DictWriter(fh, fieldnames=COLUMNS, extrasaction="ignore")
                writer.writeheader()
                writer.writerows(rows)
        else:
            summary["instances_scored"] = 0
            if csv_path.exists():
                csv_path.unlink()
        summaries.append(summary)

    payload = {
        "note": (
            "AI arm. Each session was pasted into a new chat in each app's free version, with no "
            "VI-SPDAT questions. Every case got a 0-17 vulnerability score, a within-session rank "
            "(1 = most vulnerable), and a reason. VI-SPDAT is scored on the same instances."
        ),
        "design": (
            f"{schedule['sessions_count']} sessions x {schedule['items_per_session']} cases = "
            f"{schedule['instances_total']} instances per app. Within each profile, gender x race x "
            "disclosure is fully crossed and cities are balanced against gender and disclosure. "
            "Race x city interaction is not estimable."
        ),
        "truth_definition": (
            "True vulnerability = the base profile's full-disclosure VI-SPDAT indicator total (0-17), "
            "the same for every clone and both disclosure conditions."
        ),
        "methods": {
            "alpha": ALPHA,
            "multiple_comparisons": "Holm-Bonferroni across the ten demographic tests (race, gender, location); "
                                    "separately within each exploratory family.",
            "effect_size": "Cohen's d_z = mean paired difference / SD of the differences.",
            "cells": "Mean of (score - that profile's mean score), so cells compare like with like.",
            "triage_bands": "0-3 no housing intervention, 4-7 Rapid Re-Housing, 8-17 Permanent Supportive Housing.",
        },
        "races": RACES,
        "genders": GENDERS,
        "locations": LOCATIONS,
        "bands": BANDS,
        "sessions_per_model": schedule["sessions_count"],
        "instances_per_model": schedule["instances_total"],
        "vispdat": vispdat_summary,
        "models": summaries,
    }
    OUT.write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    a = vispdat_summary["accuracy"]["all"]
    print(f"VI-SPDAT on the paste instances: MAE {a['mae']:.2f}, band agreement {a['band_agreement']:.0%}")
    for s in summaries:
        line = f"{s['label']:<9} {s['status']:<9} {s['sessions_valid']:2d}/{s['sessions_total']} sessions"
        if s.get("accuracy"):
            acc = s["accuracy"]["all"]
            sig = [t["comparison"] for t in s["tests"] if t["significant_holm"]]
            line += f"  MAE {acc['mae']:.2f}  band agree {acc['band_agreement']:.0%}  significant (Holm): {', '.join(sig) or 'none'}"
        print(line)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
