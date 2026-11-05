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
