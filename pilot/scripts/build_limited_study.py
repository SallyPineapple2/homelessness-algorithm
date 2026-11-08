"""
Build the limited-places study site in limited/ from the pilot dashboard's template.

The study: 100 synthetic people, 35 High / 40 Medium / 25 Low places, Gemini 3.8 Flash
assigning all 100 at once, 10 rounds in different orders (analyze_pool.py), against
VI-SPDAT filling the same places by score.

A person's Gemini category on the site is their consensus over the rounds: people are
ordered by their mean category across rounds (High 2, Medium 1, Low 0), the top 35 are
High, the next 40 Medium, the rest Low. No ties fall on a cut-off.

Run:  python pilot/scripts/build_limited_study.py
Writes: limited/ (index.html, assets/, data/, results/)
"""

import csv
import glob
import json
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gemini_prompt import SECTION_TITLES  # noqa: E402
from run_gemini_pool import REPLY_FORMAT, instructions  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
PILOT = ROOT / "pilot"
OUT = ROOT / "limited"
PLACES = {"High": 35, "Medium": 40, "Low": 25}
RQ = ("Given only 35 high-priority and 40 medium-priority housing places for 100 homeless individuals, how does "
      "Gemini's housing priority assignment compare with the VI&#8209;SPDAT's assignments?")
RANK = {"High": 2, "Medium": 1, "Low": 0}


def edit(text, pairs, where):
    for a, b in pairs:
        assert a in text, (where, a[:80])
        text = text.replace(a, b, 1)
    return text


def between(text, start, end, new, where):
    i = text.index(start)
    j = text.index(end, i)
    return text[:i] + new + text[j:]


# ------------------------------------------------------------------ data

def null_distributions(profiles, ids, rounds, pool, shuffles=5000, seed=20261102):
    """
    For each circumstance: how often its people are placed High (share of rounds), against what
    shuffling the circumstance among people with the same VI-SPDAT score would give.
    """
    import numpy as np
    P = {p["id"]: p for p in profiles}
    gh = np.array([sum(r["assignments"][i]["priority"] == "High" for r in rounds) / len(rounds) for i in ids])
    score = np.array([len(P[i]["indicators"]) for i in ids])
    strata = [np.where(score == s)[0] for s in np.unique(score)]
    tests = {t["factor"]: t for t in pool["tests"] if t["family"] == "circumstance"}
    rng = np.random.default_rng(seed)
    out = {}
    for name, c in pool["circumstances"].items():
        has = np.array([c["id"] in P[i]["indicators"] for i in ids])
        k = int(has.sum())
        observed = float(gh[has].mean())
        lab = has.copy()
        sims = np.empty(shuffles)
        for s in range(shuffles):
            for idx in strata:
                lab[idx] = rng.permutation(has[idx])
            sims[s] = gh[lab].mean()
        mean = float(sims.mean())
        extreme = int((np.abs(sims - mean) >= abs(observed - mean) - 1e-12).sum())
        lo, hi = min(sims.min(), observed), max(sims.max(), observed)
        counts, edges = np.histogram(sims, bins=24, range=(float(min(sims.min(), lo)), float(max(sims.max(), hi))))
        out[name] = {"n": k, "observed": round(observed, 4), "mean": round(mean, 4), "shuffles": shuffles, "extreme": extreme,
                     "p": tests[name]["p"], "edges": [round(float(e), 4) for e in edges], "counts": [int(x) for x in counts]}
    return out


def position_effect(profiles, ids, rounds):
    """Does the position of a person in the list change their category, after accounting for VI-SPDAT score?"""
    import numpy as np
    from scipy import stats
    P = {p["id"]: p for p in profiles}
    score = {i: len(P[i]["indicators"]) for i in ids}
    rho, sig, first, second = [], 0, [], []
    for r in rounds:
        order = r["order"]
        g = {i: {"High": 2, "Medium": 1, "Low": 0}[r["assignments"][i]["priority"]] for i in ids}
        by = {}
        for i in ids:
            by.setdefault(score[i], []).append(g[i])
        resid = [g[i] - float(np.mean(by[score[i]])) for i in order]
        res = stats.spearmanr(range(len(order)), resid)
        rho.append(float(res[0]))
        sig += int(res[1] < 0.05)
        half = len(order) // 2
        first.append(float(np.mean([g[i] == 2 for i in order[:half]])))
        second.append(float(np.mean([g[i] == 2 for i in order[half:]])))
    return {"spearman_mean": float(np.mean(rho)), "spearman_min": min(rho), "spearman_max": max(rho), "rounds_sig": sig,
            "first_half_high": float(np.mean(first)), "second_half_high": float(np.mean(second))}


def build_data():
    inst = json.loads((ROOT / "data" / "vispdat_instrument.json").read_text(encoding="utf-8"))
    profiles = json.loads((PILOT / "data" / "profiles.json").read_text(encoding="utf-8"))["profiles"]
    with (PILOT / "data" / "vispdat_scores.csv").open(encoding="utf-8") as fh:
        vis = {r["id"]: r for r in csv.DictReader(fh)}
    rounds = [json.loads(f.read_text(encoding="utf-8")) for f in
              map(Path, sorted(glob.glob(str(PILOT / "data" / "gemini-pool-gemini-3.8-flash" / "raw" / "round*.json")), key=lambda f: int(re.search(r"round(\d+)", f).group(1))))]
    pool = json.loads((PILOT / "results" / "pool_gemini-3.8-flash.json").read_text(encoding="utf-8"))
    ids = [p["id"] for p in profiles]
    R = len(rounds)
    mean_rank = {i: sum(RANK[r["assignments"][i]["priority"]] for r in rounds) / R for i in ids}
    order = sorted(ids, key=lambda i: -mean_rank[i])
    cut1, cut2 = PLACES["High"], PLACES["High"] + PLACES["Medium"]
    assert mean_rank[order[cut1 - 1]] > mean_rank[order[cut1]] and mean_rank[order[cut2 - 1]] > mean_rank[order[cut2]], "tie at a cut-off"
    cat = {i: "High" if k < cut1 else "Medium" if k < cut2 else "Low" for k, i in enumerate(order)}
    answers = {}
    for i in ids:
        counts = {c: sum(r["assignments"][i]["priority"] == c for r in rounds) for c in RANK}
        reason = next((r["assignments"][i]["reason"] for r in rounds if r["assignments"][i]["priority"] == cat[i]), None)
        answers[i] = {"priority": cat[i], "explanation": reason, "high_rounds": counts["High"],
                      "medium_rounds": counts["Medium"], "low_rounds": counts["Low"],
                      "rounds": "".join(r["assignments"][i]["priority"][0] for r in rounds)}
    pool["round_details"] = [{"round": r["round"], "seconds": r["seconds"], "prompt_tokens": (r["usage"] or {}).get("prompt_token_count"),
                              "thought_tokens": (r["usage"] or {}).get("thoughts_token_count"),
                              "output_tokens": (r["usage"] or {}).get("candidates_token_count")} for r in rounds]
    pool["null"] = null_distributions(profiles, ids, rounds, pool)
    pool["position"] = position_effect(profiles, ids, rounds)
    extra_path = PILOT / "results" / "pool_extra.json"
    if extra_path.exists():
        pool["extra"] = json.loads(extra_path.read_text(encoding="utf-8"))
    items = [{"id": i["id"], "name": i["name"], "domain": d["name"], "letter": d["letter"], "questions": i["questions"],
              "rule": i["rule"]} for d in inst["domains"] for i in d["indicators"]]
    for k in ("per_round", "round_to_round_same_category", "same_category_in_every_round", "high_in_every_round",
              "tests", "circumstances", "factor_effects", "r2_factors", "r2_score_only", "by_score", "groups", "rounds",
              "places", "tokens_per_round"):
        assert k in pool, k
    data = {
        "instrument": {"version": inst["version"], "population": inst["population"], "copyright": inst["copyright"],
                       "bands": inst["bands"], "items": items},
        "prompt": {"instructions": instructions(PLACES), "reply_format": REPLY_FORMAT,
                   "sections": [t for _, t in SECTION_TITLES]},
        "runs": [{"key": "main", "label": "Gemini 3.8 Flash", "complete": True, "done": 100, "total": 100,
                  "answers": answers, "pool": {k: v for k, v in pool.items() if k != "people"}}],
        "profiles": [{
            "id": p["id"], "label": p["label"], "age": p["age"], "gender": p["gender"],
            "race": p["race"], "location": p["location"], "demographic_line": p["demographic_line"],
            "indicators": p["indicators"], "score": int(vis[p["id"]]["score"]), "vispdat": vis[p["id"]]["priority"],
            "narrative": [[t, p["narrative"][k]] for k, t in SECTION_TITLES],
        } for p in profiles],
    }
    (OUT / "data").mkdir(parents=True, exist_ok=True)
    (OUT / "data" / "dashboard.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # downloads
    (OUT / "results").mkdir(exist_ok=True)
    standalone = json.loads((PILOT / "data" / "profiles.json").read_text(encoding="utf-8"))
    for p in standalone["profiles"]:
        p.pop("source", None)
    standalone["note"] = ("100 distinct synthetic people for the limited places study, each with demographics, VI-SPDAT items, "
                          "and an 11-section case summary. Gender, race, and city were assigned by a seeded draw balanced on "
                          "VI-SPDAT score; pregnant profiles are female; each race x city cell has 2 women and 2 men.")
    (OUT / "data" / "profiles.json").write_text(json.dumps(standalone, ensure_ascii=False, indent=1), encoding="utf-8")
    shutil.copy(PILOT / "data" / "vispdat_scores.csv", OUT / "data" / "vispdat_scores.csv")
    shutil.copy(PILOT / "results" / "pool_gemini-3.8-flash.json", OUT / "results" / "limited_results.json")
    shutil.copy(PILOT / "results" / "pool_gemini-3.8-flash_groups.csv", OUT / "results" / "limited_groups.csv")
    with (OUT / "results" / "by_person.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["id", "vispdat_score", "vispdat_priority", "gemini_priority", "rounds_high", "rounds_medium", "rounds_low"])
        for p in data["profiles"]:
            a = answers[p["id"]]
            w.writerow([p["id"], p["score"], p["vispdat"], a["priority"], a["high_rounds"], a["medium_rounds"], a["low_rounds"]])
    with (OUT / "results" / "rounds.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["round", "same", "gemini_higher", "gemini_lower", "weighted_kappa"])
        for r in pool["per_round"]:
            w.writerow([r["round"], r["same"], r["higher"], r["lower"], r["kappa"]])
    return data


# ------------------------------------------------------------------ html

OVERVIEW = '''      <section class="view" id="view-overview" data-view="overview" aria-label="Overview" hidden>
        <div class="rq-block">
          <p class="rq-kicker">Limited places study</p>
          <p class="rq-text">Given only 35 high-priority and 40 medium-priority housing places for 100 homeless individuals, how does Gemini's housing priority assignment compare with the VI&#8209;SPDAT's assignments?</p>
          <dl class="rq-meta">
            <div><dt>Approach</dt><dd>VI&#8209;SPDAT fills the places with its highest scores. Gemini sees all 100 people together and assigns each one High, Medium, or Low, using exactly the places available. This is repeated 10 times with the people in a different order each time. VI&#8209;SPDAT is a benchmark, not ground truth.</dd></div>
            <div><dt>Caution</dt><dd>A raw difference between groups is not proof of bias, because groups can differ in circumstances. The significance tests compare people with the same VI&#8209;SPDAT score.</dd></div>
          </dl>
        </div>
        <div class="intro-band">
          <p class="intro-lede" id="overview-lede"></p>
        </div>
        <h2 class="block-title">Main findings</h2>
        <div class="findings" id="findings"></div>

        <div class="chart-card">
          <p class="chart-title">Places filled</p>
          <p class="chart-sub">Both approaches fill exactly 35 High, 40 Medium, and 25 Low places. The question is which people get them.</p>
          <div class="legend" id="legend-dist"></div>
          <div class="chart-scroll" id="chart-dist"></div>
        </div>
        <div class="chart-card">
          <p class="chart-title">Where each VI&#8209;SPDAT category goes</p>
          <p class="chart-sub">Each band is a group of people VI&#8209;SPDAT placed on the left and Gemini placed on the right. Wider bands are more people; bands that stay level are agreement.</p>
          <div class="chart-scroll" id="chart-flow"></div>
        </div>
        <div class="chart-card">
          <p class="chart-title">Share given a High place, in every group</p>
          <p class="chart-sub">Plum dot: VI&#8209;SPDAT. Rose dot: Gemini. Both approaches fill the same 35 High places, so groups gain or lose only where they differ.</p>
          <div class="legend" id="legend-dumbbell"></div>
          <div class="chart-scroll" id="chart-dumbbell"></div>
        </div>
        <div class="chart-card">
          <p class="chart-title">VI&#8209;SPDAT priority against Gemini priority</p>
          <p class="chart-sub">Each cell counts the people VI&#8209;SPDAT placed in the row and Gemini placed in the column. The diagonal is agreement.</p>
          <div class="chart-scroll" id="chart-crosstab"></div>
          <p class="chart-foot" id="crosstab-foot"></p>
        </div>
      </section>
'''

AGREEMENT_EXTRA = '''        <div class="chart-card">
          <p class="chart-title">People Gemini places higher or lower, at each VI&#8209;SPDAT score</p>
          <p class="chart-sub">Above the line: people Gemini places in a higher category than VI&#8209;SPDAT. Below: lower. Movement concentrates next to the cut-offs.</p>
          <div class="legend" id="legend-movement"></div>
          <div class="chart-scroll" id="chart-movement"></div>
          <p class="chart-foot" id="movement-foot"></p>
        </div>
        <div class="chart-card">
          <p class="chart-title">Gemini's ranking of all 100 people</p>
          <p class="chart-sub">Each bar is one person, ordered by how highly Gemini placed them on average across the rounds (High = 2, Medium = 1, Low = 0) and colored by their VI&#8209;SPDAT priority. Dashed lines show where Gemini's High and Medium places run out.</p>
          <div class="legend" id="legend-rank"></div>
          <div class="chart-scroll" id="chart-rank"></div>
        </div>
        <div class="chart-card">
          <p class="chart-title">Every person in every round</p>
          <p class="chart-sub">Rows are people grouped by VI&#8209;SPDAT score; columns are rounds. Solid rows are people Gemini always places the same way; patchy rows are people near a cut-off.</p>
          <div class="legend" id="legend-grid"></div>
          <div class="chart-scroll" id="chart-grid"></div>
          <p class="chart-foot" id="grid-foot"></p>
        </div>
        <div class="chart-card">
          <p class="chart-title">How many rounds each person was placed High</p>
          <p class="chart-sub">Most people are placed High in all rounds or none; the people in between change with the order of the list.</p>
          <div class="legend" id="legend-hist"></div>
          <div class="chart-scroll" id="chart-hist"></div>
          <p class="chart-foot" id="hist-foot"></p>
        </div>
        <div class="chart-card">
          <p class="chart-title">Agreement with VI&#8209;SPDAT in each round</p>
          <p class="chart-sub">People placed in the same category by both, out of 100. Each round is a separate request with the people in a new order.</p>
          <div class="chart-scroll" id="lim-rounds"></div>
          <p class="chart-foot" id="lim-rounds-foot"></p>
        </div>
        <div class="chart-card">
          <p class="chart-title">Agreement between rounds</p>
          <p class="chart-sub">For every pair of rounds, the number of people given the same category in both.</p>
          <div class="chart-scroll" id="chart-matrix"></div>
          <p class="chart-foot" id="matrix-foot"></p>
        </div>
        <div class="chart-card">
          <p class="chart-title">Round details</p>
          <p class="chart-sub">Agreement with VI&#8209;SPDAT, time taken, and tokens used. Reasoning tokens are Gemini's internal thinking before it answers.</p>
          <div class="results-scroll"><table class="results compact" id="round-table"></table></div>
        </div>
'''

SIGNIFICANCE = '''      <section class="view" id="view-significance" data-view="significance" aria-label="Significance" hidden>
        <div class="intro-band"><p class="intro-lede" id="sig-lede"></p></div>
        <div class="findings" id="sig-cards"></div>
        <div class="chart-card">
          <p class="chart-title">Which circumstances change who gets a High place?</p>
          <p class="chart-sub">Open dot: how often those people would be placed High given their VI&#8209;SPDAT scores. Filled dot: how often Gemini placed them High. Sorted by p; Holm-corrected across the 16 circumstances.</p>
          <div class="legend" id="lim-legend-items"></div>
          <div class="chart-scroll" id="lim-items"></div>
        </div>
        <div class="chart-card">
          <p class="chart-title">How unusual is the largest difference?</p>
          <p class="chart-sub">Bars show how often the people with the circumstance would be placed High if it made no difference, found by shuffling it among people with the same VI&#8209;SPDAT score. The line is what Gemini did.</p>
          <div class="chip-row" id="null-chips"></div>
          <div class="chart-scroll" id="chart-null"></div>
          <p class="chart-foot" id="null-foot"></p>
        </div>
        <div class="chart-card">
          <p class="chart-title">All 16 circumstances</p>
          <p class="chart-sub">How often Gemini placed people with each circumstance High, against what their VI&#8209;SPDAT scores predict. Bold: significant after Holm correction.</p>
          <div class="results-scroll"><table class="results compact" id="lim-circ-table"></table></div>
        </div>
        <div class="chart-card">
          <p class="chart-title">Demographic tests</p>
          <p class="chart-sub">High and Medium places going to each group under VI&#8209;SPDAT and under Gemini, and whether the group's High places differ from what its VI&#8209;SPDAT scores predict.</p>
          <div class="results-scroll"><table class="results compact" id="lim-demo-table"></table></div>
          <p class="chart-foot" id="lim-demo-foot"></p>
        </div>
        <p class="chart-foot" id="sig-method"></p>
      </section>
'''

FACTOR_RATES_CARD = '''        <div class="chart-card">
          <p class="chart-title">Placed High, with and without each factor</p>
          <p class="chart-sub">Share of rounds in which people with (filled dot) and without (open dot) each factor were placed High, sorted by the size of the gap. Factors often occur together, so this is not each factor's own effect; the next chart separates them.</p>
          <div class="legend" id="legend-rates"></div>
          <div class="chart-scroll" id="chart-rates"></div>
        </div>
'''

FACTOR_WEIGHTS_CARD = '''        <div class="chart-card">
          <p class="chart-title">How much each factor weighs in Gemini's choice</p>
          <p class="chart-sub">Change in the chance of a High place for people with each factor, holding the other factors fixed. Lines show 95% confidence intervals. VI&#8209;SPDAT counts every factor equally.</p>
          <div class="chart-scroll" id="lim-effects"></div>
          <p class="chart-foot" id="lim-effects-foot"></p>
        </div>
'''


def build_html():
    s = (PILOT / "index.html").read_text(encoding="utf-8")
    s = edit(s, [
        ("<title>Pilot · VI-SPDAT and Gemini Housing Priority</title>", "<title>Limited places · VI-SPDAT and Gemini Housing Priority</title>"),
        ('<link rel="stylesheet" href="assets/pilot.css">', '<link rel="stylesheet" href="assets/study.css">'),
        ('<script src="assets/pilot.js"></script>', '<script src="assets/study.js"></script>'),
        ('<a class="brand" href="#overview">VI&#8209;SPDAT &amp; Gemini<small>Pilot study dashboard</small></a>',
         '<a class="brand" href="#overview">VI&#8209;SPDAT &amp; Gemini<small>Limited places study</small></a>'),
        ('<div class="side-foot">Descriptive pilot: counts and within-group percentages.<br>Synthetic population: 100 distinct people.</div>',
         '<div class="side-foot">35 High, 40 Medium, 25 Low places.<br>Synthetic population: 100 distinct people.</div>'),
        ('        <a href="../limited/" class="nav-external">Limited places study &rarr;</a>\n        <a href="../index.html" class="nav-external">Original 640-record study &rarr;</a>\n', ''),
        ('      <h3>This study</h3>\n      <ul>\n        <li><a href="../index.html">Original 640-record study dashboard</a></li>\n        <li><a href="README.md">Pilot README</a></li>\n      </ul>',
         '      <h3>This study</h3>\n      <ul>\n        <li><a href="#methods">Methods</a></li>\n        <li><a href="#downloads">Data files</a></li>\n      </ul>\n    </div>\n'
         '    <div>\n      <h3>Related work</h3>\n      <ul>\n        <li><a href="../pilot/">Pilot study: unlimited places</a></li>\n'
         '        <li><a href="../index.html">Original 640-record study</a></li>\n      </ul>'),
        ('<div class="model-switch" role="group" aria-label="Gemini run">\n        <span class="control-label">Gemini run</span>\n        <div class="filters" id="model-chips"></div>\n        <span class="table-note-inline" id="run-status"></span>\n      </div>',
         '<div class="model-switch" role="group" aria-label="Model">\n        <span class="control-label">Model</span>\n        <span class="chip" aria-pressed="true">Gemini 3.8 Flash</span>\n        <span class="table-note-inline">10 rounds</span>\n      </div>'),
        ('data-sub="How VI-SPDAT and Gemini prioritize the same 100 people">Overview',
         'data-sub="Who gets the places under VI-SPDAT and under Gemini">Overview'),
        ('data-sub="Which groups and circumstances change Gemini\'s judgment beyond the VI-SPDAT score">Significance',
         'data-sub="Which groups and circumstances change who gets a High place beyond the VI-SPDAT score">Significance'),
        ('data-sub="Share rated high priority in each study city">Cities', 'data-sub="Share given a High place in each study city">Cities'),
        ('data-sub="All 100 people, each tool\'s priority, and Gemini\'s explanation">Profiles',
         'data-sub="All 100 people, each approach\'s priority, and Gemini\'s reason">Profiles'),
        ('data-sub="Population, VI-SPDAT scoring, and the Gemini prompt">Study design',
         'data-sub="Population, places, VI-SPDAT scoring, and the Gemini prompt">Study design'),
    ], "index head")
    # views
    s = re.sub(r'      <section class="view" id="view-overview".*?</section>\n', lambda m: OVERVIEW, s, count=1, flags=re.S)
    s = re.sub(r'      <section class="view" id="view-significance".*?</section>\n', lambda m: SIGNIFICANCE, s, count=1, flags=re.S)
    s = edit(s, [
        ('        <div class="chart-card">\n          <p class="chart-title">Agreement summary</p>',
         AGREEMENT_EXTRA + '        <div class="chart-card">\n          <p class="chart-title">Agreement summary</p>'),
        ('<p class="chart-sub">Each disagreement, with Gemini\'s explanation in its own words.</p>',
         '<p class="chart-sub">Each person placed in a different category, with the reason Gemini gave in a round that matches its final placement.</p>'),
        ('<p class="chart-title">Share rated <strong>High</strong> priority, by <span id="group-name">gender</span></p>',
         '<p class="chart-title">Share given a <strong>High</strong> place, by <span id="group-name">gender</span></p>'),
        ('<p class="chart-sub">People grouped by VI&#8209;SPDAT score (0&ndash;17); each bar shows how Gemini placed them. Dashed lines mark the VI&#8209;SPDAT cut-offs between Low, Medium, and High.</p>',
         '<p class="chart-sub">People grouped by VI&#8209;SPDAT score (0&ndash;17); each bar shows how Gemini placed them. Dashed lines mark where VI&#8209;SPDAT\'s Low, Medium, and High places divide.</p>'),
        ('<p class="chart-title">Share rated High priority in each city</p>', '<p class="chart-title">Share given a High place in each city</p>'),
        ('        <div class="chart-card">\n          <p class="chart-title">High, Medium, and Low within each group</p>',
         '        <div class="chart-card">\n          <p class="chart-title">Places gained or lost under Gemini, by <span id="group-name-3">gender</span></p>\n          <p class="chart-sub">Gemini\'s High and Medium places minus VI&#8209;SPDAT\'s, in people. Bars to the right mean the group gets more places under Gemini; to the left, fewer.</p>\n          <div class="legend" id="legend-gain"></div>\n          <div class="chart-scroll" id="chart-gain"></div>\n        </div>\n        <div class="chart-card">\n          <p class="chart-title">High, Medium, and Low within each group</p>'),
    ], "views")
    # factors: replace the weights card
    s = re.sub(r'        <div class="chart-card">\n          <p class="chart-title">How much each approach weighs each factor</p>.*?id="weights-foot"></p>\n        </div>\n',
               lambda m: FACTOR_RATES_CARD + FACTOR_WEIGHTS_CARD, s, count=1, flags=re.S)
    s = re.sub(r'<p class="chart-sub">Plain-language definition, the VI&#8209;SPDAT questions it comes from.*?</p>',
               '<p class="chart-sub">Plain-language definition, the VI&#8209;SPDAT questions it comes from, the published scoring rule, and two results for Gemini: how much the factor changes the chance of a High place, and whether people with the factor get High places more or less often than their VI&#8209;SPDAT scores predict.</p>',
               s, count=1, flags=re.S)
    # design
    s = edit(s, [
        ('<p><strong>Population.</strong> 100 distinct synthetic adults: 32 adapted from the original study\'s base profiles and 68 new. Every case summary states each VI&#8209;SPDAT item outright, so neither approach has to guess.</p>',
         '<p><strong>Population.</strong> 100 distinct synthetic adults, written for this study with AI assistance and reviewed by the researcher. Every case summary states each VI&#8209;SPDAT item outright, so neither approach has to guess.</p>'),
        ('<p><strong>Demographics.</strong> The original study\'s 2 genders, 5 races, and 5 cities. Age comes',
         '<p><strong>Demographics.</strong> Two genders, five races, and five cities. Age comes'),
        ('<p><strong>Gemini.</strong> Gemini gives its own judgment, not a VI&#8209;SPDAT calculation. Each person is a separate API request with only the instructions and that person\'s case summary, so one case cannot influence another. Gemini never saw the VI&#8209;SPDAT questions, items, rules, or scores, or the titles and IDs used on this page.</p>',
         '<p><strong>Places.</strong> 35 High places (permanent supportive housing), 40 Medium places (rapid re&#8209;housing), and 25 people who receive neither. These are the numbers VI&#8209;SPDAT assigns to these 100 people, so both approaches fill the same places. VI&#8209;SPDAT fills High places with the highest scores, then Medium places with the next highest.</p>\n          <p><strong>Gemini.</strong> Gemini gives its own judgment, not a VI&#8209;SPDAT calculation. It sees all 100 case summaries in one request and must assign every person High, Medium, or Low, using exactly 35, 40, and 25. A round is accepted only if every person is assigned once and the split is exact. The request is repeated for 10 rounds; each round lists the people in a new random order under new anonymous numbers, and no round can see another. Gemini never saw the VI&#8209;SPDAT questions, items, rules, or scores, or the titles and IDs used on this page.</p>\n          <p><strong>Final placement.</strong> Each person\'s placement on this site is their consensus over the rounds: people are ordered by their average category (High 2, Medium 1, Low 0), the top 35 are High, the next 40 Medium, and the rest Low. No tie falls on a cut-off.</p>'),
        ('<p class="chart-title">Prompt sent for every person</p>\n          <p class="chart-sub">Identical for all 100 requests; only the case summary changes.</p>',
         '<p class="chart-title">Prompt sent in every round</p>\n          <p class="chart-sub">Identical in all 10 rounds; only the order and numbering of the 100 case summaries changes.</p>'),
    ], "design")
    views = {}
    cur = None
    for line in (PILOT / "scripts" / "limited_views.html").read_text(encoding="utf-8").split("\n"):
        if line.startswith("<!--VIEW:"):
            cur = line[9:-3]
            views[cur] = []
        elif cur:
            views[cur].append(line)
    views = {k: "\n".join(v).replace("@@RQ@@", RQ).replace("VI-SPDAT", "VI&#8209;SPDAT") + "\n" for k, v in views.items()}
    # restore plain text inside tags that must not contain entities
    s = s.replace('    <main id="main">\n', '    <main id="main">\n' + views["summary"], 1)
    s = s.replace('      <section class="view" id="view-downloads"', views["methods"] + views["robustness"] + views["limitations"] + views["glossary"] +
                  '      <section class="view" id="view-downloads"', 1)
    s = s.replace('      <div class="nav-group">\n        <span class="nav-label">Results</span>',
                  '      <div class="nav-group">\n        <span class="nav-label">Summary</span>\n'
                  '        <a href="#summary" data-view-link="summary" data-sub="Research question, key results, and caveats">Summary</a>\n      </div>\n'
                  '      <div class="nav-group">\n        <span class="nav-label">Results</span>', 1)
    s = s.replace('      <div class="nav-group">\n        <span class="nav-label">Files</span>',
                  '      <div class="nav-group">\n        <span class="nav-label">Methods and checks</span>\n'
                  '        <a href="#methods" data-view-link="methods" data-sub="How the study was run and analyzed">Methods</a>\n'
                  '        <a href="#robustness" data-view-link="robustness" data-sub="Reliability, confidence intervals, consistency across rounds, and power">Robustness</a>\n'
                  '        <a href="#limitations" data-view-link="limitations" data-sub="What the study can and cannot show">Limitations</a>\n'
                  '        <a href="#glossary" data-view-link="glossary" data-sub="Terms and statistics used on this site">Glossary</a>\n      </div>\n'
                  '      <div class="nav-group">\n        <span class="nav-label">Files</span>', 1)
    assert 'id="view-summary"' in s and 'id="view-glossary"' in s and 'data-view-link="methods"' in s
    OUT.mkdir(exist_ok=True)
    (OUT / "index.html").write_text(s, encoding="utf-8")


# ------------------------------------------------------------------ script

CARDS = r'''  d3.select("#overview-lede").text(
    `VI‑SPDAT and ${RUN.label} filled the same ${DATA.prompt_places.High} High and ${DATA.prompt_places.Medium} Medium places for ${t.n} synthetic people. ` +
    `Gemini saw everyone at once and assigned each person, ${POOL.rounds} times, with the people in a different order each time.`);
  const pr = POOL.per_round, avg = (k) => d3.mean(pr, (r) => r[k]);
  const circ = POOL.tests.filter((x) => x.family === "circumstance"), demo = POOL.tests.filter((x) => x.family === "demographic");
  const sigC = circ.filter((x) => x.p_holm < 0.05), sigD = demo.filter((x) => x.p_holm < 0.05);
  const cards = [
    { kicker: "Agreement", stat: `${t.same} of 100`, note: "people placed in the same category by both",
      body: `Weighted Cohen's kappa ${kappa(P).toFixed(2)}: substantial agreement. Single rounds range from ${d3.min(pr, (r) => r.same)} to ${d3.max(pr, (r) => r.same)} people.` },
    { kicker: "Direction", stat: `${t.higher} up · ${t.lower} down`, note: "people Gemini places above / below VI‑SPDAT",
      body: "With limited places Gemini has to choose, so it moves about as many people down as up." },
    { kicker: "Stability", stat: `${POOL.same_category_in_every_round} of 100`, note: `people given the same category in all ${POOL.rounds} rounds`,
      body: `Two rounds agree on ${fmt1(POOL.round_to_round_same_category.mean)} people on average. Choices near the cut-offs vary with the order of the list.` },
    { kicker: "What stood out", stat: `${sigC.length} of ${circ.length}`, note: "circumstances significant (Holm-corrected)",
      body: (sigC.length ? `${sigC.map((x) => x.factor).join(", ")}. ` : "No circumstance clearly changed who got a High place. ") +
        `Demographics: ${sigD.length} of ${demo.length} significant.` }
  ];
'''

SIG = r'''function renderSignificance() {
  const circ = POOL.tests.filter((x) => x.family === "circumstance"), demo = POOL.tests.filter((x) => x.family === "demographic");
  const sigC = circ.filter((x) => x.p_holm < 0.05), sigD = demo.filter((x) => x.p_holm < 0.05);
  d3.select("#sig-lede").text(
    `These tests ask whether a group or circumstance changes who gets a High place once the VI‑SPDAT score is held fixed. ` +
    `Each person's High-place rate is the share of the ${POOL.rounds} rounds in which Gemini placed them High. With 100 people, only large effects can be detected.`);
  const top = circ.slice().sort((a, b) => a.p - b.p)[0], d = POOL.circumstances[top.factor];
  const cards = [
    { kicker: "Circumstances", stat: `${sigC.length} of ${circ.length}`, note: "significant after Holm correction",
      body: sigC.length ? `${sigC.map((x) => x.factor).join(", ")}: ${d.n} people placed High in ${Math.round(d.observed * 100)}% of rounds, against ${Math.round(d.expected * 100)}% expected from their VI‑SPDAT scores.` : "None." },
    { kicker: "Demographics", stat: `${sigD.length} of ${demo.length}`, note: "gender, race, city, age: significant after Holm",
      body: sigD.length ? sigD.map((x) => x.factor).join(", ") : "No demographic group's High places differ from what its VI‑SPDAT scores predict." },
    { kicker: "VI-SPDAT score", stat: `${Math.round(POOL.r2_score_only * 100)}%`, note: "of who gets a High place is explained by the VI‑SPDAT score alone",
      body: `Adding the 17 individual factors raises this to ${Math.round(POOL.r2_factors * 100)}%, so Gemini weighs the factors differently from VI‑SPDAT's equal points.` },
    { kicker: "Stability", stat: `${POOL.same_category_in_every_round} of 100`, note: `given the same category in all ${POOL.rounds} rounds`,
      body: "Results are averages over rounds, because a single round can place people near a cut-off differently." }
  ];
  const el = d3.select("#sig-cards").html("");
  cards.forEach((c) => {
    const a = el.append("article").attr("class", "fcard");
    a.append("p").attr("class", "fcard-kicker").text(c.kicker);
    a.append("p").attr("class", "fcard-stat").text(c.stat);
    a.append("p").attr("class", "fcard-note").text(c.note);
    a.append("p").attr("class", "fcard-body").text(c.body);
  });
  limitedCircumstances(POOL, circ);
  limitedDemographics(POOL, demo);
  d3.select("#sig-method").text(
    `Stratified permutation tests (labels shuffled among people with the same VI‑SPDAT score, 20,000 shuffles), Holm-corrected within each family. ` +
    `A round counts only if every person is assigned once and the split is exactly ${POOL.places.High} / ${POOL.places.Medium} / ${POOL.places.Low}.`);
}

'''

FACTOR_TABLE = r'''  const eff = Object.fromEntries(POOL.factor_effects.map((f) => [f.id, f]));
  const tst = Object.fromEntries(POOL.tests.filter((x) => x.family === "circumstance").map((x) => [x.factor, x]));
  const det = Object.fromEntries(Object.values(POOL.circumstances).map((c) => [c.id, c]));
  const nameOf = Object.fromEntries(Object.entries(POOL.circumstances).map(([name, c]) => [c.id, name]));
  const sigCell = (txt, p) => (p < 0.05 ? `<span class="weight-sig">${txt}</span>` : txt);
  table("#factor-table", ["#", "Factor", "Counts as yes when the person…", "VI‑SPDAT questions", "Published scoring rule", "People",
    "Change in High-place chance (Holm p)", "High places vs expected (Holm p)"],
    items.map((it, i) => {
      const e = eff[it.id], c = det[it.id], t = c ? tst[nameOf[it.id]] : null;
      return { cells: [
        i + 1,
        `<span class="domain-swatch" style="background:${css(DOMAIN_TOKEN[it.letter])}"></span>${esc(it.name)}<br><span class="group-n">${it.letter === "—" ? "" : it.letter + ". "}${esc(it.domain)}</span>`,
        esc(FACTOR_PLAIN[it.id]), esc(it.questions), esc(it.rule),
        `${P.filter((p) => p.indicators.includes(it.id)).length}`,
        e ? sigCell(`${e.effect > 0 ? "+" : ""}${(e.effect * 100).toFixed(0)} pts (${fmtP(e.p_holm)})`, e.p_holm) : "—",
        c ? sigCell(`${Math.round(c.observed * 100)}% vs ${Math.round(c.expected * 100)}% (${fmtP(t.p_holm)})`, t.p_holm) : "—"
      ] };
    }));
  limitedEffects(POOL);
'''


def build_js():
    s = (PILOT / "assets" / "pilot.js").read_text(encoding="utf-8")
    lim = (ROOT / "pilot" / "scripts" / "limited_charts.js").read_text(encoding="utf-8")
    lim += "\n" + (ROOT / "pilot" / "scripts" / "limited_extra.js").read_text(encoding="utf-8")
    lim += "\n" + (ROOT / "pilot" / "scripts" / "limited_pages.js").read_text(encoding="utf-8")
    s = edit(s, [
        ("   Pilot dashboard: VI-SPDAT and Gemini priority for 100 people", "   Limited places study: VI-SPDAT and Gemini with 35 High and 40 Medium places"),
        ("let RUN = null;        // active complete run", "let RUN = null;        // the run\nlet POOL = null;       // analysis of its rounds"),
        ('document.title = `${link ? link.textContent + " · " : ""}Pilot · VI-SPDAT and Gemini Housing Priority`;',
         'document.title = `${link ? link.textContent + " · " : ""}Limited places · VI-SPDAT and Gemini Housing Priority`;'),
        ('  RUN = data.runs.find((r) => r.complete) || null;', '  RUN = data.runs.find((r) => r.complete) || null;\n  POOL = RUN ? RUN.pool : null;\n  data.prompt_places = POOL ? POOL.places : null;'),
        ('''  const complete = DATA.runs.filter((r) => r.complete);
  chipGroup("#model-chips", complete.map((r) => ({ value: r.key, label: r.label })), RUN.key,
    (v) => { RUN = complete.find((r) => r.key === v); renderAll(); });
  d3.select("#run-status").text("");
''', ""),
        ('  renderDownloads();\n}', '  renderDownloads();\n  renderRounds(POOL);\n  renderExtras();\n  renderPages();\n}'),
        ('`${k} of ${n} people in the pilot.`', '`${k} of ${n} people in the study.`'),
        ('d3.select("#crosstab-foot").text(`Same category: ${t.same} of ${t.n}. Gemini higher: ${t.higher}. Gemini lower: ${t.lower}.`);',
         'd3.select("#crosstab-foot").text(`Same category: ${t.same} of ${t.n}. Gemini higher: ${t.higher}. Gemini lower: ${t.lower}. Gemini\'s placement is its consensus over ${POOL.rounds} rounds.`);'),
        ('side.append("p").text(RUN.answers[p.id].explanation || "—");',
         'side.append("p").text(RUN.answers[p.id].explanation || "—");\n    side.append("p").attr("class", "group-n").text(`Placed High in ${RUN.answers[p.id].high_rounds}, Medium in ${RUN.answers[p.id].medium_rounds}, Low in ${RUN.answers[p.id].low_rounds} of ${POOL.rounds} rounds.`);'),
        ('    { value: "differ", label: "Placed differently", count: P.filter((p) => gem(p) !== p.vispdat).length }\n  ];',
         '    { value: "differ", label: "Placed differently", count: P.filter((p) => gem(p) !== p.vispdat).length },\n    { value: "varies", label: "Changes between rounds", count: P.filter((p) => new Set(RUN.answers[p.id].rounds).size > 1).length }\n  ];'),
        ('const rows = P.filter((p) => PROFILE_FILTER === "all" || (PROFILE_FILTER === "same") === (gem(p) === p.vispdat));',
         'const rows = P.filter((p) => PROFILE_FILTER === "all" || (PROFILE_FILTER === "varies" ? new Set(RUN.answers[p.id].rounds).size > 1 : (PROFILE_FILTER === "same") === (gem(p) === p.vispdat)));'),
        ('["ID", "Person", "Age", "Gender", "Race", "City", "VI‑SPDAT score", "VI‑SPDAT", "Gemini"].forEach',
         '["ID", "Person", "Age", "Gender", "Race", "City", "VI‑SPDAT score", "VI‑SPDAT", "Gemini", "Rounds High"].forEach'),
        ('p.score, priTag(p.vispdat), priTag(gem(p))]\n      .forEach',
         'p.score, priTag(p.vispdat), priTag(gem(p)), `${RUN.answers[p.id].high_rounds} / ${POOL.rounds}`]\n      .forEach'),
        ('.attr("colspan", 9)', '.attr("colspan", 10)'),
    ], "js simple")
    s = between(s, '  d3.select("#overview-lede").text(', '  const el = d3.select("#findings");', CARDS, "cards")
    s = between(s, "function renderSignificance() {", "/* ============================================================\n   Cities", SIG + "\n", "sig")
    s = between(s, "function renderWeights() {", "/* ============================================================\n   Profiles", "\n", "weights")
    s = between(s, "  const fw = DATA.factor_weights ?", "  d3.select(\"#factor-foot\")", FACTOR_TABLE, "factor table")
    # design: prompt and run text
    s = between(s, "  const done = DATA.runs.filter", "  const P = DATA.profiles, n = P.length, rows = [];",
                '''  d3.select("#design-runs").html(`<strong>Model.</strong> Gemini 3.8 Flash with default settings, including its default reasoning. Each round used about ${Math.round(POOL.tokens_per_round.prompt_token_count / 1000)}k input and ${Math.round((POOL.tokens_per_round.thoughts_token_count + POOL.tokens_per_round.candidates_token_count) / 1000)}k output tokens (including reasoning).`);
  const pr = DATA.prompt;
  d3.select("#prompt-text").text(`${pr.instructions}\\n\\nApplicant 1\\nAge [age]. Gender: [gender]. Race: [race]. Location: [city].\\n\\n` +
    pr.sections.map((s) => `${s}: [text]`).join("\\n") + `\\n\\n[... Applicants 2 to 100 in the same format ...]\\n\\n${pr.reply_format}`);

''', "design")
    # downloads
    s = between(s, "  const files = [", "  table(\"#downloads-table\"", '''  const files = [
    ["Dashboard data", "data/dashboard.json", "Every profile, its VI‑SPDAT score and priority, Gemini's placement and rounds, and the analysis behind each figure."],
    ["Profiles", "data/profiles.json", "The 100 people: demographics, VI‑SPDAT items, and case summaries."],
    ["VI‑SPDAT scores", "data/vispdat_scores.csv", "Score, domain subtotals, recommendation, and priority per person."],
    ["Results by person", "results/by_person.csv", "VI‑SPDAT priority, Gemini's placement, and how many of the rounds put each person in each category."],
    ["Agreement by round", "results/rounds.csv", "People placed in the same category, higher, and lower, with kappa, for each round."],
    ["Results by group", "results/limited_groups.csv", "High and Medium places going to each group under VI‑SPDAT and Gemini."],
    ["All results", "results/limited_results.json", "Agreement, stability, significance tests, and factor effects."]
  ];
''', "downloads")
    s = s.rstrip() + "\n\n" + lim + "\n"
    (OUT / "assets").mkdir(parents=True, exist_ok=True)
    (OUT / "assets" / "study.js").write_text(s, encoding="utf-8")


def main():
    OUT.mkdir(exist_ok=True)
    (OUT / "assets").mkdir(exist_ok=True)
    shutil.copy(PILOT / "assets" / "style.css", OUT / "assets" / "style.css")
    shutil.copy(PILOT / "assets" / "pilot.css", OUT / "assets" / "study.css")
    shutil.copytree(PILOT / "assets" / "vendor", OUT / "assets" / "vendor", dirs_exist_ok=True)
    build_data()
    build_html()
    build_js()
    print("built", OUT)


if __name__ == "__main__":
    main()
