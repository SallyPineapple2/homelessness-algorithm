/* ============================================================
   Limited places view

   Gemini sees all 100 applicants at once and must fill a fixed number of
   High and Medium places. VI-SPDAT fills the same places by score.
   Data: DATA.limited, built by scripts/analyze_pool.py.
   ============================================================ */

let LIMITED_KEY = "main";
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const fmt1 = (x) => (Math.abs(x - Math.round(x)) < 0.05 ? String(Math.round(x)) : x.toFixed(1));
const GROUP_SHORT = (g) => RACE_SHORT[g] || (CITY_CALLOUT[g] ? CITY_CALLOUT[g].short : g);

function renderLimited() {
  if (!DATA || !DATA.limited || !DATA.limited.length) return;
  const all = DATA.limited;
  const sc = all.find((s) => s.key === LIMITED_KEY) || all[0];
  const R = sc.rounds, pl = sc.places;
  chipGroup("#lim-scenarios", all.map((s) => ({ value: s.key, label: `${s.role}: ${s.label}`, count: `${s.rounds} rounds` })),
    sc.key, (v) => { LIMITED_KEY = v; renderLimited(); });

  d3.select("#lim-lede").text(
    `Housing is limited: only ${pl.High} High and ${pl.Medium} Medium places for ${pl.High + pl.Medium + pl.Low} applicants. ` +
    `VI‑SPDAT fills them by score. Gemini sees all applicants together and assigns each one, ${R} times, ` +
    `with the applicants in a different order each time.`);

  /* ---------- finding cards ---------- */
  const same = mean(sc.per_round.map((r) => r.same)), up = mean(sc.per_round.map((r) => r.higher)), down = mean(sc.per_round.map((r) => r.lower));
  const kap = sc.per_round.map((r) => r.kappa);
  const circ = sc.tests.filter((t) => t.family === "circumstance"), demo = sc.tests.filter((t) => t.family === "demographic");
  const sigC = circ.filter((t) => t.p_holm < 0.05), sigD = demo.filter((t) => t.p_holm < 0.05);
  const cards = [
    { kicker: "Agreement", stat: `${fmt1(same)} of 100`, note: `people placed in the same category as VI‑SPDAT (average of ${R} rounds)`,
      body: `Weighted Cohen's kappa ${d3.min(kap).toFixed(2)}–${d3.max(kap).toFixed(2)}. Gemini follows VI‑SPDAT closely once places are limited.` },
    { kicker: "Direction", stat: `${fmt1(up)} up · ${fmt1(down)} down`, note: "people Gemini places above / below VI‑SPDAT",
      body: "With a limit, Gemini has to rank people, so it moves about as many down as up." },
    { kicker: "Stability", stat: `${sc.same_category_in_every_round} of 100`, note: `people given the same category in all ${R} rounds`,
      body: `Two rounds agree on ${fmt1(sc.round_to_round_same_category.mean)} people on average. Gemini's choices near the cut-offs vary with list order.` },
    { kicker: "What stood out", stat: `${sigC.length} of ${circ.length}`, note: "circumstances significant (Holm-corrected)",
      body: (sigC.length ? `${sigC.map((t) => t.factor).join(", ")}. ` : "No circumstance clearly changed who got a High place. ") +
        `Demographics: ${sigD.length} of ${demo.length} significant.` }
  ];
  const el = d3.select("#lim-findings");
  el.selectAll("*").remove();
  cards.forEach((c) => {
    const a = el.append("article").attr("class", "fcard");
    a.append("p").attr("class", "fcard-kicker").text(c.kicker);
    a.append("p").attr("class", "fcard-stat").text(c.stat);
    a.append("p").attr("class", "fcard-note").text(c.note);
    a.append("p").attr("class", "fcard-body").text(c.body);
  });

  limitedRounds(sc);
  limitedCrosstab(sc);
  limitedByScore(sc);
  limitedCircumstances(sc, circ);
  limitedEffects(sc);
  limitedDemographics(sc, demo);
  d3.select("#lim-method").text(
    `Gemini 3.8 Flash, default settings. Each round is one request with all 100 case summaries in a new random order and new anonymous ` +
    `applicant numbers; Gemini never saw VI‑SPDAT questions or scores. A round counts only if every applicant is assigned and the split is exactly ` +
    `${pl.High} / ${pl.Medium} / ${pl.Low}. Tests compare people with the same VI‑SPDAT score (stratified permutation, 20,000 shuffles, Holm within each family).`);
}

/* ---------- agreement in each round ---------- */

function limitedRounds(sc) {
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
}

/* ---------- consensus crosstab ---------- */

function limitedCrosstab(sc) {
  const ct = sc.consensus_crosstab_vispdat_to_gemini;
  table("#lim-crosstab", ["", "Gemini High", "Gemini Medium", "Gemini Low", "Total"],
    CATS.map((a) => ({ cells: [`VI‑SPDAT ${a}`, ...CATS.map((b) => {
      const v = ct[`${a}->${b}`];
      return a === b ? `<strong>${fmt1(v)}</strong>` : fmt1(v);
    }), fmt1(d3.sum(CATS, (b) => ct[`${a}->${b}`]))] })));
  d3.select("#lim-crosstab-foot").text(
    `Gemini's rounds are combined by ranking people on how often they were placed in a higher category, then filling the same places. ` +
    `Counts can be fractions where people tie at a cut-off.`);
}

/* ---------- how often each VI-SPDAT score gets a place ---------- */

function limitedByScore(sc) {
  legend("#lim-legend-score", [{ name: "Gemini High", color: css(CAT_COLOR.High) }, { name: "Gemini Medium", color: css(CAT_COLOR.Medium) },
    { name: "Gemini Low", color: css(CAT_COLOR.Low) }, { kind: "line", name: "VI‑SPDAT cut-off" }]);
  const rows = sc.by_score, scores = d3.range(0, 18);
  const W = widthOf("#lim-byscore", 560, 960), H = 300, m = { t: 34, r: 12, b: 44, l: 44 };
  const x = d3.scaleBand().domain(scores).range([m.l, W - m.r]).padding(0.18);
  const y = d3.scaleLinear().domain([0, 1]).range([H - m.b, m.t]);
  const svg = d3.select("#lim-byscore").html("").append("svg").attr("width", W).attr("height", H).attr("role", "img")
    .attr("aria-label", "Share of rounds in which people at each VI-SPDAT score were placed High, Medium, or Low.");
  svg.append("g").selectAll("line").data(y.ticks(5)).join("line").attr("class", "gridline").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y).attr("y2", y);
  svg.append("g").selectAll("text").data(y.ticks(5)).join("text").attr("class", "tick-text").attr("x", m.l - 8).attr("y", y)
    .attr("dy", "0.32em").attr("text-anchor", "end").text((d) => `${Math.round(d * 100)}%`);
  scores.forEach((s) => {
    const r = rows.find((q) => q.score === s);
    svg.append("text").attr("class", "axis-label").attr("x", x(s) + x.bandwidth() / 2).attr("y", H - m.b + 16).attr("text-anchor", "middle").text(s);
    if (!r) return;
    let acc = 0;
    [["Low", 1 - r.high - r.medium], ["Medium", r.medium], ["High", r.high]].forEach(([c, v]) => {
      if (v <= 0.001) return;
      const sel = svg.append("rect").attr("x", x(s)).attr("width", x.bandwidth()).attr("y", y(acc + v)).attr("height", y(acc) - y(acc + v) - 1)
        .attr("fill", css(CAT_COLOR[c])).attr("rx", 2);
      hover(sel, () => `<span class="tt-title">VI‑SPDAT score ${s} (${r.n} ${r.n === 1 ? "person" : "people"})</span><span class="tt-row">Gemini ${c}: ${Math.round(v * 100)}% of rounds</span>`);
      acc += v;
    });
  });
  // VI-SPDAT cut-offs: where its High and Medium places run out when people are taken from the top score down
  let cum = 0;
  [[sc.places.High, "Medium | High"], [sc.places.High + sc.places.Medium, "Low | Medium"]].forEach(([cap, label]) => {
    cum = 0;
    let at = null;
    [...rows].sort((a, b) => b.score - a.score).forEach((r) => { if (at === null) { cum += r.n; if (cum >= cap) at = r.score; } });
    if (at === null) return;
    const xx = x(at) - (x.step() - x.bandwidth()) / 2;
    svg.append("line").attr("class", "cut-line").attr("x1", xx).attr("x2", xx).attr("y1", m.t - 10).attr("y2", H - m.b);
    svg.append("text").attr("class", "cut-label").attr("x", xx).attr("y", m.t - 14).attr("text-anchor", "middle").text(label);
  });
  svg.append("text").attr("class", "axis-title").attr("x", (m.l + W - m.r) / 2).attr("y", H - 6).attr("text-anchor", "middle").text("VI‑SPDAT SCORE");
}

/* ---------- circumstances: observed against expected High share ---------- */

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

/* ---------- factor effects (regression) ---------- */

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

/* ---------- demographics ---------- */

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
