/* ============================================================
   Dashboard charts & tables

   Scores are computed from indicator flags using the published
   VI-SPDAT (Single Adults, American Version 2.0) scoring rules,
   never asserted in the data.

   Mark specs: bars <=24px thick, 4px rounded data-end square at the
   baseline, 2px surface gap between adjacent bars, hairline solid
   gridlines, legend always present for >=2 series, hover tooltips.
   ============================================================ */

const DOMAIN_COLOR = {
  pre: "--ink-muted",
  a: "--series-1",
  b: "--series-2",
  c: "--series-3",
  d: "--series-4"
};

const MODELS = [
  { key: "vispdat", name: "VI-SPDAT", varName: "--series-1" },
  { key: "llm", name: "AI-based model (LLM)", varName: "--series-2" }
];

const css = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

let INSTRUMENT = null;
let BANDS = [];
let DOMAINS = [];
let INDICATOR_BY_ID = new Map();

function scoreOf(profile) {
  return profile.indicators.length;
}

function domainScore(profile, domainKey) {
  return profile.indicators.filter(
    (id) => INDICATOR_BY_ID.get(id) && INDICATOR_BY_ID.get(id).domain === domainKey
  ).length;
}

const bandOf = (total) => BANDS.find((b) => total >= b.min && total <= b.max);

/* ---------- tooltip ---------- */

const tip = document.createElement("div");
tip.className = "tooltip";
document.body.appendChild(tip);

function showTip(event, html) {
  tip.innerHTML = html;
  tip.classList.add("visible");
  moveTip(event);
}
function moveTip(event) {
  const pad = 14;
  const rect = tip.getBoundingClientRect();
  let x = event.clientX + pad;
  let y = event.clientY + pad;
  if (x + rect.width > window.innerWidth - 8) x = event.clientX - rect.width - pad;
  if (y + rect.height > window.innerHeight - 8) y = event.clientY - rect.height - pad;
  tip.style.left = x + "px";
  tip.style.top = y + "px";
}
function hideTip() {
  tip.classList.remove("visible");
}

/* ---------- shared chart helpers ---------- */

// Rounded at the data-end, square at the baseline.
function barPath(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, Math.max(h, 0));
  if (h <= 0) return `M${x},${y}`;
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y}
          L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr}
          L${x + w},${y + h} Z`;
}

const MAX_BAR = 24;
const GAP = 2;
const RADIUS = 4;

function makeSvg(container, width, height) {
  d3.select(container).selectAll("svg").remove();
  return d3
    .select(container)
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", `0 0 ${width} ${height}`);
}

function drawGrid(g, y, width, ticks) {
  g.selectAll(".gridline")
    .data(ticks)
    .join("line")
    .attr("class", "gridline")
    .attr("x1", 0)
    .attr("x2", width)
    .attr("y1", (d) => y(d))
    .attr("y2", (d) => y(d));
}

function drawYTicks(g, y, ticks) {
  g.selectAll(".ytick")
    .data(ticks)
    .join("text")
    .attr("class", "tick-text ytick")
    .attr("x", -10)
    .attr("y", (d) => y(d))
    .attr("dy", "0.32em")
    .attr("text-anchor", "end")
    .text((d) => d);
}

function wrapLabel(text, maxChars) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  words.forEach((w) => {
    if ((line + " " + w).trim().length > maxChars && line) {
      lines.push(line.trim());
      line = w;
    } else {
      line = (line + " " + w).trim();
    }
  });
  if (line) lines.push(line);
  return lines;
}

function renderLegend(container, items) {
  const el = d3.select(container);
  el.selectAll("*").remove();
  items.forEach((item) => {
    const row = el.append("span").attr("class", "legend-item");
    row
      .append("span")
      .attr("class", item.blank ? "legend-swatch is-blank" : "legend-swatch")
      .style("background", item.blank ? null : item.color);
    row.append("span").text(item.name);
  });
}

/* ============================================================
   1. Distribution of the 32 base profiles (real data)
   ============================================================ */

function renderDistribution(profiles) {
  const container = "#chart-distribution";
  const counts = d3.rollup(profiles, (v) => v.length, (p) => scoreOf(p));
  const scores = d3.range(0, 18);
  const data = scores.map((s) => ({ score: s, count: counts.get(s) || 0 }));

  const margin = { top: 28, right: 16, bottom: 52, left: 40 };
  const outerW = Math.max(560, Math.min(920, document.querySelector(container).clientWidth || 720));
  const width = outerW - margin.left - margin.right;
  const height = 240;

  const svg = makeSvg(container, outerW, height + margin.top + margin.bottom);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleBand().domain(scores).range([0, width]).paddingInner(0);
  const maxCount = d3.max(data, (d) => d.count) || 1;
  const y = d3.scaleLinear().domain([0, maxCount]).range([height, 0]).nice();
  const ticks = y.ticks(Math.min(maxCount, 4));

  drawGrid(g, y, width, ticks);
  drawYTicks(g, y, ticks);

  // Threshold markers where a one-point shift changes the recommendation.
  [3.5, 7.5].forEach((cut) => {
    const cx = x(Math.floor(cut)) + x.bandwidth();
    g.append("line")
      .attr("class", "threshold")
      .attr("x1", cx).attr("x2", cx)
      .attr("y1", -14).attr("y2", height);
    g.append("text")
      .attr("class", "threshold-label")
      .attr("x", cx + 5)
      .attr("y", -18)
      .text(cut === 3.5 ? "Rapid Re-Housing threshold" : "PSH threshold");
  });

  const barW = Math.min(MAX_BAR, x.bandwidth() - GAP);
  const offset = (x.bandwidth() - barW) / 2;

  g.selectAll(".bar")
    .data(data.filter((d) => d.count > 0))
    .join("path")
    .attr("class", "bar")
    .attr("d", (d) => barPath(x(d.score) + offset, y(d.count), barW, height - y(d.count), RADIUS))
    .attr("fill", (d) => css(bandOf(d.score).varName))
    .style("cursor", "pointer")
    .on("mouseenter", function (event, d) {
      const band = bandOf(d.score);
      showTip(
        event,
        `<span class="tt-title">Score ${d.score} of 17</span>
         <span class="tt-row"><span class="tt-dot" style="background:${css(band.varName)}"></span>
         ${d.count} base profile${d.count === 1 ? "" : "s"} &middot; ${band.name}</span>`
      );
    })
    .on("mousemove", moveTip)
    .on("mouseleave", hideTip);

  g.append("line")
    .attr("class", "baseline")
    .attr("x1", 0).attr("x2", width)
    .attr("y1", height).attr("y2", height);

  g.selectAll(".xtick")
    .data(scores)
    .join("text")
    .attr("class", "tick-text xtick")
    .attr("x", (d) => x(d) + x.bandwidth() / 2)
    .attr("y", height + 18)
    .attr("text-anchor", "middle")
    .text((d) => d);

  g.append("text")
    .attr("class", "axis-title")
    .attr("x", width / 2)
    .attr("y", height + 42)
    .attr("text-anchor", "middle")
    .text("VI-SPDAT total score (0–17)");

  g.append("text")
    .attr("class", "axis-title")
    .attr("transform", "rotate(-90)")
    .attr("x", -height / 2)
    .attr("y", -28)
    .attr("text-anchor", "middle")
    .text("Base profiles");

  renderLegend(
    "#legend-distribution",
    BANDS.map((b) => ({ name: `${b.name} (${b.min}–${b.max})`, color: css(b.varName) }))
  );
}

/* ============================================================
   2. Blank template chart - planned results, no data yet
   ============================================================ */

function renderBlankTemplate() {
  const container = "#chart-blank";
  const races = [
    "American Indian, Alaska Native,\nor Indigenous",
    "Asian or Asian American",
    "Black, African American,\nor African",
    "Hispanic/Latino/e/a",
    "White"
  ];

  const margin = { top: 12, right: 16, bottom: 74, left: 44 };
  const outerW = Math.max(560, Math.min(920, document.querySelector(container).clientWidth || 720));
  const width = outerW - margin.left - margin.right;
  const height = 260;

  const svg = makeSvg(container, outerW, height + margin.top + margin.bottom);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const x0 = d3.scaleBand().domain(races).range([0, width]).paddingInner(0.3);
  const x1 = d3.scaleBand().domain(MODELS.map((m) => m.key)).range([0, x0.bandwidth()]).paddingInner(0);
  const y = d3.scaleLinear().domain([0, 17]).range([height, 0]);
  const ticks = [0, 4, 8, 12, 17];

  drawGrid(g, y, width, ticks);
  drawYTicks(g, y, ticks);

  const barW = Math.min(MAX_BAR, x1.bandwidth() - GAP);
  const offset = (x1.bandwidth() - barW) / 2;

  races.forEach((race) => {
    const group = g.append("g").attr("transform", `translate(${x0(race)},0)`);
    MODELS.forEach((m) => {
      const bx = x1(m.key) + offset;
      group
        .append("rect")
        .attr("class", "blank-bar")
        .attr("x", bx)
        .attr("y", y(11))
        .attr("width", barW)
        .attr("height", height - y(11))
        .attr("rx", RADIUS)
        .attr("stroke", css(m.varName))
        .attr("stroke-opacity", 0.75);
      group
        .append("text")
        .attr("class", "blank-mark")
        .attr("x", bx + barW / 2)
        .attr("y", y(11) - 7)
        .text("—");
    });
  });

  g.append("text")
    .attr("class", "awaiting")
    .attr("x", width / 2)
    .attr("y", y(15))
    .text("Awaiting model output");

  g.append("line")
    .attr("class", "baseline")
    .attr("x1", 0).attr("x2", width)
    .attr("y1", height).attr("y2", height);

  races.forEach((race) => {
    const cx = x0(race) + x0.bandwidth() / 2;
    const label = g.append("text").attr("class", "tick-text").attr("text-anchor", "middle");
    race.split("\n").forEach((line, i) => {
      label.append("tspan").attr("x", cx).attr("y", height + 18 + i * 13).text(line);
    });
  });

  g.append("text")
    .attr("class", "axis-title")
    .attr("x", width / 2)
    .attr("y", height + 64)
    .attr("text-anchor", "middle")
    .text("HUD race and ethnicity category");

  g.append("text")
    .attr("class", "axis-title")
    .attr("transform", "rotate(-90)")
    .attr("x", -height / 2)
    .attr("y", -30)
    .attr("text-anchor", "middle")
    .text("Mean vulnerability score (0–17)");

  renderLegend("#legend-blank", [
    ...MODELS.map((m) => ({ name: m.name, color: css(m.varName) })),
    { name: "Value not yet collected", blank: true }
  ]);
}

/* ============================================================
   3. Example-values chart - hidden by default, toggleable
   ============================================================ */

function renderDemo(rows) {
  const container = "#chart-demo";
  const margin = { top: 12, right: 16, bottom: 62, left: 44 };
  const el = document.querySelector(container);
  const outerW = Math.max(560, Math.min(920, el.clientWidth || 720));
  const width = outerW - margin.left - margin.right;
  const height = 240;

  const svg = makeSvg(container, outerW, height + margin.top + margin.bottom);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const groups = rows.map((d) => d.race);
  const x0 = d3.scaleBand().domain(groups).range([0, width]).paddingInner(0.3);
  const x1 = d3.scaleBand().domain(MODELS.map((m) => m.key)).range([0, x0.bandwidth()]).paddingInner(0);
  const y = d3.scaleLinear().domain([0, 17]).range([height, 0]);
  const ticks = [0, 4, 8, 12, 17];

  drawGrid(g, y, width, ticks);
  drawYTicks(g, y, ticks);

  const barW = Math.min(MAX_BAR, x1.bandwidth() - GAP);
  const offset = (x1.bandwidth() - barW) / 2;

  rows.forEach((row) => {
    const group = g.append("g").attr("transform", `translate(${x0(row.race)},0)`);
    MODELS.forEach((m) => {
      const value = row[m.key];
      group
        .append("path")
        .attr("d", barPath(x1(m.key) + offset, y(value), barW, height - y(value), RADIUS))
        .attr("fill", css(m.varName))
        .style("cursor", "pointer")
        .on("mouseenter", (event) =>
          showTip(
            event,
            `<span class="tt-title">${row.race}</span>
             <span class="tt-row"><span class="tt-dot" style="background:${css(m.varName)}"></span>
             ${m.name}: ${value.toFixed(1)}</span>`
          )
        )
        .on("mousemove", moveTip)
        .on("mouseleave", hideTip);
    });
  });

  g.append("line")
    .attr("class", "baseline")
    .attr("x1", 0).attr("x2", width)
    .attr("y1", height).attr("y2", height);

  groups.forEach((race) => {
    const cx = x0(race) + x0.bandwidth() / 2;
    const label = g.append("text").attr("class", "tick-text").attr("text-anchor", "middle");
    wrapLabel(race, 18).forEach((line, i) => {
      label.append("tspan").attr("x", cx).attr("y", height + 18 + i * 13).text(line);
    });
  });

  g.append("text")
    .attr("class", "axis-title")
    .attr("transform", "rotate(-90)")
    .attr("x", -height / 2)
    .attr("y", -30)
    .attr("text-anchor", "middle")
    .text("Mean vulnerability score (0–17)");

  renderLegend("#legend-demo", MODELS.map((m) => ({ name: m.name, color: css(m.varName) })));
}

/* ============================================================
   4. Instrument reference table
   ============================================================ */

function renderInstrument() {
  const tbody = d3.select("#instrument-body");
  tbody.selectAll("*").remove();

  DOMAINS.forEach((domain) => {
    const head = tbody.append("tr").attr("class", "domain-row");
    const cell = head.append("th").attr("colspan", 4).attr("scope", "rowgroup");
    cell
      .append("span")
      .attr("class", "domain-chip")
      .style("background", css(DOMAIN_COLOR[domain.key]));
    cell.append("span").attr("class", "domain-name")
      .text(domain.letter === "—" ? domain.name : `${domain.letter}. ${domain.name}`);
    cell.append("span").attr("class", "domain-max").text(`max ${domain.max}`);

    domain.indicators.forEach((ind) => {
      const tr = tbody.append("tr");
      tr.append("td").attr("class", "ind-name").text(ind.name);
      tr.append("td").attr("class", "ind-q").text(ind.questions);
      tr.append("td").attr("class", "ind-rule").text(ind.rule);
      tr.append("td").attr("class", "num").text("1");
    });
  });
}

/* ============================================================
   5. Base profile table
   ============================================================ */

let activeBand = "all";
const expanded = new Set();

const ATTRIBUTES = [
  { key: "background", label: "Work and education" },
  { key: "path", label: "Path into homelessness" },
  { key: "finances", label: "Financial situation" },
  { key: "ties", label: "Family and social ties" },
  { key: "routine", label: "A typical day" },
  { key: "goals", label: "What they want next" },
  { key: "services", label: "Service history" },
  { key: "demeanor", label: "Demeanor in the interview" }
];

function personDetail(profile) {
  const wrap = document.createElement("div");
  wrap.className = "person-detail";

  if (profile.design_role) {
    const role = document.createElement("p");
    role.className = "design-role";
    role.textContent = profile.design_role;
    wrap.appendChild(role);
  }

  const grid = document.createElement("div");
  grid.className = "attr-grid";
  ATTRIBUTES.forEach((attr) => {
    if (!profile[attr.key]) return;
    const block = document.createElement("div");
    block.className = "attr";
    const head = document.createElement("div");
    head.className = "attr-label";
    head.textContent = attr.label;
    const body = document.createElement("div");
    body.className = "attr-value";
    body.textContent = profile[attr.key];
    block.appendChild(head);
    block.appendChild(body);
    grid.appendChild(block);
  });
  wrap.appendChild(grid);

  return wrap;
}

function indicatorDetail(profile) {
  const wrap = document.createElement("div");
  wrap.className = "ind-detail";

  DOMAINS.forEach((domain) => {
    const block = document.createElement("div");
    block.className = "ind-block";

    const head = document.createElement("div");
    head.className = "ind-block-head";
    const swatch = document.createElement("span");
    swatch.className = "domain-chip";
    swatch.style.background = css(DOMAIN_COLOR[domain.key]);
    head.appendChild(swatch);
    const name = document.createElement("span");
    name.textContent =
      (domain.letter === "—" ? domain.name : `${domain.letter}. ${domain.name}`) +
      `  ${domainScore(profile, domain.key)}/${domain.max}`;
    head.appendChild(name);
    block.appendChild(head);

    domain.indicators.forEach((ind) => {
      const on = profile.indicators.includes(ind.id);
      const chip = document.createElement("span");
      chip.className = "ind-chip" + (on ? " on" : " off");
      chip.textContent = ind.name;
      chip.title = `${ind.questions} — ${ind.rule}`;
      if (on) chip.style.borderColor = css(DOMAIN_COLOR[domain.key]);
      block.appendChild(chip);
    });

    wrap.appendChild(block);
  });

  return wrap;
}

function renderProfileTable(profiles) {
  const tbody = d3.select("#profile-body");
  const rows = profiles.filter((p) => {
    if (activeBand === "all") return true;
    return bandOf(scoreOf(p)).id === Number(activeBand);
  });

  tbody.selectAll("*").remove();

  rows.forEach((p) => {
    const total = scoreOf(p);
    const band = bandOf(total);
    const isOpen = expanded.has(p.id);

    const tr = tbody.append("tr").attr("class", "profile-row" + (isOpen ? " is-open" : ""));

    const toggleCell = tr.append("td").attr("class", "toggle-cell");
    toggleCell
      .append("button")
      .attr("class", "row-toggle")
      .attr("type", "button")
      .attr("aria-expanded", isOpen)
      .attr("aria-label", `Show indicator detail for ${p.id}`)
      .text(isOpen ? "−" : "+")
      .on("click", () => {
        if (expanded.has(p.id)) expanded.delete(p.id);
        else expanded.add(p.id);
        renderProfileTable(profiles);
      });

    tr.append("td").attr("class", "id").text(p.id);

    const cell = tr.append("td");
    cell.append("span").attr("class", "p-label").text(p.label);
    cell.append("span").attr("class", "p-age").text(`Age ${p.age}`);
    cell.append("span").attr("class", "p-vignette").text(p.vignette);

    const compo = tr.append("td").append("div").attr("class", "compo");
    DOMAINS.forEach((d) => {
      const v = domainScore(p, d.key);
      if (v > 0) {
        compo
          .append("span")
          .style("width", (v / 17) * 100 + "%")
          .style("background", css(DOMAIN_COLOR[d.key]))
          .attr("title", `${d.name}: ${v} of ${d.max}`);
      }
    });

    DOMAINS.forEach((d) => {
      const v = domainScore(p, d.key);
      tr.append("td")
        .attr("class", "num" + (v === 0 ? " zero" : ""))
        .text(v);
    });

    tr.append("td").attr("class", "num total").text(total);

    const bandCell = tr.append("td").append("span").attr("class", "band-tag");
    bandCell.append("span").attr("class", "dot").style("background", css(band.varName));
    bandCell.append("span").text(band.name);

    if (isOpen) {
      const detailRow = tbody.append("tr").attr("class", "detail-row");
      const td = detailRow.append("td").attr("colspan", 11);
      td.node().appendChild(personDetail(p));
      td.node().appendChild(indicatorDetail(p));
    }
  });

  document.getElementById("profile-count").textContent =
    `${rows.length} of ${profiles.length} base profiles shown`;
}

function renderFilters(profiles) {
  const wrap = d3.select("#profile-filters");
  wrap.selectAll("*").remove();

  const options = [
    { value: "all", name: "All bands", count: profiles.length, color: null },
    ...BANDS.map((b) => ({
      value: String(b.id),
      name: `${b.name} (${b.min}–${b.max})`,
      count: profiles.filter((p) => bandOf(scoreOf(p)).id === b.id).length,
      color: css(b.varName)
    }))
  ];

  options.forEach((opt) => {
    const btn = wrap
      .append("button")
      .attr("class", "chip")
      .attr("type", "button")
      .attr("aria-pressed", activeBand === opt.value);
    if (opt.color) btn.append("span").attr("class", "dot").style("background", opt.color);
    btn.append("span").text(opt.name);
    btn.append("span").attr("class", "chip-count").text(opt.count);
    btn.on("click", () => {
      activeBand = opt.value;
      wrap.selectAll(".chip").attr("aria-pressed", function () {
        return this === btn.node();
      });
      renderProfileTable(profiles);
    });
  });
}

function renderDomainKey() {
  renderLegend(
    "#legend-domains",
    DOMAINS.map((d) => ({
      name: `${d.letter === "—" ? d.name : d.letter + ". " + d.name} (max ${d.max})`,
      color: css(DOMAIN_COLOR[d.key])
    }))
  );
}

/* ---------- expand / collapse all ---------- */

function wireExpandAll(profiles) {
  document.getElementById("expand-all").addEventListener("click", (event) => {
    if (expanded.size === profiles.length) {
      expanded.clear();
      event.currentTarget.textContent = "Expand all";
    } else {
      profiles.forEach((p) => expanded.add(p.id));
      event.currentTarget.textContent = "Collapse all";
    }
    renderProfileTable(profiles);
  });
}

/* ============================================================
   Boot
   ============================================================ */

let cachedProfiles = null;
let cachedDemo = null;

function renderAll() {
  if (cachedProfiles) {
    renderDistribution(cachedProfiles);
    renderInstrument();
    renderProfileTable(cachedProfiles);
    renderFilters(cachedProfiles);
    renderDomainKey();
  }
  renderBlankTemplate();
  if (cachedDemo && !document.getElementById("demo-wrap").hidden) {
    renderDemo(cachedDemo);
  }
}

Promise.all([
  d3.json("data/vispdat_instrument.json"),
  d3.json("data/base_profiles.json"),
  d3.json("data/sample_scores.json")
]).then(([instrument, profileData, demoData]) => {
  INSTRUMENT = instrument;
  DOMAINS = instrument.domains;
  BANDS = instrument.bands.map((b, i) => ({ ...b, varName: `--band-${i + 1}` }));

  DOMAINS.forEach((d) => {
    d.indicators.forEach((ind) => INDICATOR_BY_ID.set(ind.id, { ...ind, domain: d.key }));
  });

  cachedProfiles = profileData.profiles;
  cachedDemo = demoData;

  const n = cachedProfiles.length;
  const clones = n * 2 * 5;
  document.getElementById("stat-profiles").textContent = n;
  document.getElementById("stat-clones").textContent = clones.toLocaleString();
  document.getElementById("stat-instances").textContent = (clones * 2).toLocaleString();
  document.getElementById("stat-scores").textContent = (clones * 2 * 2).toLocaleString();

  wireExpandAll(cachedProfiles);
  renderAll();
});

document.getElementById("demo-toggle").addEventListener("click", (event) => {
  const wrap = document.getElementById("demo-wrap");
  const nowHidden = !wrap.hidden;
  wrap.hidden = nowHidden;
  event.currentTarget.textContent = nowHidden
    ? "Show version with example values"
    : "Hide version with example values";
  event.currentTarget.setAttribute("aria-expanded", String(!nowHidden));
  if (!nowHidden && cachedDemo) renderDemo(cachedDemo);
});

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderAll);

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderAll, 180);
});
