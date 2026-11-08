"""
Research-paper tables for the limited places study, built from the dashboard's own data file
(limited/data/dashboard.json) so every number matches the live dashboard.

Main scenario only: 35 High / 40 Medium / 25 Low places, Gemini 3.8 Flash, 10 rounds. Each
person's Gemini category is the consensus placement used on the dashboard (people ranked by
their average category over the rounds; top 35 High, next 40 Medium, rest Low).

Run:  python pilot/scripts/export_limited_paper_tables.py
Writes: pilot/exports/limited_places_paper_tables.docx
"""

import json
import sys
from collections import Counter
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyze import apa_table, para, style_doc  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CATS = ["High", "Medium", "Low"]
RANK = {"High": 2, "Medium": 1, "Low": 0}
CITIES = ["Los Angeles, California", "Cincinnati, Ohio", "Chicago, Illinois", "Atlanta, Georgia", "New York City, New York"]
RACES = ["American Indian, Alaska Native, or Indigenous", "Asian or Asian American", "Black, African American, or African",
         "Hispanic/Latino/e/a", "White"]
AGES = ["18–24", "25–39", "40–59", "60 and older"]
AGE_KEY = {"18-24": "18–24", "25-39": "25–39", "40-59": "40–59", "60 and older": "60 and older"}


def r0(x):
    """Round half up, as the dashboard does."""
    return int(x + 0.5) if x >= 0 else -int(-x + 0.5)


def pc(x):
    return f"{r0(100 * x)}%"


def fp(p):
    return "< .001" if p < 0.001 else f"{p:.3f}".lstrip("0")


def f1(x):
    return str(r0(x)) if abs(x - round(x)) < 0.05 else f"{x:.1f}"


def npc(k, n):
    return f"{k} ({100 * k / n:.1f})" if n else "—"


def age_group(a):
    return "18–24" if a < 25 else "25–39" if a < 40 else "40–59" if a < 60 else "60 and older"


def main():
    D = json.loads((ROOT / "limited" / "data" / "dashboard.json").read_text(encoding="utf-8"))
    run = D["runs"][0]
    A, S, E = run["answers"], run["pool"], run["pool"]["extra"]
    P = D["profiles"]
    N, R = len(P), S["rounds"]
    gem = {p["id"]: A[p["id"]]["priority"] for p in P}
    item_name = {i["id"]: i["name"] for i in D["instrument"]["items"]}

    doc = Document()
    style_doc(doc, landscape=True)
    para(doc, "Tables: Housing Priority With Limited Places, VI-SPDAT and Gemini 3.8 Flash", bold=True,
         align=WD_ALIGN_PARAGRAPH.CENTER, space_after=4)
    para(doc, f"100 synthetic people; 35 High, 40 Medium, and 25 Low places; Gemini assigned all 100 at once in {R} rounds. "
              "Numbers match the limited places study dashboard.", size=11, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=12)
    cons = ("Gemini's category is each person's consensus placement: people are ranked by their average category over the "
            f"{R} rounds (High = 2, Medium = 1, Low = 0); the top 35 are High, the next 40 Medium, and the rest Low.")
    t = 0

    def nxt():
        nonlocal t
        t += 1
        return t

    # 1. composition
    body, groups = [], []
    blocks = [("Gender", lambda p: p["gender"], ["Female", "Male"]),
              ("Race", lambda p: p["race"], RACES),
              ("City", lambda p: p["location"], CITIES),
              ("Age group", lambda p: age_group(p["age"]), AGES),
              ("VI-SPDAT priority", lambda p: p["vispdat"], CATS)]
    for title, of, order in blocks:
        groups.append(len(body))
        body.append([title, "", ""])
        c = Counter(of(p) for p in P)
        for g in order:
            body.append(["    " + g, c[g], f"{100 * c[g] / N:.1f}"])
    scores = [p["score"] for p in P]
    apa_table(doc, nxt(), "Composition of the Synthetic Population (N = 100)", ["Characteristic", "n", "%"], body,
              note=f"Every race and every city has 20 people (10 women, 10 men), and every race by city pair has 2 women and "
                   f"2 men. VI-SPDAT score: M = {sum(scores) / N:.1f}, range {min(scores)}-{max(scores)}.",
              widths=[4.6, 0.8, 0.8], group_rows=groups)

    # 2. VI-SPDAT items
    body, groups, last = [], [], None
    for i in D["instrument"]["items"]:
        if i["domain"] != last:
            groups.append(len(body))
            body.append([i["domain"] if i["letter"] in ("—", "—") or not i["letter"].strip() or i["domain"] == "Pre-Survey"
                         else f"{i['letter']}. {i['domain']}", "", "", ""])
            last = i["domain"]
        k = sum(i["id"] in p["indicators"] for p in P)
        body.append(["    " + i["name"], i["questions"], i["rule"], f"{k} ({100 * k / N:.0f})"])
    apa_table(doc, nxt(), "VI-SPDAT 2.0 Items and the Number of People Meeting Each", ["Item", "Questions", "Scoring rule",
              "People, n (%)"], body, size=8, widths=[2.4, 1.2, 4.2, 1.1], group_rows=groups,
              note=f"Rules quoted from VI-SPDAT {D['instrument']['version']}, {D['instrument']['population']}. "
                   f"{D['instrument']['copyright']} Each item scores 1 point; maximum 17. Bands: Low 0-3, Medium 4-7, High 8-17.")

    # 3. key results
    ag, co, rel = E["agreement"], E["correlation"], E["reliability"]
    higher = sum(RANK[gem[p["id"]]] > RANK[p["vispdat"]] for p in P)
    lower = sum(RANK[gem[p["id"]]] < RANK[p["vispdat"]] for p in P)
    circ = [x for x in S["tests"] if x["family"] == "circumstance"]
    demo = [x for x in S["tests"] if x["family"] == "demographic"]
    top = min(circ, key=lambda x: x["p"])
    tc = S["circumstances"][top["factor"]]
    ci2 = lambda c: f"{c[0]:.2f} to {c[1]:.2f}"  # noqa: E731
    body = [
        ["People in the same category as VI-SPDAT", f"{ag['consensus_same']} of 100", f"{r0(100 * ag['consensus_ci'][0])}-{r0(100 * ag['consensus_ci'][1])}%"],
        ["Weighted Cohen's kappa, VI-SPDAT and Gemini", f"{ag['kappa_consensus']:.2f}", ci2(ag["kappa_ci"])],
        ["Spearman's rho, VI-SPDAT score and Gemini's average category", f"{co['spearman']:.2f}", ci2(co["spearman_ci"])],
        ["Kendall's tau, same variables", f"{co['kendall']:.2f}", ci2(co["kendall_ci"])],
        ["Fleiss' kappa across the rounds", f"{rel['fleiss_kappa']:.2f}", ci2(rel["fleiss_ci"])],
        ["People placed higher / lower than VI-SPDAT", f"{higher} / {lower}", "—"],
        [f"People given the same category in all {R} rounds", f"{S['same_category_in_every_round']} of 100", "—"],
        [f"“{top['factor']}”: share of rounds placed High (expected)", f"{pc(tc['observed'])} ({pc(tc['expected'])})",
         f"Holm p {fp(top['p_holm'])}"],
        ["Demographic factors significant after Holm correction", f"{sum(x['p_holm'] < 0.05 for x in demo)} of {len(demo)}", "—"],
    ]
    apa_table(doc, nxt(), "Key Results", ["Measure", "Estimate", "95% CI"], body,
              note="CI = confidence interval: Wilson interval for the proportion; percentile bootstrap (2,000 resamples of people) "
                   "otherwise. " + cons, widths=[5.0, 1.8, 1.8])

    # 4. cross-tab
    ct = {(a, b): sum(p["vispdat"] == a and gem[p["id"]] == b for p in P) for a in CATS for b in CATS}
    body = [[f"VI-SPDAT {a}"] + [ct[(a, b)] for b in CATS] + [sum(ct[(a, b)] for b in CATS)] for a in CATS]
    body.append(["Total"] + [sum(ct[(a, b)] for a in CATS) for b in CATS] + [N])
    apa_table(doc, nxt(), "Priority Assigned by VI-SPDAT and by Gemini to the Same People",
              ["", "Gemini High", "Gemini Medium", "Gemini Low", "Total"], body,
              note=f"Same category: {ag['consensus_same']} of {N}. Gemini higher: {higher}. Gemini lower: {lower}. " + cons,
              widths=[2.0, 1.3, 1.3, 1.3, 1.0])

    # 5. agreement summary
    body = [["Same category", ag["consensus_same"], f"{ag['consensus_same']:.1f}"],
            ["Gemini higher than VI-SPDAT", higher, f"{higher:.1f}"],
            ["Gemini lower than VI-SPDAT", lower, f"{lower:.1f}"]]
    for c in CATS:
        k = sum(p["vispdat"] == c for p in P)
        body.append([f"VI-SPDAT {c}: Gemini agrees", f"{ct[(c, c)]} of {k}", f"{100 * ct[(c, c)] / k:.1f}"])
    apa_table(doc, nxt(), "Agreement Between VI-SPDAT and Gemini", ["Measure", "People", "%"], body,
              note=f"Linear-weighted Cohen's kappa = {ag['kappa_consensus']:.2f} (95% CI {ci2(ag['kappa_ci'])}).",
              widths=[3.6, 1.2, 1.0])

    # 6. by score
    body = []
    for s in sorted({p["score"] for p in P}):
        at = [p for p in P if p["score"] == s]
        g = Counter(gem[p["id"]] for p in at)
        up = sum(RANK[gem[p["id"]]] > RANK[p["vispdat"]] for p in at)
        dn = sum(RANK[gem[p["id"]]] < RANK[p["vispdat"]] for p in at)
        hs = sum(A[p["id"]]["high_rounds"] for p in at) / (len(at) * R)
        body.append([s, at[0]["vispdat"], len(at), g["High"], g["Medium"], g["Low"], up, dn, pc(hs)])
    apa_table(doc, nxt(), "Gemini's Placement at Each VI-SPDAT Score",
              ["VI-SPDAT score", "VI-SPDAT priority", "n", "Gemini High", "Gemini Medium", "Gemini Low", "Placed higher",
               "Placed lower", "Share of rounds placed High"], body,
              note="Placed higher or lower compares each person's consensus placement with VI-SPDAT's. " + cons,
              widths=[0.9, 1.0, 0.5, 0.9, 0.9, 0.9, 0.9, 0.9, 1.3])

    # 7. rounds
    det = {d["round"]: d for d in S["round_details"]}
    body = []
    for r in S["per_round"]:
        d = det[r["round"]]
        body.append([r["round"], f1(r["same"]), f1(r["higher"]), f1(r["lower"]), f"{r['kappa']:.2f}", f"{d['seconds'] / 60:.1f}",
                     f"{d['prompt_tokens']:,}", f"{d['thought_tokens']:,}", f"{d['output_tokens']:,}"])
    body.append(["Mean", f"{ag['per_round_mean']:.1f}", f1(sum(r["higher"] for r in S["per_round"]) / R),
                 f1(sum(r["lower"] for r in S["per_round"]) / R), f"{ag['kappa_per_round_mean']:.2f}", "", "", "", ""])
    c = E["cost"]
    apa_table(doc, nxt(), "Agreement With VI-SPDAT and Resources Used in Each Round",
              ["Round", "Same", "Higher", "Lower", "Weighted kappa", "Minutes", "Input tokens", "Reasoning tokens", "Output tokens"],
              body, note=f"Counts are people out of 100. Each round is one request containing all 100 people in a new random order. "
                         f"Total tokens: {c['input_tokens']:,} input, {c['reasoning_tokens']:,} reasoning, {c['output_tokens']:,} output; "
                         f"estimated cost about ${c['usd']:.2f} ({c['prices']}).",
              widths=[0.6, 0.7, 0.7, 0.7, 1.1, 0.8, 1.2, 1.3, 1.2])

    # 8. stability
    hist = Counter(A[p["id"]]["high_rounds"] for p in P)
    body = [["Fleiss' kappa across rounds (95% CI)", f"{rel['fleiss_kappa']:.2f} ({ci2(rel['fleiss_ci'])})"],
            ["People in the same category in both of two rounds, mean (range)", f"{rel['pairwise_mean']:.1f} ({rel['pairwise_min']}-{rel['pairwise_max']})"],
            [f"People given the same category in all {R} rounds", S["same_category_in_every_round"]],
            [f"People placed High in all {R} rounds", hist[R]], ["People never placed High", hist[0]],
            ["People placed High in some rounds but not others", N - hist[R] - hist[0]]]
    apa_table(doc, nxt(), "Consistency of Gemini's Placements Across Rounds", ["Measure", "Value"], body,
              note="Rounds differ only in the order and numbering of the 100 people. Fleiss' kappa treats the rounds as raters.",
              widths=[5.0, 2.4])

    # 9. by group (consensus)
    facs = [("Gender", lambda p: p["gender"], ["Female", "Male"]), ("Race", lambda p: p["race"], RACES),
            ("City", lambda p: p["location"], CITIES), ("Age group", lambda p: age_group(p["age"]), AGES),
            ("Sleeping situation", lambda p: "Unsheltered or other" if "a1_sleep" in p["indicators"] else "Shelter or transitional",
             ["Shelter or transitional", "Unsheltered or other"]),
            ("Long or repeat homelessness", lambda p: "Yes" if "a2_duration" in p["indicators"] else "No", ["Yes", "No"]),
            ("Physical health", lambda p: "Yes" if "d1_physical" in p["indicators"] else "No", ["Yes", "No"]),
            ("Mental health", lambda p: "Yes" if "d3_mental" in p["indicators"] else "No", ["Yes", "No"]),
            ("Substance use", lambda p: "Yes" if "d2_substance" in p["indicators"] else "No", ["Yes", "No"])]

    def row(name, people):
        n = len(people)
        v, g = Counter(p["vispdat"] for p in people), Counter(gem[p["id"]] for p in people)
        same = sum(gem[p["id"]] == p["vispdat"] for p in people)
        hi = sum(RANK[gem[p["id"]]] > RANK[p["vispdat"]] for p in people)
        lo = sum(RANK[gem[p["id"]]] < RANK[p["vispdat"]] for p in people)
        return [name, n, npc(v["High"], n), npc(g["High"], n), npc(v["Medium"], n), npc(g["Medium"], n), npc(v["Low"], n),
                npc(g["Low"], n), npc(same, n), npc(hi, n), npc(lo, n)]
    body, groups = [row("All people", P)], []
    for title, of, order in facs:
        groups.append(len(body))
        body.append([title] + [""] * 10)
        for g in order:
            body.append(row("    " + g, [p for p in P if of(p) == g]))
    apa_table(doc, nxt(), "Priority by Group: VI-SPDAT and Gemini",
              ["Group", "n", "VI-SPDAT High\nn (%)", "Gemini High\nn (%)", "VI-SPDAT Medium\nn (%)", "Gemini Medium\nn (%)",
               "VI-SPDAT Low\nn (%)", "Gemini Low\nn (%)", "Same\nn (%)", "Gemini higher\nn (%)", "Gemini lower\nn (%)"],
              body, size=7, widths=[2.0, 0.35] + [0.73] * 9, group_rows=groups,
              note="Percentages are within each group (row). Group differences describe the two approaches and do not by "
                   "themselves establish bias; significance tests are in the next tables. " + cons)

    # 10. demographic tests
    body, groups = [], []
    for x in demo:
        groups.append(len(body))
        body.append([x["factor"], "", "", "", "", "", fp(x["p"]), fp(x["p_holm"])])
        gs = [g for g in S["groups"] if g["factor"] == x["factor"]]
        if x["factor"] == "Age group":
            gs = sorted(gs, key=lambda g: AGES.index(AGE_KEY.get(g["group"], g["group"])))
        for g in gs:
            body.append(["    " + AGE_KEY.get(g["group"], g["group"]), g["n"], f1(g["vispdat_high"]), f1(g["gemini_high"]),
                         f1(g["vispdat_medium"]), f1(g["gemini_medium"]), "", ""])
    apa_table(doc, nxt(), "Who Receives High and Medium Places, by Demographic Group",
              ["Group", "n", "VI-SPDAT High places", "Gemini High places", "VI-SPDAT Medium places", "Gemini Medium places", "p", "Holm p"],
              body, widths=[3.2, 0.5, 1.2, 1.2, 1.3, 1.3, 0.6, 0.7], group_rows=groups,
              note="Places are numbers of people; Gemini's are averaged over the rounds. p tests whether a group's High places "
                   "differ from what its members' VI-SPDAT scores predict: stratified permutation test (labels shuffled within "
                   "VI-SPDAT score, 20,000 shuffles), Holm correction across the four factors.")

    # 11. circumstances
    pr = E["per_round"]
    body = []
    for x in sorted(circ, key=lambda x: x["p"]):
        d = S["circumstances"][x["factor"]]
        body.append([x["factor"], d["n"], pc(d["observed"]), pc(d["expected"]), f"{r0(100 * (d['observed'] - d['expected'])):+d}",
                     fp(x["p"]), fp(x["p_holm"]), f"{pr[x['factor']]['rounds_p05']} of {R}"])
    apa_table(doc, nxt(), "Circumstances and Who Receives a High Place",
              ["Circumstance", "n", "Placed High (share of rounds)", "Expected from VI-SPDAT score", "Difference (points)", "p",
               "Holm p", "Rounds with p < .05"], body,
              widths=[3.0, 0.5, 1.3, 1.4, 1.0, 0.6, 0.7, 1.0],
              note="Expected: the High-place rate of people with the same VI-SPDAT scores. p and Holm p: stratified permutation "
                   "test on all rounds (20,000 shuffles), Holm correction across 16 circumstances. Rounds with p < .05: the "
                   f"same test on each round alone ({E['permutations']:,} shuffles); rounds are not independent samples of people.")

    # 12. factor effects
    body = []
    for f in sorted(S["factor_effects"], key=lambda f: -f["effect"]):
        body.append([f["name"], f["people"], f"{100 * f['effect']:+.1f}", f"{100 * f['ci_low']:.1f} to {100 * f['ci_high']:.1f}",
                     fp(f["p"]), fp(f["p_holm"])])
    apa_table(doc, nxt(), "How Much Each VI-SPDAT Factor Changes the Chance of a High Place",
              ["Factor", "People", "Change (points)", "95% CI", "p", "Holm p"], body,
              widths=[3.6, 0.8, 1.2, 1.6, 0.7, 0.8],
              note=f"Ordinary least squares of each person's share of rounds placed High on the 17 factors, HC3 standard errors. "
                   f"R² = {S['r2_factors']:.2f}; VI-SPDAT score alone: R² = {S['r2_score_only']:.2f}. VI-SPDAT gives every "
                   "factor 1 point. Exploratory: factors co-occur and 100 people limit precision.")

    # 13. forest (group differences with CIs)
    body, groups = [], []
    for fam, label in (("demographic", "Demographic groups"), ("circumstance", "Circumstances (people with it)")):
        groups.append(len(body))
        body.append([label, "", "", "", "", ""])
        rows = [r for r in E["forest"] if r["family"] == fam]
        if fam == "demographic":
            order = {"Gender": 0, "Race": 1, "City": 2, "Age group": 3}
            rows.sort(key=lambda r: (order[r["factor"]], str(r["group"])))
        else:
            rows.sort(key=lambda r: -r["diff"])
        for r in rows:
            name = f"{r['factor']}: {AGE_KEY.get(r['group'], r['group'])}" if fam == "demographic" else r["factor"]
            body.append(["    " + name, r["n"], pc(r["vispdat_high"]), pc(r["gemini_high"]), f"{100 * r['diff']:+.1f}",
                         f"{100 * r['ci'][0]:.1f} to {100 * r['ci'][1]:.1f}"])
    apa_table(doc, nxt(), "Share of Each Group Given a High Place, With 95% Confidence Intervals",
              ["Group", "n", "VI-SPDAT", "Gemini", "Difference (points)", "95% CI"], body, size=8,
              widths=[4.0, 0.5, 0.9, 0.9, 1.3, 1.4], group_rows=groups,
              note="Gemini's share uses each person's share of rounds placed High. CI: percentile bootstrap, 2,000 resamples of "
                   "people within the group. These intervals compare Gemini with VI-SPDAT's own High places; the permutation "
                   "tests instead hold the VI-SPDAT score fixed.")

    # 14. robustness
    cs, pos = E["consensus"], S["position"]
    body = [["Combining rounds", "Average-rank allocation (used throughout)", f"{cs['mean_rank_allocation']['same']} of 100 agree"],
            ["", "Average of single rounds", f"{cs['single_round_mean']['same']} of 100 agree"],
            ["", "Most common category per person", f"{cs['most_common_category']['same']} of 100 agree"],
            ["List position", "Correlation of position with category after VI-SPDAT score, mean of rounds",
             f"rho = {pos['spearman_mean']:.3f} (range {pos['spearman_min']:.2f} to {pos['spearman_max']:.2f})"],
            ["", "Share placed High, first half / second half of the list", f"{pc(pos['first_half_high'])} / {pc(pos['second_half_high'])}"],
            ["", "Rounds with a significant position correlation (p < .05)", f"{pos['rounds_sig']} of {R}"]]
    for m in E["power"]["mde"]:
        body.append(["Smallest detectable difference" if m["n"] == E["power"]["mde"][0]["n"] else "", f"Group of {m['n']} people",
                     f"{m['points']} points"])
    apa_table(doc, nxt(), "Robustness and Power", ["Check", "Detail", "Result"], body,
              widths=[2.2, 4.6, 2.4],
              note="Smallest detectable difference: the difference in High-place rate a group would need, against everyone else "
                   f"with the same VI-SPDAT score, for 80% power at alpha = .05 (residual SD {E['power']['residual_sd']:.2f}).")

    # S1. every person
    body = []
    for p in sorted(P, key=lambda p: int(p["id"][1:])):
        a = A[p["id"]]
        body.append([p["id"], p["age"], p["gender"], p["race"], p["location"].split(",")[0], p["score"], p["vispdat"],
                     a["priority"], f"{a['high_rounds']} / {a['medium_rounds']} / {a['low_rounds']}"])
    apa_table(doc, "S1", "All 100 People: VI-SPDAT and Gemini Placement",
              ["ID", "Age", "Gender", "Race", "City", "VI-SPDAT score", "VI-SPDAT", "Gemini", "Rounds High / Medium / Low"],
              body, size=8, widths=[0.5, 0.45, 0.7, 2.8, 1.1, 0.8, 0.8, 0.8, 1.4], note=cons)

    # S2. disagreements
    dis = sorted((p for p in P if gem[p["id"]] != p["vispdat"]), key=lambda p: (p["score"], int(p["id"][1:])))
    body = [[p["id"], f"{p['age']}, {p['gender']}, {p['race']}, {p['location'].split(',')[0]}", p["score"], p["vispdat"],
             gem[p["id"]], f"{A[p['id']]['high_rounds']} / {A[p['id']]['medium_rounds']} / {A[p['id']]['low_rounds']}",
             A[p["id"]]["explanation"] or ""] for p in dis]
    apa_table(doc, "S2", f"The {len(dis)} People Placed Differently, With Gemini's Reason",
              ["ID", "Person", "Score", "VI-SPDAT", "Gemini", "Rounds H / M / L", "Gemini's reason"], body, size=8,
              widths=[0.5, 2.4, 0.5, 0.8, 0.8, 1.0, 3.3],
              note="Gemini's reason is the short phrase it gave in a round whose category matches the final placement.")

    out = ROOT / "pilot" / "exports" / "limited_places_paper_tables.docx"
    doc.save(out)
    print(out, "tables:", t, "+ S1, S2")


if __name__ == "__main__":
    main()
