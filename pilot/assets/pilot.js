/* ============================================================
   Pilot dashboard: VI-SPDAT and Gemini priority for 100 people

   Everything is computed here from data/dashboard.json: the
   profiles with their VI-SPDAT score and priority, and each
   complete Gemini run's priority and explanation per person.
   Descriptive only: counts and within-group percentages.
   ============================================================ */

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const CATS = ["High", "Medium", "Low"];
const RANK = { Low: 0, Medium: 1, High: 2 };
const CAT_COLOR = { High: "--series-2", Medium: "--series-4", Low: "--series-3" };
const TOOL_COLOR = { vispdat: "--series-1", gemini: "--series-2" };

const RACE_SHORT = {
  "American Indian, Alaska Native, or Indigenous": "Am. Indian / AK Native",
  "Asian or Asian American": "Asian",
  "Black, African American, or African": "Black",
  "Hispanic/Latino/e/a": "Hispanic / Latino",
  White: "White"
};
const CITIES = ["Los Angeles, California", "Cincinnati, Ohio", "Chicago, Illinois", "Atlanta, Georgia",
  "New York City, New York"];
const CITY_COORDS = {
  "Los Angeles, California": [-118.2437, 34.0522],
  "Cincinnati, Ohio": [-84.512, 39.1031],
  "Chicago, Illinois": [-87.6298, 41.8781],
  "Atlanta, Georgia": [-84.388, 33.749],
  "New York City, New York": [-74.006, 40.7128]
};
const CITY_CALLOUT = {
  "Los Angeles, California": { dx: 24, dy: 74, anchor: "start", short: "Los Angeles" },
  "Cincinnati, Ohio": { dx: 30, dy: 66, anchor: "start", short: "Cincinnati" },
  "Chicago, Illinois": { dx: -30, dy: -66, anchor: "end", short: "Chicago" },
  "Atlanta, Georgia": { dx: -30, dy: 70, anchor: "end", short: "Atlanta" },
  "New York City, New York": { dx: -10, dy: -84, anchor: "middle", short: "New York" }
};
const SHORT_ITEM = {
  pre_age: "60+", a1_sleep: "unsheltered", a2_duration: "long or repeat homelessness", b1_emergency: "4+ emergency contacts",
  b2_harm: "risk of harm", b3_legal: "legal issues", b4_exploitation: "exploitation", c1_money: "no income or debt",
  c2_activity: "no meaningful activity", c3_selfcare: "cannot meet basic needs", c4_relationships: "relationship cause",
  d1_physical: "physical health", d2_substance: "substance use", d3_mental: "mental health",
  d4_trimorbidity: "tri-morbidity", d5_medications: "medication problems", d6_trauma: "abuse or trauma cause"
};

const ageGroup = (a) => (a < 25 ? "18–24" : a < 40 ? "25–39" : a < 60 ? "40–59" : "60 and older");
const yesNo = (id) => (p) => (p.indicators.includes(id) ? "Yes" : "No");
const FACTORS = [
  { key: "gender", label: "Gender", of: (p) => p.gender, order: ["Female", "Male"] },
  { key: "race", label: "Race", of: (p) => RACE_SHORT[p.race], order: Object.values(RACE_SHORT) },
  { key: "city", label: "City", of: (p) => CITY_CALLOUT[p.location].short, order: CITIES.map((c) => CITY_CALLOUT[c].short) },
  { key: "age", label: "Age group", of: (p) => ageGroup(p.age), order: ["18–24", "25–39", "40–59", "60 and older"] },
  { key: "sleep", label: "Sleeping situation",
    of: (p) => (p.indicators.includes("a1_sleep") ? "Unsheltered or other" : "Shelter or transitional"),
    order: ["Shelter or transitional", "Unsheltered or other"] },
  { key: "chronic", label: "Long or repeat homelessness", of: yesNo("a2_duration"), order: ["Yes", "No"] },
  { key: "physical", label: "Physical health", of: yesNo("d1_physical"), order: ["Yes", "No"] },
  { key: "mental", label: "Mental health", of: yesNo("d3_mental"), order: ["Yes", "No"] },
  { key: "substance", label: "Substance use", of: yesNo("d2_substance"), order: ["Yes", "No"] }
];

let DATA = null;
let RUN = null;        // active complete run
let FACTOR = "gender";
let PROFILE_FILTER = "all";
let usMap = null;

/* ---------- formatting ---------- */

const pct = (k, n) => (n ? `${((100 * k) / n).toFixed(1)}%` : "—");
const pct0 = (k, n) => (n ? `${Math.round((100 * k) / n)}%` : "—");
const nPct = (k, n) => `${k} (${n ? ((100 * k) / n).toFixed(1) : "—"})`;
const priTag = (c) => `<span class="pri pri-${c}">${c}</span>`;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- tooltip ---------- */

const tip = document.createElement("div");
tip.className = "tooltip";
document.body.appendChild(tip);
function showTip(event, html) { tip.innerHTML = html; tip.classList.add("visible"); moveTip(event); }
function moveTip(event) {
  const pad = 14, r = tip.getBoundingClientRect();
  let x = event.clientX + pad, y = event.clientY + pad;
  if (x + r.width > innerWidth - 8) x = event.clientX - r.width - pad;
  if (y + r.height > innerHeight - 8) y = event.clientY - r.height - pad;
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
const hideTip = () => tip.classList.remove("visible");
function hover(sel, html) {
  sel.on("mouseenter", (e, d) => showTip(e, html(d))).on("mousemove", moveTip).on("mouseleave", hideTip);
}

/* ---------- shared UI ---------- */

function chipGroup(selector, options, active, onPick) {
  const wrap = d3.select(selector);
  wrap.selectAll("*").remove();
  options.forEach((o) => {
    const b = wrap.append("button").attr("class", "chip" + (o.empty ? " is-empty" : "")).attr("type", "button")
      .attr("aria-pressed", o.value === active).attr("disabled", o.disabled ? true : null);
    if (!o.disabled) b.on("click", () => onPick(o.value));
    b.append("span").text(o.label);
    if (o.count) b.append("span").attr("class", "chip-count").text(o.count);
  });
}

function legend(selector, items) {
  const el = d3.select(selector);
  el.selectAll("*").remove();
  items.forEach((it) => {
    const row = el.append("span").attr("class", "legend-item");
    const svg = row.append("svg").attr("width", 22).attr("height", 12).attr("aria-hidden", "true");
    if (it.kind === "line") svg.append("line").attr("x1", 1).attr("x2", 21).attr("y1", 6).attr("y2", 6)
      .attr("class", "cut-line");
    else svg.append("rect").attr("x", 5).attr("y", 1).attr("width", 11).attr("height", 10).attr("rx", 2).attr("fill", it.color);
    row.append("span").text(it.name);
  });
}

function table(selector, headers, rows) {
  const t = d3.select(selector);
  t.selectAll("*").remove();
  const tr = t.append("thead").append("tr");
  headers.forEach((h, i) => tr.append("th").attr("scope", "col").attr("class", i ? "model-col" : null).html(h));
  const tb = t.append("tbody");
  rows.forEach((r) => {
    const row = tb.append("tr").attr("class", r.cls || null);
    r.cells.forEach((c, i) => row.append("td").attr("class", i ? "cell sep" : "cmp").html(c ?? "—"));
  });
  return t;
}

function widthOf(selector, min = 520, max = 960) {
  const el = document.querySelector(selector);
  return Math.max(min, Math.min(max, (el && el.clientWidth) || 760));
}

/* ---------- data helpers ---------- */

const gem = (p) => RUN.answers[p.id].priority;
function tally(people) {
  const n = people.length;
  const v = Object.fromEntries(CATS.map((c) => [c, people.filter((p) => p.vispdat === c).length]));
  const g = Object.fromEntries(CATS.map((c) => [c, people.filter((p) => gem(p) === c).length]));
  const same = people.filter((p) => gem(p) === p.vispdat).length;
  const higher = people.filter((p) => RANK[gem(p)] > RANK[p.vispdat]).length;
  const lower = people.filter((p) => RANK[gem(p)] < RANK[p.vispdat]).length;
  return { n, v, g, same, higher, lower };
}
function groupsOf(factor) {
  const f = FACTORS.find((x) => x.key === factor);
  return f.order.map((name) => ({ name, people: DATA.profiles.filter((p) => f.of(p) === name) }));
}
function kappa(people) {
  const n = people.length, obs = {}, rv = {}, rg = {};
  CATS.forEach((a) => { rv[a] = 0; rg[a] = 0; CATS.forEach((b) => (obs[a + b] = 0)); });
  people.forEach((p) => { obs[p.vispdat + gem(p)]++; rv[p.vispdat]++; rg[gem(p)]++; });
  let num = 0, den = 0;
  CATS.forEach((a) => CATS.forEach((b) => {
    const w = Math.abs(RANK[a] - RANK[b]) / 2;
    num += (w * obs[a + b]) / n;
    den += w * (rv[a] / n) * (rg[b] / n);
  }));
  return den ? 1 - num / den : null;
}

/* ============================================================
   Overview
   ============================================================ */

function renderOverview() {
  const P = DATA.profiles, t = tally(P);
  d3.select("#overview-lede").text(
    `The VI‑SPDAT and ${RUN.label} placed the same ${t.n} synthetic people in High, Medium, or Low housing priority. ` +
    `Each person was a separate request to Gemini, which never saw the VI‑SPDAT questions or scores.`);

  // the group with the largest Gemini-minus-VI-SPDAT gap in share rated High, among demographic factors
  let gap = null;
  ["gender", "race", "city", "age"].forEach((f) => groupsOf(f).forEach((g) => {
    const tt = tally(g.people);
    const d = tt.g.High / tt.n - tt.v.High / tt.n;
    if (!gap || d > gap.d) gap = { f, g, tt, d };
  }));
  const fl = FACTORS.find((x) => x.key === gap.f).label.toLowerCase();
  const cards = [
    { kicker: "Agreement", stat: pct0(t.same, t.n), note: "placed in the same category by both",
      body: `Linear‑weighted Cohen's kappa = ${kappa(P).toFixed(2)}. ${t.n - t.same} people are placed differently.` },
    { kicker: "Direction", stat: `${t.higher} up · ${t.lower} down`,
      note: "people Gemini places above / below VI‑SPDAT",
      body: t.lower === 0 ? `Whenever the two disagree, Gemini assigns the higher priority; it never ranks anyone below VI‑SPDAT${RUN.stats ? ` (sign test p ${fmtP(RUN.stats.direction.p_sign)})` : ""}.`
        : `Gemini is higher for ${t.higher} people and lower for ${t.lower}.` },
    { kicker: "High priority", stat: `${t.v.High} → ${t.g.High}`, note: "people rated High: VI‑SPDAT → Gemini",
      body: `Gemini moves ${P.filter((p) => p.vispdat === "Medium" && gem(p) === "High").length} of VI‑SPDAT's ${t.v.Medium} Medium people up to High.` },
    { kicker: "Largest group gap", stat: `+${Math.round(gap.d * 100)} pts`, note: `${gap.g.name} (${fl}): share rated High, Gemini minus VI‑SPDAT`,
      body: `${pct0(gap.tt.v.High, gap.tt.n)} → ${pct0(gap.tt.g.High, gap.tt.n)} of ${gap.tt.n} people. Small groups: a few people move this number.` }
  ];
  const el = d3.select("#findings");
  el.selectAll("*").remove();
  cards.forEach((c) => {
    const a = el.append("article").attr("class", "fcard");
    a.append("p").attr("class", "fcard-kicker").text(c.kicker);
    a.append("p").attr("class", "fcard-stat").text(c.stat);
    a.append("p").attr("class", "fcard-note").text(c.note);
    a.append("p").attr("class", "fcard-body").text(c.body);
  });

  // grouped bars: count in each category
  legend("#legend-dist", [{ name: "VI‑SPDAT", color: css(TOOL_COLOR.vispdat) }, { name: RUN.label, color: css(TOOL_COLOR.gemini) }]);
  const W = widthOf("#chart-dist", 420, 760), H = 260, m = { t: 18, r: 16, b: 34, l: 40 };
  const svg = d3.select("#chart-dist").html("").append("svg").attr("width", W).attr("height", H)
    .attr("role", "img").attr("aria-label", `People in each priority category. VI-SPDAT: ${CATS.map((c) => `${c} ${t.v[c]}`).join(", ")}. Gemini: ${CATS.map((c) => `${c} ${t.g[c]}`).join(", ")}.`);
  const x0 = d3.scaleBand().domain(CATS).range([m.l, W - m.r]).paddingInner(0.3).paddingOuter(0.15);
  const x1 = d3.scaleBand().domain(["vispdat", "gemini"]).range([0, x0.bandwidth()]).padding(0.08);
  const y = d3.scaleLinear().domain([0, Math.max(t.n * 0.75, d3.max(CATS, (c) => Math.max(t.v[c], t.g[c])))]).nice().range([H - m.b, m.t]);
  svg.append("g").selectAll("line").data(y.ticks(5)).join("line").attr("class", "gridline")
    .attr("x1", m.l).attr("x2", W - m.r).attr("y1", y).attr("y2", y);
  svg.append("g").selectAll("text").data(y.ticks(5)).join("text").attr("class", "tick-text").attr("x", m.l - 8)
    .attr("y", y).attr("dy", "0.32em").attr("text-anchor", "end").text((d) => d);
  const bars = CATS.flatMap((c) => [{ c, tool: "vispdat", k: t.v[c] }, { c, tool: "gemini", k: t.g[c] }]);
  const bw = Math.min(x1.bandwidth(), 56);
  const g = svg.append("g").selectAll("g").data(bars).join("g");
  g.append("rect").attr("x", (d) => x0(d.c) + x1(d.tool) + (x1.bandwidth() - bw) / 2).attr("width", bw)
    .attr("y", (d) => y(d.k)).attr("height", (d) => y(0) - y(d.k)).attr("rx", 3)
    .attr("fill", (d) => css(TOOL_COLOR[d.tool]));
  g.append("text").attr("class", "bar-value").attr("text-anchor", "middle")
    .attr("x", (d) => x0(d.c) + x1(d.tool) + x1.bandwidth() / 2).attr("y", (d) => y(d.k) - 5).text((d) => d.k);
  hover(g, (d) => `<span class="tt-title">${d.c} priority</span><span class="tt-row">${d.tool === "vispdat" ? "VI‑SPDAT" : RUN.label}: ${d.k} of ${t.n} (${pct(d.k, t.n)})</span>`);
  svg.append("g").selectAll("text").data(CATS).join("text").attr("class", "axis-label").attr("text-anchor", "middle")
    .attr("x", (c) => x0(c) + x0.bandwidth() / 2).attr("y", H - 12).text((c) => c);

  renderCrosstab("#chart-crosstab", P);
  d3.select("#crosstab-foot").text(`Same category: ${t.same} of ${t.n}. Gemini higher: ${t.higher}. Gemini lower: ${t.lower}.`);
}

function renderCrosstab(selector, people) {
  const cell = 92, lw = 128, th = 46, W = lw + cell * 3 + 70, H = th + cell * 3 + 46;
  const svg = d3.select(selector).html("").append("svg").attr("width", W).attr("height", H).attr("role", "img")
    .attr("aria-label", "Cross-tabulation of VI-SPDAT priority (rows) and Gemini priority (columns).");
  const count = (a, b) => people.filter((p) => p.vispdat === a && gem(p) === b).length;
  const max = d3.max(CATS.flatMap((a) => CATS.map((b) => count(a, b))));
  const fillOf = (a, b, k) => d3.interpolateLab(css("--surface-sunk"), css(a === b ? "--series-1" : "--series-2"))(k ? 0.25 + 0.75 * (k / max) : 0);
  svg.append("text").attr("class", "axis-title").attr("x", lw + (cell * 3) / 2).attr("y", 14).attr("text-anchor", "middle").text(RUN.label.toUpperCase());
  CATS.forEach((b, j) => svg.append("text").attr("class", "axis-label").attr("x", lw + j * cell + cell / 2).attr("y", th - 10)
    .attr("text-anchor", "middle").text(b));
  CATS.forEach((a, i) => {
    svg.append("text").attr("class", "axis-label").attr("x", lw - 12).attr("y", th + i * cell + cell / 2).attr("dy", "0.32em")
      .attr("text-anchor", "end").text(`VI‑SPDAT ${a}`);
    let rowTotal = 0;
    CATS.forEach((b, j) => {
      const k = count(a, b);
      rowTotal += k;
      const fill = fillOf(a, b, k);
      const g = svg.append("g").attr("class", "xt-cell");
      g.append("rect").attr("x", lw + j * cell + 2).attr("y", th + i * cell + 2).attr("width", cell - 4).attr("height", cell - 4)
        .attr("rx", 6).attr("fill", fill).attr("stroke", a === b ? css("--series-1") : "none").attr("stroke-width", a === b ? 1.5 : 0);
      g.append("text").attr("x", lw + j * cell + cell / 2).attr("y", th + i * cell + cell / 2).attr("dy", "0.35em")
        .attr("text-anchor", "middle").attr("font-size", 22).attr("font-weight", 600)
        .attr("fill", d3.lab(fill).l > 62 ? "#0b0b0b" : "#ffffff").text(k);
      hover(g, () => `<span class="tt-title">VI‑SPDAT ${a} · Gemini ${b}</span><span class="tt-row">${k} people</span>`);
    });
    svg.append("text").attr("class", "group-n").attr("x", lw + cell * 3 + 12).attr("y", th + i * cell + cell / 2).attr("dy", "0.32em")
      .text(`n = ${rowTotal}`);
  });
  CATS.forEach((b, j) => svg.append("text").attr("class", "group-n").attr("x", lw + j * cell + cell / 2).attr("y", th + cell * 3 + 22)
    .attr("text-anchor", "middle").text(`n = ${people.filter((p) => gem(p) === b).length}`));
}

/* ============================================================
   By group
   ============================================================ */

function renderGroups() {
  chipGroup("#group-tabs", FACTORS.map((f) => ({ value: f.key, label: f.label })), FACTOR, (v) => { FACTOR = v; renderGroups(); });
  const f = FACTORS.find((x) => x.key === FACTOR);
  d3.select("#group-name").text(f.label.toLowerCase());
  d3.select("#group-name-2").text(f.label.toLowerCase());
  const groups = groupsOf(FACTOR).map((g) => ({ ...g, t: tally(g.people) }));
  legend("#legend-groups", [{ name: "VI‑SPDAT", color: css(TOOL_COLOR.vispdat) }, { name: RUN.label, color: css(TOOL_COLOR.gemini) }]);

  const W = widthOf("#chart-groups", 520, 900), lw = 220, bar = 16, gap = 4, row = bar * 2 + gap + 22;
  const H = groups.length * row + 40, m = { r: 54 };
  const x = d3.scaleLinear().domain([0, 1]).range([lw, W - m.r]);
  const svg = d3.select("#chart-groups").html("").append("svg").attr("width", W).attr("height", H).attr("role", "img")
    .attr("aria-label", `Share rated High by ${f.label}: ` + groups.map((g) => `${g.name}: VI-SPDAT ${pct0(g.t.v.High, g.t.n)}, Gemini ${pct0(g.t.g.High, g.t.n)}`).join("; "));
  [0, 0.25, 0.5, 0.75, 1].forEach((v) => {
    svg.append("line").attr("class", "gridline").attr("x1", x(v)).attr("x2", x(v)).attr("y1", 6).attr("y2", H - 26);
    svg.append("text").attr("class", "tick-text").attr("x", x(v)).attr("y", H - 10).attr("text-anchor", "middle").text(`${v * 100}%`);
  });
  groups.forEach((g, i) => {
    const y0 = 10 + i * row;
    svg.append("text").attr("class", "group-label").attr("x", lw - 12).attr("y", y0 + bar).attr("text-anchor", "end").text(g.name);
    svg.append("text").attr("class", "group-n").attr("x", lw - 12).attr("y", y0 + bar + 14).attr("text-anchor", "end").text(`n = ${g.t.n}`);
    [["vispdat", g.t.v.High], ["gemini", g.t.g.High]].forEach(([tool, k], j) => {
      const share = g.t.n ? k / g.t.n : 0, y = y0 + j * (bar + gap);
      const sel = svg.append("g").datum({ tool, k, g });
      sel.append("rect").attr("x", x(0)).attr("y", y).attr("height", bar).attr("width", Math.max(0, x(share) - x(0))).attr("rx", 3)
        .attr("fill", css(TOOL_COLOR[tool]));
      sel.append("text").attr("class", "bar-value").style("text-anchor", "start").attr("x", x(share) + 6).attr("y", y + bar / 2).attr("dy", "0.35em")
        .text(`${pct0(k, g.t.n)} (${k})`);
      hover(sel, (d) => `<span class="tt-title">${d.g.name}</span><span class="tt-row">${d.tool === "vispdat" ? "VI‑SPDAT" : RUN.label}: ${d.k} of ${d.g.t.n} rated High (${pct(d.k, d.g.t.n)})</span>`);
    });
  });

  table("#group-table",
    ["Group", "n", "VI‑SPDAT High", "Gemini High", "VI‑SPDAT Medium", "Gemini Medium", "VI‑SPDAT Low", "Gemini Low", "Same", "Gemini higher", "Gemini lower"],
    [{ name: "All people", t: tally(DATA.profiles), cls: "is-active" }].concat(groups).map((g) => ({
      cls: g.cls,
      cells: [esc(g.name), g.t.n, nPct(g.t.v.High, g.t.n), nPct(g.t.g.High, g.t.n), nPct(g.t.v.Medium, g.t.n), nPct(g.t.g.Medium, g.t.n),
        nPct(g.t.v.Low, g.t.n), nPct(g.t.g.Low, g.t.n), nPct(g.t.same, g.t.n), nPct(g.t.higher, g.t.n), nPct(g.t.lower, g.t.n)]
    })));
}

/* ============================================================
   Agreement
   ============================================================ */

function renderAgreement() {
  const P = DATA.profiles, t = tally(P);
  legend("#legend-byscore", CATS.map((c) => ({ name: `Gemini ${c}`, color: css(CAT_COLOR[c]) })).concat([{ kind: "line", name: "VI‑SPDAT cut-off" }]));
  const scores = d3.range(0, 18);
  const W = widthOf("#chart-byscore", 560, 960), H = 310, m = { t: 34, r: 12, b: 44, l: 40 };
  const x = d3.scaleBand().domain(scores).range([m.l, W - m.r]).padding(0.18);
  const maxN = d3.max(scores, (s) => P.filter((p) => p.score === s).length);
  const y = d3.scaleLinear().domain([0, maxN]).nice().range([H - m.b, m.t]);
  const svg = d3.select("#chart-byscore").html("").append("svg").attr("width", W).attr("height", H).attr("role", "img")
    .attr("aria-label", "Number of people at each VI-SPDAT score, split by Gemini's priority.");
  svg.append("g").selectAll("line").data(y.ticks(5)).join("line").attr("class", "gridline").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y).attr("y2", y);
  svg.append("g").selectAll("text").data(y.ticks(5)).join("text").attr("class", "tick-text").attr("x", m.l - 8).attr("y", y)
    .attr("dy", "0.32em").attr("text-anchor", "end").text((d) => d);
  scores.forEach((s) => {
    const at = P.filter((p) => p.score === s);
    let acc = 0;
    ["Low", "Medium", "High"].forEach((c) => {
      const k = at.filter((p) => gem(p) === c).length;
      if (!k) return;
      const sel = svg.append("rect").attr("x", x(s)).attr("width", x.bandwidth()).attr("y", y(acc + k)).attr("height", y(acc) - y(acc + k) - 1)
        .attr("fill", css(CAT_COLOR[c])).attr("rx", 2);
      hover(sel, () => `<span class="tt-title">VI‑SPDAT score ${s}</span><span class="tt-row">Gemini ${c}: ${k} of ${at.length}</span>`);
      acc += k;
    });
    svg.append("text").attr("class", "axis-label").attr("x", x(s) + x.bandwidth() / 2).attr("y", H - m.b + 16).attr("text-anchor", "middle").text(s);
  });
  svg.append("text").attr("class", "axis-title").attr("x", (m.l + W - m.r) / 2).attr("y", H - 6).attr("text-anchor", "middle").text("VI‑SPDAT SCORE");
  [[3.5, "Low | Medium"], [7.5, "Medium | High"]].forEach(([b, label]) => {
    const xx = (x(Math.floor(b)) + x.bandwidth() + x(Math.ceil(b))) / 2;
    svg.append("line").attr("class", "cut-line").attr("x1", xx).attr("x2", xx).attr("y1", m.t - 10).attr("y2", H - m.b);
    svg.append("text").attr("class", "cut-label").attr("x", xx).attr("y", m.t - 12).attr("text-anchor", "middle").text(label);
  });

  const k = kappa(P);
  table("#agreement-table", ["Measure", "People", "Share"], [
    { cells: ["Same category", t.same, pct(t.same, t.n)] },
    { cells: ["Gemini higher than VI‑SPDAT", t.higher, pct(t.higher, t.n)] },
    { cells: ["Gemini lower than VI‑SPDAT", t.lower, pct(t.lower, t.n)] },
    ...CATS.map((c) => {
      const inC = P.filter((p) => p.vispdat === c);
      const same = inC.filter((p) => gem(p) === c).length;
      return { cells: [`VI‑SPDAT ${c}: Gemini agrees`, `${same} of ${inC.length}`, pct(same, inC.length)] };
    })
  ]);
  d3.select("#agreement-foot").text(`Linear-weighted Cohen's kappa = ${k.toFixed(2)} (0 = chance agreement, 1 = perfect).`);

  const dis = P.filter((p) => gem(p) !== p.vispdat).sort((a, b) => a.score - b.score || +a.id.slice(1) - +b.id.slice(1));
  table("#disagree-table", ["ID", "Person", "Score", "VI‑SPDAT", "Gemini", "Gemini's explanation"],
    dis.map((p) => ({ cells: [p.id, `${esc(p.label)}<br><span class="group-n">${p.age}, ${p.gender}, ${esc(RACE_SHORT[p.race])}, ${CITY_CALLOUT[p.location].short}</span>`,
      p.score, priTag(p.vispdat), priTag(gem(p)), esc(RUN.answers[p.id].explanation)] })));
}

/* ============================================================
   Overview: dumbbell across every group
   ============================================================ */

function renderDumbbell() {
  legend("#legend-dumbbell", [{ name: "VI‑SPDAT", color: css(TOOL_COLOR.vispdat) }, { name: RUN.label, color: css(TOOL_COLOR.gemini) }]);
  const rows = [];
  ["gender", "race", "city", "age"].forEach((fk) => {
    const f = FACTORS.find((x) => x.key === fk);
    rows.push({ head: f.label });
    groupsOf(fk).forEach((g) => { const t = tally(g.people); rows.push({ name: g.name, t }); });
  });
  const W = widthOf("#chart-dumbbell", 560, 960), lw = 200, rh = 24, H = rows.length * rh + 40, mr = 60;
  const x = d3.scaleLinear().domain([0, 1]).range([lw, W - mr]);
  const svg = d3.select("#chart-dumbbell").html("").append("svg").attr("width", W).attr("height", H).attr("role", "img")
    .attr("aria-label", "Share rated High in each group, VI-SPDAT and Gemini.");
  [0, 0.25, 0.5, 0.75, 1].forEach((v) => {
    svg.append("line").attr("class", "gridline").attr("x1", x(v)).attr("x2", x(v)).attr("y1", 4).attr("y2", H - 26);
    svg.append("text").attr("class", "tick-text").attr("x", x(v)).attr("y", H - 10).attr("text-anchor", "middle").text(`${v * 100}%`);
  });
  rows.forEach((r, i) => {
    const cy = 14 + i * rh;
    if (r.head) {
      svg.append("text").attr("class", "axis-title").attr("x", 0).attr("y", cy + 4).text(r.head.toUpperCase());
      return;
    }
    const a = r.t.v.High / r.t.n, b = r.t.g.High / r.t.n;
    svg.append("text").attr("class", "group-label").attr("x", lw - 12).attr("y", cy).attr("dy", "0.35em").attr("text-anchor", "end").text(r.name);
    const g = svg.append("g");
    g.append("line").attr("x1", x(a)).attr("x2", x(b)).attr("y1", cy).attr("y2", cy).attr("stroke", css("--rule-strong")).attr("stroke-width", 3);
    g.append("circle").attr("cx", x(a)).attr("cy", cy).attr("r", 6).attr("fill", css(TOOL_COLOR.vispdat));
    g.append("circle").attr("cx", x(b)).attr("cy", cy).attr("r", 6).attr("fill", css(TOOL_COLOR.gemini));
    g.append("text").attr("class", "bar-value").style("text-anchor", "start").attr("x", x(Math.max(a, b)) + 10).attr("y", cy).attr("dy", "0.35em")
      .text(`${pct0(r.t.v.High, r.t.n)} → ${pct0(r.t.g.High, r.t.n)}`);
    hover(g, () => `<span class="tt-title">${r.name} (n = ${r.t.n})</span><span class="tt-row">VI‑SPDAT High: ${r.t.v.High} (${pct(r.t.v.High, r.t.n)})</span><span class="tt-row">${RUN.label} High: ${r.t.g.High} (${pct(r.t.g.High, r.t.n)})</span>`);
  });
}

/* ============================================================
   By group: 100% stacked bars, all three categories
   ============================================================ */

function renderStacked() {
  legend("#legend-stacked", CATS.map((c) => ({ name: c, color: css(CAT_COLOR[c]) })));
  const groups = groupsOf(FACTOR).map((g) => ({ ...g, t: tally(g.people) }));
  const W = widthOf("#chart-stacked", 560, 960), lw = 220, bar = 15, gap = 3, row = bar * 2 + gap + 20, mr = 16;
  const H = groups.length * row + 36;
  const x = d3.scaleLinear().domain([0, 1]).range([lw, W - mr]);
  const svg = d3.select("#chart-stacked").html("").append("svg").attr("width", W).attr("height", H).attr("role", "img")
    .attr("aria-label", "High, Medium, and Low shares within each group for VI-SPDAT and Gemini.");
  [0, 0.25, 0.5, 0.75, 1].forEach((v) =>
    svg.append("text").attr("class", "tick-text").attr("x", x(v)).attr("y", H - 8).attr("text-anchor", "middle").text(`${v * 100}%`));
  groups.forEach((g, i) => {
    const y0 = 8 + i * row;
    svg.append("text").attr("class", "group-label").attr("x", lw - 12).attr("y", y0 + bar).attr("text-anchor", "end").text(g.name);
    svg.append("text").attr("class", "group-n").attr("x", lw - 12).attr("y", y0 + bar + 14).attr("text-anchor", "end").text(`n = ${g.t.n}`);
    [["VI‑SPDAT", g.t.v], [RUN.label, g.t.g]].forEach(([tool, counts], j) => {
      let acc = 0;
      const y = y0 + j * (bar + gap);
      CATS.forEach((c) => {
        const share = counts[c] / g.t.n;
        if (!share) return;
        const sel = svg.append("g");
        sel.append("rect").attr("x", x(acc)).attr("y", y).attr("width", Math.max(0, x(acc + share) - x(acc) - 1)).attr("height", bar)
          .attr("fill", css(CAT_COLOR[c]));
        if (share >= 0.08) sel.append("text").attr("class", "bar-value").attr("text-anchor", "middle")
          .attr("x", (x(acc) + x(acc + share)) / 2).attr("y", y + bar / 2).attr("dy", "0.35em").style("fill", "#0b0b0b").text(pct0(counts[c], g.t.n));
        hover(sel, () => `<span class="tt-title">${g.name} · ${tool}</span><span class="tt-row">${c}: ${counts[c]} of ${g.t.n} (${pct(counts[c], g.t.n)})</span>`);
        acc += share;
      });
    });
  });
}

/* ============================================================
   Significance
   ============================================================ */

const fmtP = (p) => (p === null || p === undefined ? "—" : p < 0.001 ? "< .001" : p.toFixed(3).replace(/^0/, ""));

function renderSignificance() {
  const S = RUN.stats;
  if (!S) { d3.select("#sig-lede").text("Significance tests are not available for this run yet."); return; }
  const sigItems = S.items.filter((i) => i.p_holm < 0.05);
  const rawItems = S.items.filter((i) => i.p < 0.05);
  const sigDemo = S.demographics.filter((d) => d.p_holm < 0.05);
  d3.select("#sig-lede").text(
    `Of the ${S.eligible} people VI‑SPDAT rated Low or Medium, ${RUN.label} placed ${S.upgraded} higher. These exploratory tests ask whether a ` +
    `group or circumstance changes that judgment once the VI‑SPDAT score is held fixed. With 100 people, small differences cannot be detected.`);
  const cards = [
    { kicker: "Direction", stat: `p ${fmtP(S.direction.p_sign)}`, note: `${S.direction.higher} placed higher vs ${S.direction.lower} lower (exact sign test)`,
      body: "Gemini assigns higher priority than VI‑SPDAT far more often than chance would predict. This is the clearest result of the pilot." },
    { kicker: "VI-SPDAT score", stat: "Main driver", note: "of who Gemini moves up",
      body: "Upgrades follow the VI‑SPDAT score: none at scores 0–1, most at the top of each band (score 3, and 5–7). Gemini rates everyone scoring 6 or more High (VI‑SPDAT starts at 8)." },
    { kicker: "Demographics", stat: `${sigDemo.length} of ${S.demographics.length}`, note: "gender, race, city, age: significant after Holm",
      body: sigDemo.length ? sigDemo.map((d) => d.factor).join(", ") : "No demographic group changes Gemini's judgment once the VI‑SPDAT score is held fixed." },
    { kicker: "Circumstances", stat: `${sigItems.length} of ${S.items.length}`, note: "significant after Holm correction",
      body: rawItems.length ? `Before correction: ${rawItems.map((i) => `${i.name.toLowerCase()} (p ${fmtP(i.p)})`).join("; ")}. None survives correction.` : "None." }
  ];
  const el = d3.select("#sig-cards").html("");
  cards.forEach((c) => {
    const a = el.append("article").attr("class", "fcard");
    a.append("p").attr("class", "fcard-kicker").text(c.kicker);
    a.append("p").attr("class", "fcard-stat").text(c.stat);
    a.append("p").attr("class", "fcard-note").text(c.note);
    a.append("p").attr("class", "fcard-body").text(c.body);
  });

  // upgrade rate by score
  const elig = DATA.profiles.filter((p) => p.vispdat !== "High");
  const scores = d3.range(0, 8);
  const pts = scores.map((s) => {
    const at = elig.filter((p) => p.score === s);
    const k = at.filter((p) => RANK[gem(p)] > RANK[p.vispdat]).length;
    return { s, n: at.length, k, r: at.length ? k / at.length : 0 };
  });
  const W = widthOf("#chart-upgrade-score", 520, 860), H = 260, m = { t: 20, r: 16, b: 46, l: 46 };
  const x = d3.scaleBand().domain(scores).range([m.l, W - m.r]).padding(0.25);
  const y = d3.scaleLinear().domain([0, 1]).range([H - m.b, m.t]);
  const svg = d3.select("#chart-upgrade-score").html("").append("svg").attr("width", W).attr("height", H).attr("role", "img")
    .attr("aria-label", "Share placed higher by Gemini at each VI-SPDAT score: " + pts.map((d) => `score ${d.s}: ${d.k} of ${d.n}`).join(", "));
  [0, 0.25, 0.5, 0.75, 1].forEach((v) => {
    svg.append("line").attr("class", "gridline").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(v)).attr("y2", y(v));
    svg.append("text").attr("class", "tick-text").attr("x", m.l - 8).attr("y", y(v)).attr("dy", "0.32em").attr("text-anchor", "end").text(`${v * 100}%`);
  });
  pts.forEach((d) => {
    const g = svg.append("g");
    g.append("rect").attr("x", x(d.s)).attr("width", x.bandwidth()).attr("y", y(d.r)).attr("height", y(0) - y(d.r)).attr("rx", 3)
      .attr("fill", css(d.s >= 4 ? "--series-4" : "--series-3"));
    g.append("text").attr("class", "bar-value").attr("text-anchor", "middle").attr("x", x(d.s) + x.bandwidth() / 2).attr("y", y(d.r) - 5).text(`${d.k}/${d.n}`);
    svg.append("text").attr("class", "axis-label").attr("x", x(d.s) + x.bandwidth() / 2).attr("y", H - m.b + 16).attr("text-anchor", "middle").text(d.s);
    hover(g, () => `<span class="tt-title">VI‑SPDAT score ${d.s} (${d.s >= 4 ? "Medium" : "Low"})</span><span class="tt-row">Placed higher by Gemini: ${d.k} of ${d.n} (${pct(d.k, d.n)})</span>`);
  });
  svg.append("text").attr("class", "axis-title").attr("x", (m.l + W - m.r) / 2).attr("y", H - 8).attr("text-anchor", "middle").text("VI‑SPDAT SCORE (LOW 0–3 · MEDIUM 4–7)");

  // dumbbell per circumstance
  legend("#legend-items", [{ name: "With the circumstance", color: css("--series-2") }, { name: "Without", color: css("--ink-muted") }]);
  const items = S.items.slice().sort((a, b) => a.p - b.p);
  const W2 = widthOf("#chart-items", 600, 960), lw = 280, rh = 28, rw = 150, H2 = items.length * rh + 44;
  const x2 = d3.scaleLinear().domain([0, 1]).range([lw, W2 - rw - 24]);
  const s2 = d3.select("#chart-items").html("").append("svg").attr("width", W2).attr("height", H2).attr("role", "img")
    .attr("aria-label", "Share placed higher with and without each circumstance, with p-values.");
  [0, 0.25, 0.5, 0.75, 1].forEach((v) => {
    s2.append("line").attr("class", "gridline").attr("x1", x2(v)).attr("x2", x2(v)).attr("y1", 10).attr("y2", H2 - 28);
    s2.append("text").attr("class", "tick-text").attr("x", x2(v)).attr("y", H2 - 12).attr("text-anchor", "middle").text(`${v * 100}%`);
  });
  s2.append("text").attr("class", "axis-title").attr("x", W2 - rw + 30).attr("y", 8).text("p (HOLM p)");
  items.forEach((it, i) => {
    const cy = 24 + i * rh, a = it.with.rate, b = it.without.rate;
    s2.append("text").attr("class", "group-label").attr("x", lw - 12).attr("y", cy).attr("dy", "0.35em").attr("text-anchor", "end").text(it.name);
    const g = s2.append("g");
    g.append("line").attr("x1", x2(a)).attr("x2", x2(b)).attr("y1", cy).attr("y2", cy).attr("stroke", css("--rule-strong")).attr("stroke-width", 3);
    g.append("circle").attr("cx", x2(b)).attr("cy", cy).attr("r", 5.5).attr("fill", css("--surface")).attr("stroke", css("--ink-muted")).attr("stroke-width", 2);
    g.append("circle").attr("cx", x2(a)).attr("cy", cy).attr("r", 6).attr("fill", css("--series-2"));
    s2.append("text").attr("class", "bar-value").attr("x", W2 - rw + 30).attr("y", cy).attr("dy", "0.35em").style("text-anchor", "start")
      .attr("font-weight", it.p_holm < 0.05 ? 700 : 500).text(`${fmtP(it.p)} (${fmtP(it.p_holm)})`);
    hover(g, () => `<span class="tt-title">${it.name}</span><span class="tt-row">With: ${it.with.upgraded} of ${it.with.n} placed higher (${pct(it.with.upgraded, it.with.n)})</span><span class="tt-row">Without: ${it.without.upgraded} of ${it.without.n} (${pct(it.without.upgraded, it.without.n)})</span><span class="tt-row">p = ${fmtP(it.p)}, Holm p = ${fmtP(it.p_holm)}</span>`);
  });

  table("#sig-demo-table", ["Factor", "Placed higher in each group", "p", "Holm p"],
    S.demographics.map((d) => ({ cells: [d.factor,
      d.groups.map((g) => `${esc(RACE_SHORT[g.group] || (CITY_CALLOUT[g.group] ? CITY_CALLOUT[g.group].short : g.group))}: ${g.upgraded}/${g.n} (${pct0(g.upgraded, g.n)})`).join("<br>"),
      fmtP(d.p), fmtP(d.p_holm)] })));
  d3.select("#sig-method").text(S.method + " Exploratory: the pilot was not designed with the power to detect small differences.");
}

/* ============================================================
   Cities
   ============================================================ */

function renderCities() {
  const wrap = d3.select("#city-maps").html("").attr("class", "map-grid is-compact");
  const tools = [{ key: "vispdat", label: "VI‑SPDAT", of: (p) => p.vispdat }, { key: "gemini", label: RUN.label, of: gem }];
  const color = d3.scaleLinear().domain([0, 1]).range([css("--div-mid"), css("--div-pos")]).interpolate(d3.interpolateLab);
  const stats = tools.map((tool) => ({ tool, cities: CITIES.map((c) => {
    const at = DATA.profiles.filter((p) => p.location === c);
    const k = at.filter((p) => tool.of(p) === "High").length;
    return { c, k, n: at.length, share: k / at.length };
  }) }));
  const leg = d3.select("#legend-cities").html("");
  const lsvg = leg.append("svg").attr("width", 240).attr("height", 32).attr("aria-hidden", "true");
  const grad = lsvg.append("defs").append("linearGradient").attr("id", "grad-cities");
  [0, 0.5, 1].forEach((v) => grad.append("stop").attr("offset", `${v * 100}%`).attr("stop-color", color(v)));
  lsvg.append("rect").attr("x", 0).attr("y", 2).attr("width", 240).attr("height", 10).attr("rx", 2).attr("fill", "url(#grad-cities)");
  [[0, 0, "start"], [0.5, 120, "middle"], [1, 240, "end"]].forEach(([v, xx, a]) =>
    lsvg.append("text").attr("class", "tick-text").attr("x", xx).attr("y", 26).attr("text-anchor", a).text(`${v * 100}%`));
  leg.append("span").attr("class", "grad-caption").text("Share of the city's 20 people rated High");

  const draw = (us) => {
    const states = topojson.feature(us, us.objects.states).features.filter((f) => !["02", "15"].includes(String(f.id)));
    const lower48 = topojson.merge(us, us.objects.states.geometries.filter((g) => !["02", "15"].includes(String(g.id))));
    const path = d3.geoPath();
    const projection = d3.geoAlbersUsa().scale(1300).translate([487.5, 305]);
    const [[x0, y0], [x1, y1]] = path.bounds(lower48);
    const box = [x0 - 16, y0 - 16, x1 - x0 + 32, y1 - y0 + 32];
    stats.forEach(({ tool, cities }) => {
      const panel = wrap.append("figure").attr("class", "map-panel");
      const cap = panel.append("figcaption").attr("class", "map-panel-head");
      cap.append("span").attr("class", "map-panel-title").text(tool.label);
      const vals = cities.map((c) => c.share);
      cap.append("span").attr("class", "map-panel-sub").text(`${pct0(d3.min(vals), 1)}–${pct0(d3.max(vals), 1)} rated High`);
      const svg = panel.append("div").attr("class", "map map-small").append("svg").attr("viewBox", box.join(" ")).attr("role", "img")
        .attr("aria-label", `${tool.label}: share rated High in each city. ` + cities.map((c) => `${CITY_CALLOUT[c.c].short} ${pct0(c.k, c.n)}`).join(", "));
      svg.append("g").selectAll("path").data(states).join("path").attr("class", "state").attr("d", path);
      svg.append("path").datum(lower48).attr("class", "nation").attr("d", path);
      cities.forEach((c) => {
        const pt = projection(CITY_COORDS[c.c]);
        const L = CITY_CALLOUT[c.c], fill = color(c.share);
        const bx = pt[0] + L.dx, by = pt[1] + L.dy, w = 158, h = 74;
        const left = L.anchor === "end" ? bx - w : L.anchor === "middle" ? bx - w / 2 : bx;
        const ex = Math.max(left, Math.min(pt[0], left + w)), ey = Math.max(by - h / 2, Math.min(pt[1], by + h / 2));
        const g = svg.append("g").attr("class", "city").attr("tabindex", 0);
        g.append("line").attr("class", "city-leader").attr("x1", pt[0]).attr("y1", pt[1]).attr("x2", ex).attr("y2", ey);
        g.append("circle").attr("class", "city-pin").attr("cx", pt[0]).attr("cy", pt[1]).attr("r", 6);
        g.append("rect").attr("class", "city-box").attr("x", left).attr("y", by - h / 2).attr("width", w).attr("height", h).attr("rx", 8).attr("fill", fill);
        const ink = d3.lab(fill).l > 62 ? "#0b0b0b" : "#ffffff";
        g.append("text").attr("class", "city-name").attr("x", left + w / 2).attr("y", by - 9).attr("text-anchor", "middle").attr("fill", ink).text(L.short);
        g.append("text").attr("class", "city-val").attr("x", left + w / 2).attr("y", by + 25).attr("text-anchor", "middle").attr("fill", ink).text(pct0(c.k, c.n));
        hover(g, () => `<span class="tt-title">${c.c} · ${tool.label}</span><span class="tt-row">${c.k} of ${c.n} rated High (${pct(c.k, c.n)})</span>`);
      });
    });
  };
  if (usMap) draw(usMap);
  else d3.json("assets/vendor/states-albers-10m.json").then((us) => { usMap = us; draw(us); });

  table("#city-table", ["City", "n", "VI‑SPDAT High", "Gemini High", "Same", "Gemini higher", "Gemini lower"],
    CITIES.map((c) => {
      const t = tally(DATA.profiles.filter((p) => p.location === c));
      return { cells: [c, t.n, nPct(t.v.High, t.n), nPct(t.g.High, t.n), nPct(t.same, t.n), nPct(t.higher, t.n), nPct(t.lower, t.n)] };
    }));
}

/* ============================================================
   The 17 factors
   ============================================================ */

const FACTOR_PLAIN = {
  pre_age: "Is 60 or older",
  a1_sleep: "Sleeps anywhere other than a shelter, transitional housing, or a safe haven (car, outdoors, a couch)",
  a2_duration: "Homeless 1 year or more without a break, or 4 or more times in 3 years",
  b1_emergency: "4 or more emergency contacts in 6 months: ER visits, ambulance rides, hospital stays, crisis calls, police, or jail",
  b2_harm: "Attacked since becoming homeless, or threatened or tried to harm self or others",
  b3_legal: "Legal trouble that could lead to jail or fines",
  b4_exploitation: "Forced or tricked into things, or trades sex, drugs, or favors",
  c1_money: "No regular income, or owes money",
  c2_activity: "No planned activities that bring happiness or fulfillment",
  c3_selfcare: "Cannot take care of basic needs such as washing, clean clothes, and meals",
  c4_relationships: "Became homeless because of a relationship breakdown or family or friends",
  d1_physical: "Chronic illness, physical disability, pregnancy, or HIV",
  d2_substance: "Drinking or drug use that cost housing or makes it hard to keep",
  d3_mental: "Mental illness, head injury, or learning or cognitive impairment that affects housing",
  d4_trimorbidity: "Meets physical health, substance use, and mental health together (scored automatically)",
  d5_medications: "Not taking, or selling, prescribed medication",
  d6_trauma: "Became homeless because of abuse or trauma"
};
const DOMAIN_TOKEN = { "—": "--ink-muted", A: "--series-1", B: "--series-2", C: "--series-3", D: "--series-4" };

function renderFactors() {
  const P = DATA.profiles, n = P.length, items = DATA.instrument.items;
  const bandName = { 1: "Low", 2: "Medium", 3: "High" };
  const bands = d3.select("#factor-bands").html("");
  DATA.instrument.bands.forEach((b) => {
    const k = P.filter((p) => p.score >= b.min && p.score <= b.max).length;
    const a = bands.append("article").attr("class", "fcard");
    a.append("p").attr("class", "fcard-kicker").text(`Score ${b.min}–${b.max}`);
    a.append("p").attr("class", "fcard-stat").text(bandName[b.id]);
    a.append("p").attr("class", "fcard-note").text(b.name);
    a.append("p").attr("class", "fcard-body").text(`${k} of ${n} people in the pilot.`);
  });
  const mean = d3.mean(P, (p) => p.score);
  const a = bands.append("article").attr("class", "fcard");
  a.append("p").attr("class", "fcard-kicker").text("Factors per person");
  a.append("p").attr("class", "fcard-stat").text(mean.toFixed(1));
  a.append("p").attr("class", "fcard-note").text("average VI‑SPDAT score of the 100 people");
  a.append("p").attr("class", "fcard-body").text(`Scores range from ${d3.min(P, (p) => p.score)} to ${d3.max(P, (p) => p.score)}.`);

  const domains = [...new Map(items.map((i) => [i.letter, i.domain])).entries()];
  legend("#legend-factors", domains.map(([l, d]) => ({ name: l === "—" ? d : `${l}. ${d}`, color: css(DOMAIN_TOKEN[l]) })));
  const W = widthOf("#chart-factors", 600, 960), lw = 300, rh = 26, H = items.length * rh + 34, mr = 70;
  const x = d3.scaleLinear().domain([0, n]).range([lw, W - mr]);
  const svg = d3.select("#chart-factors").html("").append("svg").attr("width", W).attr("height", H).attr("role", "img")
    .attr("aria-label", "Number of people meeting each VI-SPDAT factor: " + items.map((i) => `${i.name} ${P.filter((p) => p.indicators.includes(i.id)).length}`).join(", "));
  [0, 25, 50, 75, 100].forEach((v) => {
    svg.append("line").attr("class", "gridline").attr("x1", x(v)).attr("x2", x(v)).attr("y1", 4).attr("y2", H - 24);
    svg.append("text").attr("class", "tick-text").attr("x", x(v)).attr("y", H - 8).attr("text-anchor", "middle").text(v);
  });
  items.forEach((it, i) => {
    const k = P.filter((p) => p.indicators.includes(it.id)).length, y = 8 + i * rh;
    svg.append("text").attr("class", "group-label").attr("x", lw - 12).attr("y", y + 9).attr("dy", "0.35em").attr("text-anchor", "end")
      .text(`${i + 1}. ${it.name}`);
    const g = svg.append("g");
    g.append("rect").attr("x", x(0)).attr("y", y).attr("height", 18).attr("width", x(k) - x(0)).attr("rx", 3).attr("fill", css(DOMAIN_TOKEN[it.letter]));
    g.append("text").attr("class", "bar-value").style("text-anchor", "start").attr("x", x(k) + 6).attr("y", y + 9).attr("dy", "0.35em").text(`${k}`);
    hover(g, () => `<span class="tt-title">${it.name}</span><span class="tt-row">${FACTOR_PLAIN[it.id]}</span><span class="tt-row">${k} of ${n} people</span>`);
  });

  table("#factor-table", ["#", "Factor", "Counts as yes when the person…", "VI‑SPDAT questions", "Published scoring rule", "People"],
    items.map((it, i) => ({ cells: [
      i + 1,
      `<span class="domain-swatch" style="background:${css(DOMAIN_TOKEN[it.letter])}"></span>${esc(it.name)}<br><span class="group-n">${it.letter === "—" ? "" : it.letter + ". "}${esc(it.domain)}</span>`,
      esc(FACTOR_PLAIN[it.id]), esc(it.questions), esc(it.rule),
      `${P.filter((p) => p.indicators.includes(it.id)).length}`
    ] })));
  d3.select("#factor-foot").text(`Rules quoted from VI‑SPDAT ${DATA.instrument.version}, ${DATA.instrument.population}. ${DATA.instrument.copyright}`);
}

/* ============================================================
   Profiles
   ============================================================ */

let openProfile = null;
function renderProfiles() {
  const P = DATA.profiles;
  const filters = [
    { value: "all", label: "All", count: P.length },
    { value: "same", label: "Same category", count: P.filter((p) => gem(p) === p.vispdat).length },
    { value: "differ", label: "Placed differently", count: P.filter((p) => gem(p) !== p.vispdat).length }
  ];
  chipGroup("#profile-filter", filters, PROFILE_FILTER, (v) => { PROFILE_FILTER = v; renderProfiles(); });
  const rows = P.filter((p) => PROFILE_FILTER === "all" || (PROFILE_FILTER === "same") === (gem(p) === p.vispdat));
  const t = d3.select("#profile-table").html("");
  const head = t.append("thead").append("tr");
  ["ID", "Person", "Age", "Gender", "Race", "City", "VI‑SPDAT score", "VI‑SPDAT", "Gemini"].forEach((h, i) =>
    head.append("th").attr("scope", "col").attr("class", i ? "model-col" : null).text(h));
  const tb = t.append("tbody");
  rows.forEach((p) => {
    const tr = tb.append("tr").attr("class", "prow").attr("tabindex", 0).attr("aria-expanded", openProfile === p.id);
    [p.id, esc(p.label), p.age, p.gender, esc(RACE_SHORT[p.race]), CITY_CALLOUT[p.location].short, p.score, priTag(p.vispdat), priTag(gem(p))]
      .forEach((c, i) => tr.append("td").attr("class", i ? "cell sep" : "cmp").html(c));
    const toggle = () => { openProfile = openProfile === p.id ? null : p.id; renderProfiles(); };
    tr.on("click", toggle).on("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    if (openProfile !== p.id) return;
    const td = tb.append("tr").attr("class", "pdetail").append("td").attr("colspan", 9);
    const grid = td.append("div").attr("class", "pdetail-grid");
    const left = grid.append("div");
    left.append("p").attr("class", "demo-line").text(p.demographic_line);
    const dl = left.append("dl");
    p.narrative.forEach(([title, text]) => { dl.append("dt").text(title); dl.append("dd").text(text); });
    const side = grid.append("div").attr("class", "pdetail-side");
    side.append("h4").text(`VI‑SPDAT: ${p.score} of 17 · ${p.vispdat}`);
    const ul = side.append("ul");
    if (!p.indicators.length) ul.append("li").text("No items met");
    p.indicators.forEach((i) => ul.append("li").text(SHORT_ITEM[i]));
    side.append("h4").text(`${RUN.label}: ${gem(p)}`);
    side.append("p").text(RUN.answers[p.id].explanation || "—");
  });
}

/* ============================================================
   Study design & downloads
   ============================================================ */

function renderDesign() {
  const runs = DATA.runs.map((r) => `${r.label}: ${r.complete ? "complete (100 of 100), shown here" : `in progress (${r.done} of ${r.total}); added when complete`}. ${r.note}`);
  d3.select("#design-runs").html(`<strong>Gemini runs.</strong> ${runs.map(esc).join(" ")}`);
  const pr = DATA.prompt;
  d3.select("#prompt-text").text(`${pr.instructions}\n\nCase summary\nAge [age]. Gender: [gender]. Race: [race]. Location: [city].\n\n` +
    pr.sections.map((s) => `${s}: [text]`).join("\n") + `\n\n${pr.reply_format}`);

  const P = DATA.profiles, n = P.length, rows = [];
  FACTORS.slice(0, 4).forEach((f) => {
    rows.push({ cls: "is-active", cells: [`<strong>${f.label}</strong>`, "", ""] });
    f.order.forEach((g) => { const k = P.filter((p) => f.of(p) === g).length; rows.push({ cells: [g, k, pct(k, n)] }); });
  });
  rows.push({ cls: "is-active", cells: ["<strong>VI‑SPDAT priority</strong>", "", ""] });
  CATS.forEach((c) => { const k = P.filter((p) => p.vispdat === c).length; rows.push({ cells: [c, k, pct(k, n)] }); });
  table("#composition-table", ["Group", "n", "%"], rows);

  let last = null;
  const irows = [];
  DATA.instrument.items.forEach((i) => {
    if (i.domain !== last) { irows.push({ cls: "is-active", cells: [`<strong>${i.letter === "—" ? "" : i.letter + ". "}${esc(i.domain)}</strong>`, "", "", ""] }); last = i.domain; }
    const k = P.filter((p) => p.indicators.includes(i.id)).length;
    irows.push({ cells: [esc(i.name), esc(i.questions), esc(i.rule), `${k} (${pct0(k, n)})`] });
  });
  table("#items-table", ["Item", "Questions", "Scoring rule", "People meeting it"], irows);
  d3.select("#items-foot").text(`Rules quoted from VI‑SPDAT ${DATA.instrument.version}, ${DATA.instrument.population}. ${DATA.instrument.copyright}`);
}

function renderDownloads() {
  const files = [
    ["Dashboard data", "data/dashboard.json", "Every profile, VI‑SPDAT score and priority, and each complete Gemini run's answers."],
    ["Profiles", "data/profiles.json", "The 100 people: demographics, VI‑SPDAT items, and case summaries."],
    ["VI‑SPDAT scores", "data/vispdat_scores.csv", "Score, domain subtotals, recommendation, and priority per person."],
    ["Results by person", "results/by_profile.csv", "VI‑SPDAT and Gemini priority side by side, with Gemini's explanation."],
    ["Comparison by group", "results/comparison_by_group.csv", "Counts and within-group percentages for every group."],
    ["Composition", "results/composition.csv", "Counts and percentages for every group and VI‑SPDAT item."],
    ["Significance tests", "results/significance_gemini.csv", "Stratified permutation tests by group and circumstance (Flash-Lite run)."],
    ["Reasoning-token check", "results/thinking_check_gemini-3.8-flash.json", "Token use per request for Gemini 3.8 Flash under the study settings."],
    ["Results tables (Word)", "exports/pilot_results.docx", "APA tables: composition, cross-tab, and comparison by group."],
    ["Appendix (Word)", "exports/pilot_appendix.docx", "VI‑SPDAT items and rules, the Gemini prompt, and all 100 profiles."]
  ];
  table("#downloads-table", ["File", "Contents"], files.map(([name, href, what]) => ({ cells: [`<a href="${href}">${name}</a>`, what] })));
}

/* ============================================================
   Shell
   ============================================================ */

function renderAll() {
  if (!DATA || !RUN) return;
  const complete = DATA.runs.filter((r) => r.complete);
  chipGroup("#model-chips", DATA.runs.map((r) => ({ value: r.key, label: r.label, disabled: !r.complete, empty: !r.complete,
    count: r.complete ? null : `${r.done}/${r.total}` })), RUN.key, (v) => { RUN = complete.find((r) => r.key === v); renderAll(); });
  const pending = DATA.runs.filter((r) => !r.complete);
  d3.select("#run-status").attr("class", "table-note-inline run-pending")
    .text(pending.length ? `${pending.map((r) => r.label).join(", ")} in progress; shown when all 100 are done` : "");
  renderOverview();
  renderDumbbell();
  renderGroups();
  renderStacked();
  renderSignificance();
  renderAgreement();
  renderCities();
  renderFactors();
  renderProfiles();
  renderDesign();
  renderDownloads();
}

const VIEWS = [...document.querySelectorAll(".view")].map((v) => v.dataset.view);
function showView(name) {
  if (!VIEWS.includes(name)) name = VIEWS[0];
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.dataset.view !== name));
  document.querySelectorAll("[data-view-link]").forEach((a) =>
    a.dataset.viewLink === name ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  const link = document.querySelector(`[data-view-link="${name}"]`);
  document.getElementById("view-title").textContent = link ? link.textContent : "";
  if (link && link.dataset.sub) document.getElementById("view-sub").textContent = link.dataset.sub;
  document.title = `${link ? link.textContent + " · " : ""}Pilot · VI-SPDAT and Gemini Housing Priority`;
  window.scrollTo(0, 0);
  renderAll(); // charts drawn while hidden used a fallback width
}
const route = () => showView(decodeURIComponent((location.hash || "").slice(1)));
window.addEventListener("hashchange", route);

let resizeTimer;
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderAll, 180); });

d3.json("data/dashboard.json").then((data) => {
  DATA = data;
  RUN = data.runs.find((r) => r.complete) || null;
  if (!RUN) { d3.select("#findings").text("No complete Gemini run yet."); return; }
  route();
});
