/* ============================================================
   Limited places study: VI-SPDAT and Gemini with 35 High and 40 Medium places

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
let RUN = null;        // the run
let POOL = null;       // analysis of its rounds
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
  d3.select("#crosstab-foot").text(`Same category: ${t.same} of ${t.n}. Gemini higher: ${t.higher}. Gemini lower: ${t.lower}. Gemini's placement is its consensus over ${POOL.rounds} rounds.`);
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
    a.append("p").attr("class", "fcard-body").text(`${k} of ${n} people in the study.`);
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

  const eff = Object.fromEntries(POOL.factor_effects.map((f) => [f.id, f]));
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
    { value: "differ", label: "Placed differently", count: P.filter((p) => gem(p) !== p.vispdat).length },
    { value: "varies", label: "Changes between rounds", count: P.filter((p) => new Set(RUN.answers[p.id].rounds).size > 1).length }
  ];
  chipGroup("#profile-filter", filters, PROFILE_FILTER, (v) => { PROFILE_FILTER = v; renderProfiles(); });
  const rows = P.filter((p) => PROFILE_FILTER === "all" || (PROFILE_FILTER === "varies" ? new Set(RUN.answers[p.id].rounds).size > 1 : (PROFILE_FILTER === "same") === (gem(p) === p.vispdat)));
  const t = d3.select("#profile-table").html("");
  const head = t.append("thead").append("tr");
  ["ID", "Person", "Age", "Gender", "Race", "City", "VI‑SPDAT score", "VI‑SPDAT", "Gemini", "Rounds High"].forEach((h, i) =>
    head.append("th").attr("scope", "col").attr("class", i ? "model-col" : null).text(h));
  const tb = t.append("tbody");
  rows.forEach((p) => {
    const tr = tb.append("tr").attr("class", "prow").attr("tabindex", 0).attr("aria-expanded", openProfile === p.id);
    [p.id, esc(p.label), p.age, p.gender, esc(RACE_SHORT[p.race]), CITY_CALLOUT[p.location].short, p.score, priTag(p.vispdat), priTag(gem(p)), `${RUN.answers[p.id].high_rounds} / ${POOL.rounds}`]
      .forEach((c, i) => tr.append("td").attr("class", i ? "cell sep" : "cmp").html(c));
    const toggle = () => { openProfile = openProfile === p.id ? null : p.id; renderProfiles(); };
    tr.on("click", toggle).on("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    if (openProfile !== p.id) return;
    const td = tb.append("tr").attr("class", "pdetail").append("td").attr("colspan", 10);
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
    side.append("p").attr("class", "group-n").text(`Placed High in ${RUN.answers[p.id].high_rounds}, Medium in ${RUN.answers[p.id].medium_rounds}, Low in ${RUN.answers[p.id].low_rounds} of ${POOL.rounds} rounds.`);
  });
}

/* ============================================================
   Study design & downloads
   ============================================================ */

function renderDesign() {
  d3.select("#design-runs").html(`<strong>Model.</strong> Gemini 3.8 Flash with default settings, including its default reasoning. Each round used about ${Math.round(POOL.tokens_per_round.prompt_token_count / 1000)}k input and ${Math.round((POOL.tokens_per_round.thoughts_token_count + POOL.tokens_per_round.candidates_token_count) / 1000)}k output tokens (including reasoning).`);
  const pr = DATA.prompt;
  d3.select("#prompt-text").text(`${pr.instructions}\n\nApplicant 1\nAge [age]. Gender: [gender]. Race: [race]. Location: [city].\n\n` +
    pr.sections.map((s) => `${s}: [text]`).join("\n") + `\n\n[... Applicants 2 to 100 in the same format ...]\n\n${pr.reply_format}`);

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
    ["Dashboard data", "data/dashboard.json", "Every profile, its VI‑SPDAT score and priority, Gemini's placement and rounds, and the analysis behind each figure."],
    ["Profiles", "data/profiles.json", "The 100 people: demographics, VI‑SPDAT items, and case summaries."],
    ["VI‑SPDAT scores", "data/vispdat_scores.csv", "Score, domain subtotals, recommendation, and priority per person."],
    ["Results by person", "results/by_person.csv", "VI‑SPDAT priority, Gemini's placement, and how many of the rounds put each person in each category."],
    ["Agreement by round", "results/rounds.csv", "People placed in the same category, higher, and lower, with kappa, for each round."],
    ["Results by group", "results/limited_groups.csv", "High and Medium places going to each group under VI‑SPDAT and Gemini."],
    ["All results", "results/limited_results.json", "Agreement, stability, significance tests, and factor effects."]
  ];
  table("#downloads-table", ["File", "Contents"], files.map(([name, href, what]) => ({ cells: [`<a href="${href}">${name}</a>`, what] })));
}

/* ============================================================
   Shell
   ============================================================ */

function renderAll() {
  if (!DATA || !RUN) return;
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
  renderRounds(POOL);
  renderExtras();
  renderPages();
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
  document.title = `${link ? link.textContent + " · " : ""}Limited places · VI-SPDAT and Gemini Housing Priority`;
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
  POOL = RUN ? RUN.pool : null;
  data.prompt_places = POOL ? POOL.places : null;
  if (!RUN) { d3.select("#findings").text("No complete Gemini run yet."); return; }
  route();
});

/* ---------- charts for the limited-places analysis (data: RUN.pool) ---------- */

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const fmt1 = (x) => (Math.abs(x - Math.round(x)) < 0.05 ? String(Math.round(x)) : x.toFixed(1));
const GROUP_SHORT = (g) => RACE_SHORT[g] || (CITY_CALLOUT[g] ? CITY_CALLOUT[g].short : g);

function renderRounds(sc) {
  if (!sc) return;
  const rounds = sc.per_round, W = widthOf("#lim-rounds", 560, 960), H = 250, m = { t: 22, r: 84, b: 40, l: 44 };
  const x = d3.scaleBand().domain(rounds.map((r) => r.round)).range([m.l, W - m.r]).padding(0.28);
  const lo = Math.max(0, Math.floor((d3.min(rounds, (r) => r.same) - 12) / 10) * 10);
  const y = d3.scaleLinear().domain([lo, 100]).range([H - m.b, m.t]);
  const svg = d3.select("#lim-rounds").html("").append("svg").attr("width", W).attr("height", H).attr("role", "img")
    .attr("aria-label", "People placed in the same category by VI-SPDAT and Gemini in each round.");
  const ticks = y.ticks(5);
  svg.append("g").selectAll("line").data(ticks).join("line").attr("class", "gridline").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y).attr("y2", y);
  svg.append("g").selectAll("text").data(ticks).join("text").attr("class", "tick-text").attr("x", m.l - 8).attr("y", y)
    .attr("dy", "0.32em").attr("text-anchor", "end").text((d) => d);
  rounds.forEach((r) => {
    const sel = svg.append("rect").datum(r).attr("x", x(r.round)).attr("width", x.bandwidth()).attr("y", y(r.same))
      .attr("height", y(lo) - y(r.same)).attr("rx", 3).attr("fill", css("--series-1")).attr("fill-opacity", 0.85);
    hover(sel, (d) => `<span class="tt-title">Round ${d.round}</span><span class="tt-row">${fmt1(d.same)} same, ${fmt1(d.higher)} higher, ${fmt1(d.lower)} lower</span><span class="tt-row">kappa ${d.kappa.toFixed(2)}</span>`);
    svg.append("text").attr("class", "bar-value").style("text-anchor", "middle").attr("x", x(r.round) + x.bandwidth() / 2).attr("y", y(r.same) - 6).text(fmt1(r.same));
    svg.append("text").attr("class", "axis-label").attr("x", x(r.round) + x.bandwidth() / 2).attr("y", H - m.b + 16).attr("text-anchor", "middle").text(r.round);
  });
  const avg = mean(rounds.map((r) => r.same));
  svg.append("line").attr("class", "ref-line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(avg)).attr("y2", y(avg));
  svg.append("text").attr("class", "ref-label").attr("x", W - m.r + 8).attr("y", y(avg)).attr("dy", "0.35em").attr("text-anchor", "start").text(`average ${fmt1(avg)}`);
  svg.append("text").attr("class", "axis-title").attr("x", (m.l + W - m.r) / 2).attr("y", H - 6).attr("text-anchor", "middle").text("ROUND");
  d3.select("#lim-rounds-foot").text(`Gemini's placement varies a little from round to round: ${sc.same_category_in_every_round} of 100 people got the same category in all ${sc.rounds} rounds, and two rounds agree on ${fmt1(sc.round_to_round_same_category.mean)} people on average.`);
}

function limitedCircumstances(sc, circ) {
  legend("#lim-legend-items", [{ name: "Expected from VI‑SPDAT score", color: css("--rule-strong") }, { name: "Gemini: share of rounds placed High", color: css("--series-2") }]);
  const rows = circ.slice().sort((a, b) => a.p - b.p).map((t) => ({ t, d: sc.circumstances[t.factor] }));
  const W = widthOf("#lim-items", 560, 980), rh = 30, m = { t: 30, r: 190, b: 30, l: 290 }, H = m.t + rows.length * rh + m.b;
  const x = d3.scaleLinear().domain([0, 1]).range([m.l, W - m.r]);
  const svg = d3.select("#lim-items").html("").append("svg").attr("width", W).attr("height", H).attr("role", "img")
    .attr("aria-label", "For each circumstance, how often Gemini placed those people High, against what their VI-SPDAT scores predict.");
  svg.append("g").selectAll("line").data(x.ticks(5)).join("line").attr("class", "gridline").attr("x1", x).attr("x2", x).attr("y1", m.t - 6).attr("y2", H - m.b);
  svg.append("g").selectAll("text").data(x.ticks(5)).join("text").attr("class", "tick-text").attr("x", x).attr("y", H - m.b + 16)
    .attr("text-anchor", "middle").text((d) => `${Math.round(d * 100)}%`);
  svg.append("text").attr("class", "axis-title").attr("x", W - m.r + 12).attr("y", m.t - 12).text("p (HOLM p)");
  rows.forEach(({ t, d }, i) => {
    const cy = m.t + i * rh + rh / 2, sig = t.p_holm < 0.05;
    const g = svg.append("g");
    const lab = g.append("text").attr("class", "group-label").attr("x", m.l - 12).attr("y", cy - 3).attr("dy", "0.35em").attr("text-anchor", "end")
      .attr("font-weight", sig ? 700 : 400).text(t.factor);
    lab.append("tspan").attr("class", "group-n").attr("dx", 6).text(`n = ${d.n}`);
    g.append("line").attr("class", "ci-line").attr("x1", x(Math.min(d.expected, d.observed))).attr("x2", x(Math.max(d.expected, d.observed)))
      .attr("y1", cy - 3).attr("y2", cy - 3);
    g.append("circle").attr("cx", x(d.expected)).attr("cy", cy - 3).attr("r", 5.5).attr("fill", css("--surface")).attr("stroke", css("--ink-muted")).attr("stroke-width", 2);
    g.append("circle").attr("cx", x(d.observed)).attr("cy", cy - 3).attr("r", 6).attr("fill", css("--series-2"));
    svg.append("text").attr("class", "bar-value").style("text-anchor", "start").attr("x", W - m.r + 12).attr("y", cy - 3).attr("dy", "0.35em")
      .attr("font-weight", sig ? 700 : 500).text(`${fmtP(t.p)} (${fmtP(t.p_holm)})`);
    hover(g, () => `<span class="tt-title">${esc(t.factor)}</span><span class="tt-row">${d.n} people; placed High in ${Math.round(d.observed * 100)}% of rounds</span><span class="tt-row">expected from VI‑SPDAT score: ${Math.round(d.expected * 100)}%</span><span class="tt-row">p = ${fmtP(t.p)}, Holm p = ${fmtP(t.p_holm)}</span>`);
  });
}

function limitedEffects(sc) {
  const rows = sc.factor_effects.slice().sort((a, b) => b.effect - a.effect);
  const W = widthOf("#lim-effects", 560, 980), rh = 26, m = { t: 30, r: 200, b: 36, l: 300 }, H = m.t + rows.length * rh + m.b;
  const lo = Math.min(-0.2, d3.min(rows, (r) => r.ci_low)), hi = Math.max(0.2, d3.max(rows, (r) => r.ci_high));
  const x = d3.scaleLinear().domain([lo, hi]).nice().range([m.l, W - m.r]);
  const svg = d3.select("#lim-effects").html("").append("svg").attr("width", W).attr("height", H).attr("role", "img")
    .attr("aria-label", "Change in the chance of a High place associated with each VI-SPDAT factor, with 95% confidence intervals.");
  svg.append("g").selectAll("line").data(x.ticks(6)).join("line").attr("class", "gridline").attr("x1", x).attr("x2", x).attr("y1", m.t - 6).attr("y2", H - m.b);
  svg.append("g").selectAll("text").data(x.ticks(6)).join("text").attr("class", "tick-text").attr("x", x).attr("y", H - m.b + 16)
    .attr("text-anchor", "middle").text((d) => `${d > 0 ? "+" : ""}${Math.round(d * 100)}`);
  svg.append("line").attr("class", "ref-line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", m.t - 6).attr("y2", H - m.b);
  svg.append("text").attr("class", "axis-title").attr("x", (m.l + W - m.r) / 2).attr("y", H - 4).attr("text-anchor", "middle").text("CHANGE IN CHANCE OF A HIGH PLACE (PERCENTAGE POINTS)");
  svg.append("text").attr("class", "axis-title").attr("x", W - m.r + 12).attr("y", m.t - 12).text("p (HOLM p)");
  rows.forEach((r, i) => {
    const cy = m.t + i * rh + rh / 2, sig = r.p_holm < 0.05;
    const g = svg.append("g");
    g.append("text").attr("class", "group-label").attr("x", m.l - 12).attr("y", cy).attr("dy", "0.35em").attr("text-anchor", "end")
      .attr("font-weight", sig ? 700 : 400).text(r.name);
    g.append("line").attr("class", "ci-line").attr("x1", x(r.ci_low)).attr("x2", x(r.ci_high)).attr("y1", cy).attr("y2", cy);
    g.append("circle").attr("cx", x(r.effect)).attr("cy", cy).attr("r", 5.5).attr("fill", css(r.effect >= 0 ? "--series-2" : "--series-1"));
    svg.append("text").attr("class", "bar-value").style("text-anchor", "start").attr("x", W - m.r + 12).attr("y", cy).attr("dy", "0.35em")
      .attr("font-weight", sig ? 700 : 500).text(`${fmtP(r.p)} (${fmtP(r.p_holm)})`);
    hover(g, () => `<span class="tt-title">${esc(r.name)}</span><span class="tt-row">${r.people} people</span><span class="tt-row">${r.effect > 0 ? "+" : ""}${(r.effect * 100).toFixed(1)} points [${(r.ci_low * 100).toFixed(1)}, ${(r.ci_high * 100).toFixed(1)}]</span><span class="tt-row">p = ${fmtP(r.p)}, Holm p = ${fmtP(r.p_holm)}</span>`);
  });
  d3.select("#lim-effects-foot").text(
    `Linear regression of how often each person was placed High (share of ${sc.rounds} rounds) on the ${rows.length} VI‑SPDAT factors, with HC3 standard errors. ` +
    `The factors explain ${Math.round(sc.r2_factors * 100)}% of the variation, against ${Math.round(sc.r2_score_only * 100)}% for the VI‑SPDAT score alone. ` +
    `Exploratory: with ${rows.length} factors and 100 people, only large effects can be detected.`);
}

function limitedDemographics(sc, demo) {
  const rows = [];
  demo.forEach((t) => {
    const gs = sc.groups.filter((g) => g.factor === t.factor);
    gs.forEach((g, i) => rows.push({ cells: [i === 0 ? `<strong>${esc(t.factor)}</strong>` : "", esc(GROUP_SHORT(g.group)), g.n,
      fmt1(g.vispdat_high), fmt1(g.gemini_high), fmt1(g.vispdat_medium), fmt1(g.gemini_medium),
      i === 0 ? fmtP(t.p) : "", i === 0 ? fmtP(t.p_holm) : ""] }));
  });
  table("#lim-demo-table", ["Factor", "Group", "n", "VI‑SPDAT High places", "Gemini High places", "VI‑SPDAT Medium places", "Gemini Medium places", "p", "Holm p"], rows);
  d3.select("#lim-demo-foot").text(
    "Places are counts of people; Gemini's are averaged over rounds. The tests ask whether a group's High places differ from what their VI‑SPDAT scores predict. " +
    "With groups of about 13–33 people, only large differences can be detected.");
}

/* ---------- extra detail for the limited-places study ---------- */

const CH = { H: "High", M: "Medium", L: "Low" };
const ans = (p) => RUN.answers[p.id];
const meanRank = (p) => (2 * ans(p).high_rounds + ans(p).medium_rounds) / POOL.rounds;
const orderBy = (P) => P.slice().sort((a, b) => b.score - a.score || meanRank(b) - meanRank(a) || a.id.localeCompare(b.id));
const personLine = (p) => `${esc(p.label)}<br><span class="tt-row">${p.age}, ${p.gender}, ${esc(RACE_SHORT[p.race])}, ${CITY_CALLOUT[p.location].short}</span>`;

function renderExtras() {
  if (!POOL) return;
  renderFlow();
  renderRankCurve();
  renderMovement();
  renderGrid();
  renderHist();
  renderMatrix();
  renderRoundTable();
  renderFactorRates();
  renderNull();
}

/* ---------- flow from VI-SPDAT to Gemini ---------- */

function renderFlow() {
  const P = DATA.profiles;
  const W = widthOf("#chart-flow", 560, 940), H = 320, m = { t: 30, b: 14, l: 150, r: 150 }, gap = 20, bw = 16;
  const scale = (H - m.t - m.b - 2 * gap) / P.length;
  const count = (a, b) => P.filter((p) => p.vispdat === a && gem(p) === b).length;
  const side = (key) => {
    let y = m.t;
    return Object.fromEntries(CATS.map((c) => {
      const n = P.filter((p) => key(p) === c).length, node = { y, h: n * scale, n };
      y += n * scale + gap;
      return [c, node];
    }));
  };
  const left = side((p) => p.vispdat), right = side(gem);
  const x0 = m.l, x1 = W - m.r, xm = (x0 + bw + x1 - bw) / 2;
  const svg = d3.select("#chart-flow").html("").append("svg").attr("width", W).attr("height", H).attr("role", "img")
    .attr("aria-label", "Flow of people from their VI-SPDAT category to their Gemini category: " +
      CATS.flatMap((a) => CATS.map((b) => `${a} to ${b}: ${count(a, b)}`)).join(", "));
  svg.append("text").attr("class", "axis-title").attr("x", x0).attr("y", 14).text("VI‑SPDAT");
  svg.append("text").attr("class", "axis-title").attr("x", x1).attr("y", 14).attr("text-anchor", "end").text(RUN.label.toUpperCase());
  const offL = { High: 0, Medium: 0, Low: 0 }, offR = { High: 0, Medium: 0, Low: 0 };
  CATS.forEach((a) => CATS.forEach((b) => {
    const k = count(a, b);
    if (!k) return;
    const h = k * scale, y0 = left[a].y + offL[a], y1 = right[b].y + offR[b];
    offL[a] += h; offR[b] += h;
    const d = `M${x0 + bw},${y0} C${xm},${y0} ${xm},${y1} ${x1 - bw},${y1} L${x1 - bw},${y1 + h} C${xm},${y1 + h} ${xm},${y0 + h} ${x0 + bw},${y0 + h} Z`;
    const sel = svg.append("path").attr("d", d).attr("fill", css(CAT_COLOR[b])).attr("fill-opacity", a === b ? 0.5 : 0.32)
      .attr("stroke", css(CAT_COLOR[b])).attr("stroke-opacity", 0.5).attr("stroke-width", 0.6);
    hover(sel, () => `<span class="tt-title">VI‑SPDAT ${a} → Gemini ${b}</span><span class="tt-row">${k} ${k === 1 ? "person" : "people"}</span>`);
  }));
  CATS.forEach((c) => {
    svg.append("rect").attr("x", x0).attr("y", left[c].y).attr("width", bw).attr("height", left[c].h).attr("rx", 3).attr("fill", css(CAT_COLOR[c]));
    svg.append("rect").attr("x", x1 - bw).attr("y", right[c].y).attr("width", bw).attr("height", right[c].h).attr("rx", 3).attr("fill", css(CAT_COLOR[c]));
    svg.append("text").attr("class", "group-label").attr("x", x0 - 10).attr("y", left[c].y + left[c].h / 2).attr("dy", "0.35em").attr("text-anchor", "end")
      .text(`${c} (${left[c].n})`);
    svg.append("text").attr("class", "group-label").attr("x", x1 + 10).attr("y", right[c].y + right[c].h / 2).attr("dy", "0.35em")
      .text(`${c} (${right[c].n})`);
  });
}

/* ---------- Gemini's ranking of all 100 people ---------- */

function renderRankCurve() {
  const P = DATA.profiles.slice().sort((a, b) => meanRank(b) - meanRank(a) || b.score - a.score || a.id.localeCompare(b.id));
  legend("#legend-rank", CATS.map((c) => ({ name: `VI‑SPDAT ${c}`, color: css(CAT_COLOR[c]) })).concat([{ kind: "line", name: "Where Gemini's places run out" }]));
  const W = widthOf("#chart-rank", 560, 960), H = 300, m = { t: 34, r: 12, b: 44, l: 74 };
  const x = d3.scaleBand().domain(d3.range(P.length)).range([m.l, W - m.r]).padding(0.12);
  const y = d3.scaleLinear().domain([0, 2]).range([H - m.b, m.t]);
  const svg = d3.select("#chart-rank").html("").append("svg").attr("width", W).attr("height", H).attr("role", "img")
    .attr("aria-label", "All 100 people ordered by how highly Gemini ranked them on average across the rounds, colored by VI-SPDAT priority.");
  [[0, "Low"], [0.5, ""], [1, "Medium"], [1.5, ""], [2, "High"]].forEach(([v, l]) => {
    svg.append("line").attr("class", "gridline").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(v)).attr("y2", y(v));
    svg.append("text").attr("class", "tick-text").attr("x", m.l - 8).attr("y", y(v)).attr("dy", "0.32em").attr("text-anchor", "end").text(l || v);
  });
  P.forEach((p, i) => {
    const sel = svg.append("rect").datum(p).attr("x", x(i)).attr("width", x.bandwidth()).attr("y", y(meanRank(p))).attr("height", Math.max(1.5, y(0) - y(meanRank(p))))
      .attr("rx", 1.5).attr("fill", css(CAT_COLOR[p.vispdat]));
    hover(sel, (d) => `<span class="tt-title">${personLine(d)}</span><span class="tt-row">VI‑SPDAT ${d.score} (${d.vispdat})</span><span class="tt-row">Gemini: High ${ans(d).high_rounds}, Medium ${ans(d).medium_rounds}, Low ${ans(d).low_rounds} of ${POOL.rounds} rounds</span>`);
  });
  [[POOL.places.High, "High | Medium"], [POOL.places.High + POOL.places.Medium, "Medium | Low"]].forEach(([k, l]) => {
    const xx = x(k) - (x.step() - x.bandwidth()) / 2;
    svg.append("line").attr("class", "cut-line").attr("x1", xx).attr("x2", xx).attr("y1", m.t - 10).attr("y2", H - m.b);
    svg.append("text").attr("class", "cut-label").attr("x", xx).attr("y", m.t - 14).attr("text-anchor", "middle").text(l);
  });
  svg.append("text").attr("class", "axis-title").attr("x", (m.l + W - m.r) / 2).attr("y", H - 8).attr("text-anchor", "middle").text("100 PEOPLE, RANKED BY GEMINI");
  svg.append("text").attr("class", "axis-title").attr("transform", `translate(12 ${(m.t + H - m.b) / 2}) rotate(-90)`).attr("text-anchor", "middle").text("AVERAGE CATEGORY");
}

/* ---------- people moved up and down at each score ---------- */

function renderMovement() {
  const P = DATA.profiles, scores = d3.range(0, 18);
  const rows = scores.map((s) => {
    const at = P.filter((p) => p.score === s);
    return { s, n: at.length, up: at.filter((p) => RANK[gem(p)] > RANK[p.vispdat]).length, down: at.filter((p) => RANK[gem(p)] < RANK[p.vispdat]).length };
  });
  legend("#legend-movement", [{ name: "Gemini places higher than VI‑SPDAT", color: css("--series-2") }, { name: "Gemini places lower", color: css("--series-1") }]);
  const W = widthOf("#chart-movement", 560, 960), H = 280, m = { t: 20, r: 12, b: 44, l: 44 };
  const top = Math.max(1, d3.max(rows, (r) => r.up)), bot = Math.max(1, d3.max(rows, (r) => r.down));
  const x = d3.scaleBand().domain(scores).range([m.l, W - m.r]).padding(0.2);
  const y = d3.scaleLinear().domain([-bot - 0.5, top + 0.5]).range([H - m.b, m.t]);
  const svg = d3.select("#chart-movement").html("").append("svg").attr("width", W).attr("height", H).attr("role", "img")
    .attr("aria-label", "People Gemini placed higher or lower than VI-SPDAT at each VI-SPDAT score.");
  y.ticks(6).forEach((v) => {
    svg.append("line").attr("class", "gridline").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(v)).attr("y2", y(v));
    svg.append("text").attr("class", "tick-text").attr("x", m.l - 8).attr("y", y(v)).attr("dy", "0.32em").attr("text-anchor", "end").text(Math.abs(v));
  });
  svg.append("line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(0)).attr("y2", y(0)).attr("stroke", css("--ink-muted"));
  rows.forEach((r) => {
    const g = svg.append("g");
    if (r.up) g.append("rect").attr("x", x(r.s)).attr("width", x.bandwidth()).attr("y", y(r.up)).attr("height", y(0) - y(r.up)).attr("rx", 2).attr("fill", css("--series-2"));
    if (r.down) g.append("rect").attr("x", x(r.s)).attr("width", x.bandwidth()).attr("y", y(0)).attr("height", y(-r.down) - y(0)).attr("rx", 2).attr("fill", css("--series-1"));
    svg.append("text").attr("class", "axis-label").attr("x", x(r.s) + x.bandwidth() / 2).attr("y", H - m.b + 16).attr("text-anchor", "middle").text(r.s);
    hover(g, () => `<span class="tt-title">VI‑SPDAT score ${r.s} (${r.n} ${r.n === 1 ? "person" : "people"})</span><span class="tt-row">${r.up} placed higher, ${r.down} placed lower</span>`);
  });
  svg.append("text").attr("class", "axis-title").attr("x", (m.l + W - m.r) / 2).attr("y", H - 6).attr("text-anchor", "middle").text("VI‑SPDAT SCORE");
  const nearEdge = rows.filter((r) => [3, 4, 7, 8].includes(r.s)).reduce((a, r) => a + r.up + r.down, 0), all = d3.sum(rows, (r) => r.up + r.down);
  d3.select("#movement-foot").text(`${nearEdge} of the ${all} people placed differently score 3, 4, 7, or 8, right next to a VI‑SPDAT cut-off. Nobody scoring 0–1 or 12 or more is moved.`);
}

/* ---------- every person in every round ---------- */

function renderGrid() {
  const R = POOL.rounds, P = orderBy(DATA.profiles);
  legend("#legend-grid", CATS.map((c) => ({ name: `Gemini ${c}`, color: css(CAT_COLOR[c]) })));
  const cw = 34, rh = 6.4, m = { t: 44, l: 96, r: 70, b: 10 }, W = m.l + R * cw + m.r, H = m.t + P.length * rh + m.b;
  const svg = d3.select("#chart-grid").html("").append("svg").attr("width", W).attr("height", H).attr("role", "img")
    .attr("aria-label", "For each of the 100 people, the category Gemini gave them in each round.");
  d3.range(R).forEach((k) => svg.append("text").attr("class", "axis-label").attr("x", m.l + k * cw + cw / 2).attr("y", m.t - 10).attr("text-anchor", "middle").text(k + 1));
  svg.append("text").attr("class", "axis-title").attr("x", m.l + (R * cw) / 2).attr("y", 12).attr("text-anchor", "middle").text("ROUND");
  svg.append("text").attr("class", "axis-title").attr("x", m.l - 22).attr("y", m.t - 10).attr("text-anchor", "end").text("SCORE");
  svg.append("text").attr("class", "axis-title").attr("x", m.l + R * cw + 14).attr("y", m.t - 10).text("FINAL");
  let last = null, lastLabelY = null;
  P.forEach((p, i) => {
    const y = m.t + i * rh;
    if (p.score !== last) {
      if (lastLabelY === null || y - lastLabelY >= 11) {
        svg.append("text").attr("class", "group-n").attr("x", m.l - 22).attr("y", y + rh / 2 + 1).attr("dy", "0.35em").attr("text-anchor", "end").text(p.score);
        lastLabelY = y;
      }
      if (last !== null) svg.append("line").attr("x1", m.l - 18).attr("x2", m.l + R * cw).attr("y1", y).attr("y2", y).attr("stroke", css("--surface")).attr("stroke-width", 1.5);
      last = p.score;
    }
    const g = svg.append("g").datum(p);
    g.append("rect").attr("x", m.l - 14).attr("y", y).attr("width", 8).attr("height", rh - 0.8).attr("fill", css(CAT_COLOR[p.vispdat]));
    ans(p).rounds.split("").forEach((c, k) =>
      g.append("rect").attr("x", m.l + k * cw + 1).attr("y", y).attr("width", cw - 2).attr("height", rh - 0.8).attr("fill", css(CAT_COLOR[CH[c]])));
    g.append("rect").attr("x", m.l + R * cw + 8).attr("y", y).attr("width", 20).attr("height", rh - 0.8).attr("fill", css(CAT_COLOR[ans(p).priority]));
    hover(g, (d) => `<span class="tt-title">${personLine(d)}</span><span class="tt-row">VI‑SPDAT ${d.score} (${d.vispdat}); Gemini final ${ans(d).priority}</span><span class="tt-row">Rounds: ${ans(d).rounds.split("").map((c) => c).join(" ")}</span>`);
  });
  svg.append("text").attr("class", "group-n").attr("x", m.l - 14).attr("y", H - 0).attr("text-anchor", "start").text("");
  const stable = P.filter((p) => new Set(ans(p).rounds.split("")).size === 1).length;
  d3.select("#grid-foot").text(`Each row is one person, grouped by VI‑SPDAT score; the narrow bar on the left is their VI‑SPDAT priority. ${stable} of 100 people received the same category in every round. ` +
    `H = High, M = Medium, L = Low in the tooltip.`);
}

/* ---------- how many rounds each person was placed High ---------- */

function renderHist() {
  const R = POOL.rounds, P = DATA.profiles;
  legend("#legend-hist", CATS.map((c) => ({ name: `VI‑SPDAT ${c}`, color: css(CAT_COLOR[c]) })));
  const bins = d3.range(R + 1);
  const W = widthOf("#chart-hist", 520, 900), H = 280, m = { t: 20, r: 12, b: 46, l: 44 };
  const x = d3.scaleBand().domain(bins).range([m.l, W - m.r]).padding(0.2);
  const counts = bins.map((k) => Object.fromEntries(["Low", "Medium", "High"].map((c) => [c, P.filter((p) => ans(p).high_rounds === k && p.vispdat === c).length])));
  const tot = counts.map((c) => c.Low + c.Medium + c.High);
  const y = d3.scaleLinear().domain([0, d3.max(tot)]).nice().range([H - m.b, m.t]);
  const svg = d3.select("#chart-hist").html("").append("svg").attr("width", W).attr("height", H).attr("role", "img")
    .attr("aria-label", "Number of people by how many rounds Gemini placed them in High, split by VI-SPDAT priority.");
  y.ticks(5).forEach((v) => {
    svg.append("line").attr("class", "gridline").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(v)).attr("y2", y(v));
    svg.append("text").attr("class", "tick-text").attr("x", m.l - 8).attr("y", y(v)).attr("dy", "0.32em").attr("text-anchor", "end").text(v);
  });
  bins.forEach((k) => {
    let acc = 0;
    ["Low", "Medium", "High"].forEach((c) => {
      const v = counts[k][c];
      if (!v) return;
      const sel = svg.append("rect").attr("x", x(k)).attr("width", x.bandwidth()).attr("y", y(acc + v)).attr("height", y(acc) - y(acc + v) - 1).attr("rx", 2).attr("fill", css(CAT_COLOR[c]));
      hover(sel, () => `<span class="tt-title">High in ${k} of ${R} rounds</span><span class="tt-row">VI‑SPDAT ${c}: ${v} ${v === 1 ? "person" : "people"}</span>`);
      acc += v;
    });
    if (tot[k]) svg.append("text").attr("class", "bar-value").style("text-anchor", "middle").attr("x", x(k) + x.bandwidth() / 2).attr("y", y(tot[k]) - 6).text(tot[k]);
    svg.append("text").attr("class", "axis-label").attr("x", x(k) + x.bandwidth() / 2).attr("y", H - m.b + 16).attr("text-anchor", "middle").text(k);
  });
  svg.append("text").attr("class", "axis-title").attr("x", (m.l + W - m.r) / 2).attr("y", H - 6).attr("text-anchor", "middle").text(`ROUNDS PLACED HIGH (OF ${R})`);
  const always = tot[R], never = tot[0], between = d3.sum(tot) - always - never;
  d3.select("#hist-foot").text(`${always} people were placed High in every round and ${never} in none. The other ${between} people changed with the order of the list; these are the people near the cut-off.`);
}

/* ---------- agreement between every pair of rounds ---------- */

function renderMatrix() {
  const R = POOL.rounds, P = DATA.profiles;
  const rr = P.map((p) => ans(p).rounds);
  const same = (a, b) => rr.filter((s) => s[a] === s[b]).length;
  const cells = d3.range(R).flatMap((a) => d3.range(R).map((b) => ({ a, b, v: a === b ? null : same(a, b) })));
  const vals = cells.filter((c) => c.v !== null).map((c) => c.v), lo = d3.min(vals), hi = d3.max(vals);
  const cell = 46, m = { t: 40, l: 56 }, W = m.l + R * cell + 20, H = m.t + R * cell + 14;
  const svg = d3.select("#chart-matrix").html("").append("svg").attr("width", W).attr("height", H).attr("role", "img")
    .attr("aria-label", "Number of people given the same category in each pair of rounds.");
  d3.range(R).forEach((k) => {
    svg.append("text").attr("class", "axis-label").attr("x", m.l + k * cell + cell / 2).attr("y", m.t - 10).attr("text-anchor", "middle").text(k + 1);
    svg.append("text").attr("class", "axis-label").attr("x", m.l - 12).attr("y", m.t + k * cell + cell / 2).attr("dy", "0.32em").attr("text-anchor", "end").text(k + 1);
  });
  svg.append("text").attr("class", "axis-title").attr("x", m.l + (R * cell) / 2).attr("y", 12).attr("text-anchor", "middle").text("ROUND");
  cells.forEach((c) => {
    const fill = c.v === null ? css("--surface-sunk") : d3.interpolateLab(css("--surface-sunk"), css("--series-1"))(0.15 + 0.85 * ((c.v - lo) / Math.max(1, hi - lo)));
    const g = svg.append("g");
    g.append("rect").attr("x", m.l + c.b * cell + 1).attr("y", m.t + c.a * cell + 1).attr("width", cell - 2).attr("height", cell - 2).attr("rx", 4).attr("fill", fill);
    if (c.v !== null) {
      g.append("text").attr("x", m.l + c.b * cell + cell / 2).attr("y", m.t + c.a * cell + cell / 2).attr("dy", "0.35em").attr("text-anchor", "middle")
        .attr("font-size", 13).attr("font-weight", 600).attr("fill", d3.lab(fill).l > 62 ? "#0b0b0b" : "#ffffff").text(c.v);
      hover(g, () => `<span class="tt-title">Rounds ${c.a + 1} and ${c.b + 1}</span><span class="tt-row">${c.v} of 100 people in the same category</span>`);
    }
  });
  d3.select("#matrix-foot").text(`Any two rounds agree on between ${lo} and ${hi} of the 100 people (average ${d3.mean(vals).toFixed(1)}).`);
}

/* ---------- round details ---------- */

function renderRoundTable() {
  const det = Object.fromEntries((POOL.round_details || []).map((d) => [d.round, d]));
  table("#round-table", ["Round", "Same", "Higher", "Lower", "Kappa", "Time", "Input tokens", "Reasoning tokens", "Output tokens"],
    POOL.per_round.map((r) => {
      const d = det[r.round] || {};
      return { cells: [r.round, fmt1(r.same), fmt1(r.higher), fmt1(r.lower), r.kappa.toFixed(2),
        d.seconds ? `${Math.round(d.seconds / 6) / 10} min` : "—", d.prompt_tokens ? d.prompt_tokens.toLocaleString() : "—",
        d.thought_tokens ? d.thought_tokens.toLocaleString() : "—", d.output_tokens ? d.output_tokens.toLocaleString() : "—"] };
    }));
}

/* ---------- gain and loss in places, by group ---------- */

function renderGroupGain() {
  const f = FACTORS.find((x) => x.key === FACTOR);
  d3.select("#group-name-3").text(f.label.toLowerCase());
  legend("#legend-gain", [{ name: "High places", color: css("--series-2") }, { name: "Medium places", color: css("--series-4") }]);
  const groups = groupsOf(FACTOR).map((g) => { const t = tally(g.people); return { name: g.name, n: t.n, hi: t.g.High - t.v.High, med: t.g.Medium - t.v.Medium }; });
  const W = widthOf("#chart-gain", 520, 900), lw = 220, bar = 14, row = bar * 2 + 18, H = groups.length * row + 44, m = { r: 50 };
  const ext = Math.max(2, d3.max(groups, (g) => Math.max(Math.abs(g.hi), Math.abs(g.med))));
  const x = d3.scaleLinear().domain([-ext, ext]).nice().range([lw + 36, W - m.r]);
  const svg = d3.select("#chart-gain").html("").append("svg").attr("width", W).attr("height", H).attr("role", "img")
    .attr("aria-label", `Gemini's High and Medium places minus VI-SPDAT's, by ${f.label}.`);
  x.ticks(6).forEach((v) => {
    svg.append("line").attr("class", "gridline").attr("x1", x(v)).attr("x2", x(v)).attr("y1", 6).attr("y2", H - 26);
    svg.append("text").attr("class", "tick-text").attr("x", x(v)).attr("y", H - 10).attr("text-anchor", "middle").text(v > 0 ? `+${v}` : v);
  });
  svg.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 6).attr("y2", H - 26).attr("stroke", css("--ink-muted"));
  groups.forEach((g, i) => {
    const y = 12 + i * row;
    svg.append("text").attr("class", "group-label").attr("x", lw - 12).attr("y", y + bar).attr("text-anchor", "end").text(g.name);
    svg.append("text").attr("class", "group-n").attr("x", lw - 12).attr("y", y + bar + 13).attr("text-anchor", "end").text(`n = ${g.n}`);
    [["hi", "--series-2", 0], ["med", "--series-4", bar + 2]].forEach(([k, c, dy]) => {
      const v = g[k], sel = svg.append("rect").attr("x", Math.min(x(0), x(v))).attr("y", y + dy).attr("width", Math.max(1.5, Math.abs(x(v) - x(0)))).attr("height", bar).attr("rx", 2).attr("fill", css(c));
      svg.append("text").attr("class", "bar-value").style("text-anchor", v >= 0 ? "start" : "end").attr("x", v >= 0 ? x(v) + 5 : x(v) - 5).attr("y", y + dy + bar / 2).attr("dy", "0.35em").text(v > 0 ? `+${v}` : v);
      hover(sel, () => `<span class="tt-title">${esc(g.name)}</span><span class="tt-row">${k === "hi" ? "High" : "Medium"} places: Gemini minus VI‑SPDAT = ${v > 0 ? "+" : ""}${v}</span>`);
    });
  });
}
const __renderGroups = renderGroups;
renderGroups = function () { __renderGroups(); renderGroupGain(); }; // eslint-disable-line no-func-assign

/* ---------- people with and without each factor ---------- */

function renderFactorRates() {
  const P = DATA.profiles, R = POOL.rounds, items = DATA.instrument.items;
  const share = (p) => ans(p).high_rounds / R;
  const rows = items.map((it) => {
    const w = P.filter((p) => p.indicators.includes(it.id)), wo = P.filter((p) => !p.indicators.includes(it.id));
    return { it, nw: w.length, a: d3.mean(w, share), b: d3.mean(wo, share) };
  }).filter((r) => r.nw && r.nw < P.length).sort((p, q) => (q.a - q.b) - (p.a - p.b));
  legend("#legend-rates", [{ name: "People with the factor", color: css("--series-2") }, { name: "People without", color: css("--ink-muted") }]);
  const W = widthOf("#chart-rates", 600, 960), lw = 260, rh = 28, rw = 130, H = rows.length * rh + 44;
  const x = d3.scaleLinear().domain([0, 1]).range([lw, W - rw - 20]);
  const svg = d3.select("#chart-rates").html("").append("svg").attr("width", W).attr("height", H).attr("role", "img")
    .attr("aria-label", "Share of rounds placed High for people with and without each VI-SPDAT factor.");
  [0, 0.25, 0.5, 0.75, 1].forEach((v) => {
    svg.append("line").attr("class", "gridline").attr("x1", x(v)).attr("x2", x(v)).attr("y1", 10).attr("y2", H - 28);
    svg.append("text").attr("class", "tick-text").attr("x", x(v)).attr("y", H - 12).attr("text-anchor", "middle").text(`${v * 100}%`);
  });
  svg.append("text").attr("class", "axis-title").attr("x", W - rw + 12).attr("y", 8).text("DIFFERENCE");
  rows.forEach((r, i) => {
    const cy = 24 + i * rh, g = svg.append("g");
    svg.append("text").attr("class", "group-label").attr("x", lw - 12).attr("y", cy).attr("dy", "0.35em").attr("text-anchor", "end").text(r.it.name);
    g.append("line").attr("class", "ci-line").attr("x1", x(r.a)).attr("x2", x(r.b)).attr("y1", cy).attr("y2", cy);
    g.append("circle").attr("cx", x(r.b)).attr("cy", cy).attr("r", 5.5).attr("fill", css("--surface")).attr("stroke", css("--ink-muted")).attr("stroke-width", 2);
    g.append("circle").attr("cx", x(r.a)).attr("cy", cy).attr("r", 6).attr("fill", css("--series-2"));
    const d = Math.round((r.a - r.b) * 100);
    svg.append("text").attr("class", "bar-value").style("text-anchor", "start").attr("x", W - rw + 12).attr("y", cy).attr("dy", "0.35em").text(`${d > 0 ? "+" : ""}${d} pts (n = ${r.nw})`);
    hover(g, () => `<span class="tt-title">${esc(r.it.name)}</span><span class="tt-row">With: placed High in ${Math.round(r.a * 100)}% of rounds (${r.nw} people)</span><span class="tt-row">Without: ${Math.round(r.b * 100)}% (${P.length - r.nw} people)</span>`);
  });
}

/* ---------- how unusual is the largest difference? ---------- */

let NULL_KEY = null;
function renderNull() {
  const N = POOL.null;
  if (!N) return;
  const keys = Object.keys(N).sort((a, b) => N[a].p - N[b].p).slice(0, 4);
  if (!NULL_KEY || !N[NULL_KEY]) NULL_KEY = keys[0];
  chipGroup("#null-chips", keys.map((k) => ({ value: k, label: k })), NULL_KEY, (v) => { NULL_KEY = v; renderNull(); });
  const d = N[NULL_KEY];
  const W = widthOf("#chart-null", 520, 900), H = 270, m = { t: 26, r: 16, b: 46, l: 48 };
  const lo = Math.min(d.edges[0], d.observed), hi = Math.max(d.edges[d.edges.length - 1], d.observed);
  const x = d3.scaleLinear().domain([lo - 0.01, hi + 0.01]).range([m.l, W - m.r]);
  const y = d3.scaleLinear().domain([0, d3.max(d.counts)]).nice().range([H - m.b, m.t]);
  const svg = d3.select("#chart-null").html("").append("svg").attr("width", W).attr("height", H).attr("role", "img")
    .attr("aria-label", `Distribution of how often ${NULL_KEY} people would be placed High by chance, with the observed value marked.`);
  y.ticks(4).forEach((v) => svg.append("line").attr("class", "gridline").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(v)).attr("y2", y(v)));
  d.counts.forEach((c, i) => {
    svg.append("rect").attr("x", x(d.edges[i]) + 1).attr("width", Math.max(1, x(d.edges[i + 1]) - x(d.edges[i]) - 2)).attr("y", y(c)).attr("height", y(0) - y(c))
      .attr("fill", css("--series-1")).attr("fill-opacity", 0.55).attr("rx", 2);
  });
  svg.append("line").attr("class", "ref-line").attr("x1", x(d.observed)).attr("x2", x(d.observed)).attr("y1", m.t - 6).attr("y2", H - m.b);
  svg.append("text").attr("class", "ref-label").attr("x", x(d.observed) + (d.observed > (lo + hi) / 2 ? -6 : 6)).attr("y", m.t - 10)
    .attr("text-anchor", d.observed > (lo + hi) / 2 ? "end" : "start").text(`Gemini: ${Math.round(d.observed * 100)}%`);
  x.ticks(6).forEach((v) => svg.append("text").attr("class", "tick-text").attr("x", x(v)).attr("y", H - m.b + 16).attr("text-anchor", "middle").text(`${Math.round(v * 100)}%`));
  svg.append("text").attr("class", "axis-title").attr("x", (m.l + W - m.r) / 2).attr("y", H - 6).attr("text-anchor", "middle").text(`HOW OFTEN THESE ${d.n} PEOPLE ARE PLACED HIGH`);
  d3.select("#null-foot").text(`If “${NULL_KEY.toLowerCase()}” made no difference, these ${d.n} people would be placed High in about ${Math.round(d.mean * 100)}% of rounds (bars: ${d.shuffles.toLocaleString()} random shuffles among people with the same VI‑SPDAT score). ` +
    `Gemini placed them High in ${Math.round(d.observed * 100)}%; ${d.extreme} of ${d.shuffles.toLocaleString()} shuffles were as extreme, p ${fmtP(d.p)}.`);
  const tst = Object.fromEntries(POOL.tests.filter((t) => t.family === "circumstance").map((t) => [t.factor, t]));
  table("#lim-circ-table", ["Circumstance", "People", "Placed High (rounds)", "Expected from VI‑SPDAT score", "Difference", "p", "Holm p"],
    Object.entries(POOL.circumstances).sort((a, b) => tst[a[0]].p - tst[b[0]].p).map(([name, c]) => {
      const t = tst[name], diff = Math.round((c.observed - c.expected) * 100), sig = t.p_holm < 0.05;
      const cell = (x) => (sig ? `<span class="weight-sig">${x}</span>` : x);
      return { cells: [cell(esc(name)), c.n, `${Math.round(c.observed * 100)}%`, `${Math.round(c.expected * 100)}%`, cell(`${diff > 0 ? "+" : ""}${diff} pts`), fmtP(t.p), cell(fmtP(t.p_holm))] };
    }));
}

/* ---------- summary, methods, and robustness pages ---------- */

const ciPct = (c) => `${Math.round(c[0] * 100)}–${Math.round(c[1] * 100)}%`;
const ciNum = (c) => `${c[0].toFixed(2)} to ${c[1].toFixed(2)}`;

function renderPages() {
  if (!POOL || !POOL.extra) return;
  renderSummary();
  renderMethods();
  renderRobustness();
}

/* ---------- summary ---------- */

function renderSummary() {
  const E = POOL.extra, A = E.agreement, C = E.correlation, F = E.reliability, t = tally(DATA.profiles);
  const circ = POOL.tests.filter((x) => x.family === "circumstance"), demo = POOL.tests.filter((x) => x.family === "demographic");
  const sigC = circ.filter((x) => x.p_holm < 0.05), sigD = demo.filter((x) => x.p_holm < 0.05);
  const top = sigC[0] ? POOL.circumstances[sigC[0].factor] : null;
  d3.select("#sum-answer").text(
    `Gemini's assignments agree substantially with VI‑SPDAT's: ${A.consensus_same} of 100 people are placed in the same category (95% CI ${ciPct(A.consensus_ci)}; weighted kappa ${A.kappa_consensus.toFixed(2)}, 95% CI ${ciNum(A.kappa_ci)}). ` +
    `The ${t.higher + t.lower} disagreements split evenly (${t.higher} placed higher, ${t.lower} lower) and sit next to VI‑SPDAT's cut-offs. ` +
    (sigD.length ? `Demographic differences: ${sigD.map((x) => x.factor).join(", ")}. ` : "No demographic factor changes who gets a High place beyond the VI‑SPDAT score. ") +
    (top ? `One circumstance does: people who cannot meet basic needs are placed High more often than their scores predict.` : ""));

  const tbl = [
    ["People in the same category as VI‑SPDAT", `${A.consensus_same} of 100`, `${ciPct(A.consensus_ci)}`, "Consensus of 10 rounds"],
    ["Weighted Cohen's kappa, VI‑SPDAT against Gemini", A.kappa_consensus.toFixed(2), ciNum(A.kappa_ci), "Substantial agreement"],
    ["Spearman correlation, VI‑SPDAT score and Gemini's average category", C.spearman.toFixed(2), ciNum(C.spearman_ci), "Gemini's ranking follows the score closely"],
    ["Kendall's tau, same variables", C.kendall.toFixed(2), ciNum(C.kendall_ci), "Rank agreement allowing for ties"],
    ["Fleiss' kappa across the 10 rounds", F.fleiss_kappa.toFixed(2), ciNum(F.fleiss_ci), "Gemini places the same people consistently"],
    ["People placed higher / lower than VI‑SPDAT", `${t.higher} / ${t.lower}`, "—", "Symmetric once places are limited"],
    ["People given the same category in all 10 rounds", `${POOL.same_category_in_every_round} of 100`, "—", "The rest vary with list order"]
  ];
  if (top) tbl.push([`“${sigC[0].factor}”: placed High in the rounds`, `${Math.round(top.observed * 100)}% vs ${Math.round(top.expected * 100)}% expected`, "—", `Holm p ${fmtP(sigC[0].p_holm)}; n = ${top.n}`]);
  tbl.push(["Demographic factors significant (gender, race, city, age)", `${sigD.length} of ${demo.length}`, "—", `Holm p ${demo.map((x) => fmtP(x.p_holm)).join(", ")}`]);
  table("#sum-table", ["Measure", "Estimate", "95% CI", "Reading"], tbl.map((r) => ({ cells: r })));
  d3.select("#sum-foot").text("CI: confidence interval. Kappa: 0 is chance agreement, 1 is perfect. See the Glossary for each measure.");

  const moved = DATA.profiles.filter((p) => gem(p) !== p.vispdat), near = moved.filter((p) => [3, 4, 7, 8].includes(p.score)).length;
  const sdw = E.power.residual_sd, mdeAt = (n) => Math.round(100 * 2.8 * sdw * Math.sqrt(1 / n + 1 / (100 - n)));
  const kc = E.per_round[sigC[0] ? sigC[0].factor : "Cannot meet basic needs"];
  const items = [
    `<strong>Agreement is substantial, and the approaches differ mostly at the cut-offs.</strong> ${A.consensus_same} of 100 people get the same category, and ${t.higher + t.lower} are placed differently, ${near} of them with VI‑SPDAT scores of 3, 4, 7, or 8 (next to a cut-off). Nobody scoring 0 to 1 or 12 and above is moved. (Agreement, Overview)`,
    `<strong>With limited places the disagreements are two-way.</strong> ${t.higher} people are placed higher and ${t.lower} lower, because Gemini has to choose who gets scarce places. (Agreement)`,
    `<strong>Gemini's ranking follows the VI‑SPDAT score.</strong> Spearman rho ${C.spearman.toFixed(2)}; the score alone explains ${Math.round(POOL.r2_score_only * 100)}% of who gets a High place, and the 17 factors together ${Math.round(POOL.r2_factors * 100)}%, so Gemini also weighs the factors differently from VI‑SPDAT's equal points. (Agreement, The 17 factors)`,
    top ? `<strong>One circumstance changes who gets a High place: “${sigC[0].factor.toLowerCase()}”.</strong> The ${top.n} people with it were placed High in ${Math.round(top.observed * 100)}% of rounds, against ${Math.round(top.expected * 100)}% expected from their scores (Holm p ${fmtP(sigC[0].p_holm)}). The test reached p < .05 in ${kc.rounds_p05} of the 10 rounds alone. (Significance, Robustness)` :
      `<strong>No circumstance changes who gets a High place after correction.</strong> (Significance)`,
    `<strong>No demographic factor changes who gets a High place.</strong> Gender, race, city, and age: Holm p ${demo.map((x) => fmtP(x.p_holm)).join(", ")}. With groups of 9 to 50 only large differences (about ${mdeAt(50)} to ${mdeAt(9)} points) could be detected. (Significance, Robustness)`,
    `<strong>Gemini is consistent but not deterministic.</strong> Fleiss' kappa across rounds is ${F.fleiss_kappa.toFixed(2)}, but only ${POOL.same_category_in_every_round} people get the same category every time; the others are near a cut-off and change with list order. (Agreement, Robustness)`
  ];
  const el = d3.select("#sum-findings").html("");
  const ol = el.append("ol");
  items.forEach((h) => ol.append("li").html(h));
}

/* ---------- methods tables ---------- */

function renderMethods() {
  const E = POOL.extra;
  table("#meth-rounds", ["Round", "Requested (UTC)", "Time", "Attempts", "Model version", "Prompt SHA‑256 (first 16)"],
    E.rounds_meta.map((r) => ({ cells: [r.round, r.requested_at.replace("T", " ").replace("+00:00", ""), `${(r.seconds / 60).toFixed(1)} min`, r.attempt, esc(r.model_version), `<code>${r.prompt_sha256.slice(0, 16)}</code>`] })));
  const c = E.cost;
  table("#meth-params", ["Setting", "Value"], [
    ["Model", "Gemini 3.8 Flash (Gemini API, generate_content), default reasoning and sampling, no system instruction"],
    ["Rounds / people per round", `${c.rounds} / 100`],
    ["Places", "35 High, 40 Medium, 25 Low (exact split required)"],
    ["Order of people", "New seeded random order and anonymous numbering each round"],
    ["Permutation tests", `${POOL.tests.length ? "20,000" : ""} shuffles within VI‑SPDAT score; Holm correction within each family (4 demographic, 16 circumstance)`],
    ["Shuffle test shown on Significance page", `${POOL.null ? Object.values(POOL.null)[0].shuffles.toLocaleString() : ""} shuffles per circumstance`],
    ["Per-round tests (Robustness)", `${E.permutations.toLocaleString()} shuffles per circumstance per round`],
    ["Bootstrap", `${E.bootstrap.toLocaleString()} resamples of people; percentile 95% intervals`],
    ["Regression", "OLS on 17 factors, HC3 robust standard errors, Holm-adjusted p-values"],
    ["Random seed (extra analyses)", E.seed],
    ["Tokens used (10 rounds)", `${c.input_tokens.toLocaleString()} input, ${c.reasoning_tokens.toLocaleString()} reasoning, ${c.output_tokens.toLocaleString()} output`],
    ["Estimated cost", `about $${c.usd.toFixed(2)} (${esc(c.prices)})`]
  ].map((r) => ({ cells: r })));
}

/* ---------- robustness ---------- */

let FOREST_FAMILY = "demographic";

function renderRobustness() {
  const E = POOL.extra, F = E.reliability, A = E.agreement, C = E.correlation;
  d3.select("#rob-lede").text(
    "These checks ask whether the findings depend on the particular way the results are summarized: how consistent Gemini is across rounds, how precisely each group difference is estimated, whether significance recurs round by round, and what size of difference this study could detect.");
  const cards = [
    { kicker: "Reliability", stat: `κ = ${F.fleiss_kappa.toFixed(2)}`, note: "Fleiss' kappa across the 10 rounds", body: `95% CI ${ciNum(F.fleiss_ci)}. Two rounds agree on ${Math.round(F.pairwise_mean)} of 100 people on average (range ${F.pairwise_min}–${F.pairwise_max}).` },
    { kicker: "Rank agreement", stat: `ρ = ${C.spearman.toFixed(2)}`, note: "Spearman: VI‑SPDAT score and Gemini's average category", body: `95% CI ${ciNum(C.spearman_ci)}. Kendall's tau ${C.kendall.toFixed(2)} (${ciNum(C.kendall_ci)}).` },
    { kicker: "Agreement", stat: `${A.consensus_same} of 100`, note: "consensus agreement with VI‑SPDAT", body: `95% CI ${ciPct(A.consensus_ci)}. Single rounds: ${A.per_round_min} to ${A.per_round_max} (mean ${A.per_round_mean}, SD ${A.per_round_sd}).` },
    { kicker: "Power", stat: `${E.power.mde.find((m) => m.n === 20).points} pts`, note: "smallest difference detectable for a group of 20", body: "At 80% power. Groups of 20 are the size of each race and city here." }
  ];
  const el = d3.select("#rob-cards").html("");
  cards.forEach((c) => {
    const a = el.append("article").attr("class", "fcard");
    a.append("p").attr("class", "fcard-kicker").text(c.kicker);
    a.append("p").attr("class", "fcard-stat").text(c.stat);
    a.append("p").attr("class", "fcard-note").text(c.note);
    a.append("p").attr("class", "fcard-body").text(c.body);
  });
  renderForest();
  renderHeat();
  renderScore();
  renderPower();
  const cs = E.consensus;
  table("#rob-consensus", ["Rule", "People in the same category as VI‑SPDAT", "Notes"], [
    ["Average-rank allocation (used here)", cs.mean_rank_allocation.same, esc(cs.mean_rank_allocation.note)],
    ["Average of single rounds", cs.single_round_mean.same, esc(cs.single_round_mean.note)],
    ["Most common category", cs.most_common_category.same,
      `${esc(cs.most_common_category.note)} (High ${cs.most_common_category.counts.High}, Medium ${cs.most_common_category.counts.Medium}, Low ${cs.most_common_category.counts.Low})`]
  ].map((r) => ({ cells: r })));
  const pos = POOL.position;
  if (pos) {
    table("#rob-position", ["Check", "Result"], [
      ["Correlation of list position with category, after accounting for VI‑SPDAT score (mean of 10 rounds)", `rho = ${pos.spearman_mean.toFixed(3)} (range ${pos.spearman_min.toFixed(2)} to ${pos.spearman_max.toFixed(2)})`],
      ["Share placed High, first half of the list / second half", `${Math.round(pos.first_half_high * 100)}% / ${Math.round(pos.second_half_high * 100)}%`],
      ["Rounds with a significant position correlation (p < .05)", `${pos.rounds_sig} of ${E.cost.rounds}`]
    ].map((r) => ({ cells: r })));
    d3.select("#position-foot").text(`A correlation near zero and no consistent sign across rounds means list position did not systematically change who got a High place.`);
  }
}

function renderForest() {
  const E = POOL.extra;
  chipGroup("#forest-chips", [{ value: "demographic", label: "Demographics" }, { value: "circumstance", label: "Circumstances" }], FOREST_FAMILY,
    (v) => { FOREST_FAMILY = v; renderForest(); });
  const nice = (r) => (r.family === "demographic" ? `${r.factor}: ${GROUP_SHORT(r.group)}` : r.factor);
  const rows = E.forest.filter((r) => r.family === FOREST_FAMILY).sort((a, b) => b.diff - a.diff);
  const W = widthOf("#chart-forest", 600, 980), rh = 26, m = { t: 30, r: 230, b: 36, l: 280 }, H = m.t + rows.length * rh + m.b;
  const ext = Math.max(0.3, d3.max(rows, (r) => Math.max(Math.abs(r.ci[0]), Math.abs(r.ci[1]))));
  const x = d3.scaleLinear().domain([-ext, ext]).nice().range([m.l, W - m.r]);
  const svg = d3.select("#chart-forest").html("").append("svg").attr("width", W).attr("height", H).attr("role", "img")
    .attr("aria-label", "Difference in High-place share between Gemini and VI-SPDAT for each group, with 95% confidence intervals.");
  x.ticks(8).forEach((v) => {
    svg.append("line").attr("class", "gridline").attr("x1", x(v)).attr("x2", x(v)).attr("y1", m.t - 6).attr("y2", H - m.b);
    svg.append("text").attr("class", "tick-text").attr("x", x(v)).attr("y", H - m.b + 16).attr("text-anchor", "middle").text(`${v > 0 ? "+" : ""}${Math.round(v * 100)}`);
  });
  svg.append("line").attr("class", "ref-line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", m.t - 6).attr("y2", H - m.b);
  svg.append("text").attr("class", "axis-title").attr("x", (m.l + W - m.r) / 2).attr("y", H - 4).attr("text-anchor", "middle").text("GEMINI MINUS VI‑SPDAT, PERCENTAGE POINTS OF THE GROUP GIVEN A HIGH PLACE");
  svg.append("text").attr("class", "axis-title").attr("x", W - m.r + 14).attr("y", m.t - 12).text("VI‑SPDAT → GEMINI (n)");
  rows.forEach((r, i) => {
    const cy = m.t + i * rh + rh / 2, g = svg.append("g"), excl = r.ci[0] > 0 || r.ci[1] < 0;
    svg.append("text").attr("class", "group-label").attr("x", m.l - 12).attr("y", cy).attr("dy", "0.35em").attr("text-anchor", "end").attr("font-weight", excl ? 700 : 400).text(nice(r));
    g.append("line").attr("class", "ci-line").attr("x1", x(r.ci[0])).attr("x2", x(r.ci[1])).attr("y1", cy).attr("y2", cy);
    g.append("circle").attr("cx", x(r.diff)).attr("cy", cy).attr("r", 5.5).attr("fill", css(r.diff >= 0 ? "--series-2" : "--series-1"));
    svg.append("text").attr("class", "bar-value").style("text-anchor", "start").attr("x", W - m.r + 14).attr("y", cy).attr("dy", "0.35em")
      .text(`${Math.round(r.vispdat_high * 100)}% → ${Math.round(r.gemini_high * 100)}% (${r.n})`);
    hover(g, () => `<span class="tt-title">${esc(nice(r))}</span><span class="tt-row">n = ${r.n}</span><span class="tt-row">VI‑SPDAT ${Math.round(r.vispdat_high * 100)}% → Gemini ${Math.round(r.gemini_high * 100)}% given a High place</span><span class="tt-row">Difference ${r.diff > 0 ? "+" : ""}${(r.diff * 100).toFixed(1)} points [${(r.ci[0] * 100).toFixed(1)}, ${(r.ci[1] * 100).toFixed(1)}]</span>`);
  });
  const ex = rows.filter((r) => r.ci[0] > 0 || r.ci[1] < 0).length;
  d3.select("#forest-foot").text(`${ex} of ${rows.length} intervals exclude zero. Bold labels mark them. These intervals compare Gemini with VI‑SPDAT's own High places; the significance tests on the Significance page instead hold the VI‑SPDAT score fixed, so the two answer related but different questions.`);
}

function renderHeat() {
  const E = POOL.extra, R = E.cost.rounds;
  const names = Object.keys(E.per_round).sort((a, b) => E.per_round[b].rounds_p05 - E.per_round[a].rounds_p05 || E.per_round[a].median_p - E.per_round[b].median_p);
  const tst = Object.fromEntries(POOL.tests.filter((x) => x.family === "circumstance").map((x) => [x.factor, x]));
  const cw = 34, rh = 26, m = { t: 44, l: 280, r: 220 }, W = m.l + R * cw + m.r, H = m.t + names.length * rh + 12;
  const svg = d3.select("#chart-heat").html("").append("svg").attr("width", W).attr("height", H).attr("role", "img")
    .attr("aria-label", "For each circumstance and round, whether the permutation test reached p below .05.");
  d3.range(R).forEach((k) => svg.append("text").attr("class", "axis-label").attr("x", m.l + k * cw + cw / 2).attr("y", m.t - 10).attr("text-anchor", "middle").text(k + 1));
  svg.append("text").attr("class", "axis-title").attr("x", m.l + (R * cw) / 2).attr("y", 12).attr("text-anchor", "middle").text("ROUND");
  svg.append("text").attr("class", "axis-title").attr("x", m.l + R * cw + 16).attr("y", m.t - 10).text("ROUNDS p < .05 · HOLM p");
  names.forEach((name, i) => {
    const y = m.t + i * rh, d = POOL.circumstances[name], up = d.observed >= d.expected, row = E.per_round[name];
    svg.append("text").attr("class", "group-label").attr("x", m.l - 12).attr("y", y + rh / 2).attr("dy", "0.35em").attr("text-anchor", "end").text(`${name} ${up ? "↑" : "↓"}`);
    row.p.forEach((p, k) => {
      const sig = p < 0.05, strong = p < 0.01;
      const fill = sig ? d3.interpolateLab(css("--surface-sunk"), css(up ? "--series-2" : "--series-1"))(strong ? 1 : 0.6) : css("--surface-sunk");
      const g = svg.append("g");
      g.append("rect").attr("x", m.l + k * cw + 1).attr("y", y + 1).attr("width", cw - 2).attr("height", rh - 2).attr("rx", 3).attr("fill", fill).attr("fill-opacity", sig ? 1 : 0.55);
      hover(g, () => `<span class="tt-title">${esc(name)}, round ${k + 1}</span><span class="tt-row">p = ${fmtP(p)}</span><span class="tt-row">${up ? "More" : "Fewer"} High places than expected overall</span>`);
    });
    svg.append("text").attr("class", "bar-value").style("text-anchor", "start").attr("x", m.l + R * cw + 16).attr("y", y + rh / 2).attr("dy", "0.35em")
      .attr("font-weight", tst[name].p_holm < 0.05 ? 700 : 500).text(`${row.rounds_p05} of ${R} · ${fmtP(tst[name].p_holm)}`);
  });
  const k = names[0], consistent = names.filter((n) => E.per_round[n].rounds_p05 >= 6);
  d3.select("#heat-foot").text(`Arrows show the direction of each circumstance's overall difference (↑ more High places than expected, ↓ fewer). ${consistent.length ? `${consistent.map((n) => `“${n}”`).join(", ")} reach p < .05 in at least 6 of ${R} rounds. ` : ""}` +
    `Repeated rounds are not independent samples of people, so recurring significance shows Gemini is consistent, not that the effect generalizes. The Holm column is the corrected result from the full 10-round analysis.`);
}

function renderScore() {
  const P = DATA.profiles;
  legend("#legend-score", CATS.map((c) => ({ name: `VI‑SPDAT ${c}`, color: css(CAT_COLOR[c]) })));
  const W = widthOf("#chart-score", 560, 960), H = 320, m = { t: 20, r: 16, b: 46, l: 70 };
  const x = d3.scaleLinear().domain([-0.5, 17.5]).range([m.l, W - m.r]);
  const y = d3.scaleLinear().domain([0, 2]).range([H - m.b, m.t]);
  const svg = d3.select("#chart-score").html("").append("svg").attr("width", W).attr("height", H).attr("role", "img")
    .attr("aria-label", "Each person's VI-SPDAT score against Gemini's average category over 10 rounds.");
  [[0, "Low"], [1, "Medium"], [2, "High"]].forEach(([v, l]) => {
    svg.append("line").attr("class", "gridline").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(v)).attr("y2", y(v));
    svg.append("text").attr("class", "tick-text").attr("x", m.l - 8).attr("y", y(v)).attr("dy", "0.32em").attr("text-anchor", "end").text(l);
  });
  d3.range(0, 18).forEach((s) => svg.append("text").attr("class", "axis-label").attr("x", x(s)).attr("y", H - m.b + 16).attr("text-anchor", "middle").text(s));
  svg.append("text").attr("class", "axis-title").attr("x", (m.l + W - m.r) / 2).attr("y", H - 6).attr("text-anchor", "middle").text("VI‑SPDAT SCORE");
  const avg = d3.rollups(P, (v) => d3.mean(v, meanRank), (p) => p.score).sort((a, b) => a[0] - b[0]);
  svg.append("path").attr("d", d3.line().x((d) => x(d[0])).y((d) => y(d[1]))(avg)).attr("fill", "none").attr("stroke", css("--ink-muted")).attr("stroke-width", 2).attr("stroke-dasharray", "5 4");
  const rnd = d3.randomLcg(7), jit = () => (rnd() - 0.5) * 0.5;
  P.forEach((p) => {
    const sel = svg.append("circle").datum(p).attr("cx", x(p.score + jit())).attr("cy", y(meanRank(p))).attr("r", 4.2).attr("fill", css(CAT_COLOR[p.vispdat])).attr("fill-opacity", 0.75).attr("stroke", css("--surface")).attr("stroke-width", 0.8);
    hover(sel, (d) => `<span class="tt-title">${personLine(d)}</span><span class="tt-row">VI‑SPDAT ${d.score}; Gemini average ${meanRank(d).toFixed(1)}</span>`);
  });
  const C = POOL.extra.correlation;
  d3.select("#score-foot").text(`Spearman rho ${C.spearman.toFixed(2)} (95% CI ${ciNum(C.spearman_ci)}). Dots are jittered horizontally so people with the same score do not overlap; the dashed line is the average at each score.`);
}

function renderPower() {
  const E = POOL.extra, sd = E.power.residual_sd, N = 100;
  const mde = (n) => 100 * 2.8 * sd * Math.sqrt(1 / n + 1 / (N - n));
  const pts = Object.entries(POOL.circumstances).map(([name, c]) => ({ name, n: c.n, d: Math.abs(c.observed - c.expected) * 100, up: c.observed >= c.expected }));
  const W = widthOf("#chart-power", 560, 900), H = 320, m = { t: 20, r: 20, b: 46, l: 56 };
  const x = d3.scaleLinear().domain([5, 80]).range([m.l, W - m.r]);
  const y = d3.scaleLinear().domain([0, 40]).range([H - m.b, m.t]);
  const svg = d3.select("#chart-power").html("").append("svg").attr("width", W).attr("height", H).attr("role", "img")
    .attr("aria-label", "Smallest detectable difference in High-place rate by group size, with the tested circumstances.");
  y.ticks(5).forEach((v) => {
    svg.append("line").attr("class", "gridline").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(v)).attr("y2", y(v));
    svg.append("text").attr("class", "tick-text").attr("x", m.l - 8).attr("y", y(v)).attr("dy", "0.32em").attr("text-anchor", "end").text(v);
  });
  x.ticks(8).forEach((v) => svg.append("text").attr("class", "axis-label").attr("x", x(v)).attr("y", H - m.b + 16).attr("text-anchor", "middle").text(v));
  svg.append("text").attr("class", "axis-title").attr("x", (m.l + W - m.r) / 2).attr("y", H - 6).attr("text-anchor", "middle").text("PEOPLE IN THE GROUP");
  svg.append("text").attr("class", "axis-title").attr("transform", `translate(14 ${(m.t + H - m.b) / 2}) rotate(-90)`).attr("text-anchor", "middle").text("DIFFERENCE IN HIGH-PLACE RATE (POINTS)");
  const curve = d3.range(8, 81, 1).map((n) => [n, mde(n)]);
  svg.append("path").attr("d", d3.area().x((d) => x(d[0])).y0(y(0)).y1((d) => y(d[1]))(curve)).attr("fill", css("--series-1")).attr("fill-opacity", 0.1);
  svg.append("path").attr("d", d3.line().x((d) => x(d[0])).y((d) => y(d[1]))(curve)).attr("fill", "none").attr("stroke", css("--series-1")).attr("stroke-width", 2);
  const mde50 = (n) => (mde(n) * 1.96) / 2.8;
  const curve50 = d3.range(8, 81, 1).map((n) => [n, mde50(n)]);
  svg.append("path").attr("d", d3.line().x((d) => x(d[0])).y((d) => y(d[1]))(curve50)).attr("fill", "none").attr("stroke", css("--series-1")).attr("stroke-width", 1.5).attr("stroke-dasharray", "5 4");
  svg.append("text").attr("class", "ref-label").attr("x", W - m.r).attr("y", y(mde(80)) - 8).attr("text-anchor", "end").text("detected 80% of the time");
  svg.append("text").attr("class", "ref-label").attr("x", x(56)).attr("y", y(mde50(56)) + 22).attr("text-anchor", "middle").text("detected about half the time");
  pts.forEach((p) => {
    const sel = svg.append("circle").datum(p).attr("cx", x(p.n)).attr("cy", y(p.d)).attr("r", 5.5).attr("fill", css(p.up ? "--series-2" : "--series-1")).attr("fill-opacity", 0.85).attr("stroke", css("--surface")).attr("stroke-width", 1);
    hover(sel, (d) => `<span class="tt-title">${esc(d.name)}</span><span class="tt-row">${d.n} people; difference ${d.d.toFixed(1)} points</span><span class="tt-row">Detectable above ${mde(d.n).toFixed(1)} points</span>`);
  });
  const above = pts.filter((p) => p.d > mde(p.n)).length, above50 = pts.filter((p) => p.d > mde50(p.n)).length;
  d3.select("#power-foot").text(`Minimum detectable differences: ${E.power.mde.map((m) => `${m.n} people ${m.points} pts`).join("; ")}. ${above} of ${pts.length} circumstances lie above the 80% curve and ${above50} above the 50% curve. A difference between the curves is detected some of the time, so a significant result there is plausible but may overstate the true size. ` +
    `${E.power.note} Residual spread of High-place rate at a given score: SD ${sd.toFixed(2)}.`);
}

