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
