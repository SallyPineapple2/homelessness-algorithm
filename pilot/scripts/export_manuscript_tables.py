"""
Data tables for the manuscript: every table on the pilot dashboard for the complete
Gemini 3.5 Flash-Lite run, as APA-style Word tables.

Reads pilot/data/dashboard.json and pilot/results/*.csv; writes
pilot/exports/manuscript_tables_gemini-3.5-flash-lite.docx.
"""

import csv
import json
import sys
from collections import Counter
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyze import apa_table, para, style_doc  # noqa: E402

PILOT = Path(__file__).resolve().parents[1]
CATS = ["High", "Medium", "Low"]
RANK = {"Low": 0, "Medium": 1, "High": 2}
SHORT_RACE = {
    "American Indian, Alaska Native, or Indigenous": "American Indian / Alaska Native",
    "Asian or Asian American": "Asian",
    "Black, African American, or African": "Black",
    "Hispanic/Latino/e/a": "Hispanic / Latino",
    "White": "White",
}


def pct(k, n):
    return f"{100 * k / n:.1f}" if n else "-"


def fmt_p(p):
    return "< .001" if p < 0.001 else f"{p:.3f}".lstrip("0")


def main():
    data = json.loads((PILOT / "data" / "dashboard.json").read_text(encoding="utf-8"))
    run = next(r for r in data["runs"] if r["key"] == "flash-lite" and r["complete"])
    stats, fw, profiles = run["stats"], data["factor_weights"], data["profiles"]
    gem = {pid: a["priority"] for pid, a in run["answers"].items()}
    n = len(profiles)
    with (PILOT / "results" / "comparison_by_group.csv").open(encoding="utf-8") as fh:
        comps = list(csv.DictReader(fh))
    with (PILOT / "results" / "composition.csv").open(encoding="utf-8") as fh:
        comp = list(csv.DictReader(fh))

    doc = Document()
    style_doc(doc, landscape=True)
    para(doc, "Manuscript Tables: VI-SPDAT and Gemini 3.5 Flash-Lite Housing Priority", bold=True,
         align=WD_ALIGN_PARAGRAPH.CENTER, space_after=4)
    para(doc, "Complete run: 100 synthetic profiles, one independent request per person, identical instructions, "
              "default settings. Gemini was not shown VI-SPDAT questions or scores.", size=11,
         align=WD_ALIGN_PARAGRAPH.CENTER, space_after=12)

    # 1. composition
    body, groups, last = [], [], None
    for r in comp:
        if r["characteristic"] != last:
            groups.append(len(body))
            body.append([r["characteristic"], "", ""])
            last = r["characteristic"]
        body.append(["    " + r["group"], r["n"], r["percent"]])
    apa_table(doc, 1, "Composition of the Synthetic Population (N = 100)", ["Characteristic", "n", "%"], body,
              note="VI-SPDAT circumstances are the 17 items of VI-SPDAT 2.0 for single adults; one person can meet "
                   "several. Each race has 10 women, 10 men, and 4 people in each city, with a similar mix of "
                   "VI-SPDAT need.", widths=[5.2, 0.8, 0.8], group_rows=groups)

    # 2. agreement
    ct = {(v, g): sum(p["vispdat"] == v and gem[p["id"]] == g for p in profiles) for v in CATS for g in CATS}
    same = sum(ct[(c, c)] for c in CATS)
    higher = sum(ct[(v, g)] for v in CATS for g in CATS if RANK[g] > RANK[v])
    lower = sum(ct[(v, g)] for v in CATS for g in CATS if RANK[g] < RANK[v])
    rv, rg = Counter(p["vispdat"] for p in profiles), Counter(gem.values())
    num = sum(abs(RANK[v] - RANK[g]) / 2 * ct[(v, g)] / n for v in CATS for g in CATS)
    den = sum(abs(RANK[v] - RANK[g]) / 2 * rv[v] / n * rg[g] / n for v in CATS for g in CATS)
    kappa = 1 - num / den
    body = [[f"VI-SPDAT {v}"] + [ct[(v, g)] for g in CATS] + [sum(ct[(v, g)] for g in CATS)] for v in CATS]
    body.append(["Total"] + [sum(ct[(v, g)] for v in CATS) for g in CATS] + [n])
    apa_table(doc, 2, "Priority Assigned by VI-SPDAT and by Gemini to the Same Profiles",
              ["", "Gemini High", "Gemini Medium", "Gemini Low", "Total"], body,
              note=f"Same category: {same} of {n} ({pct(same, n)}%). Gemini higher: {higher} ({pct(higher, n)}%). "
                   f"Gemini lower: {lower} ({pct(lower, n)}%). Linear-weighted Cohen's kappa = {kappa:.2f}. "
                   "VI-SPDAT categories: High = score 8-17, Medium = 4-7, Low = 0-3.",
              widths=[1.8, 1.2, 1.2, 1.2, 1.0])

    # 3. agreement summary
    body = [["Same category", same, pct(same, n)], ["Gemini higher than VI-SPDAT", higher, pct(higher, n)],
            ["Gemini lower than VI-SPDAT", lower, pct(lower, n)]]
    for c in CATS:
        k = sum(1 for p in profiles if p["vispdat"] == c)
        body.append([f"VI-SPDAT {c}: Gemini agrees", f"{ct[(c, c)]} of {k}", pct(ct[(c, c)], k)])
    apa_table(doc, 3, "Agreement Between VI-SPDAT and Gemini", ["Measure", "People", "%"], body,
              note=f"Linear-weighted Cohen's kappa = {kappa:.2f} (0 = chance agreement, 1 = perfect). Sign test on "
                   f"the {higher} disagreements, all in the same direction: p {fmt_p(stats['direction']['p_sign'])}.",
              widths=[3.4, 1.2, 1.0])

    # 4. by group (also the city table)
    header = ["Group", "n", "VI-SPDAT High\nn (%)", "Gemini High\nn (%)", "VI-SPDAT Medium\nn (%)",
              "Gemini Medium\nn (%)", "VI-SPDAT Low\nn (%)", "Gemini Low\nn (%)", "Same\nn (%)",
              "Gemini higher\nn (%)", "Gemini lower\nn (%)"]
    body, groups, last = [], [], None
    for r in comps:
        if r["characteristic"] != last:
            if r["characteristic"] != "All profiles":
                groups.append(len(body))
                body.append([r["characteristic"]] + [""] * 10)
            last = r["characteristic"]
        cell = lambda k: f"{r[k + '_n']} ({r[k + '_pct']})"  # noqa: E731
        label = r["group"] if r["characteristic"] == "All profiles" else "    " + r["group"]
        body.append([label, r["n"], cell("vispdat_high"), cell("gemini_high"), cell("vispdat_medium"),
                     cell("gemini_medium"), cell("vispdat_low"), cell("gemini_low"), cell("same"),
                     cell("gemini_higher"), cell("gemini_lower")])
    apa_table(doc, 4, "Priority by Group: VI-SPDAT and Gemini (including each city)", header, body, size=8,
              note="Percentages are within each group (row). Higher means Gemini placed the person in a higher "
                   "priority category than VI-SPDAT. Differences between groups describe the two approaches and "
                   "do not by themselves establish bias.",
              widths=[2.3, 0.4] + [0.65] * 9, group_rows=groups)

    # 5. demographic significance
    body = []
    for d in stats["demographics"]:
        for i, g in enumerate(d["groups"]):
            name = SHORT_RACE.get(g["group"], g["group"])
            body.append([d["factor"] if i == 0 else "", name, g["n"], g["upgraded"], pct(g["upgraded"], g["n"]),
                         fmt_p(d["p"]) if i == 0 else "", fmt_p(d["p_holm"]) if i == 0 else ""])
    apa_table(doc, 5, "Demographic Differences in Being Placed Above the VI-SPDAT Category",
              ["Factor", "Group", "n", "Placed higher", "%", "p", "Holm p"], body,
              note=f"Among the {stats['eligible']} people VI-SPDAT rated Low or Medium, {stats['upgraded']} were "
                   "placed higher by Gemini. Stratified permutation tests (labels shuffled within VI-SPDAT score, "
                   "20,000 shuffles); Holm correction across the four factors.",
              widths=[1.3, 2.9, 0.6, 1.1, 0.7, 0.8, 0.8])

    # 6. circumstance significance
    body = []
    for it in sorted(stats["items"], key=lambda x: x["p"]):
        w, wo = it["with"], it["without"]
        body.append([it["name"], f"{w['upgraded']}/{w['n']} ({pct(w['upgraded'], w['n'])})",
                     f"{wo['upgraded']}/{wo['n']} ({pct(wo['upgraded'], wo['n'])})", f"{100 * it['diff']:+.1f}",
                     fmt_p(it["p"]), fmt_p(it["p_holm"])])
    apa_table(doc, 6, "Circumstances and Being Placed Above the VI-SPDAT Category",
              ["Circumstance", "With: placed higher\nn/N (%)", "Without: placed higher\nn/N (%)",
               "Difference\n(points)", "p", "Holm p"], body,
              note=f"Among the {stats['eligible']} people VI-SPDAT rated Low or Medium: the share Gemini placed in a "
                   "higher category, with and without each circumstance. Stratified permutation tests within "
                   "VI-SPDAT score; Holm correction across the 16 circumstances.",
              widths=[3.2, 1.5, 1.5, 0.9, 0.7, 0.7])

    # 7. factor weights
    items = {i["id"]: i for i in data["instrument"]["items"]}
    up = {i["item"]: i for i in stats["items"]}
    body = []
    for f in sorted(fw["factors"], key=lambda x: -x["gemini_relative_weight"]):
        u = up.get(f["id"])
        body.append([f["factor"], f["people"], f"{f['gemini_urgency_points']:.1f} [{f['ci_low']:.1f}, {f['ci_high']:.1f}]",
                     f"{f['gemini_relative_weight']:.1f}", fmt_p(f["p_vs_zero"]), fmt_p(f["p_vs_zero_holm"]),
                     fmt_p(f["p_vs_average_holm"])])
    apa_table(doc, 7, "How Much Gemini Weighs Each VI-SPDAT Factor",
              ["Factor", "People", "Urgency points\n[95% CI]", "Weight vs.\nVI-SPDAT (1.0)", "p", "Holm p",
               "Holm p vs.\nequal weights"], body,
              note=f"Ordinary least squares of Gemini's 1-100 urgency rating on the 17 factors (n = {fw['n']}; "
                   f"R² = {fw['r_squared']:.2f}; HC3 standard errors). VI-SPDAT gives every factor 1 point, so "
                   "weight is each factor's points divided by the average. Tri-morbidity is negative because those people "
                   "already receive points for each of the three conditions it combines. Test that all weights are equal: "
                   f"F({fw['equal_weights_test']['df'][0]}, {fw['equal_weights_test']['df'][1]}) = "
                   f"{fw['equal_weights_test']['F']:.2f}, p {fmt_p(fw['equal_weights_test']['p'])}. Demographics "
                   f"added to the model: F({fw['demographics_test']['df'][0]}, {fw['demographics_test']['df'][1]}) = "
                   f"{fw['demographics_test']['F']:.2f}, p = {fmt_p(fw['demographics_test']['p'])}.",
              widths=[3.0, 0.8, 1.7, 1.3, 0.8, 0.8, 1.2])

    # 8. VI-SPDAT items
    body, groups, last = [], [], None
    for i in data["instrument"]["items"]:
        if i["domain"] != last:
            groups.append(len(body))
            body.append([i["domain"], "", "", ""])
            last = i["domain"]
        k = sum(i["id"] in p["indicators"] for p in profiles)
        body.append(["    " + i["name"], i["questions"], i["rule"], f"{k} ({pct(k, n)})"])
    apa_table(doc, 8, "VI-SPDAT Items and How Many of the 100 People Meet Each", ["Item", "Questions", "Scoring rule",
              "People meeting it\nn (%)"], body, size=8,
              note=f"Rules quoted from VI-SPDAT {data['instrument']['version']}, {data['instrument']['population']}. "
                   f"{data['instrument']['copyright']}", widths=[2.2, 2.4, 3.4, 1.0], group_rows=groups)

    # 9. every person
    body = [[p["id"], p["label"], p["age"], p["gender"], SHORT_RACE[p["race"]], p["location"].split(",")[0],
             p["score"], p["vispdat"], gem[p["id"]]] for p in profiles]
    apa_table(doc, 9, "All 100 People: VI-SPDAT and Gemini Priority", ["ID", "Person", "Age", "Gender", "Race",
              "City", "VI-SPDAT\nscore", "VI-SPDAT", "Gemini"], body, size=8, widths=[0.5, 2.6, 0.4, 0.7, 1.7, 1.1, 0.7, 0.8, 0.8])

    # 10. disagreements with explanations
    dis = sorted((p for p in profiles if gem[p["id"]] != p["vispdat"]), key=lambda p: (p["score"], int(p["id"][1:])))
    body = [[p["id"], f"{p['label']} ({p['age']}, {p['gender']}, {SHORT_RACE[p['race']]}, {p['location'].split(',')[0]})",
             p["score"], p["vispdat"], gem[p["id"]], run["answers"][p["id"]]["explanation"]] for p in dis]
    apa_table(doc, 10, f"The {len(dis)} People Gemini Placed Differently From VI-SPDAT, With Gemini's Explanation",
              ["ID", "Person", "Score", "VI-SPDAT", "Gemini", "Gemini's explanation"], body, size=8,
              widths=[0.5, 2.4, 0.5, 0.8, 0.8, 4.0])

    out = PILOT / "exports" / "manuscript_tables_gemini-3.5-flash-lite.docx"
    doc.save(out)
    print(out)


if __name__ == "__main__":
    main()
