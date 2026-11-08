"""
Appendix for the limited places paper (APA 7 style, Times New Roman).

  Appendix A  VI-SPDAT 2.0 items and scoring rules, and the score bands
  Appendix B  the exact prompt sent to Gemini in every round (limited places)
  Appendix C  overview of the 100 synthetic people
  Appendix D  every person's full case summary (11 sections), exactly as Gemini received it,
              with the VI-SPDAT items it meets and the resulting score

Run:  python pilot/scripts/export_limited_appendix.py
Writes: pilot/exports/limited_places_appendix.docx
"""

import json
import sys
from pathlib import Path

from docx import Document
from docx.enum.section import WD_ORIENT, WD_SECTION
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches, Pt

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyze import apa_table, para, style_doc  # noqa: E402
from export_review_sheet import CITY, ORDER, RACE, SHORT  # noqa: E402
from gemini_prompt import SECTION_TITLES  # noqa: E402
from run_gemini_pool import REPLY_FORMAT, instructions  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
PILOT = ROOT / "pilot"
PLACES = {"High": 35, "Medium": 40, "Low": 25}


def heading(doc, text, sub):
    para(doc, text, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=0)
    para(doc, sub, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=12)


def mono(doc, text):
    for line in text.split("\n"):
        q = doc.add_paragraph()
        q.paragraph_format.space_after = Pt(0)
        q.paragraph_format.left_indent = Inches(0.4)
        r = q.add_run(line)
        r.font.name, r.font.size = "Courier New", Pt(9)


def priority(score):
    return "High" if score >= 8 else "Medium" if score >= 4 else "Low"


def main():
    inst = json.loads((ROOT / "data" / "vispdat_instrument.json").read_text(encoding="utf-8"))
    profiles = json.loads((PILOT / "data" / "profiles.json").read_text(encoding="utf-8"))["profiles"]
    profiles.sort(key=lambda p: int(p["id"][1:]))
    names = {i["id"]: i["name"] for d in inst["domains"] for i in d["indicators"]}
    n = len(profiles)
    doc = Document()
    style_doc(doc)

    # ---------------- Appendix A
    heading(doc, "Appendix A", "VI-SPDAT Items, Scoring Rules, and Score Bands")
    body, groups = [], []
    for d in inst["domains"]:
        groups.append(len(body))
        title = d["name"] if d["key"] == "pre" else f"{d['letter']}. {d['name']}"
        body.append([f"{title} (max {d['max']})", "", "", ""])
        for i in d["indicators"]:
            k = sum(i["id"] in p["indicators"] for p in profiles)
            body.append(["    " + i["name"], i["questions"], i["rule"], f"{k} ({100 * k / n:.0f}%)"])
    apa_table(doc, "A1", "VI-SPDAT 2.0 (Single Adults) Scoring Items",
              ["Item", "Questions", "Scoring rule", "People meeting it, n (%)"], body, size=9,
              widths=[1.7, 0.8, 3.0, 1.0], group_rows=groups,
              note=f"Rules are quoted from the VI-SPDAT American Version 2.0 for single adults ({inst['copyright']}). "
                   f"Each item met scores 1 point; maximum 17. N = {n}.")
    body = []
    pri = {1: "Low", 2: "Medium", 3: "High"}
    for b in inst["bands"]:
        k = sum(b["min"] <= len(p["indicators"]) <= b["max"] for p in profiles)
        body.append([f"{b['min']}-{b['max']}", b["action"], pri[b["id"]], f"{k} ({100 * k / n:.0f}%)"])
    apa_table(doc, "A2", "VI-SPDAT Score Bands and the Places Available in Each Category",
              ["Score", "VI-SPDAT recommendation", "Priority category", "People, n (%)"], body, size=10,
              widths=[0.8, 3.3, 1.2, 1.2],
              note=f"The limited places study offers {PLACES['High']} High places and {PLACES['Medium']} Medium places; the other "
                   f"{PLACES['Low']} people receive neither. These equal the numbers VI-SPDAT's bands assign to these 100 people.")

    # ---------------- Appendix B
    doc.add_page_break()
    heading(doc, "Appendix B", "Prompt Sent to Gemini in Every Round")
    para(doc, "Each of the 10 rounds was one request to Gemini 3.8 Flash containing the text below, with all 100 case "
              "summaries in a new random order under new applicant numbers (1 to 100). Nothing else was sent: no system "
              "instruction, no earlier rounds, and no VI-SPDAT questions, items, rules, or scores. Case titles and profile IDs "
              "were never shown.", size=11, space_after=8)
    mono(doc, instructions(PLACES))
    doc.add_paragraph().paragraph_format.space_after = Pt(0)
    mono(doc, "Applicant 1\nAge [age]. Gender: [gender]. Race: [race]. Location: [city].\n\n" +
         "\n".join(f"{t}: [text]" for _, t in SECTION_TITLES))
    doc.add_paragraph().paragraph_format.space_after = Pt(0)
    mono(doc, "[Applicants 2 to 100 in the same format]")
    doc.add_paragraph().paragraph_format.space_after = Pt(0)
    mono(doc, REPLY_FORMAT)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)
    para(doc, "A reply was accepted only if it was valid JSON, assigned every applicant exactly once, and used exactly "
              f"{PLACES['High']} High, {PLACES['Medium']} Medium, and {PLACES['Low']} Low. All 10 rounds were accepted on the "
              "first attempt.", size=11)

    # ---------------- Appendix C (landscape)
    sec = doc.add_section(WD_SECTION.NEW_PAGE)
    sec.orientation = WD_ORIENT.LANDSCAPE
    sec.page_width, sec.page_height = sec.page_height, sec.page_width
    heading(doc, "Appendix C", "The 100 Synthetic People")
    body = []
    for p in profiles:
        s = len(p["indicators"])
        body.append([p["id"], p["age"],
                     "F" if p["gender"] == "Female" else "M", RACE[p["race"]], CITY[p["location"]], s, priority(s),
                     ", ".join(SHORT[i] for i in ORDER if i in p["indicators"]) or "none"])
    apa_table(doc, "C1", "Overview of the 100 People (Full Case Summaries in Appendix D)",
              ["ID", "Age", "Gender", "Race", "City", "Score", "Priority", "VI-SPDAT items met"], body, size=8,
              widths=[0.45, 0.4, 0.55, 0.6, 0.45, 0.45, 0.6, 5.5],
              note="F = female; M = male. AIAN = American Indian, Alaska Native, or Indigenous; Asian = Asian or "
                   "Asian American; Black = Black, African American, or African; Hisp = Hispanic/Latino/e/a. Cities: LA = Los "
                   "Angeles, Cin = Cincinnati, Chi = Chicago, Atl = Atlanta, NYC = New York City. Item names are shortened from "
                   "Table A1.")

    # ---------------- Appendix D (portrait)
    sec = doc.add_section(WD_SECTION.NEW_PAGE)
    sec.orientation = WD_ORIENT.PORTRAIT
    sec.page_width, sec.page_height = sec.page_height, sec.page_width
    heading(doc, "Appendix D", "Case Summaries")
    para(doc, "Each case summary is reproduced exactly as Gemini received it: a demographic line followed by 11 sections. "
              "The ID and title are for reference only; Gemini never saw them. Below each summary are the VI-SPDAT items it "
              "meets, which determine the score.", size=11, space_after=10)
    for k, p in enumerate(profiles):
        s = len(p["indicators"])
        h = doc.add_paragraph()
        h.paragraph_format.space_before = Pt(10 if k else 0)
        h.paragraph_format.space_after = Pt(2)
        h.paragraph_format.keep_with_next = True
        r = h.add_run(f"{p['id']}. {p['label']}")
        r.bold, r.font.size = True, Pt(12)
        dl = doc.add_paragraph()
        dl.paragraph_format.space_after = Pt(4)
        dl.paragraph_format.keep_with_next = True
        rr = dl.add_run(p["demographic_line"])
        rr.italic, rr.font.size = True, Pt(11)
        for key, title in SECTION_TITLES:
            q = doc.add_paragraph()
            q.paragraph_format.space_after = Pt(2)
            q.paragraph_format.left_indent = Inches(0.25)
            a = q.add_run(f"{title}: ")
            a.bold, a.font.size = True, Pt(10.5)
            b = q.add_run(p["narrative"][key])
            b.font.size = Pt(10.5)
        q = doc.add_paragraph()
        q.paragraph_format.space_after = Pt(6)
        q.paragraph_format.left_indent = Inches(0.25)
        a = q.add_run(f"VI-SPDAT: score {s} of 17 ({priority(s)}). ")
        a.bold, a.font.size = True, Pt(10.5)
        items = [names[i] for i in ORDER if i in p["indicators"]]
        b = q.add_run("Items met: " + (", ".join(items) if items else "none") + ".")
        b.font.size = Pt(10.5)

    for t in doc.tables:
        for row in t.rows:
            for c in row.cells:
                for q in c.paragraphs:
                    q.paragraph_format.space_after = Pt(0)
    out = PILOT / "exports" / "limited_places_appendix.docx"
    doc.save(out)
    print(f"wrote {out.relative_to(ROOT)} ({n} people)")


if __name__ == "__main__":
    main()
