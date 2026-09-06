// Grouped bar chart: mean vulnerability score by race, VI-SPDAT vs. LLM (placeholder data)
d3.json("data/sample_scores.json").then(function (data) {
  const groups = data.map((d) => d.race);
  const subgroups = ["vispdat", "llm"];
  const labels = { vispdat: "VI-SPDAT", llm: "LLM (simulated)" };
  const colors = { vispdat: "#4c78a8", llm: "#e45756" };

  const margin = { top: 20, right: 20, bottom: 90, left: 45 };
  const width = Math.min(760, window.innerWidth - 80) - margin.left - margin.right;
  const height = 340 - margin.top - margin.bottom;

  const svg = d3
    .select("#bias-chart")
    .append("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom)
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const x0 = d3.scaleBand().domain(groups).range([0, width]).padding(0.25);
  const x1 = d3.scaleBand().domain(subgroups).range([0, x0.bandwidth()]).padding(0.1);
  const y = d3.scaleLinear().domain([0, 17]).nice().range([height, 0]);

  svg
    .append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${height})`)
    .call(d3.axisBottom(x0))
    .selectAll("text")
    .attr("transform", "rotate(-30)")
    .style("text-anchor", "end");

  svg.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(6));

  svg
    .append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -height / 2)
    .attr("y", -32)
    .attr("text-anchor", "middle")
    .style("font-size", "0.8rem")
    .text("Mean vulnerability score (0-17)");

  const group = svg
    .selectAll(".race-group")
    .data(data)
    .join("g")
    .attr("class", "race-group")
    .attr("transform", (d) => `translate(${x0(d.race)},0)`);

  group
    .selectAll("rect")
    .data((d) => subgroups.map((key) => ({ key, value: d[key] })))
    .join("rect")
    .attr("x", (d) => x1(d.key))
    .attr("y", (d) => y(d.value))
    .attr("width", x1.bandwidth())
    .attr("height", (d) => height - y(d.value))
    .attr("fill", (d) => colors[d.key]);

  const legend = svg
    .append("g")
    .attr("class", "legend")
    .attr("transform", `translate(0,${-8})`);

  subgroups.forEach((key, i) => {
    const g = legend.append("g").attr("transform", `translate(${i * 150},0)`);
    g.append("rect").attr("width", 12).attr("height", 12).attr("fill", colors[key]);
    g.append("text").attr("x", 18).attr("y", 11).text(labels[key]);
  });
});

// Indicator table: VI-SPDAT domains
d3.json("data/vispdat_domains.json").then(function (rows) {
  const table = d3.select("#indicator-table").append("table");
  const thead = table.append("thead").append("tr");
  thead.append("th").text("Domain");
  thead.append("th").text("Indicator");

  const tbody = table.append("tbody");
  tbody
    .selectAll("tr")
    .data(rows)
    .join("tr")
    .html((d) => `<td>${d.domain}</td><td>${d.indicator}</td>`);
});
