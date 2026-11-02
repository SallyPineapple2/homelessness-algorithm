"""
Manuscript tables for the limited-places study (Gemini 3.8 Flash, fixed numbers of places).

Main scenario: 35 High / 40 Medium / 25 Low. Check: 15 / 25 / 60 (scarcer places).
Reads pilot/results/pool_gemini-3.8-flash[-h15m25].json (analyze_pool.py);
writes pilot/exports/manuscript_tables_limited_places.docx.
"""

import json
import sys
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyze import apa_table, para, style_doc  # noqa: E402

PILOT = Path(__file__).resolve().parents[1]
CATS = ["High", "Medium", "Low"]
SHORT = {"American Indian, Alaska Native, or Indigenous": "American Indian / Alaska Native",
         "Asian or Asian American": "Asian", "Black, African American, or African": "Black",
         "Hispanic/Latino/e/a": "Hispanic / Latino", "White": "White"}


def fp(p):
    return "< .001" if p < 0.001 else f"{p:.3f}".lstrip("0")


def f1(x):
    return str(int(round(x))) if abs(x - round(x)) < 0.05 else f"{x:.1f}"


def pc(x):
    return f"{100 * x:.0f}"


def load(tag):
    return json.loads((PILOT / "results" / f"pool_gemini-3.8-flash{tag}.json").read_text(encoding="utf-8"))


def main():
    A, B = load(""), load("-h15m25")  # main, check
    doc = Document()
    style_doc(doc, landscape=True)
    para(doc, "Manuscript Tables: Housing Priority With Limited Places (Gemini 3.8 Flash)", bold=True,
         align=WD_ALIGN_PARAGRAPH.CENTER, space_after=4)
    para(doc, f"Main scenario: {A['places']['High']} High, {A['places']['Medium']} Medium, {A['places']['Low']} Low "
              f"({A['rounds']} rounds). Check: {B['places']['High']} / {B['places']['Medium']} / {B['places']['Low']} "
              f"({B['rounds']} rounds). Each round is one request containing all 100 applicants in a new random order.",
         size=11, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=12)
    sc_note = ("Main scenario: 35 High, 40 Medium, 25 Low places (the numbers VI-SPDAT assigns to these 100 people). "
               "Check: 15 High, 25 Medium, 60 Low.")

    # 1. agreement by round
    body = []
    for k in range(max(A["rounds"], B["rounds"])):
        row = [k + 1]
        for S in (A, B):
            r = S["per_round"][k] if k < S["rounds"] else None
            row += [f1(r["same"]), f1(r["higher"]), f1(r["lower"]), f"{r['kappa']:.2f}"] if r else ["", "", "", ""]
        body.append(row)
    mean_row = ["Mean"]
    for S in (A, B):
        pr = S["per_round"]
        mean_row += [f1(sum(r["same"] for r in pr) / len(pr)), f1(sum(r["higher"] for r in pr) / len(pr)),
                     f1(sum(r["lower"] for r in pr) / len(pr)), f"{sum(r['kappa'] for r in pr) / len(pr):.2f}"]
    body.append(mean_row)
    apa_table(doc, 1, "Agreement Between VI-SPDAT and Gemini in Each Round",
              ["Round", "Main: same", "Main: Gemini higher", "Main: Gemini lower", "Main: kappa",
               "Check: same", "Check: Gemini higher", "Check: Gemini lower", "Check: kappa"], body,
              note=f"People out of 100. {sc_note} Kappa is linear-weighted Cohen's kappa. Both approaches fill the same "
                   "places, so Gemini places about as many people below VI-SPDAT as above it.",
              widths=[0.8] + [1.0] * 8)

    # 2. crosstab
    body = []
    for name, S in (("Main scenario (35 / 40 / 25)", A), ("Check (15 / 25 / 60)", B)):
        ct = S["consensus_crosstab_vispdat_to_gemini"]
        body.append([name, "", "", "", ""])
        for a in CATS:
            tot = sum(ct[f"{a}->{b}"] for b in CATS)
            body.append([f"    VI-SPDAT {a}"] + [f1(ct[f"{a}->{b}"]) for b in CATS] + [f1(tot)])
    apa_table(doc, 2, "Priority Assigned by VI-SPDAT and by Gemini to the Same People",
              ["", "Gemini High", "Gemini Medium", "Gemini Low", "Total"], body,
              note="Gemini's rounds are combined by ranking people on how often they were placed in a higher category "
                   "and filling the same places; counts can be fractions where people tie at a cut-off.",
              widths=[2.6, 1.2, 1.2, 1.2, 1.0], group_rows=(0, 4))

    # 3. stability
    body = []
    for name, S in (("Main (35 / 40 / 25)", A), ("Check (15 / 25 / 60)", B)):
        rr = S["round_to_round_same_category"]
        body.append([name, S["rounds"], S["same_category_in_every_round"], S["high_in_every_round"],
                     f"{f1(rr['mean'])} ({rr['min']}-{rr['max']})"])
    apa_table(doc, 3, "Stability of Gemini's Allocation Across Rounds",
              ["Scenario", "Rounds", "People with the same category in every round", "People High in every round",
               "Two rounds agree on (mean, range)"], body,
              note="Counts are people out of 100. Rounds differ only in the order of the applicants.",
              widths=[2.2, 0.8, 2.4, 1.8, 2.0])

    # 4-5. circumstances
    for num, name, S in ((4, "Main Scenario (35 / 40 / 25)", A), (5, "Check (15 / 25 / 60)", B)):
        tests = {t["factor"]: t for t in S["tests"] if t["family"] == "circumstance"}
        body = []
        for f, t in sorted(tests.items(), key=lambda kv: kv[1]["p"]):
            d = S["circumstances"][f]
            body.append([f, d["n"], pc(d["observed"]), pc(d["expected"]), f"{100 * (d['observed'] - d['expected']):+.0f}",
                         fp(t["p"]), fp(t["p_holm"])])
        apa_table(doc, num, f"Circumstances and Who Receives a High Place: {name}",
                  ["Circumstance", "n", "High in Gemini's rounds (%)", "Expected from VI-SPDAT score (%)",
                   "Difference (points)", "p", "Holm p"], body,
                  note="Share of rounds in which people with the circumstance were placed High, against the share expected "
                       "for people with the same VI-SPDAT scores. Stratified permutation tests (labels shuffled within "
                       "VI-SPDAT score, 20,000 shuffles); Holm correction across 16 circumstances.",
                  widths=[3.4, 0.5, 1.5, 1.7, 1.2, 0.7, 0.7])

    # 6. factor effects, both scenarios
    ea = {e["id"]: e for e in A["factor_effects"]}
    eb = {e["id"]: e for e in B["factor_effects"]}
    body = []
    for i, e in sorted(ea.items(), key=lambda kv: -kv[1]["effect"]):
        g = eb.get(i)
        cell = lambda x: [f"{100 * x['effect']:+.1f} [{100 * x['ci_low']:.1f}, {100 * x['ci_high']:.1f}]", fp(x["p"]), fp(x["p_holm"])]  # noqa: E731
        body.append([e["name"], e["people"]] + cell(e) + (cell(g) if g else ["", "", ""]))
    apa_table(doc, 6, "How Much Each VI-SPDAT Factor Changes the Chance of a High Place",
              ["Factor", "People", "Main: change in points [95% CI]", "Main: p", "Main: Holm p",
               "Check: change in points [95% CI]", "Check: p", "Check: Holm p"], body, size=8,
              note=f"Linear regression of how often each person was placed High (share of rounds) on the 17 factors, HC3 "
                   f"standard errors. R² = {A['r2_factors']:.2f} (VI-SPDAT score alone: {A['r2_score_only']:.2f}) in the "
                   f"main scenario and {B['r2_factors']:.2f} ({B['r2_score_only']:.2f}) in the check. VI-SPDAT counts every "
                   "factor equally. Exploratory: only large effects can be detected with 100 people.",
              widths=[2.6, 0.6, 1.6, 0.6, 0.8, 1.6, 0.6, 0.8])

    # 7-8. demographics
    for num, name, S in ((7, "Main Scenario (35 / 40 / 25)", A), (8, "Check (15 / 25 / 60)", B)):
        body, groups = [], []
        for t in (t for t in S["tests"] if t["family"] == "demographic"):
            groups.append(len(body))
            body.append([t["factor"], "", "", "", "", "", fp(t["p"]), fp(t["p_holm"])])
            for g in (g for g in S["groups"] if g["factor"] == t["factor"]):
                grp = SHORT.get(g["group"], g["group"].split(",")[0] if t["factor"] == "City" else g["group"])
                body.append(["    " + grp, g["n"], f1(g["vispdat_high"]), f1(g["gemini_high"]), f1(g["vispdat_medium"]),
                             f1(g["gemini_medium"]), "", ""])
        apa_table(doc, num, f"Who Gets the Places, by Group: {name}",
                  ["Group", "n", "VI-SPDAT High places", "Gemini High places", "VI-SPDAT Medium places",
                   "Gemini Medium places", "p", "Holm p"], body,
                  note="Places are counts of people; Gemini's are averaged over rounds. p values test whether a group's High "
                       "places differ from what its VI-SPDAT scores predict (stratified permutation, 20,000 shuffles, Holm "
                       "correction across the four factors). With groups of about 13-33 people only large differences can be "
                       "detected.",
                  widths=[2.6, 0.5, 1.3, 1.3, 1.4, 1.4, 0.7, 0.7], group_rows=groups)

    out = PILOT / "exports" / "manuscript_tables_limited_places.docx"
    doc.save(out)
    print(out)


if __name__ == "__main__":
    main()
