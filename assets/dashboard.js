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
   4b. Run schedule — randomized order, clones kept apart
   ============================================================ */

let SCHEDULE = null;
let RESULTS = null;
let activeSession = 1;

function renderSessionPicker() {
  const select = document.getElementById("session-select");
  select.innerHTML = "";
  SCHEDULE.sessions.forEach((sess) => {
    const opt = document.createElement("option");
    opt.value = sess.session;
    opt.textContent = `Session ${sess.session}`;
    select.appendChild(opt);
  });
  document.getElementById("session-total").textContent = SCHEDULE.sessions.length;

  const go = (n) => {
    const total = SCHEDULE.sessions.length;
    activeSession = ((n - 1 + total) % total) + 1;
    renderSchedule();
  };
  select.addEventListener("change", () => go(Number(select.value)));
  document.getElementById("session-prev").addEventListener("click", () => go(activeSession - 1));
  document.getElementById("session-next").addEventListener("click", () => go(activeSession + 1));
}

function renderSchedule() {
  const sess = SCHEDULE.sessions.find((s) => s.session === activeSession);
  document.getElementById("session-num").textContent = activeSession;
  document.getElementById("session-select").value = activeSession;

  const tbody = d3.select("#schedule-body");
  tbody.selectAll("*").remove();

  sess.items.forEach((item) => {
    const tr = tbody.append("tr");
    tr.append("td").attr("class", "num pos").text(item.position);
    tr.append("td").attr("class", "id").text(item.profile);
    tr.append("td").text(item.gender);
    tr.append("td").text(item.race);
    tr.append("td").text(item.location);
    tr.append("td")
      .attr("class", item.disclosure === "Underdisclosure" ? "disclosure partial" : "disclosure")
      .text(item.disclosure);
  });
}

/* ---------- AI model roster ---------- */

function renderModelsRoster(roster, summaries) {
  const byKey = new Map(summaries.map((s) => [s.key, s]));
  const tbody = d3.select("#models-body");
  tbody.selectAll("*").remove();

  roster.forEach((m) => {
    const s = byKey.get(m.key);
    const status = s ? s.status : "not run";
    const tr = tbody.append("tr");
    const versions = s && s.model_versions ? Object.keys(s.model_versions) : [];
    tr.append("td").attr("class", "p-label").text(m.label);
    tr.append("td").text(m.family);
    tr.append("td").text(m.interface);
    tr.append("td").append("span").attr("class", "mono").text(versions.length ? versions.join(", ") : "—");
    tr.append("td").attr("class", "num").text(s ? `${s.sessions_valid} / ${s.sessions_total}` : "—");
    tr.append("td")
      .append("span")
      .attr("class", `status-tag ${status.replace(" ", "-")}`)
      .text(status.charAt(0).toUpperCase() + status.slice(1));
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
  { key: "housing", label: "Current housing" },
  { key: "finances", label: "Finances" },
  { key: "health", label: "Health" },
  { key: "safety", label: "Safety" },
  { key: "ties", label: "Family and social ties" },
  { key: "routine", label: "A typical day" },
  { key: "goals", label: "Goals" },
  { key: "services", label: "Service history" },
  { key: "demeanor", label: "Presentation in the interview" }
];

function attrGrid(fields) {
  const grid = document.createElement("div");
  grid.className = "attr-grid";
  ATTRIBUTES.forEach((attr) => {
    if (!fields[attr.key]) return;
    const block = document.createElement("div");
    block.className = "attr";
    const head = document.createElement("div");
    head.className = "attr-label";
    head.textContent = attr.label;
    const body = document.createElement("div");
    body.className = "attr-value";
    body.textContent = fields[attr.key];
    block.appendChild(head);
    block.appendChild(body);
    grid.appendChild(block);
  });
  return grid;
}

function personDetail(profile) {
  const wrap = document.createElement("div");
  wrap.className = "person-detail";

  if (profile.design_role) {
    const role = document.createElement("p");
    role.className = "design-role";
    role.textContent = profile.design_role;
    wrap.appendChild(role);
  }

  wrap.appendChild(attrGrid(profile.narrative));

  if (profile.underdisclosure) {
    const override = document.createElement("div");
    override.className = "override";
    const head = document.createElement("p");
    head.className = "override-head";
    head.textContent = "On record under underdisclosure \u2014 these fields replace the ones above";
    override.appendChild(head);
    override.appendChild(attrGrid(profile.underdisclosure));
    wrap.appendChild(override);
  }

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

function renderAll() {
  if (cachedProfiles) {
    renderDistribution(cachedProfiles);
    renderInstrument();
    renderProfileTable(cachedProfiles);
    renderFilters(cachedProfiles);
    renderDomainKey();
  }
  if (typeof renderResults === "function") renderResults();
}

Promise.all([
  d3.json("data/vispdat_instrument.json"),
  d3.json("data/base_profiles.json"),
  d3.json("data/ai/paste_schedule.json"),
  d3.json("data/vispdat_results.json"),
  d3.json("data/ai/models.json"),
  d3.json("data/ai_results.json")
]).then(([instrument, profileData, schedule, vispdatResults, modelRoster, aiResults]) => {
  INSTRUMENT = instrument;
  DOMAINS = instrument.domains;
  BANDS = instrument.bands.map((b, i) => ({ ...b, varName: `--band-${i + 1}` }));

  DOMAINS.forEach((d) => {
    d.indicators.forEach((ind) => INDICATOR_BY_ID.set(ind.id, { ...ind, domain: d.key }));
  });

  cachedProfiles = profileData.profiles;
  SCHEDULE = schedule;
  RESULTS = vispdatResults;
  AI = aiResults;

  // VI-SPDAT scores every instance of the full design; each AI app reads the paste schedule
  const n = cachedProfiles.length;
  const instances = vispdatResults.instances_scored;
  // entries with a "source" are second analyses of an app's replies, not extra scores
  const apps = modelRoster.models.filter((m) => !m.source);
  const aiModels = apps.length;
  const scores = instances + schedule.instances_total * aiModels;
  document.getElementById("stat-profiles").textContent = n;
  document.getElementById("stat-clones").textContent = (instances / 2).toLocaleString();
  document.getElementById("stat-instances").textContent = instances.toLocaleString();
  document.getElementById("stat-scores").textContent = scores.toLocaleString();
  document.getElementById("stat-models").textContent =
    aiModels === 1 ? `VI-SPDAT and ${apps[0].label}` : `VI-SPDAT and ${aiModels} AI models`;

  wireExpandAll(cachedProfiles);
  renderSessionPicker();
  renderSchedule();
  renderModelsRoster(modelRoster.models, aiResults.models);
  renderAll();
});

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderAll);

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderAll, 180);
});
