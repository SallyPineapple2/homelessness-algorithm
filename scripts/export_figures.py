"""
Export the key results as APA 7 figures for the paper.

Figure 1  Accuracy against true vulnerability (mean absolute error, correct triage band)
Figure 2  Triage: share flagged high-need against the true share, and cases missed
Figure 3  Bias: paired differences with 95% confidence intervals

APA 7 style: grayscale (readable in print and by color-blind readers), Times New Roman to
match the paper, no chart
titles inside the image (the number and title go above it in the paper), tools identified by
axis labels rather than color, and a Note under each figure. Every value is read from
data/ai_results.json, the same file the dashboard uses.

Writes: exports/figures/figure1_accuracy.png, figure2_triage.png, figure3_bias.png (300 dpi)
        exports/figures.docx (the three figures laid out in APA format, ready to paste)
Run:    python scripts/export_figures.py
"""

import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from docx import Document
from docx.shared import Inches, Pt

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "exports"
FIG = OUT / "figures"
FIG.mkdir(parents=True, exist_ok=True)

data = json.loads((ROOT / "data" / "ai_results.json").read_text(encoding="utf-8"))
tools = [("VI-SPDAT", data["vispdat"])] + [(m["label"], m) for m in data["models"] if m.get("instances_scored")]
names = [t[0] for t in tools]
n_ai = len(tools) - 1

plt.rcParams.update({
    "font.family": "Times New Roman", "font.size": 10, "axes.spines.top": False, "axes.spines.right": False,
    "axes.edgecolor": "black", "axes.linewidth": 0.8, "xtick.color": "black", "ytick.color": "black",
    "savefig.dpi": 300, "savefig.bbox": "tight",
})
# VI-SPDAT in black, the AI runs in one mid gray: identity comes from the axis labels
fills = ["black"] + ["0.6"] * n_ai


def hbar(ax, values, fmt, xlabel, xmax=None, ref=None, ref_label=None):
    y = list(range(len(values)))[::-1]
    ax.barh(y, values, color=fills, edgecolor="black", linewidth=0.6, height=0.6)
    span = xmax or max(values)
    for yi, v, fill in zip(y, values, fills):
        # a label that would sit on the reference line goes inside the end of its bar instead
        if ref is not None and v < ref < v + span * 0.12:
            ax.text(v - span * 0.015, yi, fmt(v), va="center", ha="right", fontsize=9, zorder=3,
                    color="white" if fill == "black" else "black")
        else:
            ax.text(v + span * 0.015, yi, fmt(v), va="center", fontsize=9, zorder=3)
    ax.set_yticks(y)
    ax.set_yticklabels(names)
    ax.set_xlim(0, (xmax or max(values)) * 1.15)
    ax.set_xlabel(xlabel)
    ax.tick_params(axis="y", length=0)
    if ref is not None:
        ax.axvline(ref, color="black", linestyle="--", linewidth=1, zorder=1)
        ax.text(ref, len(values) - 0.35, ref_label, ha="center", va="bottom", fontsize=9)


def panel_label(ax, letter):
    ax.text(-0.02, 1.06, letter, transform=ax.transAxes, fontsize=11, fontweight="bold", ha="right")


# ---------------- Figure 1: accuracy ----------------
fig, axes = plt.subplots(1, 2, figsize=(7.5, 2.8))
hbar(axes[0], [d["accuracy"]["all"]["mae"] for _, d in tools], lambda v: f"{v:.2f}",
     "Mean absolute error (points, 0–17 scale)")
hbar(axes[1], [100 * d["accuracy"]["all"]["band_agreement"] for _, d in tools], lambda v: f"{v:.0f}%",
     "Placed in the correct triage band (%)", xmax=100)
axes[1].set_yticklabels([])
panel_label(axes[0], "A")
panel_label(axes[1], "B")
fig.tight_layout(w_pad=2)
fig.savefig(FIG / "figure1_accuracy.png")
plt.close(fig)

# ---------------- Figure 2: triage ----------------
flag = [d["triage"]["psh_flagging"] for _, d in tools]
truth = 100 * flag[0]["truly_share"]
fig, axes = plt.subplots(1, 2, figsize=(7.5, 2.8))
hbar(axes[0], [100 * f["flagged_share"] for f in flag], lambda v: f"{v:.0f}%",
     "Flagged high-need (%)", xmax=100, ref=truth, ref_label=f"True: {truth:.0f}%")
hbar(axes[1], [f["missed"] for f in flag], lambda v: f"{v:.0f}",
     f"Truly high-need cases missed (of {flag[0]['truly']})")
axes[1].set_yticklabels([])
panel_label(axes[0], "A")
panel_label(axes[1], "B")
fig.tight_layout(w_pad=2)
fig.savefig(FIG / "figure2_triage.png")
plt.close(fig)

# ---------------- Figure 3: bias ----------------
def test(d, fam):
    return [t for t in d["tests"] if t["family"] == fam and t["mean_diff"] is not None]


def worst(ts):
    return max(ts, key=lambda t: abs(t["mean_diff"]))


measures = [
    ("Underdisclosure vs. full disclosure", lambda d: test(d, "disclosure")[0]),
    ("Female vs. male", lambda d: test(d, "gender")[0]),
    ("Largest race gap vs. White", lambda d: worst(test(d, "race"))),
    ("Largest city effect", lambda d: worst(test(d, "location"))),
]
fig, axes = plt.subplots(2, 2, figsize=(7.5, 5.2))
axes = axes.flatten()
for k, (ax, (title, get)) in enumerate(zip(axes, measures)):
    ys = list(range(len(tools)))[::-1]
    for yi, (_, d) in zip(ys, tools):
        t = get(d)
        lo, hi, m = t["ci_low"], t["ci_high"], t["mean_diff"]
        ax.plot([lo, hi], [yi, yi], color="black", linewidth=1.2)
        ax.plot(m, yi, marker="o", markersize=6, markeredgecolor="black", markeredgewidth=1.2,
                markerfacecolor="black" if t["significant_holm"] else "white", linestyle="none")
    ax.axvline(0, color="black", linestyle=":", linewidth=1)
    lim = max(0.5, max(max(abs(get(d)["ci_low"] or 0), abs(get(d)["ci_high"] or 0)) for _, d in tools) * 1.15)
    ax.set_xlim(-lim, lim)
    ax.set_title(title, fontsize=10, loc="left", pad=8)
    ax.set_yticks(ys)
    ax.set_yticklabels(names if k % 2 == 0 else [])
    ax.tick_params(axis="y", length=0)
    ax.set_xlabel("Difference (points)", fontsize=9)
    ax.text(-0.02, 1.02, "ABCD"[k], transform=ax.transAxes, fontsize=11, fontweight="bold", ha="right", va="bottom")
fig.tight_layout(w_pad=1.5, h_pad=2)
fig.savefig(FIG / "figure3_bias.png")
plt.close(fig)

# ---------------- Word file, APA 7 layout ----------------
doc = Document()
for side in ("left_margin", "right_margin", "top_margin", "bottom_margin"):
    setattr(doc.sections[0], side, Inches(1))
doc.styles["Normal"].font.name = "Times New Roman"
doc.styles["Normal"].font.size = Pt(12)


def figure(number, title, image, note):
    p = doc.add_paragraph()
    p.add_run(f"Figure {number}").bold = True
    p.paragraph_format.space_after = Pt(0)
    p = doc.add_paragraph()
    p.add_run(title).italic = True
    p.paragraph_format.space_after = Pt(6)
    doc.add_picture(str(image), width=Inches(6.5))
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(6)
    p.add_run("Note. ").italic = True
    p.add_run(note)
    doc.add_paragraph()


ai_names = ", ".join(names[1:])
figure(1, "Accuracy of Each Tool Against True Vulnerability", FIG / "figure1_accuracy.png",
       f"Each tool scored the same 640 synthetic intake records. True vulnerability is the profile's "
       f"VI-SPDAT total under full disclosure, so the VI-SPDAT is exact on fully disclosed records by "
       f"construction. (A) Mean absolute difference between assigned and true score; lower is better. "
       f"(B) Share of records placed in the same triage band as the true score. VI-SPDAT is shown in "
       f"black; the AI runs ({ai_names}) in gray.")
figure(2, "Records Flagged as High-Need and High-Need Records Missed", FIG / "figure2_triage.png",
       f"High-need is the Permanent Supportive Housing band (score 8–17). (A) Share of the 640 records "
       f"each tool placed in that band; the dashed line marks the share that is truly high-need "
       f"({truth:.0f}%). (B) Truly high-need records placed in a lower band. All {flag[0]['missed']} "
       f"records the VI-SPDAT missed were underdisclosure cases.")
figure(3, "Paired Differences in Assigned Score by Disclosure, Gender, Race, and City",
       FIG / "figure3_bias.png",
       "Points are mean paired differences within base profile; horizontal lines are 95% confidence "
       "intervals. Filled points are significant after Holm adjustment across the ten demographic "
       "tests (α = .05); open points are not. For race and city, the comparison with the largest "
       "absolute difference is shown for each tool. The VI-SPDAT does not use race, gender, or city, "
       "so its demographic differences are zero by construction.")
doc.save(OUT / "figures.docx")
print("wrote exports/figures/figure1_accuracy.png, figure2_triage.png, figure3_bias.png and exports/figures.docx")
