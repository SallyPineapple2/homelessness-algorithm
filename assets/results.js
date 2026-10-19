/* ============================================================
   Results — VI-SPDAT beside each AI model

   Reads two payloads loaded in dashboard.js:
     RESULTS  data/vispdat_results.json  (VI-SPDAT on all 3,200 instances)
     AI       data/ai_results.json       (VI-SPDAT and each AI model on the
                                          same 640 paste-design instances)
   Shared helpers (css, makeSvg, barPath, drawGrid, drawYTicks, renderLegend,
   showTip/moveTip/hideTip, MAX_BAR, GAP, RADIUS) come from dashboard.js.

   Charts compare VI-SPDAT (categorical slot 1) with ONE selected AI model
   (slot 2). Comparisons across every model live in tables, which scale past
   the series cap without generating extra hues. Diverging encodings use the
   blue <-> red pair with a neutral gray midpoint.
   ============================================================ */

let AI = null;
let activeModel = null;
let activeFactor = "race";
let triageFactor = "race";
let mapMetric = "effect";
let labelView = "current";
let usMapPromise = null;

const FACTORS = [
  { key: "race", label: "Race", title: "race and ethnicity", means: "means_by_race" },
  { key: "gender", label: "Gender", title: "gender", means: "means_by_gender" },
  { key: "location", label: "Location", title: "location", means: "means_by_location" },
  { key: "disclosure", label: "Disclosure", title: "disclosure condition", means: "means_by_disclosure" }
];

const SHORT_LABEL = {
  "American Indian, Alaska Native, or Indigenous": "Am. Indian, Alaska\nNative, or Indigenous",
  "Asian or Asian American": "Asian or\nAsian American",
  "Black, African American, or African": "Black, African\nAmerican, or African",
  "Hispanic/Latino/e/a": "Hispanic/\nLatino/e/a",
  "Los Angeles, California": "Los Angeles,\nCalifornia",
  "Cincinnati, Ohio": "Cincinnati,\nOhio",
  "Chicago, Illinois": "Chicago,\nIllinois",
  "Atlanta, Georgia": "Atlanta,\nGeorgia",
  "New York City, New York": "New York City,\nNew York",
  "Full disclosure": "Full\ndisclosure",
  "Underdisclosure": "Under-\ndisclosure"
};

const SHORT_RACE = {
  "American Indian, Alaska Native, or Indigenous": "Am. Indian / AK Native",
  "Asian or Asian American": "Asian",
  "Black, African American, or African": "Black",
  "Hispanic/Latino/e/a": "Hispanic / Latino",
  White: "White"
};

const CITY_COORDS = {
  "Los Angeles, California": [-118.2437, 34.0522],
  "Cincinnati, Ohio": [-84.512, 39.1031],
  "Chicago, Illinois": [-87.6298, 41.8781],
  "Atlanta, Georgia": [-84.388, 33.749],
  "New York City, New York": [-74.006, 40.7128]
};

// Callout offsets from each city's exact position; they keep the Midwest pair and the coast apart.
const CITY_CALLOUT = {
  "Los Angeles, California": { dx: 24, dy: 74, anchor: "start", short: "Los Angeles" },
  "Cincinnati, Ohio": { dx: 30, dy: 66, anchor: "start", short: "Cincinnati" },
  "Chicago, Illinois": { dx: -30, dy: -66, anchor: "end", short: "Chicago" },
  "Atlanta, Georgia": { dx: -30, dy: 70, anchor: "end", short: "Atlanta" },
  "New York City, New York": { dx: -10, dy: -84, anchor: "middle", short: "New York" }
};

const MAP_METRICS = [
  {
    value: "effect", label: "City effect",
    description: "city minus the other four cities"
  },
  {
    value: "gender_gap", label: "Gender gap in city",
    description: "female minus male, within city"
  },
  {
    value: "disclosure_penalty", label: "Underdisclosure penalty in city",
    description: "underdisclosure minus full, within city"
  }
];

const DEMOGRAPHIC_FAMILIES = ["race", "gender", "location"];

/* ---------- selection helpers ---------- */

const hasData = (m) => Boolean(m && m.instances_scored > 0);
const selectedModel = () => (AI ? AI.models.find((m) => m.key === activeModel) : null) || null;
const arm = () => (hasData(selectedModel()) ? selectedModel() : null);
const modelName = () => (selectedModel() ? selectedModel().label : "AI model");

function levelsFor(factorKey) {
  if (factorKey === "race") return AI.races;
  if (factorKey === "location") return AI.locations;
  if (factorKey === "gender") return AI.genders;
  return ["Full disclosure", "Underdisclosure"];
}

function shortComparison(c) {
  return c
    .replace("American Indian, Alaska Native, or Indigenous", "Am. Indian / AK Native")
    .replace("Asian or Asian American", "Asian")
    .replace("Black, African American, or African", "Black")
    .replace("Hispanic/Latino/e/a", "Hispanic / Latino")
    .replace(/, (California|Ohio|Illinois|Georgia|New York)(?= vs\.)/, "")
    .replace("Underdisclosure vs. full disclosure", "Underdisclosure vs. full");
}

/* ---------- number formatting ---------- */

const fmt = (v, digits) => (v === null || v === undefined ? "—" : Number(v).toFixed(digits));
const fmtP = (p) => (p === null || p === undefined ? "—" : p < 0.001 ? "<0.001" : Number(p).toFixed(3));
const fmtT = (t) => (t === null || t === undefined ? "n/a" : Number(t).toFixed(2));
const fmtPct = (v) => (v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`);
const fmtPct1 = (v) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`);
function fmtSigned(v, digits) {
  if (v === null || v === undefined) return "—";
  const s = Math.abs(v).toFixed(digits);
  if (Number(s) === 0) return s;
  return (v > 0 ? "+" : "−") + s;
}
const fmtCI = (t) =>
  t && t.ci_low !== null && t.ci_low !== undefined ? `[${fmtSigned(t.ci_low, 2)}, ${fmtSigned(t.ci_high, 2)}]` : "—";

function widthOf(selector, min = 560, max = 920) {
  const el = document.querySelector(selector);
  return Math.max(min, Math.min(max, (el && el.clientWidth) || 720));
}

const diverging = (m) =>
  d3.scaleLinear()
    .domain([-m, 0, m])
    .range([css("--div-neg"), css("--div-mid"), css("--div-pos")])
    .interpolate(d3.interpolateLab)
    .clamp(true);

// Numbers printed on a colored cell take whichever ink reads against it.
const inkOn = (color) => (d3.lab(color).l > 62 ? "#0b0b0b" : "#ffffff");

/* ---------- shared UI pieces ---------- */

function chipGroup(selector, options, active, onPick) {
  const wrap = d3.select(selector);
  wrap.selectAll("*").remove();
  options.forEach((o) => {
    const btn = wrap
      .append("button")
      .attr("class", "chip" + (o.empty ? " is-empty" : ""))
      .attr("type", "button")
      .attr("aria-pressed", o.value === active)
      .on("click", () => onPick(o.value));
    btn.append("span").text(o.label);
    if (o.count) btn.append("span").attr("class", "chip-count").text(o.count);
  });
}

function markLegend(selector, items) {
  const el = d3.select(selector);
  el.selectAll("*").remove();
  items.forEach((it) => {
    const row = el.append("span").attr("class", "legend-item");
    if (it.kind === "text") {
      row.append("span").attr("class", "grad-caption").text(it.name);
      return;
    }
    const svg = row.append("svg").attr("width", 22).attr("height", 12).attr("aria-hidden", "true");
    if (it.kind === "line") {
      svg.append("line").attr("x1", 1).attr("x2", 21).attr("y1", 6).attr("y2", 6)
        .attr("stroke", it.color).attr("stroke-width", 2).attr("stroke-dasharray", it.dash || null);
    } else if (it.kind === "dot") {
      svg.append("circle").attr("cx", 11).attr("cy", 6).attr("r", 4.5).attr("fill", it.color);
    } else if (it.kind === "ring") {
      svg.append("circle").attr("cx", 11).attr("cy", 6).attr("r", 4).attr("fill", "none")
        .attr("stroke", it.color).attr("stroke-width", 2);
    } else if (it.kind === "tick") {
      svg.append("line").attr("x1", 11).attr("x2", 11).attr("y1", 0).attr("y2", 12)
        .attr("stroke", it.color).attr("stroke-width", 2);
    } else if (it.kind === "range") {
      svg.append("line").attr("x1", 2).attr("x2", 20).attr("y1", 6).attr("y2", 6)
        .attr("stroke", it.color).attr("stroke-width", 2).attr("stroke-opacity", 0.45);
    } else if (it.kind === "blank") {
      svg.append("rect").attr("x", 5).attr("y", 1).attr("width", 11).attr("height", 10).attr("rx", 2)
        .attr("class", "blank-bar");
    } else {
      svg.append("rect").attr("x", 5).attr("y", 1).attr("width", 11).attr("height", 10).attr("rx", 2)
        .attr("fill", it.color);
    }
    row.append("span").text(it.name);
  });
}

function gradientLegend(selector, m, lowText, highText) {
  const el = d3.select(selector);
  el.selectAll("*").remove();
  const w = 240;
  const id = `grad-${selector.replace(/[^a-z0-9]/gi, "")}`;
  const svg = el.append("svg").attr("width", w).attr("height", 32).attr("aria-hidden", "true");
  const grad = svg.append("defs").append("linearGradient").attr("id", id);
  const scale = diverging(m);
  d3.range(0, 1.0001, 0.125).forEach((t) =>
    grad.append("stop").attr("offset", `${t * 100}%`).attr("stop-color", scale(-m + 2 * m * t))
  );
  svg.append("rect").attr("x", 0).attr("y", 2).attr("width", w).attr("height", 10).attr("rx", 2)
    .attr("fill", `url(#${id})`);
  [[-m, 0, "start"], [0, w / 2, "middle"], [m, w, "end"]].forEach(([v, x, anchor]) =>
    svg.append("text").attr("class", "tick-text").attr("x", x).attr("y", 26).attr("text-anchor", anchor)
      .text(fmtSigned(v, 1))
  );
  el.append("span").attr("class", "grad-caption").text(`Blue: ${lowText}   ·   Red: ${highText}`);
}

function tableFrom(selector, headers, rows) {
  const table = d3.select(selector);
  table.selectAll("*").remove();
  const head = table.append("thead").append("tr");
  headers.forEach((h, i) => head.append("th").attr("scope", "col").attr("class", i === 0 ? null : "model-col").html(h));
  const tbody = table.append("tbody");
  rows.forEach((r) => {
    const tr = tbody.append("tr").attr("class", r.className || null);
    r.cells.forEach((c, i) => {
      const cell = typeof c === "object" && c !== null ? c : { text: c };
      const td = tr.append("td").attr("class", i === 0 ? "cmp" : "cell sep" + (cell.cls ? ` ${cell.cls}` : ""));
      if (cell.html) td.html(cell.html);
      else td.text(cell.text === undefined || cell.text === null ? "—" : cell.text);
      if (i > 0 && (cell.text === "—" || cell.text === null || cell.text === undefined) && !cell.html) td.classed("empty", true);
      if (cell.title) td.attr("title", cell.title);
    });
  });
}

function sigCell(test, text) {
  if (!test || test.mean_diff === null || test.mean_diff === undefined) return { text: "—" };
  const dagger = test.significant && !test.significant_holm ? '<span class="sig-mark">†</span>' : "";
  return {
    html: `${text}${dagger}`,
    cls: test.significant_holm ? "sig" : "",
    title: `n = ${test.n}, 95% CI ${fmtCI(test)}, t = ${fmtT(test.t)}, p = ${fmtP(test.p)}, Holm p = ${fmtP(test.p_holm)}`
  };
}

/* ---------- grouped bars (means and triage) ---------- */

function groupedBars({ container, levels, series, yMax, ticks, tickFormat, valueFormat, refValue, refLabel, axisTitle, yTitle }) {
  const margin = { top: 16, right: 16, bottom: 78, left: 48 };
  const outerW = widthOf(container);
  const width = outerW - margin.left - margin.right;
  const height = 260;

  const svg = makeSvg(container, outerW, height + margin.top + margin.bottom);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const x0 = d3.scaleBand().domain(levels).range([0, width]).paddingInner(0.3);
  const x1 = d3.scaleBand().domain(series.map((s) => s.id)).range([0, x0.bandwidth()]).paddingInner(0);
  const y = d3.scaleLinear().domain([0, yMax]).range([height, 0]);

  g.selectAll(".gridline").data(ticks).join("line").attr("class", "gridline")
    .attr("x1", 0).attr("x2", width).attr("y1", (d) => y(d)).attr("y2", (d) => y(d));
  g.selectAll(".ytick").data(ticks).join("text").attr("class", "tick-text ytick")
    .attr("x", -10).attr("y", (d) => y(d)).attr("dy", "0.32em").attr("text-anchor", "end").text(tickFormat);

  const barW = Math.min(MAX_BAR, x1.bandwidth() - GAP);
  const offset = (x1.bandwidth() - barW) / 2;
  const ry = y(refValue);
  g.append("line").attr("class", "truth-line").attr("x1", 0).attr("x2", width).attr("y1", ry).attr("y2", ry);

  levels.forEach((level) => {
    const group = g.append("g").attr("transform", `translate(${x0(level)},0)`);
    series.forEach((s) => {
      const bx = x1(s.id) + offset;
      const value = s.values ? s.values(level) : null;
      if (value === null || value === undefined) {
        group.append("rect").attr("class", "blank-bar").attr("x", bx).attr("y", ry)
          .attr("width", barW).attr("height", height - ry).attr("rx", RADIUS);
        return;
      }
      group.append("path")
        .attr("d", barPath(bx, y(value), barW, height - y(value), RADIUS))
        .attr("fill", css(s.varName))
        .style("cursor", "pointer")
        .on("mouseenter", (event) =>
          showTip(event, `<span class="tt-title">${level}</span>
            <span class="tt-row"><span class="tt-dot" style="background:${css(s.varName)}"></span>${s.name}: ${valueFormat(value)}</span>
            ${s.extra ? s.extra(level) : ""}
            <span class="tt-row">${refLabel}: ${valueFormat(refValue)}</span>`)
        )
        .on("mousemove", moveTip)
        .on("mouseleave", hideTip);
      group.append("text").attr("class", "bar-value").attr("x", bx + barW / 2).attr("y", y(value) - 7)
        .text(valueFormat(value));
    });
  });

  // The reference value is named in the legend, so no label competes with the bar values.
  g.append("line").attr("class", "baseline").attr("x1", 0).attr("x2", width).attr("y1", height).attr("y2", height);

  levels.forEach((level) => {
    const cx = x0(level) + x0.bandwidth() / 2;
    const label = g.append("text").attr("class", "tick-text").attr("text-anchor", "middle");
    (SHORT_LABEL[level] || level).split("\n").forEach((line, i) => {
      label.append("tspan").attr("x", cx).attr("y", height + 18 + i * 13).text(line);
    });
  });
  g.append("text").attr("class", "axis-title").attr("x", width / 2).attr("y", height + 66)
    .attr("text-anchor", "middle").text(axisTitle);
  g.append("text").attr("class", "axis-title").attr("transform", "rotate(-90)")
    .attr("x", -height / 2).attr("y", -36).attr("text-anchor", "middle").text(yTitle);
}

/* ============================================================
   6.1 Overview
   ============================================================ */

function renderKpis() {
  const m = arm();
  const V = AI.vispdat;
  const selected = selectedModel();
  const demo = (tests) => tests.filter((t) => DEMOGRAPHIC_FAMILIES.includes(t.family));
  const disclosure = (tests) => tests.find((t) => t.family === "disclosure");
  const lc = selected ? selected.label_check : null;
  const first = lc && lc.attempts && lc.attempts.length ? lc.attempts[0] : null;

  const items = [
    {
      label: "Mean absolute error",
      main: m ? fmt(m.accuracy.all.mae, 2) : "—",
      ref: `VI‑SPDAT ${fmt(V.accuracy.all.mae, 2)}`,
      note: "Points from true score (0–17)."
    },
    {
      label: "Correct triage band",
      main: m ? fmtPct(m.accuracy.all.band_agreement) : "—",
      ref: `VI‑SPDAT ${fmtPct(V.accuracy.all.band_agreement)}`,
      note: "Same band as true score."
    },
    {
      label: "Bias tests significant",
      main: m ? `${demo(m.tests).filter((t) => t.significant_holm).length} of ${demo(m.tests).length}` : "—",
      ref: `VI‑SPDAT ${demo(V.tests).filter((t) => t.significant_holm).length} of ${demo(V.tests).length}`,
      note: "Race, gender, city · Holm α = 0.05."
    },
    {
      label: "Underdisclosure penalty",
      main: m ? fmtSigned(disclosure(m.tests).mean_diff, 2) : "—",
      ref: `VI‑SPDAT ${fmtSigned(disclosure(V.tests).mean_diff, 2)}`,
      note: "Points, withheld vs. full."
    },
    {
      label: "Answers on the wrong case",
      main: lc && lc.current.answers_checked ? fmtPct(lc.current.share_mixed) : "—",
      ref: first && first.answers_checked ? `first attempt ${fmtPct(first.share_mixed)}` : "",
      note: "Reason fits a different case."
    }
  ];

  const wrap = d3.select("#kpis");
  wrap.selectAll("*").remove();
  items.forEach((it) => {
    const k = wrap.append("div").attr("class", "kpi");
    k.append("div").attr("class", "kpi-label").text(it.label);
    const v = k.append("div").attr("class", "kpi-values");
    v.append("span").attr("class", "kpi-main").text(it.main);
    if (it.ref) v.append("span").attr("class", "kpi-ref").text(it.ref);
    k.append("div").attr("class", "kpi-note").text(it.note);
  });
}

function renderSummaryTable() {
  const cols = [{ label: "VI‑SPDAT", d: AI.vispdat, ref: true }].concat(
    AI.models.map((m) => ({ label: m.label, d: hasData(m) ? m : null, m }))
  );
  const pick = (d, fam) => d.tests.filter((t) => t.family === fam && t.mean_diff !== null);
  const sigCount = (d, fam) => {
    const ts = pick(d, fam);
    return ts.length ? `${ts.filter((t) => t.significant_holm).length} of ${ts.length}` : "—";
  };
  const largest = (d, fam, name) => {
    const ts = pick(d, fam);
    if (!ts.length) return "—";
    const t = ts.slice().sort((a, b) => Math.abs(b.mean_diff) - Math.abs(a.mean_diff))[0];
    return Math.abs(t.mean_diff) === 0 ? "0.00" : sigCell(t, `${fmtSigned(t.mean_diff, 2)} (${name(t)})`);
  };
  const raceName = (t) => SHORT_RACE[t.comparison.split(" vs.")[0]] || t.comparison;
  const cityName = (t) => t.comparison.split(",")[0];
  const one = (d, fam) => {
    const t = pick(d, fam)[0];
    return t ? sigCell(t, `${fmtSigned(t.mean_diff, 2)} (Holm p ${fmtP(t.p_holm)})`) : "—";
  };
  const sd = (d) => {
    const s = d.profiles.map((p) => p.sd).filter((v) => v !== null);
    return s.length ? fmt(d3.mean(s), 2) : "—";
  };
  const wrongCase = (d, c) => {
    if (c.ref) return "n/a";
    if (c.m.reattachment) return `${c.m.reattachment.moved} moved, ${c.m.reattachment.dropped} dropped`;
    const lc = c.m.label_check && c.m.label_check.current;
    return lc && lc.answers_checked ? fmtPct1(lc.share_mixed) : "—";
  };

  const flag = (d) => d.triage.psh_flagging;
  const groups = [
    ["Accuracy against true vulnerability", [
      ["Mean absolute error (points)", (d) => fmt(d.accuracy.all.mae, 2)],
      ["Mean error (+ overrates)", (d) => fmtSigned(d.accuracy.all.mean_error, 2)],
      ["Correlation with true score (r)", (d) => fmt(d.accuracy.all.pearson_r, 2)],
      ["Correct triage band", (d) => fmtPct(d.accuracy.all.band_agreement)],
      ["Over‑triage / under‑triage", (d) => `${fmtPct(d.accuracy.all.over_triage)} / ${fmtPct(d.accuracy.all.under_triage)}`]
    ]],
    [`Who gets flagged high‑need (PSH, score 8+; truly ${fmtPct(flag(AI.vispdat).truly_share)})`, [
      ["Flagged high‑need", (d) => `${fmtPct(flag(d).flagged_share)} (${flag(d).flagged})`],
      ["Of those flagged, truly high‑need", (d) => fmtPct(flag(d).precision)],
      ["Truly high‑need, caught", (d) => `${fmtPct(flag(d).recall)} (${flag(d).hits} of ${flag(d).truly})`],
      ["Flagged but not truly high‑need", (d) => String(flag(d).false_alarms)],
      ["Truly high‑need, missed", (d) => String(flag(d).missed)]
    ]],
    ["Bias (paired tests, Holm‑adjusted)", [
      ["Race vs. White: largest gap (points)", (d) => largest(d, "race", raceName)],
      ["Race tests significant", (d) => sigCount(d, "race")],
      ["Female vs. male (points)", (d) => one(d, "gender")],
      ["City: largest effect (points)", (d) => largest(d, "location", cityName)],
      ["City tests significant", (d) => sigCount(d, "location")],
      ["Underdisclosure vs. full (points)", (d) => one(d, "disclosure")]
    ]],
    ["Consistency and data quality", [
      ["Instances", (d) => d.instances_scored.toLocaleString()],
      ["Same profile, SD across versions", sd],
      ["Answers describing a different case", wrongCase]
    ]]
  ];
  const rows = [];
  groups.forEach(([title, items]) => {
    rows.push({ className: "group-row", cells: [{ html: `<strong>${title}</strong>` }].concat(cols.map(() => "")) });
    items.forEach(([name, fn]) => rows.push({ cells: [name].concat(cols.map((c) => (c.d ? fn(c.d, c) : "—"))) }));
  });
  tableFrom("#summary-table", ["Measure"].concat(cols.map((c) => c.label)), rows);
}

function renderFlaggingTable() {
  const cols = [{ label: "VI‑SPDAT", d: AI.vispdat }].concat(
    AI.models.map((m) => ({ label: m.label, d: hasData(m) ? m : null }))
  );
  const f = (d) => d.triage.psh_flagging;
  const lines = [
    ["Truly high‑need", (d) => `${fmtPct1(f(d).truly_share)} (${f(d).truly})`],
    ["Flagged high‑need", (d) => `${fmtPct1(f(d).flagged_share)} (${f(d).flagged})`],
    ["Flagged and truly high‑need", (d) => String(f(d).hits)],
    ["Flagged but not truly high‑need", (d) => String(f(d).false_alarms)],
    ["Truly high‑need but not flagged", (d) => String(f(d).missed)],
    ["Of those flagged, share truly high‑need", (d) => fmtPct1(f(d).precision)],
    ["Of the truly high‑need, share flagged", (d) => fmtPct1(f(d).recall)]
  ];
  tableFrom("#flagging-table", [""].concat(cols.map((c) => c.label)),
    lines.map(([name, fn]) => ({ cells: [name].concat(cols.map((c) => (c.d ? fn(c.d) : "—"))) })));
}

function renderCityTable() {
  const metric = MAP_METRICS.find((x) => x.value === mapMetric);
  const head = document.getElementById("city-table-title");
  if (head) head.textContent = `${metric.label} by city, every tool`;
  const cols = toolsWithData();
  tableFrom("#city-table", ["City"].concat(cols.map((c) => c.label)),
    AI.locations.map((loc) => ({
      cells: [loc].concat(cols.map((c) => {
        const t = c.d.locations.find((x) => x.location === loc)[mapMetric];
        return t.mean_diff === null ? "—" : sigCell(t, `${fmtSigned(t.mean_diff, 2)} ${fmtCI(t)}`);
      }))
    })));
}

/* ============================================================
   6.2 Data integrity — case-label check
   ============================================================ */

function renderLabelCheck() {
  const model = selectedModel();
  const lc = model ? model.label_check : null;
  document.getElementById("label-model").textContent = model ? model.label : "AI model";

  const views = [{ value: "current", label: "Current replies" }].concat(
    ((lc && lc.attempts) || []).map((a, i) => ({ value: a.attempt, label: `Attempt ${i + 1} (archived)` }))
  );
  if (!views.some((v) => v.value === labelView)) labelView = "current";
  chipGroup("#label-views", views, labelView, (v) => {
    labelView = v;
    renderLabelCheck();
  });

  const data = !lc ? null : labelView === "current" ? lc.current : lc.attempts.find((a) => a.attempt === labelView);
  const bySession = new Map(((data && data.sessions) || []).map((s) => [s.session, s]));
  const keys = [
    { key: "matches", name: "Matches its case", varName: "--series-1" },
    { key: "mixed up", name: "Describes a different case", varName: "--series-2" },
    { key: "can't tell", name: "Can't tell", varName: "--ink-muted" }
  ];

  const container = "#chart-labels";
  const margin = { top: 12, right: 12, bottom: 46, left: 44 };
  const outerW = widthOf(container);
  const width = outerW - margin.left - margin.right;
  const height = 190;
  const sessions = d3.range(1, AI.sessions_per_model + 1);
  const perSession = 32;

  const svg = makeSvg(container, outerW, height + margin.top + margin.bottom);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  const x = d3.scaleBand().domain(sessions).range([0, width]).paddingInner(0.3);
  const y = d3.scaleLinear().domain([0, perSession]).range([height, 0]);
  const ticks = [0, 8, 16, 24, 32];
  drawGrid(g, y, width, ticks);
  drawYTicks(g, y, ticks);
  const barW = Math.min(MAX_BAR, x.bandwidth());
  const offset = (x.bandwidth() - barW) / 2;

  sessions.forEach((n) => {
    const s = bySession.get(n);
    const bx = x(n) + offset;
    if (!s) {
      g.append("rect").attr("class", "blank-bar").attr("x", bx).attr("y", y(perSession))
        .attr("width", barW).attr("height", height - y(perSession)).attr("rx", 2);
      return;
    }
    let base = 0;
    const present = keys.filter((k) => s[k.key] > 0);
    present.forEach((k, i) => {
      const v = s[k.key];
      const top = y(base + v);
      const h = y(base) - top - (i > 0 ? GAP : 0);
      const isTop = i === present.length - 1;
      g.append("path")
        .attr("d", isTop ? barPath(bx, top, barW, Math.max(h, 0), RADIUS) : `M${bx},${top}h${barW}v${Math.max(h, 0)}h${-barW}Z`)
        .attr("fill", css(k.varName));
      base += v;
    });
    g.append("rect").attr("class", "hover-row").attr("x", x(n)).attr("y", 0).attr("width", x.bandwidth()).attr("height", height)
      .style("fill-opacity", 0)
      .on("mouseenter", (event) =>
        showTip(event, `<span class="tt-title">Session ${n}</span>` +
          keys.map((k) => `<span class="tt-row"><span class="tt-dot" style="background:${css(k.varName)}"></span>${k.name}: ${s[k.key]}</span>`).join(""))
      )
      .on("mousemove", moveTip)
      .on("mouseleave", hideTip);
  });

  g.append("line").attr("class", "baseline").attr("x1", 0).attr("x2", width).attr("y1", height).attr("y2", height);
  sessions.forEach((n) =>
    g.append("text").attr("class", "tick-text").attr("x", x(n) + x.bandwidth() / 2).attr("y", height + 16)
      .attr("text-anchor", "middle").text(n)
  );
  g.append("text").attr("class", "axis-title").attr("x", width / 2).attr("y", height + 38).attr("text-anchor", "middle").text("Session");
  g.append("text").attr("class", "axis-title").attr("transform", "rotate(-90)").attr("x", -height / 2).attr("y", -32)
    .attr("text-anchor", "middle").text("Answers");

  markLegend("#legend-labels", keys.map((k) => ({ name: k.name, color: css(k.varName) })).concat([{ kind: "blank", name: "Not yet run" }]));

  const foot = document.getElementById("labels-foot");
  if (!data || !data.answers_checked) {
    foot.textContent = `No ${model ? model.label : "AI"} replies have been checked yet.`;
  } else {
    const t = data.totals;
    foot.textContent =
      `Checked ${data.answers_checked}: match ${t.matches} · different case ${t["mixed up"]} (${fmtPct1(data.share_mixed)}) · ` +
      `can't tell ${t["can't tell"]} · sessions affected ${data.sessions_with_mixups} of ${data.sessions.length}`;
  }
}

/* ============================================================
   6.3 Accuracy
   ============================================================ */

function renderCalibration() {
  const m = arm();
  const V = AI.vispdat;
  const container = "#chart-calibration";
  const series = [
    { name: "VI‑SPDAT, full disclosure", varName: "--series-1", dash: null, pts: V.accuracy.calibration.map((c) => [c.true_score, c.mean_full]) },
    { name: "VI‑SPDAT, underdisclosure", varName: "--series-1", dash: "6 4", pts: V.accuracy.calibration.map((c) => [c.true_score, c.mean_under]) }
  ];
  if (m) {
    series.push(
      { name: `${m.label}, full disclosure`, varName: "--series-2", dash: null, pts: m.accuracy.calibration.map((c) => [c.true_score, c.mean_full]) },
      { name: `${m.label}, underdisclosure`, varName: "--series-2", dash: "6 4", pts: m.accuracy.calibration.map((c) => [c.true_score, c.mean_under]) }
    );
  }

  const margin = { top: 16, right: 24, bottom: 48, left: 48 };
  const outerW = widthOf(container);
  const width = outerW - margin.left - margin.right;
  const height = 320;
  const svg = makeSvg(container, outerW, height + margin.top + margin.bottom);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  const x = d3.scaleLinear().domain([0, 17]).range([0, width]);
  const y = d3.scaleLinear().domain([0, 17]).range([height, 0]);
  const ticks = [0, 4, 8, 12, 17];
  drawGrid(g, y, width, ticks);
  drawYTicks(g, y, ticks);

  g.append("line").attr("class", "identity-line").attr("x1", x(0)).attr("y1", y(0)).attr("x2", x(17)).attr("y2", y(17));

  const line = d3.line().defined((d) => d[1] !== null && d[1] !== undefined).x((d) => x(d[0])).y((d) => y(d[1]));
  series.forEach((s) => {
    g.append("path").attr("d", line(s.pts)).attr("fill", "none").attr("stroke", css(s.varName))
      .attr("stroke-width", 2).attr("stroke-dasharray", s.dash);
    g.selectAll(null).data(s.pts.filter((d) => d[1] !== null && d[1] !== undefined)).join("circle")
      .attr("cx", (d) => x(d[0])).attr("cy", (d) => y(d[1])).attr("r", s.dash ? 3 : 4)
      .attr("fill", s.dash ? css("--surface") : css(s.varName)).attr("stroke", s.dash ? css(s.varName) : css("--surface"))
      .attr("stroke-width", s.dash ? 1.5 : 1.5);
  });

  g.append("line").attr("class", "baseline").attr("x1", 0).attr("x2", width).attr("y1", height).attr("y2", height);
  d3.range(0, 18).forEach((v) =>
    g.append("text").attr("class", "tick-text").attr("x", x(v)).attr("y", height + 16).attr("text-anchor", "middle").text(v)
  );
  g.append("text").attr("class", "axis-title").attr("x", width / 2).attr("y", height + 40).attr("text-anchor", "middle").text("True vulnerability (0–17)");
  g.append("text").attr("class", "axis-title").attr("transform", "rotate(-90)").attr("x", -height / 2).attr("y", -34)
    .attr("text-anchor", "middle").text("Mean assigned score");

  // crosshair
  const guide = g.append("line").attr("class", "guide-line").attr("y1", 0).attr("y2", height).style("opacity", 0);
  g.append("rect").attr("width", width).attr("height", height).attr("fill", "transparent")
    .on("mousemove", (event) => {
      const [mx] = d3.pointer(event);
      const v = Math.max(0, Math.min(17, Math.round(x.invert(mx))));
      guide.attr("x1", x(v)).attr("x2", x(v)).style("opacity", 1);
      const rows = series.map((s) => {
        const pt = s.pts.find((d) => d[0] === v);
        return `<span class="tt-row"><span class="tt-dot" style="background:${css(s.varName)}"></span>${s.name}: ${pt && pt[1] !== null ? pt[1].toFixed(2) : "—"}</span>`;
      });
      showTip(event, `<span class="tt-title">True vulnerability ${v}</span>${rows.join("")}`);
    })
    .on("mouseleave", () => {
      guide.style("opacity", 0);
      hideTip();
    });

  markLegend("#legend-calibration",
    series.map((s) => ({ kind: "line", name: s.name, color: css(s.varName), dash: s.dash }))
      .concat([{ kind: "line", name: "Perfect agreement", color: css("--ink-muted"), dash: "4 4" }]));
}

function renderProfiles() {
  const m = arm();
  const V = AI.vispdat;
  const container = "#chart-profiles";
  const source = (m || V).profiles;
  const vBy = new Map(V.profiles.map((p) => [p.profile, p]));
  const rows = source.slice().sort((a, b) => a.true_score - b.true_score || a.profile.localeCompare(b.profile));

  const rowH = 21;
  const margin = { top: 26, right: 20, bottom: 44, left: 238 };
  const outerW = widthOf(container, 640);
  const width = outerW - margin.left - margin.right;
  const height = rows.length * rowH;
  const svg = makeSvg(container, outerW, height + margin.top + margin.bottom);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  const x = d3.scaleLinear().domain([0, 17]).range([0, width]);

  [0, 4, 8, 12, 17].forEach((v) =>
    g.append("line").attr("class", "gridline").attr("x1", x(v)).attr("x2", x(v)).attr("y1", 0).attr("y2", height)
  );
  [[3.5, "RRH"], [7.5, "PSH"]].forEach(([cut, name]) => {
    g.append("line").attr("class", "threshold").attr("x1", x(cut)).attr("x2", x(cut)).attr("y1", -12).attr("y2", height);
    g.append("text").attr("class", "threshold-label").attr("x", x(cut) + 4).attr("y", -14).text(`${name} threshold`);
  });

  const s1 = css("--series-1");
  const s2 = css("--series-2");
  const ink = css("--ink");
  rows.forEach((p, i) => {
    const cy = i * rowH + rowH / 2;
    const v = vBy.get(p.profile);
    const hover = g.append("rect").attr("class", "hover-row").attr("x", -margin.left).attr("y", i * rowH)
      .attr("width", width + margin.left).attr("height", rowH);
    const label = g.append("text").attr("class", "row-label").attr("x", -12).attr("y", cy).attr("dy", "0.32em").attr("text-anchor", "end");
    label.append("tspan").attr("class", "id").text(`${p.profile}  `);
    label.append("tspan").text(p.label.length > 30 ? `${p.label.slice(0, 29)}…` : p.label);

    if (m) {
      g.append("line").attr("x1", x(p.min)).attr("x2", x(p.max)).attr("y1", cy).attr("y2", cy)
        .attr("stroke", s2).attr("stroke-width", 2).attr("stroke-opacity", 0.45).style("pointer-events", "none");
    }
    g.append("line").attr("x1", x(p.true_score)).attr("x2", x(p.true_score)).attr("y1", cy - 7).attr("y2", cy + 7)
      .attr("stroke", ink).attr("stroke-width", 2).style("pointer-events", "none");
    if (v && v.vispdat_under !== null) {
      g.append("circle").attr("cx", x(v.vispdat_under)).attr("cy", cy).attr("r", 4).attr("fill", css("--surface"))
        .attr("stroke", s1).attr("stroke-width", 2).style("pointer-events", "none");
    }
    if (m) {
      g.append("circle").attr("cx", x(p.mean)).attr("cy", cy).attr("r", 4.5).attr("fill", s2)
        .attr("stroke", css("--surface")).attr("stroke-width", 1.5).style("pointer-events", "none");
    }

    hover.on("mouseenter", (event) =>
      showTip(event, `<span class="tt-title">${p.profile} · ${p.label}</span>
        <span class="tt-row">True vulnerability: ${p.true_score}</span>
        <span class="tt-row"><span class="tt-dot" style="background:${s1}"></span>VI‑SPDAT with underdisclosure: ${v ? v.vispdat_under : "—"}</span>
        ${m ? `<span class="tt-row"><span class="tt-dot" style="background:${s2}"></span>${m.label} mean: ${fmt(p.mean, 2)} (full ${fmt(p.mean_full, 1)}, under ${fmt(p.mean_under, 1)})</span>
        <span class="tt-row">Range across versions: ${p.min}–${p.max} · SD ${fmt(p.sd, 2)} · n ${p.n}</span>` : ""}`)
    ).on("mousemove", moveTip).on("mouseleave", hideTip);
  });

  g.append("line").attr("class", "baseline").attr("x1", 0).attr("x2", width).attr("y1", height).attr("y2", height);
  [0, 4, 8, 12, 17].forEach((v) =>
    g.append("text").attr("class", "tick-text").attr("x", x(v)).attr("y", height + 16).attr("text-anchor", "middle").text(v)
  );
  g.append("text").attr("class", "axis-title").attr("x", width / 2).attr("y", height + 36).attr("text-anchor", "middle").text("Score (0–17)");

  const items = [
    { kind: "tick", name: "True vulnerability", color: ink },
    { kind: "ring", name: "VI‑SPDAT with underdisclosure", color: s1 }
  ];
  if (m) {
    items.push({ kind: "dot", name: `${m.label} mean`, color: s2 }, { kind: "range", name: `${m.label} lowest–highest`, color: s2 });
  } else {
    items.push({ kind: "text", name: `${modelName()} has no results yet.` });
  }
  markLegend("#legend-profiles", items);
}

function renderAccuracyTables() {
  const V = AI.vispdat;
  const arms = [{ label: "VI‑SPDAT", data: V, ref: true }].concat(
    AI.models.map((m) => ({ label: m.label, data: hasData(m) ? m : null, model: m }))
  );

  tableFrom("#accuracy-table",
    ["Model", "Instances", "MAE", "MAE, full", "MAE, under", "Mean error", "Pearson r", "Correct band", "Over&#8209;triage", "Under&#8209;triage", "PSH&#8209;eligible missed", "Rank agreement"],
    arms.map((a) => {
      const acc = a.data ? a.data.accuracy : null;
      const rho = a.ref ? null : a.data ? a.data.ranking.rank_truth_rho : null;
      return {
        className: a.ref ? "ref-row" : null,
        cells: [
          a.label,
          a.data ? a.data.instances_scored.toLocaleString() : "—",
          acc ? fmt(acc.all.mae, 2) : "—",
          acc ? fmt(acc["by_disclosure"]["Full disclosure"].mae, 2) : "—",
          acc ? fmt(acc["by_disclosure"].Underdisclosure.mae, 2) : "—",
          acc ? fmtSigned(acc.all.mean_error, 2) : "—",
          acc ? fmt(acc.all.pearson_r, 3) : "—",
          acc ? fmtPct(acc.all.band_agreement) : "—",
          acc ? fmtPct(acc.all.over_triage) : "—",
          acc ? fmtPct(acc.all.under_triage) : "—",
          acc ? fmtPct(acc.all.psh_missed) : "—",
          a.ref ? "n/a" : fmt(rho, 3)
        ]
      };
    })
  );

  const m = arm();
  const rows = [];
  [["race", AI.races, "Race"], ["gender", AI.genders, "Gender"], ["location", AI.locations, "City"]].forEach(([field, levels, title]) => {
    rows.push({ className: "group-row", cells: [{ html: `<strong>${title}</strong>` }, "", "", "", ""] });
    levels.forEach((lvl) => {
      const va = V.accuracy[`by_${field}`][lvl];
      const ma = m ? m.accuracy[`by_${field}`][lvl] : null;
      rows.push({
        cells: [
          field === "race" ? lvl : lvl,
          fmt(va.mae, 2),
          ma ? fmt(ma.mae, 2) : "—",
          ma ? fmtSigned(ma.mean_error, 2) : "—",
          ma ? fmtPct(ma.psh_missed) : "—"
        ]
      });
    });
  });
  tableFrom("#accuracy-group-table",
    ["Group", "VI‑SPDAT MAE", `${modelName()} MAE`, `${modelName()} mean error`, `${modelName()} PSH&#8209;eligible missed`],
    rows);
}

/* ============================================================
   6.4 Demographic bias
   ============================================================ */

function renderMeans() {
  chipGroup("#factor-tabs", FACTORS.map((f) => ({ value: f.key, label: f.label })), activeFactor, (v) => {
    activeFactor = v;
    renderMeans();
  });
  const factor = FACTORS.find((f) => f.key === activeFactor);
  document.getElementById("means-factor").textContent = factor.title;
  const m = arm();
  const V = AI.vispdat;

  groupedBars({
    container: "#chart-means",
    levels: levelsFor(factor.key),
    series: [
      { id: "vispdat", name: "VI‑SPDAT", varName: "--series-1", values: (l) => V[factor.means][l] },
      { id: "ai", name: modelName(), varName: "--series-2", values: m ? (l) => m[factor.means][l] : null }
    ],
    yMax: 17,
    ticks: [0, 4, 8, 12, 17],
    tickFormat: (d) => d,
    valueFormat: (v) => v.toFixed(2),
    refValue: V.true_mean,
    refLabel: "True mean",
    axisTitle: factor.title.charAt(0).toUpperCase() + factor.title.slice(1),
    yTitle: "Mean vulnerability score (0–17)"
  });

  markLegend("#legend-means", [
    { name: "VI‑SPDAT", color: css("--series-1") },
    m ? { name: m.label, color: css("--series-2") } : { kind: "blank", name: `${modelName()} — not yet run` },
    { kind: "line", name: `True mean vulnerability (${V.true_mean.toFixed(2)})`, color: css("--ink-2"), dash: "5 3" }
  ]);

  document.getElementById("means-foot").textContent =
    `n: VI‑SPDAT ${V.instances_scored} · ${modelName()} ${m ? m.instances_scored : 0}`;
}

function renderForest() {
  const m = arm();
  const V = AI.vispdat;
  const container = "#chart-forest";
  const byM = new Map(m ? m.tests.map((t) => [t.comparison, t]) : []);

  const rowH = 30;
  const familyGap = 12;
  const positions = [];
  let yPos = 0;
  let lastFamily = null;
  V.tests.forEach((t) => {
    if (lastFamily && t.family !== lastFamily) yPos += familyGap;
    positions.push({ test: t, y: yPos + rowH / 2, top: yPos });
    yPos += rowH;
    lastFamily = t.family;
  });

  const values = [];
  [V.tests, m ? m.tests : []].forEach((tests) =>
    tests.forEach((t) => [t.ci_low, t.ci_high, t.mean_diff].forEach((v) => v !== null && v !== undefined && values.push(Math.abs(v))))
  );
  const lim = Math.max(1, Math.ceil((d3.max(values) || 1) * 2) / 2);

  const margin = { top: 8, right: 24, bottom: 56, left: 196 };
  const outerW = widthOf(container);
  const width = outerW - margin.left - margin.right;
  const height = yPos;
  const svg = makeSvg(container, outerW, height + margin.top + margin.bottom);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  const x = d3.scaleLinear().domain([-lim, lim]).range([0, width]);
  const ticks = x.ticks(8);

  ticks.forEach((v) => g.append("line").attr("class", "gridline").attr("x1", x(v)).attr("x2", x(v)).attr("y1", 0).attr("y2", height));
  g.append("line").attr("class", "zero-line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", height);

  const s1 = css("--series-1");
  const s2 = css("--series-2");
  positions.forEach(({ test, y: cy, top }) => {
    const mt = byM.get(test.comparison);
    const hover = g.append("rect").attr("class", "hover-row").attr("x", -margin.left).attr("y", top)
      .attr("width", width + margin.left).attr("height", rowH);
    g.append("text").attr("class", "row-label").attr("x", -12).attr("y", cy).attr("dy", "0.32em")
      .attr("text-anchor", "end").text(shortComparison(test.comparison));

    const mark = (t, dy, color) => {
      if (!t || t.mean_diff === null || t.mean_diff === undefined) return;
      g.append("line").attr("x1", x(t.ci_low)).attr("x2", x(t.ci_high)).attr("y1", cy + dy).attr("y2", cy + dy)
        .attr("stroke", color).attr("stroke-width", 2).style("pointer-events", "none");
      g.append("circle").attr("cx", x(t.mean_diff)).attr("cy", cy + dy).attr("r", 4.5)
        .attr("fill", t.significant_holm ? color : css("--surface")).attr("stroke", color).attr("stroke-width", 2)
        .style("pointer-events", "none");
    };
    mark(test, -5, s1);
    mark(mt, 5, s2);

    const tipRow = (name, color, t) =>
      t && t.mean_diff !== null
        ? `<span class="tt-row"><span class="tt-dot" style="background:${color}"></span>${name}: ${fmtSigned(t.mean_diff, 2)} ${fmtCI(t)}</span>
           <span class="tt-row">&nbsp;&nbsp;n ${t.n} · p ${fmtP(t.p)} · Holm p ${fmtP(t.p_holm)}</span>`
        : `<span class="tt-row"><span class="tt-dot" style="background:${color}"></span>${name}: —</span>`;
    hover.on("mouseenter", (event) =>
      showTip(event, `<span class="tt-title">${test.comparison}</span>${tipRow("VI‑SPDAT", s1, test)}${tipRow(modelName(), s2, mt)}`)
    ).on("mousemove", moveTip).on("mouseleave", hideTip);
  });

  g.append("line").attr("class", "baseline").attr("x1", 0).attr("x2", width).attr("y1", height).attr("y2", height);
  ticks.forEach((v) =>
    g.append("text").attr("class", "tick-text").attr("x", x(v)).attr("y", height + 16).attr("text-anchor", "middle").text(fmtSigned(v, 1))
  );
  g.append("text").attr("class", "axis-title").attr("x", width / 2).attr("y", height + 36).attr("text-anchor", "middle")
    .text("Difference in mean score, points (95% CI)");
  g.append("text").attr("class", "tick-text").attr("x", 0).attr("y", height + 50).text("← first group scored lower");
  g.append("text").attr("class", "tick-text").attr("x", width).attr("y", height + 50).attr("text-anchor", "end").text("first group scored higher →");

  markLegend("#legend-forest", [
    { kind: "dot", name: "VI‑SPDAT", color: s1 },
    m ? { kind: "dot", name: m.label, color: s2 } : { kind: "text", name: `${modelName()}: no results yet` },
    { kind: "text", name: "Filled: significant after Holm adjustment · Open: not significant" }
  ]);
}

function renderTestsTables() {
  const m = arm();
  const V = AI.vispdat;
  document.getElementById("tests-model-name").textContent = modelName();
  const byM = new Map(m ? m.tests.map((t) => [t.comparison, t]) : []);

  tableFrom("#tests-table",
    ["Comparison", "n", "VI‑SPDAT diff.", `${modelName()} diff.`, "95% CI", "d<sub>z</sub>", "p", "p (Holm)"],
    V.tests.map((vt) => {
      const t = byM.get(vt.comparison);
      const usable = t && t.mean_diff !== null;
      return {
        cells: [
          vt.comparison,
          usable ? t.n.toLocaleString() : vt.n.toLocaleString(),
          sigCell(vt, fmtSigned(vt.mean_diff, 3)),
          usable ? sigCell(t, fmtSigned(t.mean_diff, 3)) : "—",
          usable ? fmtCI(t) : "—",
          usable ? fmt(t.d_z, 2) : "—",
          usable ? fmtP(t.p) : "—",
          usable ? { text: fmtP(t.p_holm), cls: t.significant_holm ? "sig" : "" } : "—"
        ]
      };
    })
  );

  const columns = [{ label: "VI‑SPDAT", tests: V.tests }].concat(
    AI.models.map((mm) => ({ label: mm.label, tests: hasData(mm) ? mm.tests : null }))
  );
  tableFrom("#bias-matrix",
    ["Comparison"].concat(columns.map((c) => c.label)),
    V.tests.map((vt) => ({
      cells: [vt.comparison].concat(
        columns.map((c) => {
          const t = c.tests ? c.tests.find((x) => x.comparison === vt.comparison) : null;
          return t && t.mean_diff !== null ? sigCell(t, fmtSigned(t.mean_diff, 2)) : "—";
        })
      )
    }))
  );
}

/* ============================================================
   6.5 Intersections
   ============================================================ */

function heatmap(selector, cells, cols, colField, colLabels, scale) {
  const margin = { top: 34, right: 6, bottom: 6, left: 150 };
  const outerW = widthOf(selector, 320, 560);
  const width = outerW - margin.left - margin.right;
  const cellW = width / cols.length;
  const cellH = 42;
  const height = AI.races.length * cellH;
  const svg = makeSvg(selector, outerW, height + margin.top + margin.bottom);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  cols.forEach((c, j) =>
    g.append("text").attr("class", "heat-head").attr("x", j * cellW + cellW / 2).attr("y", -12).attr("text-anchor", "middle").text(colLabels[j])
  );
  AI.races.forEach((race, i) => {
    g.append("text").attr("class", "row-label").attr("x", -12).attr("y", i * cellH + cellH / 2).attr("dy", "0.32em")
      .attr("text-anchor", "end").text(SHORT_RACE[race]);
    cols.forEach((c, j) => {
      const cell = cells.find((d) => d.race === race && d[colField] === c);
      const v = cell ? cell.mean_deviation : null;
      const fill = v === null ? css("--surface-sunk") : scale(v);
      g.append("rect").attr("x", j * cellW + 1).attr("y", i * cellH + 1).attr("width", cellW - 2).attr("height", cellH - 2)
        .attr("rx", 2).attr("fill", fill)
        .on("mouseenter", (event) =>
          showTip(event, `<span class="tt-title">${race} · ${c}</span>
            <span class="tt-row">Deviation from profile average: ${fmtSigned(v, 3)}</span>
            <span class="tt-row">Mean score: ${fmt(cell && cell.mean_score, 2)} · n ${cell ? cell.n : 0}</span>`)
        )
        .on("mousemove", moveTip).on("mouseleave", hideTip);
      g.append("text").attr("class", "heat-value").attr("x", j * cellW + cellW / 2).attr("y", i * cellH + cellH / 2)
        .attr("dy", "0.35em").attr("text-anchor", "middle").attr("fill", v === null ? css("--ink-muted") : inkOn(fill))
        .text(fmtSigned(v, 2));
    });
  });
}

function renderIntersections() {
  const m = arm();
  const source = m || AI.vispdat;
  document.getElementById("heat-model").textContent = m ? m.label : "VI‑SPDAT (no AI model results yet)";
  const devs = source.cells.race_gender.concat(source.cells.race_disclosure).map((c) => Math.abs(c.mean_deviation || 0));
  const lim = Math.max(0.5, Math.ceil((d3.max(devs) || 0.5) * 2) / 2);
  const scale = diverging(lim);

  heatmap("#heat-race-gender", source.cells.race_gender, AI.genders, "gender", AI.genders, scale);
  heatmap("#heat-race-disclosure", source.cells.race_disclosure, ["Full disclosure", "Underdisclosure"], "disclosure", ["Full disclosure", "Underdisclosure"], scale);
  gradientLegend("#legend-heat", lim, "scored below the profile's average", "scored above it");

  tableFrom("#interaction-table",
    ["Comparison", "n", "Mean diff.", "95% CI", "p", "p (Holm)"],
    source.interaction_tests.map((t) => ({
      cells: [
        t.comparison,
        t.n.toLocaleString(),
        sigCell(t, fmtSigned(t.mean_diff, 3)),
        fmtCI(t),
        fmtP(t.p),
        { text: fmtP(t.p_holm), cls: t.significant_holm ? "sig" : "" }
      ]
    }))
  );
}

/* ============================================================
   6.6 Geography
   ============================================================ */

function loadUsMap() {
  if (!usMapPromise) usMapPromise = d3.json("assets/vendor/states-albers-10m.json");
  return usMapPromise;
}

function cityTip(city, label) {
  const lines = MAP_METRICS.map((mm) => {
    const t = city[mm.value];
    return `<span class="tt-row">${mm.label}: ${fmtSigned(t.mean_diff, 2)} ${fmtCI(t)} · Holm p ${fmtP(t.p_holm)}</span>`;
  });
  return `<span class="tt-title">${city.location} · ${label}</span>
    <span class="tt-row">Mean score in city: ${fmt(city.mean_score, 2)}</span>${lines.join("")}
    <span class="tt-row">Profiles in all conditions: ${city.profiles_complete}</span>`;
}

/* One small US map per tool, on one shared diverging scale, so cities compare across tools. */
function toolsWithData() {
  return [{ key: "vispdat", label: "VI‑SPDAT", d: AI.vispdat }].concat(
    AI.models.filter(hasData).map((m) => ({ key: m.key, label: m.label, d: m }))
  );
}

function mapGrid(containerSel, legendSel, metricKey) {
  const tools = toolsWithData();
  const metric = MAP_METRICS.find((x) => x.value === metricKey);
  const values = tools.flatMap((t) => t.d.locations.map((c) => Math.abs(c[metricKey].mean_diff || 0)));
  const lim = Math.max(1, Math.ceil((d3.max(values) || 0) * 2) / 2);
  const color = diverging(lim);
  gradientLegend(legendSel, lim, "lower", "higher");

  const wrap = d3.select(containerSel);
  wrap.selectAll("*").remove();
  wrap.attr("class", "map-grid");
  const panels = tools.map((t) => {
    const panel = wrap.append("figure").attr("class", "map-panel");
    const cap = panel.append("figcaption").attr("class", "map-panel-head");
    cap.append("span").attr("class", "map-panel-title").text(t.label);
    const sig = t.d.locations.filter((c) => c[metricKey].significant_holm).length;
    const vals = t.d.locations.map((c) => c[metricKey].mean_diff).filter((v) => v !== null && v !== undefined);
    const range = !vals.length ? "—"
      : d3.min(vals) === d3.max(vals) ? `${fmtSigned(vals[0], 2)} in every city`
      : `${fmtSigned(d3.min(vals), 2)} to ${fmtSigned(d3.max(vals), 2)}`;
    cap.append("span").attr("class", "map-panel-sub").text(`${range} · ${sig} of 5 significant`);
    return { t, host: panel.append("div").attr("class", "map map-small") };
  });

  loadUsMap().then((us) => {
    // contiguous states only: the five study cities are all in the lower 48
    const states = topojson.feature(us, us.objects.states).features.filter((f) => !["02", "15"].includes(String(f.id)));
    const lower48 = topojson.merge(us, us.objects.states.geometries.filter((g) => !["02", "15"].includes(String(g.id))));
    const path = d3.geoPath();
    // the basemap is pre-projected with this exact Albers USA projection
    const projection = d3.geoAlbersUsa().scale(1300).translate([487.5, 305]);
    const [[x0, y0], [x1, y1]] = path.bounds(lower48);
    const pad = 16;
    const box = [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad];

    panels.forEach(({ t, host }) => {
      host.selectAll("*").remove();
      const svg = host.append("svg").attr("viewBox", box.join(" ")).attr("role", "img")
        .attr("aria-label", `${t.label}: ${metric.label.toLowerCase()} in each study city. Values are listed in the table below.`);
      svg.append("g").selectAll("path").data(states).join("path").attr("class", "state").attr("d", path);
      svg.append("path").datum(lower48).attr("class", "nation").attr("d", path);

      t.d.locations.forEach((c) => {
        const pt = projection(CITY_COORDS[c.location]);
        if (!pt) return;
        const s = c[metricKey];
        const v = s.mean_diff;
        const has = v !== null && v !== undefined;
        const fill = has ? color(v) : css("--surface");
        const L = CITY_CALLOUT[c.location];
        const g = svg.append("g").attr("class", "city" + (s.significant_holm ? " is-sig" : "")).attr("data-city", c.location).attr("tabindex", 0);
        const bx = pt[0] + L.dx, by = pt[1] + L.dy;
        const w = 158, h = 74;
        const left = L.anchor === "end" ? bx - w : L.anchor === "middle" ? bx - w / 2 : bx;
        // leader from the exact city location to the callout
        const ex = Math.max(left, Math.min(pt[0], left + w));
        const ey = Math.max(by - h / 2, Math.min(pt[1], by + h / 2));
        g.append("line").attr("class", "city-leader").attr("x1", pt[0]).attr("y1", pt[1]).attr("x2", ex).attr("y2", ey);
        g.append("circle").attr("class", "city-pin").attr("cx", pt[0]).attr("cy", pt[1]).attr("r", 6);
        g.append("rect").attr("class", "city-box").attr("x", left).attr("y", by - h / 2).attr("width", w).attr("height", h)
          .attr("rx", 8).attr("fill", fill);
        const ink = has ? inkOn(fill) : css("--ink-muted");
        g.append("text").attr("class", "city-name").attr("x", left + w / 2).attr("y", by - 9).attr("text-anchor", "middle")
          .attr("fill", ink).text(L.short);
        g.append("text").attr("class", "city-val").attr("x", left + w / 2).attr("y", by + 25).attr("text-anchor", "middle")
          .attr("fill", ink).text(has ? fmtSigned(v, 2) : "—");
        const tip = () => cityTip(c, t.label);
        g.on("mouseenter", (event) => showTip(event, tip())).on("mousemove", moveTip).on("mouseleave", hideTip)
          .on("focus", function () {
            const r = this.getBoundingClientRect();
            showTip({ clientX: r.right, clientY: r.top }, tip());
          })
          .on("blur", hideTip);
      });
    });
  });
}

function renderMap() {
  chipGroup("#map-metrics", MAP_METRICS, mapMetric, (v) => {
    mapMetric = v;
    renderMap();
    renderCityTable();
  });
  const metric = MAP_METRICS.find((x) => x.value === mapMetric);
  document.getElementById("map-metric-desc").textContent = `${metric.label} — ${metric.description}`;
  mapGrid("#map", "#legend-map", mapMetric);
  mapGrid("#overview-map", "#legend-overview-map", "disclosure_penalty");
}

/* ============================================================
   6.7 Triage and ranking
   ============================================================ */

function renderTriage() {
  chipGroup("#triage-factor-tabs", FACTORS.map((f) => ({ value: f.key, label: f.label })), triageFactor, (v) => {
    triageFactor = v;
    renderTriage();
  });
  const m = arm();
  const V = AI.vispdat;
  const factor = FACTORS.find((f) => f.key === triageFactor);
  const find = (rows, lvl) => rows.find((r) => r[triageFactor] === lvl);
  const vRows = V.triage[`by_${triageFactor}`];
  const mRows = m ? m.triage[`by_${triageFactor}`] : null;
  const truth = V.triage.truth_shares.psh;

  const extra = (rows) => (lvl) => {
    const r = find(rows, lvl);
    return `<span class="tt-row">No intervention ${fmtPct1(r.share_none)} · RRH ${fmtPct1(r.share_rrh)} · PSH ${fmtPct1(r.share_psh)}</span>
      <span class="tt-row">PSH‑eligible placed lower: ${fmtPct1(r.psh_missed)}</span>`;
  };

  groupedBars({
    container: "#chart-triage",
    levels: levelsFor(triageFactor),
    series: [
      { id: "vispdat", name: "VI‑SPDAT", varName: "--series-1", values: (l) => find(vRows, l).share_psh, extra: extra(vRows) },
      { id: "ai", name: modelName(), varName: "--series-2", values: mRows ? (l) => find(mRows, l).share_psh : null, extra: mRows ? extra(mRows) : null }
    ],
    yMax: 1,
    ticks: [0, 0.25, 0.5, 0.75, 1],
    tickFormat: (d) => `${Math.round(d * 100)}%`,
    valueFormat: (v) => `${Math.round(v * 100)}%`,
    refValue: truth,
    refLabel: "Truly eligible",
    axisTitle: factor.title.charAt(0).toUpperCase() + factor.title.slice(1),
    yTitle: "Referred to PSH"
  });
  markLegend("#legend-triage", [
    { name: "VI‑SPDAT", color: css("--series-1") },
    m ? { name: m.label, color: css("--series-2") } : { kind: "blank", name: `${modelName()} — not yet run` },
    { kind: "line", name: `Share truly eligible (${Math.round(truth * 100)}%)`, color: css("--ink-2"), dash: "5 3" }
  ]);

  const note = document.getElementById("triage-note");
  if (m) {
    const sig = m.triage.psh_tests.filter((t) => DEMOGRAPHIC_FAMILIES.includes(t.family) && t.significant_holm);
    note.textContent = `Significant group differences in PSH referral (Holm): ${
      sig.length ? sig.map((t) => `${t.comparison} ${fmtSigned(t.mean_diff * 100, 1)} pts`).join("; ") : "none"}`;
  } else {
    note.textContent = `${modelName()} has no results yet.`;
  }

  const rows = [];
  [["race", AI.races, "Race"], ["gender", AI.genders, "Gender"], ["location", AI.locations, "City"], ["disclosure", ["Full disclosure", "Underdisclosure"], "Disclosure"]].forEach(([field, levels, title]) => {
    rows.push({ className: "group-row", cells: [{ html: `<strong>${title}</strong>` }, "", "", "", "", ""] });
    levels.forEach((lvl) => {
      const vr = V.triage[`by_${field}`].find((r) => r[field] === lvl);
      const mr = m ? m.triage[`by_${field}`].find((r) => r[field] === lvl) : null;
      rows.push({
        cells: [
          lvl,
          fmtPct1(vr.share_psh),
          mr ? fmtPct1(mr.share_psh) : "—",
          fmtPct1(vr.psh_missed),
          mr ? fmtPct1(mr.psh_missed) : "—",
          mr ? fmt(mr.mean_priority_position, 0) : "—"
        ]
      });
    });
  });
  tableFrom("#triage-table",
    ["Group", "VI‑SPDAT: PSH", `${modelName()}: PSH`, "VI‑SPDAT: eligible missed", `${modelName()}: eligible missed`, `${modelName()}: mean priority position`],
    rows);
}

function renderRanking() {
  const m = arm();
  const V = AI.vispdat;
  const r = m ? m.ranking : null;
  tableFrom("#ranking-table",
    ["Measure", "VI‑SPDAT", modelName()],
    [
      { cells: ["Score order vs. true vulnerability within a session (Spearman ρ)", fmt(V.ranking.score_truth_rho, 3), r ? fmt(r.score_truth_rho, 3) : "—"] },
      { cells: ["Model's own 1–32 ranking vs. true vulnerability (Spearman ρ)", "n/a", r ? `${fmt(r.rank_truth_rho, 3)} (${r.sessions_with_valid_ranks} sessions)` : "—"] },
      { cells: ["Agreement with VI‑SPDAT's scores within a session (Spearman ρ)", "1.000", r ? fmt(r.score_vispdat_rho, 3) : "—"] },
      { cells: ["Sessions returning a complete 1–32 ranking", "n/a", r ? `${r.sessions_with_valid_ranks} of ${r.sessions_total}` : "—"] },
      { cells: ["Own ranks agree with own scores (Kendall τ)", "n/a", r ? fmt(r.mean_score_rank_tau, 3) : "—"] },
      { cells: ["Sessions where some ranks contradict the model's own scores", "n/a", r ? `${r.sessions_with_inversions} of ${r.sessions_total}` : "—"] }
    ]);
}

/* ============================================================
   6.8 Data and materials
   ============================================================ */

function renderDownloads() {
  const rows = [
    ["VI‑SPDAT results, all 3,200 instances", "data/vispdat_results.csv", "Score, band, rank, and withheld indicators for every instance."],
    ["Results summary", "data/ai_results.json", "Every statistic on this dashboard, for VI‑SPDAT and each AI run."],
    ["Base profiles", "data/base_profiles.json", "Indicator flags, narratives, and underdisclosure text."],
    ["Demographic clones", "data/clones.json", "All 1,600 clones with the record under each condition."],
    ["Session schedule", "data/ai/paste_schedule.json", "The 20 sessions every AI run scored, in order."],
    ["Session 1 prompt", "paste/prompts/session-01/single-message.txt", "The exact message every AI run received for session 1."]
  ];
  AI.models.forEach((m) => {
    if (hasData(m)) rows.push([`${m.label} scores, ranks, and reasons`, `data/ai/results/${m.key}.csv`, `Score, rank, and reason for every ${m.label} instance.`]);
    if (m.reattachment) {
      rows.push([`${m.label}: re-attachment decisions`, `data/ai/checks/${m.key}_decisions.csv`, "Every answer in a mislabeled session, the case it was attached to, and why."]);
    } else if (m.label_check && m.label_check.current.answers_checked) {
      rows.push([`${m.label} case-label check`, `data/ai/checks/${m.key}_case_labels.csv`, "Case-label verdict for every answer."]);
    }
  });

  const table = d3.select("#downloads-table");
  table.selectAll("*").remove();
  const head = table.append("thead").append("tr");
  ["File", "Contents", "Download"].forEach((h) => head.append("th").attr("scope", "col").text(h));
  const tbody = table.append("tbody");
  rows.forEach(([name, href, desc]) => {
    const tr = tbody.append("tr");
    tr.append("td").attr("class", "p-label").text(name);
    tr.append("td").text(desc);
    tr.append("td").append("a").attr("href", href).attr("download", "").text(href.split("/").pop());
  });
}

/* ============================================================
   Status and entry point
   ============================================================ */

function renderStatus() {
  const run = AI.models.filter(hasData);
  const complete = AI.models.filter((m) => m.status === "complete");
  const line = document.getElementById("ai-status-line");
  if (line) {
    const ns = [...new Set(run.map((m) => m.instances_scored))];
    line.textContent = ns.length === 1 ? `n = ${ns[0]} per run` : run.map((m) => `${m.label}: n = ${m.instances_scored}`).join(" · ");
  }
  const hero = document.getElementById("hero-ai-status");
  if (hero) hero.textContent = run.length ? `${complete.length} of ${AI.models.length} complete` : "pending";
}

/* ============================================================
   Model comparison — which AI run is least biased on each measure
   ============================================================ */

// |effect| interval: how far from zero the effect could plausibly be
function absInterval(t) {
  if (t.ci_low === null || t.ci_low === undefined) return [Math.abs(t.mean_diff), Math.abs(t.mean_diff)];
  if (t.ci_low > 0) return [t.ci_low, t.ci_high];
  if (t.ci_high < 0) return [-t.ci_high, -t.ci_low];
  return [0, Math.max(-t.ci_low, t.ci_high)];
}

const shortGroup = (c) => {
  const g = c.replace(/ vs\. White.*$/, "").replace(/, (male|female) cases only$/, "")
    .replace("Underdisclosure penalty: ", "")
    .replace(/ vs\. other locations$/, "").replace(/, [A-Z][a-z]+( [A-Z][a-z]+)?$/, "");
  return SHORT_RACE[g] || g;
};

const BIAS_MEASURES = [
  { key: "race", label: "Race: largest gap vs. White", pick: (m) => m.tests.filter((t) => t.family === "race"), named: true },
  { key: "gender", label: "Gender: female vs. male", pick: (m) => m.tests.filter((t) => t.family === "gender") },
  { key: "city", label: "City: largest city effect", pick: (m) => m.tests.filter((t) => t.family === "location"), named: true },
  { key: "disclosure", label: "Underdisclosure penalty", pick: (m) => m.tests.filter((t) => t.family === "disclosure") },
  { key: "rxg", label: "Race gap within one gender (largest)", pick: (m) => m.interaction_tests.filter((t) => t.family === "race_within_gender"), named: true, withGender: true },
  { key: "pxr", label: "Penalty difference by race (largest)", pick: (m) => m.interaction_tests.filter((t) => t.family === "penalty_by_race"), named: true },
  { key: "pxg", label: "Penalty difference, female vs. male", pick: (m) => m.interaction_tests.filter((t) => t.family === "penalty_by_gender") }
];

function worstTest(tests) {
  const ok = tests.filter((t) => t.mean_diff !== null && t.mean_diff !== undefined);
  return ok.length ? ok.slice().sort((a, b) => Math.abs(b.mean_diff) - Math.abs(a.mean_diff))[0] : null;
}

function compareBias() {
  const runs = AI.models.filter(hasData);
  return BIAS_MEASURES.map((ms) => {
    const cells = runs.map((m) => ({ m, t: worstTest(ms.pick(m)) }));
    const ranked = cells.filter((c) => c.t).sort((a, b) => Math.abs(a.t.mean_diff) - Math.abs(b.t.mean_diff));
    const best = ranked[0];
    const reliable = best && ranked.slice(1).every((c) => absInterval(best.t)[1] < absInterval(c.t)[0]);
    return { ms, cells, best, reliable };
  });
}

function renderComparison() {
  if (d3.select("#compare-bias").empty()) return;
  const runs = AI.models.filter(hasData);
  const rows = compareBias();

  // headline
  const wins = d3.rollup(rows.filter((r) => r.best), (v) => v.length, (r) => r.best.m.label);
  const leader = [...wins.entries()].sort((a, b) => b[1] - a[1])[0];
  const reliableRows = rows.filter((r) => r.reliable);
  const summary = d3.select("#compare-summary");
  summary.selectAll("*").remove();
  summary.append("p").attr("class", "compare-lede").html(
    `<strong>${leader[0]}</strong> is closest to zero on ${leader[1]} of ${rows.length} bias measures. ` +
    (reliableRows.length
      ? `Only ${reliableRows.length === 1 ? "one lead is" : `${reliableRows.length} leads are`} statistically reliable (95% intervals that do not overlap): ${reliableRows.map((r) => `${r.ms.label.toLowerCase()} (${r.best.m.label})`).join("; ")}.`
      : "No lead is statistically reliable: on every measure the runs' 95% intervals overlap.") +
    " VI&#8209;SPDAT is shown for reference; it cannot respond to stated race, gender, or city.");

  // scorecard table
  const headers = ["Measure", "VI‑SPDAT"].concat(runs.map((m) => m.label), ["Closest to zero", "Reliable?"]);
  const body = rows.map((r) => {
    const vt = worstTest(r.ms.pick(AI.vispdat));
    const cell = (t) => {
      if (!t) return "—";
      const who = r.ms.named ? ` <span class="cmp-group">${shortGroup(t.comparison)}${r.ms.withGender ? (/male cases only$/.test(t.comparison) ? (/female/.test(t.comparison) ? ", women" : ", men") : "") : ""}</span>` : "";
      const v = `${fmtSigned(t.mean_diff, 2)} <span class="cmp-ci">${fmtCI(t)}</span>${who}`;
      return { html: t.significant_holm ? `<strong>${v}</strong>` : v };
    };
    return {
      cells: [r.ms.label, vt ? `${fmtSigned(vt.mean_diff, 2)}` : "—"]
        .concat(r.cells.map((c) => {
          const out = cell(c.t);
          if (r.best && c.m === r.best.m && out.html) out.cls = "cmp-best";
          return out;
        }))
        .concat([r.best ? r.best.m.label : "—", r.reliable ? "Yes" : "No — intervals overlap"])
    };
  });
  tableFrom("#compare-bias", headers, body);

  // interval plot: one panel per measure, one row per run
  const el = d3.select("#compare-plot");
  el.selectAll("*").remove();
  const W = widthOf("#compare-plot", 560, 980);
  const labelW = 190, rowH = 22, gap = 30, headH = 22;
  const panelH = headH + runs.length * rowH;
  const H = rows.length * (panelH + gap) + 30;
  const lim = Math.max(1, Math.ceil(d3.max(rows.flatMap((r) => r.cells.filter((c) => c.t).map((c) => Math.max(Math.abs(c.t.ci_low ?? 0), Math.abs(c.t.ci_high ?? 0))))) * 2) / 2);
  const x = d3.scaleLinear().domain([-lim, lim]).range([labelW, W - 16]);
  const svg = el.append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("width", "100%").attr("role", "img")
    .attr("aria-label", "Effect and 95% confidence interval for each AI run on each bias measure. Values are in the table above.");
  const ticks = x.ticks(8);
  svg.append("g").selectAll("line").data(ticks).join("line").attr("class", "grid-line")
    .attr("x1", (d) => x(d)).attr("x2", (d) => x(d)).attr("y1", 0).attr("y2", H - 26);
  svg.append("line").attr("class", "zero-line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", H - 26);
  svg.append("g").selectAll("text").data(ticks).join("text").attr("class", "tick-text").attr("x", (d) => x(d)).attr("y", H - 8)
    .attr("text-anchor", "middle").text((d) => fmtSigned(d, 1));
  rows.forEach((r, i) => {
    const y0 = i * (panelH + gap);
    svg.append("text").attr("class", "cmp-panel-title").attr("x", 0).attr("y", y0 + 14).text(r.ms.label);
    r.cells.forEach((c, j) => {
      const y = y0 + headH + j * rowH + rowH / 2;
      const isBest = r.best && c.m === r.best.m;
      svg.append("text").attr("class", "cmp-run" + (isBest ? " is-best" : "")).attr("x", labelW - 10).attr("y", y).attr("dy", "0.35em")
        .attr("text-anchor", "end").text(c.m.label);
      if (!c.t) return;
      const g = svg.append("g").attr("class", "cmp-mark" + (isBest ? " is-best" : ""));
      g.append("line").attr("x1", x(c.t.ci_low)).attr("x2", x(c.t.ci_high)).attr("y1", y).attr("y2", y);
      g.append("circle").attr("cx", x(c.t.mean_diff)).attr("cy", y).attr("r", 5.5)
        .attr("class", c.t.significant_holm ? "is-sig" : "");
      g.append("rect").attr("x", labelW).attr("y", y - rowH / 2).attr("width", W - labelW).attr("height", rowH).attr("fill", "transparent")
        .on("mouseenter", (event) => showTip(event, `<span class="tt-title">${c.m.label} · ${r.ms.label}</span>
          <span class="tt-row">${c.t.comparison}</span>
          <span class="tt-row">${fmtSigned(c.t.mean_diff, 2)} ${fmtCI(c.t)} · Holm p ${fmtP(c.t.p_holm)}</span>`))
        .on("mousemove", moveTip).on("mouseleave", hideTip);
    });
  });

  // accuracy and triage, for context
  const acc = [
    ["Mean absolute error (points)", (m) => m.accuracy.all.mae, "low", (v) => fmt(v, 2)],
    ["Score vs. truth, rank correlation (ρ)", (m) => m.ranking.score_truth_rho, "high", (v) => fmt(v, 3)],
    ["Correct triage band", (m) => m.accuracy.all.band_agreement, "high", fmtPct],
    ["Truly high‑need cases missed", (m) => m.triage.psh_flagging.missed, "low", String],
    ["Flagged high‑need but not", (m) => m.triage.psh_flagging.false_alarms, "low", String],
    ["Sessions with a complete 1–32 ranking", (m) => m.ranking.sessions_with_valid_ranks, "high", (v) => `${v} of 20`]
  ];
  tableFrom("#compare-accuracy", ["Measure", "VI‑SPDAT"].concat(runs.map((m) => m.label), ["Best AI run"]),
    acc.map(([name, get, dir, f]) => {
      const vals = runs.map(get);
      const bestV = dir === "low" ? d3.min(vals) : d3.max(vals);
      const bestRuns = runs.filter((m, k) => vals[k] === bestV).map((m) => m.label);
      let vref;
      try { vref = get(AI.vispdat); } catch (e) { vref = null; }
      return {
        cells: [name, vref === null || vref === undefined ? "n/a" : f(vref)]
          .concat(vals.map((v) => (v === bestV ? { text: f(v), cls: "cmp-best" } : f(v))))
          .concat([bestRuns.join(", ")])
      };
    }));
}

/* ============================================================
   Overview — key results as small charts, one per measure
   ============================================================ */

// Each tool keeps one categorical slot everywhere on this panel (fixed order, never cycled).
const TOOL_SLOTS = ["--series-1", "--series-2", "--series-3", "--series-4", "--series-5"];

function renderKeyCharts() {
  const host = d3.select("#key-charts");
  if (host.empty()) return;
  host.selectAll("*").remove();
  const tools = toolsWithData().map((t, i) => ({ ...t, color: css(TOOL_SLOTS[i]) }));
  const test = (d, fam) => d.tests.filter((t) => t.family === fam && t.mean_diff !== null);
  const worst = (d, fam) => worstTest(test(d, fam));
  const truth = AI.vispdat.triage.psh_flagging.truly_share;

  const groups = [
    { title: "Accuracy against true vulnerability", panels: [
      { kind: "bar", title: "Mean absolute error", sub: "Points off the true score; lower is better", get: (d) => d.accuracy.all.mae, fmt: (v) => fmt(v, 2), best: "low" },
      { kind: "bar", title: "Correct triage band", sub: "Same band as the true score; higher is better", get: (d) => d.accuracy.all.band_agreement, fmt: fmtPct, max: 1, best: "high" },
      { kind: "bar", title: "Correlation with true score", sub: "Pearson r; higher is better", get: (d) => d.accuracy.all.pearson_r, fmt: (v) => fmt(v, 2), max: 1, best: "high" }
    ]},
    { title: "Who gets flagged high‑need", panels: [
      { kind: "bar", title: "Flagged high‑need", sub: `Share placed in the PSH band; dashed line = truly high‑need (${fmtPct(truth)})`, get: (d) => d.triage.psh_flagging.flagged_share, fmt: fmtPct, max: 1, ref: truth },
      { kind: "bar", title: "Truly high‑need, missed", sub: "Of 280 truly high‑need cases; lower is better", get: (d) => d.triage.psh_flagging.missed, fmt: String, best: "low" },
      { kind: "bar", title: "Flagged but not truly high‑need", sub: "False positives, of 360; lower is better", get: (d) => d.triage.psh_flagging.false_alarms, fmt: String, best: "low" }
    ]},
    { title: "Bias (paired differences, 95% CI)", panels: [
      { kind: "ci", title: "Underdisclosure penalty", sub: "Underdisclosure minus full disclosure, points", get: (d) => test(d, "disclosure")[0] },
      { kind: "ci", title: "Female vs. male", sub: "Points; 0 = no gender difference", get: (d) => test(d, "gender")[0] },
      { kind: "ci", title: "Largest race gap vs. White", sub: "Points; the group with the largest gap", get: (d) => worst(d, "race"), named: true }
    ]}
  ];

  groups.forEach((g) => {
    host.append("h3").attr("class", "kc-group").text(g.title);
    const grid = host.append("div").attr("class", "kc-grid");
    g.panels.forEach((pn) => {
      const card = grid.append("figure").attr("class", "kc-panel");
      const cap = card.append("figcaption");
      cap.append("span").attr("class", "kc-title").text(pn.title);
      cap.append("span").attr("class", "kc-sub").text(pn.sub);
      const W = 340, labelW = 132, rowH = 30, top = 6, bottom = pn.kind === "ci" ? 24 : 6;
      const H = top + tools.length * rowH + bottom;
      const svg = card.append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("width", "100%").attr("role", "img")
        .attr("aria-label", `${pn.title}: ` + tools.map((t) => {
          const v = pn.kind === "ci" ? (pn.get(t.d) || {}).mean_diff : pn.get(t.d);
          return `${t.label} ${v === null || v === undefined ? "no value" : (pn.fmt || ((x) => fmtSigned(x, 2)))(v)}`;
        }).join("; "));
      const valueW = pn.kind === "ci" ? 0 : 46;
      const vals = tools.map((t) => (pn.kind === "ci" ? pn.get(t.d) : pn.get(t.d)));
      if (pn.kind === "bar") {
        const hi = pn.max || d3.max(vals) * 1.05 || 1;
        const x = d3.scaleLinear().domain([0, hi]).range([labelW, W - valueW]);
        const bestV = pn.best === "low" ? d3.min(vals.slice(1)) : pn.best === "high" ? d3.max(vals.slice(1)) : null;
        if (pn.ref !== undefined) {
          svg.append("line").attr("class", "kc-ref").attr("x1", x(pn.ref)).attr("x2", x(pn.ref)).attr("y1", top - 2).attr("y2", H - bottom + 2);
        }
        tools.forEach((t, i) => {
          const v = vals[i];
          const y = top + i * rowH;
          svg.append("text").attr("class", "kc-label").attr("x", labelW - 8).attr("y", y + rowH / 2).attr("dy", "0.35em")
            .attr("text-anchor", "end").text(t.label);
          svg.append("rect").attr("x", x(0)).attr("y", y + 7).attr("width", Math.max(x(v) - x(0), 1)).attr("height", rowH - 14)
            .attr("rx", 3).attr("fill", t.color);
          svg.append("text").attr("class", "kc-value" + (i > 0 && v === bestV ? " is-best" : "")).attr("x", x(v) + 6)
            .attr("y", y + rowH / 2).attr("dy", "0.35em").text(pn.fmt(v));
        });
        svg.append("line").attr("class", "kc-axis").attr("x1", x(0)).attr("x2", x(0)).attr("y1", top).attr("y2", H - bottom);
      } else {
        const ext = d3.max(vals.filter(Boolean).flatMap((t) => [Math.abs(t.ci_low), Math.abs(t.ci_high)]));
        const lim = Math.max(0.5, Math.ceil(ext * 2) / 2);
        const x = d3.scaleLinear().domain([-lim, lim]).range([labelW, W - 10]);
        x.ticks(4).forEach((tk) => {
          svg.append("line").attr("class", "grid-line").attr("x1", x(tk)).attr("x2", x(tk)).attr("y1", top).attr("y2", H - bottom);
          svg.append("text").attr("class", "tick-text").attr("x", x(tk)).attr("y", H - 6).attr("text-anchor", "middle").text(fmtSigned(tk, 1));
        });
        svg.append("line").attr("class", "zero-line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", top).attr("y2", H - bottom);
        tools.forEach((t, i) => {
          const tt = vals[i];
          const y = top + i * rowH + rowH / 2;
          svg.append("text").attr("class", "kc-label").attr("x", labelW - 8).attr("y", y).attr("dy", "0.35em")
            .attr("text-anchor", "end").text(t.label);
          if (!tt) return;
          svg.append("line").attr("x1", x(tt.ci_low)).attr("x2", x(tt.ci_high)).attr("y1", y).attr("y2", y)
            .attr("stroke", t.color).attr("stroke-width", 2.5);
          svg.append("circle").attr("cx", x(tt.mean_diff)).attr("cy", y).attr("r", 5.5)
            .attr("fill", tt.significant_holm ? t.color : css("--surface")).attr("stroke", t.color).attr("stroke-width", 2.5);
          svg.append("rect").attr("x", 0).attr("y", y - rowH / 2).attr("width", W).attr("height", rowH).attr("fill", "transparent")
            .on("mouseenter", (event) => showTip(event, `<span class="tt-title">${t.label} · ${pn.title}</span>
              <span class="tt-row">${pn.named ? tt.comparison + ": " : ""}${fmtSigned(tt.mean_diff, 2)} ${fmtCI(tt)}</span>
              <span class="tt-row">Holm p ${fmtP(tt.p_holm)}${tt.significant_holm ? " · significant" : ""}</span>`))
            .on("mousemove", moveTip).on("mouseleave", hideTip);
        });
      }
    });
  });

  markLegend("#legend-key-charts", tools.map((t) => ({ name: t.label, color: t.color }))
    .concat([{ kind: "text", name: "Bias panels: filled dot = significant after Holm adjustment; open = not significant." }]));
}

/* ============================================================
   Overview — plain-language findings, computed from the results
   ============================================================ */

function renderFindings() {
  const el = d3.select("#findings");
  if (el.empty()) return;
  el.selectAll("*").remove();
  const V = AI.vispdat;
  const models = AI.models.filter(hasData);
  if (!models.length) return;
  const pct = (x) => `${Math.round(x * 100)}%`;
  const span = (xs, f) => {
    const lo = d3.min(xs), hi = d3.max(xs);
    return f(lo) === f(hi) ? f(lo) : `${f(lo)}–${f(hi)}`;
  };
  const flagShares = models.map((m) => m.triage.psh_flagging.flagged_share);
  const truly = V.triage.psh_flagging.truly_share;
  const test = (d, fam) => d.tests.filter((t) => t.family === fam && t.mean_diff !== null);
  const penalty = (d) => test(d, "disclosure")[0];
  const aiPen = models.map((m) => penalty(m).mean_diff);
  const sigDemo = models.flatMap((m) => ["race", "gender", "location"].flatMap((fam) =>
    test(m, fam).filter((t) => t.significant_holm).map((t) => ({ m, t }))));
  const raceSig = sigDemo.filter((x) => x.t.family === "race").length;
  const citySig = sigDemo.filter((x) => x.t.family === "location").length;
  const vf = V.triage.psh_flagging;
  const aiMissed = models.map((m) => m.triage.psh_flagging.missed);

  const cards = [
    {
      kicker: "Triage",
      stat: `${span(flagShares, pct)}`,
      statNote: `of cases flagged high‑need by the AI runs; ${pct(truly)} truly are`,
      body: `VI‑SPDAT flags ${pct(vf.flagged_share)}. The AI runs flag ${span(models.map((m) => m.triage.psh_flagging.recall), pct)} of truly high‑need cases, but ${span(models.map((m) => 1 - m.triage.psh_flagging.precision), pct)} of their flags are false positives.`
    },
    {
      kicker: "Missed need",
      stat: `${vf.missed} of ${vf.truly}`,
      statNote: "truly high‑need cases missed by VI‑SPDAT",
      body: `All are underdisclosure cases. The AI runs miss ${span(aiMissed, String)} of the same ${vf.truly}.`
    },
    {
      kicker: "Underdisclosure",
      stat: `${fmtSigned(penalty(V).mean_diff, 1)} pts`,
      statNote: `VI‑SPDAT underdisclosure penalty; AI runs ${fmtSigned(d3.max(aiPen), 1)} to ${fmtSigned(d3.min(aiPen), 1)}`,
      body: "Every run scores the same profile lower when information is withheld, in every city. The AI penalty is about half the VI‑SPDAT's."
    },
    {
      kicker: "Demographic bias",
      stat: `${raceSig + citySig} of ${models.length * 9}`,
      statNote: "race and city tests significant across the AI runs",
      body: sigDemo.filter((x) => x.t.family === "gender").length
        ? `One gender effect: ${sigDemo.filter((x) => x.t.family === "gender").map((x) => `${x.m.label} scores women ${fmtSigned(x.t.mean_diff, 2)} points higher (Holm p ${fmtP(x.t.p_holm)})`).join("; ")}. It does not replicate in the other runs.`
        : "No race, gender, or city effect in any AI run after Holm adjustment."
    }
  ];
  cards.forEach((c) => {
    const card = el.append("article").attr("class", "fcard");
    card.append("p").attr("class", "fcard-kicker").text(c.kicker);
    card.append("p").attr("class", "fcard-stat").text(c.stat);
    card.append("p").attr("class", "fcard-note").text(c.statNote);
    card.append("p").attr("class", "fcard-body").text(c.body);
  });
}

function renderResults() {
  if (!RESULTS || !AI) return;
  if (!activeModel || !AI.models.some((m) => m.key === activeModel)) {
    // open on the model with the most analyzed instances
    const withData = AI.models.filter(hasData).sort((a, b) => b.instances_scored - a.instances_scored);
    const first = withData[0] || AI.models[0];
    activeModel = first ? first.key : null;
  }
  chipGroup("#model-chips",
    AI.models.map((m) => ({
      value: m.key,
      label: m.label,
      empty: !hasData(m),
      count: hasData(m)
        ? (m.instances_scored < AI.instances_per_model ? `${m.instances_scored}/${AI.instances_per_model}` : "")
        : "not run"
    })),
    activeModel,
    (v) => {
      activeModel = v;
      renderResults();
    });

  renderStatus();
  renderKpis();
  renderFindings();
  renderKeyCharts();
  renderComparison();
  renderSummaryTable();
  renderCityTable();
  renderFlaggingTable();
  renderLabelCheck();
  renderCalibration();
  renderProfiles();
  renderAccuracyTables();
  renderMeans();
  renderForest();
  renderTestsTables();
  renderIntersections();
  renderMap();
  renderTriage();
  renderRanking();
  renderDownloads();
}
