/* Software End of Support - Power BI design mockups.
 * Business rules mirrored from the agreed spec:
 *   Effective EOS = COALESCE(extended_support_end_date, obsolete_date, end_of_life_date)
 *   Past EOS when effective EOS <= snapshot date; Unknown when all three are blank.
 *   Extended = not yet past effective EOS but end_of_life_date already passed.
 *   RAG on % past EOS: <= 3% green, 3-5% amber, > 5% red.
 *   Upcoming / projections anchor to MAX(snapshot_date).
 */
(function () {
  "use strict";

  const D = window.MOCK_DATA;
  const C = {
    red: "#D71E28", redDark: "#B0151E", gold: "#FFBB41", text: "#3B3331", muted: "#6E6563",
    grid: "#EFEAE6", green: "#2E8B47", amberText: "#B47A00", unknown: "#B8B1AD",
  };
  const FONT = '"Wells Fargo Sans", "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  const STATUS = ["Past EOS", "Extended", "Supported", "Unknown"];
  const STATUS_COLORS = { "Past EOS": C.red, Extended: C.gold, Supported: C.green, Unknown: C.unknown };
  const STATUS_CLASS = { "Past EOS": "past", Extended: "extended", Supported: "supported", Unknown: "unknown" };
  const GREEN_MAX = 0.03, AMBER_MAX = 0.05;
  const DAY_MS = 86400000;

  /* ---------- helpers ---------- */
  const toDate = (d) => new Date(d * DAY_MS);
  const iso = (d) => (d == null ? "" : toDate(d).toISOString().slice(0, 10));
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const longDate = (d) => { const t = toDate(d); return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`; };
  const monthLabel = (y, m) => `${MONTHS[m]} ${String(y).slice(2)}`;
  const dayNum = (y, m, dd) => Math.round(Date.UTC(y, m, dd) / DAY_MS);
  const endOfMonth = (y, m) => dayNum(y, m + 1, 0);
  const edate = (d, months) => { const t = toDate(d); return dayNum(t.getUTCFullYear(), t.getUTCMonth() + months, t.getUTCDate()); };
  const n0 = (v) => v.toLocaleString("en-US");
  const pct = (v, dp = 1) => (v == null || isNaN(v) ? "–" : (v * 100).toFixed(dp) + "%");
  const ratio = (a, b) => (b ? a / b : null);
  const rag = (p) => (p == null ? "" : p <= GREEN_MAX ? "green" : p <= AMBER_MAX ? "amber" : "red");
  const ragColor = (p) => ({ green: C.green, amber: C.gold, red: C.red }[rag(p)] || C.unknown);
  const ragText = (p) => ({ green: C.green, amber: C.amberText, red: C.red }[rag(p)] || C.muted);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const el = (sel, root = document) => root.querySelector(sel);
  const els = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ---------- model ---------- */
  const SNAP = D.snapshots[D.snapshots.length - 1];
  const SNAP_PREV = D.snapshots[D.snapshots.length - 2];
  const SNAP_6M = edate(SNAP, 6);

  const installs = D.installs.map((r) => {
    const [id, h, p, version, edition, eol, ext, obs, aging] = r;
    const host = D.hosts[h];
    const group = D.groups[host[1]];
    const prod = D.products[p];
    const eff = ext ?? obs ?? eol;
    const basis = ext != null ? "Extended support end" : obs != null ? "Obsolete" : eol != null ? "End of life" : "";
    let status;
    if (eff == null) status = "Unknown";
    else if (eff <= SNAP) status = "Past EOS";
    else if (eol != null && eol <= SNAP) status = "Extended";
    else status = "Supported";
    return {
      id: "SI" + id, hostIdx: h, host: host[0], ciId: host[7], ciType: D.ciTypes[host[4]], city: host[5], country: host[6],
      env: D.envs[host[2]], crit: D.crits[host[3]], groupIdx: host[1], group: group[0], groupMgr: group[2],
      orgIdx: group[1], org: D.orgs[group[1]][0], orgMgr: D.orgs[group[1]][1],
      prodIdx: p, product: prod[0], mfr: prod[1], cat: D.cats[prod[2]], version, edition: D.editions[edition],
      eol, ext, obs, eff, basis, status, past: status === "Past EOS",
      daysPast: status === "Past EOS" ? SNAP - eff : null,
      aging, daysNC: aging != null ? SNAP - aging : null,
      within6m: eff != null && eff > SNAP && eff <= SNAP_6M,
    };
  });

  const cube = D.cube.map(([s, g, e, c, n, past]) => ({
    snap: D.snapshots[s], groupIdx: g, orgIdx: D.groups[g][1], env: D.envs[e], crit: D.crits[c], n, past,
  }));

  const OPTIONS = {
    org: D.orgs.map((o) => o[0]),
    env: ["Production", "Disaster Recovery", "QA", "Development", "Sandbox"].filter((e) => D.envs.includes(e)),
    crit: D.crits.slice().sort(),
    status: STATUS,
    group: D.groups.map((g) => g[0]).sort(),
    cat: D.cats.slice().sort(),
  };
  const FIELD = { org: "org", env: "env", crit: "crit", status: "status", group: "group", cat: "cat" };
  const matches = (row, filters) => Object.entries(filters).every(([k, set]) => !set.size || set.has(row[FIELD[k]]));
  const cubeRow = (c) => ({ org: D.orgs[c.orgIdx][0], env: c.env, crit: c.crit, group: D.groups[c.groupIdx][0] });

  function cubeSeries(filters, keyFn = () => "all") {
    const out = new Map();
    for (const c of cube) {
      if (!matches(cubeRow(c), filters)) continue;
      const key = keyFn(c);
      if (!out.has(key)) out.set(key, new Map(D.snapshots.map((s) => [s, { n: 0, past: 0 }])));
      const cell = out.get(key).get(c.snap);
      cell.n += c.n; cell.past += c.past;
    }
    return out;
  }

  /* ---------- charts ---------- */
  const charts = {};
  function chart(id) {
    if (!charts[id]) charts[id] = echarts.init(document.getElementById(id), null, { renderer: "canvas" });
    return charts[id];
  }
  const baseText = { fontFamily: FONT, color: C.text };
  const axisCommon = {
    axisLine: { lineStyle: { color: "#BDB5B1" } }, axisTick: { show: false },
    axisLabel: { color: C.muted, fontFamily: FONT, fontSize: 11 }, splitLine: { lineStyle: { color: C.grid } },
  };
  const tooltip = (extra = {}) => ({ textStyle: { fontFamily: FONT, fontSize: 12, color: C.text }, borderColor: "#E3DEDA", ...extra });

  /* ---------- slicers ---------- */
  const pageFilters = {};
  function buildSlicers(page, onChange) {
    const root = el(`#page-${page}`);
    const filters = (pageFilters[page] = {});
    els(".slicer", root).forEach((s) => {
      const key = s.dataset.slicer;
      filters[key] = new Set();
      const opts = OPTIONS[key];
      s.innerHTML = `
        <span class="slicer-label">${esc(s.dataset.label)}</span>
        <button type="button" class="slicer-btn"><span class="value">All</span><span class="caret">&#9660;</span></button>
        <div class="slicer-panel">
          ${s.dataset.search ? '<input type="search" placeholder="Search">' : ""}
          <label class="select-all"><input type="checkbox" data-all> Select all</label>
          <div class="slicer-options">${opts.map((o) => `<label><input type="checkbox" value="${esc(o)}"> ${esc(o)}</label>`).join("")}</div>
        </div>`;
      const btn = el(".slicer-btn", s);
      const sync = () => {
        const set = filters[key];
        el(".value", btn).textContent = !set.size ? "All" : set.size === 1 ? [...set][0] : `Multiple selections (${set.size})`;
        s.classList.toggle("filtered", set.size > 0);
        els(".slicer-options input", s).forEach((i) => (i.checked = set.has(i.value)));
        el("[data-all]", s).checked = set.size === 0;
      };
      s._sync = sync;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = !s.classList.contains("open");
        els(".slicer.open").forEach((o) => o.classList.remove("open"));
        s.classList.toggle("open", open);
      });
      el(".slicer-panel", s).addEventListener("click", (e) => e.stopPropagation());
      el(".slicer-panel", s).addEventListener("change", (e) => {
        const set = filters[key];
        if (e.target.dataset.all !== undefined) set.clear();
        else if (e.target.checked) set.add(e.target.value);
        else set.delete(e.target.value);
        sync(); onChange();
      });
      const search = el("input[type=search]", s);
      if (search) search.addEventListener("input", () => {
        const q = search.value.toLowerCase();
        els(".slicer-options label", s).forEach((l) => (l.style.display = l.textContent.toLowerCase().includes(q) ? "" : "none"));
      });
      sync();
    });
    const reset = el("[data-reset]", root);
    reset.addEventListener("click", () => {
      Object.values(filters).forEach((set) => set.clear());
      els(".slicer", root).forEach((s) => s._sync());
      onChange();
    });
    return filters;
  }
  document.addEventListener("click", () => els(".slicer.open").forEach((o) => o.classList.remove("open")));

  /* ---------- page 1: executive summary ---------- */
  function renderExecutive() {
    const f = pageFilters.executive;
    const rows = installs.filter((r) => matches(r, f));
    const total = rows.length;
    const byStatus = Object.fromEntries(STATUS.map((s) => [s, 0]));
    rows.forEach((r) => byStatus[r.status]++);
    const past = byStatus["Past EOS"];
    const p = ratio(past, total);
    const upcoming = rows.filter((r) => r.within6m).length;
    const proj6 = ratio(past + upcoming, total);
    const series = cubeSeries(f).get("all");
    const prev = series ? series.get(SNAP_PREV) : null;
    const pPrev = prev ? ratio(prev.past, prev.n) : null;
    const delta = p != null && pPrev != null ? p - pPrev : null;
    const nPrev = prev ? prev.n : null;

    kpi("#kpi-total", { label: "Total installs", value: n0(total), sub: nPrev != null ? `${deltaCount(total - nPrev)} vs prior snapshot` : "", accent: C.text });
    kpi("#kpi-pct", {
      label: "% of installs past EOS", value: pct(p), color: ragText(p),
      badge: { text: { green: "On target", amber: "Watch", red: "Off target" }[rag(p)] || "", cls: `rag-${rag(p)}` },
      sub: `${deltaPP(delta)} vs prior snapshot &middot; target &le; 3%`, accent: ragColor(p),
    });
    kpi("#kpi-past", { label: "Installs past EOS", value: n0(past), sub: `${n0(byStatus.Unknown)} installs with unknown EOS`, accent: C.red });
    kpi("#kpi-upcoming", {
      label: "Reaching EOS within 6 months", value: n0(upcoming), accent: C.gold,
      sub: `by ${longDate(SNAP_6M)} &middot; projected <b style="color:${ragText(proj6)}">${pct(proj6)}</b> past EOS if not remediated`,
    });

    chart("chart-donut").setOption({
      textStyle: baseText,
      tooltip: tooltip({ trigger: "item", formatter: (d) => `${d.marker}${d.name}<br><b>${n0(d.value)}</b> installs (${d.percent.toFixed(1)}%)` }),
      legend: { orient: "vertical", right: 0, top: "middle", icon: "circle", itemWidth: 10, textStyle: { fontFamily: FONT, color: C.text },
        formatter: (name) => `${name}  ${pct(ratio(byStatus[name], total))}` },
      series: [{
        type: "pie", radius: ["52%", "80%"], center: ["32%", "50%"], avoidLabelOverlap: true, label: { show: true, position: "center",
          formatter: () => `{v|${pct(p)}}\n{l|past EOS}`, rich: { v: { fontSize: 22, lineHeight: 28, fontWeight: 700, color: ragText(p), fontFamily: FONT }, l: { fontSize: 11, lineHeight: 14, color: C.muted, fontFamily: FONT } } },
        emphasis: { scale: true, scaleSize: 4, label: { show: true } },
        itemStyle: { borderColor: "#fff", borderWidth: 2 },
        data: ["Supported", "Extended", "Past EOS", "Unknown"].map((s) => ({ name: s, value: byStatus[s], itemStyle: { color: STATUS_COLORS[s] } })),
      }],
    }, true);

    const trend = D.snapshots.map((s) => { const c = series ? series.get(s) : { n: 0, past: 0 }; return ratio(c.past, c.n); });
    chart("chart-trend").setOption({
      textStyle: baseText, grid: { left: 44, right: 64, top: 18, bottom: 26 },
      tooltip: tooltip({ trigger: "axis", formatter: (a) => { const i = a[0].dataIndex; const c = series.get(D.snapshots[i]);
        return `${longDate(D.snapshots[i])}<br><b>${pct(trend[i], 2)}</b> past EOS<br>${n0(c.past)} of ${n0(c.n)} installs`; } }),
      xAxis: { ...axisCommon, type: "category", boundaryGap: false, data: D.snapshots.map((s) => iso(s)), axisLabel: { ...axisCommon.axisLabel, formatter: (v) => { const t = new Date(v); return `${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}`; } } },
      yAxis: { ...axisCommon, type: "value", min: 0, max: (v) => Math.max(0.06, Math.ceil((v.max + 0.005) * 50) / 50), interval: 0.02, axisLabel: { ...axisCommon.axisLabel, formatter: (v) => pct(v, 0) } },
      series: [{
        type: "line", data: trend, smooth: false, symbol: "circle", symbolSize: 7, lineStyle: { color: C.red, width: 3 },
        itemStyle: { color: (d) => ragColor(d.value), borderColor: "#fff", borderWidth: 1.5 },
        label: { show: true, position: "top", formatter: (d) => pct(d.value), color: C.text, fontFamily: FONT, fontSize: 11 },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: "rgba(215,30,40,.18)" }, { offset: 1, color: "rgba(215,30,40,0)" }]) },
        markLine: { symbol: "none", silent: true, data: [
          { yAxis: GREEN_MAX, lineStyle: { color: C.green, type: "dashed", width: 1.5 }, label: { formatter: "3% target", color: C.green, fontFamily: FONT, fontSize: 11 } },
          { yAxis: AMBER_MAX, lineStyle: { color: C.redDark, type: "dashed", width: 1.5 }, label: { formatter: "5% limit", color: C.redDark, fontFamily: FONT, fontSize: 11 } },
        ] },
      }],
    }, true);

    const prodCounts = new Map();
    rows.forEach((r) => { const c = prodCounts.get(r.product) || { past: 0, n: 0 }; c.n++; if (r.past) c.past++; prodCounts.set(r.product, c); });
    const top = [...prodCounts.entries()].filter(([, c]) => c.past).sort((a, b) => b[1].past - a[1].past || a[0].localeCompare(b[0])).slice(0, 10).reverse();
    chart("chart-top10").setOption({
      textStyle: baseText, grid: { left: 8, right: 36, top: 4, bottom: 4, containLabel: true },
      tooltip: tooltip({ trigger: "axis", axisPointer: { type: "shadow" }, formatter: (a) => { const c = top[a[0].dataIndex][1];
        return `${a[0].name}<br><b>${n0(c.past)}</b> past EOS of ${n0(c.n)} installs (${pct(c.past / c.n)})`; } }),
      xAxis: { ...axisCommon, type: "value", show: false },
      yAxis: { ...axisCommon, type: "category", data: top.map((t) => t[0]), axisLine: { show: false }, axisLabel: { ...axisCommon.axisLabel, color: C.text, fontSize: 11.5 } },
      series: [{ type: "bar", data: top.map((t) => t[1].past), barWidth: "62%", itemStyle: { color: C.red, borderRadius: [0, 3, 3, 0] },
        label: { show: true, position: "right", color: C.text, fontFamily: FONT, fontSize: 11 } }],
    }, true);

    const snapT = toDate(SNAP);
    const months = Array.from({ length: 6 }, (_, i) => { const m = snapT.getUTCMonth() + 1 + i; return { y: snapT.getUTCFullYear() + Math.floor(m / 12), m: m % 12 }; });
    const cols = months.map(({ y, m }, i) => {
      const start = i === 0 ? SNAP : endOfMonth(y, m - 1);
      const end = endOfMonth(y, m);
      return rows.filter((r) => r.eff != null && r.eff > start && r.eff <= end).length;
    });
    let running = past;
    const cumulative = cols.map((c) => ratio((running += c), total));
    chart("chart-upcoming").setOption({
      textStyle: baseText, grid: { left: 44, right: 48, top: 30, bottom: 26 },
      legend: { top: 0, right: 0, itemWidth: 12, itemHeight: 8, textStyle: { fontFamily: FONT, color: C.text, fontSize: 11 } },
      tooltip: tooltip({ trigger: "axis", formatter: (a) => { const i = a[0].dataIndex;
        return `${a[0].name}<br>${a[0].marker}${n0(cols[i])} installs cross EOS<br>${a[1].marker}Projected <b>${pct(cumulative[i], 2)}</b> past EOS`; } }),
      xAxis: { ...axisCommon, type: "category", data: months.map(({ y, m }) => monthLabel(y, m)) },
      yAxis: [
        { ...axisCommon, type: "value", name: "Installs", splitNumber: 4, nameTextStyle: { color: C.muted, fontFamily: FONT, fontSize: 11 } },
        { ...axisCommon, type: "value", min: 0, max: (v) => Math.max(0.1, Math.ceil((v.max + 0.01) * 20) / 20), interval: 0.05, splitLine: { show: false }, axisLabel: { ...axisCommon.axisLabel, formatter: (v) => pct(v, 0) } },
      ],
      series: [
        { name: "Installs crossing EOS", type: "bar", data: cols, barWidth: "48%", itemStyle: { color: C.gold, borderRadius: [3, 3, 0, 0] },
          label: { show: true, position: "insideBottom", distance: 4, color: C.text, fontFamily: FONT, fontSize: 11, fontWeight: 600 } },
        { name: "Cumulative projected % past EOS", type: "line", yAxisIndex: 1, data: cumulative, symbol: "circle", symbolSize: 7,
          lineStyle: { color: C.red, width: 3 }, itemStyle: { color: C.red },
          label: { show: true, position: "top", formatter: (d) => pct(d.value), color: C.redDark, fontFamily: FONT, fontSize: 11, fontWeight: 700 },
          markLine: { symbol: "none", silent: true, data: [{ yAxis: AMBER_MAX, lineStyle: { color: C.redDark, type: "dashed" }, label: { formatter: "5% limit", position: "insideStartTop", color: C.redDark, fontFamily: FONT, fontSize: 10 } }] } },
      ],
    }, true);
  }

  function kpi(sel, { label, value, sub = "", color = C.text, badge, accent }) {
    const node = el(sel);
    node.style.setProperty("--kpi-accent", accent || C.text);
    node.innerHTML = `<div class="label">${label}</div>
      <div class="value" style="color:${color}">${value}${badge && badge.text ? `<span class="badge ${badge.cls}">${badge.text}</span>` : ""}</div>
      <div class="sub">${sub}</div>`;
  }
  const deltaPP = (d) => d == null ? "–" : `<span class="${d > 0.0005 ? "delta-up" : d < -0.0005 ? "delta-down" : "delta-flat"}">${d > 0.0005 ? "▲" : d < -0.0005 ? "▼" : "■"} ${(Math.abs(d) * 100).toFixed(1)} pp</span>`;
  const deltaCount = (d) => `${d >= 0 ? "+" : "−"}${n0(Math.abs(d))}`;

  /* ---------- page 2: risk by organization ---------- */
  const orgState = { expanded: new Set(), selectedOrg: null };
  function sparkline(values) {
    const w = 64, h = 18, vals = values.map((v) => v ?? 0);
    const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
    const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - 2 - ((v - lo) / span) * (h - 4)}`).join(" ");
    const last = pts.split(" ").pop().split(",");
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="${C.muted}" stroke-width="1.5"/><circle cx="${last[0]}" cy="${last[1]}" r="2.5" fill="${ragColor(values[values.length - 1])}"/></svg>`;
  }
  function trendCell(series) {
    const vals = D.snapshots.map((s) => { const c = series.get(s); return ratio(c.past, c.n); });
    const d = vals[vals.length - 1] != null && vals[vals.length - 2] != null ? vals[vals.length - 1] - vals[vals.length - 2] : null;
    return `<span class="trend-cell">${deltaPP(d)}${sparkline(vals)}</span>`;
  }
  function renderOrganization() {
    const f = pageFilters.organization;
    const rows = installs.filter((r) => matches(r, f));
    const orgSeries = cubeSeries(f, (c) => c.orgIdx);
    const groupSeries = cubeSeries(f, (c) => c.groupIdx);
    const allSeries = cubeSeries(f).get("all");

    const agg = (list) => {
      const nc = list.filter((r) => r.daysNC != null);
      return { n: list.length, past: list.filter((r) => r.past).length, nc: nc.length,
        avgNC: nc.length ? nc.reduce((s, r) => s + r.daysNC, 0) / nc.length : null, maxNC: nc.length ? Math.max(...nc.map((r) => r.daysNC)) : null };
    };
    const orgs = D.orgs.map((o, i) => {
      const list = rows.filter((r) => r.orgIdx === i);
      const groups = D.groups.map((g, gi) => ({ g, gi })).filter(({ g }) => g[1] === i).map(({ g, gi }) => ({ idx: gi, name: g[0], mgr: g[2], ...agg(list.filter((r) => r.groupIdx === gi)) }));
      return { idx: i, name: o[0], mgr: o[1], ...agg(list), groups };
    }).filter((o) => o.n);
    const sortKey = (a, b) => (ratio(b.past, b.n) - ratio(a.past, a.n)) || b.past - a.past;
    orgs.sort(sortKey).forEach((o) => o.groups.sort(sortKey));
    const est = agg(rows);
    const pEst = ratio(est.past, est.n);

    const ragCount = (items) => items.filter((x) => x.n).reduce((acc, x) => (acc[rag(ratio(x.past, x.n))]++, acc), { green: 0, amber: 0, red: 0 });
    const ragDots = (c) => `<div class="rag-dots"><span style="color:${C.green}">${c.green}<small>green</small></span><span style="color:${C.amberText}">${c.amber}<small>amber</small></span><span style="color:${C.red}">${c.red}<small>red</small></span></div>`;
    const prevEst = allSeries ? allSeries.get(SNAP_PREV) : null;
    kpi("#kpi-org-estate", { label: "Estate % past EOS", value: pct(pEst), color: ragText(pEst), accent: ragColor(pEst),
      sub: `${n0(est.past)} of ${n0(est.n)} installs &middot; ${deltaPP(prevEst ? pEst - ratio(prevEst.past, prevEst.n) : null)} vs prior` });
    const oc = ragCount(orgs), gc = ragCount(orgs.flatMap((o) => o.groups));
    kpi("#kpi-org-orgs", { label: `CIO orgs by RAG (${orgs.length})`, value: ragDots(oc), accent: C.red });
    kpi("#kpi-org-groups", { label: `Managed-by groups by RAG (${orgs.reduce((s, o) => s + o.groups.filter((g) => g.n).length, 0)})`, value: ragDots(gc), accent: C.gold });
    kpi("#kpi-org-days", { label: "Avg days non-compliant", value: est.avgNC == null ? "–" : n0(Math.round(est.avgNC)), accent: C.text,
      sub: `across ${n0(est.nc)} non-compliant installs &middot; longest ${est.maxNC == null ? "–" : n0(est.maxNC)} days` });

    const tr = (lvl, cls, label, mgr, x, series, key) => {
      const p = ratio(x.past, x.n);
      return `<tr class="lvl-${lvl} ${cls}" ${key != null ? `data-org="${key}"` : ""}>
        <td>${label}</td><td class="left muted">${esc(mgr)}</td><td>${n0(x.n)}</td><td>${n0(x.past)}</td>
        <td class="rag rag-${rag(p)}">${pct(p)}</td><td>${series ? trendCell(series) : ""}</td>
        <td>${x.avgNC == null ? "–" : n0(Math.round(x.avgNC))}</td></tr>`;
    };
    let html = `<table class="mx"><thead><tr><th>CIO org / Managed-by group</th><th style="text-align:left">Manager</th><th>Installs</th><th>Past EOS</th>
      <th>% past EOS</th><th>vs prior &middot; trend</th><th title="Average days non-compliant">Avg days NC</th></tr></thead><tbody>`;
    orgs.forEach((o) => {
      const open = orgState.expanded.has(o.idx);
      const label = `<span class="toggle" data-toggle="${o.idx}">${open ? "▾" : "▸"}</span>${esc(o.name)}`;
      html += tr(0, `selectable ${orgState.selectedOrg === o.idx ? "selected" : ""}`, label, o.mgr, o, orgSeries.get(o.idx), o.idx);
      if (open) o.groups.filter((g) => g.n).forEach((g) => (html += tr(1, "", esc(g.name), g.mgr, g, groupSeries.get(g.idx))));
    });
    html += tr(0, "total", "Total", "", est, allSeries) + "</tbody></table>";
    const wrap = el("#org-matrix");
    wrap.innerHTML = html;
    els("[data-toggle]", wrap).forEach((t) => t.addEventListener("click", (e) => {
      e.stopPropagation();
      const i = +t.dataset.toggle;
      orgState.expanded.has(i) ? orgState.expanded.delete(i) : orgState.expanded.add(i);
      renderOrganization();
    }));
    els("tr[data-org]", wrap).forEach((t) => t.addEventListener("click", () => {
      const i = +t.dataset.org;
      orgState.selectedOrg = orgState.selectedOrg === i ? null : i;
      renderOrganization();
    }));

    const groupBars = orgs.filter((o) => orgState.selectedOrg == null || o.idx === orgState.selectedOrg)
      .flatMap((o) => o.groups).filter((g) => g.avgNC != null).sort((a, b) => a.avgNC - b.avgNC);
    el(".js-org-filter-hint").textContent = orgState.selectedOrg == null ? "all CIO orgs · bar colour = group RAG" : `filtered to ${D.orgs[orgState.selectedOrg][0]}`;
    chart("chart-days").setOption({
      textStyle: baseText, grid: { left: 8, right: 44, top: 4, bottom: 4, containLabel: true },
      tooltip: tooltip({ trigger: "axis", axisPointer: { type: "shadow" }, formatter: (a) => { const g = groupBars[a[0].dataIndex];
        return `${g.name}<br>Avg <b>${n0(Math.round(g.avgNC))}</b> days non-compliant<br>Longest ${n0(g.maxNC)} days &middot; ${g.nc} installs<br>${pct(ratio(g.past, g.n))} past EOS`; } }),
      xAxis: { ...axisCommon, type: "value", show: false },
      yAxis: { ...axisCommon, type: "category", data: groupBars.map((g) => g.name), axisLine: { show: false }, axisLabel: { ...axisCommon.axisLabel, color: C.text, fontSize: 11 } },
      series: [{ type: "bar", barMaxWidth: 18, barWidth: "64%", data: groupBars.map((g) => ({ value: Math.round(g.avgNC), itemStyle: { color: ragColor(ratio(g.past, g.n)), borderRadius: [0, 3, 3, 0] } })),
        label: { show: true, position: "right", color: C.text, fontFamily: FONT, fontSize: 11, formatter: (d) => n0(d.value) } }],
    }, true);
  }

  /* ---------- page 3: lifecycle detail & remediation ---------- */
  const detailState = { view: "product", expanded: new Set(), node: null, sort: { key: "daysPast", dir: -1 }, page: 0 };
  const PAGE_SIZE = 18;
  const LEVELS = {
    product: [
      { key: (r) => r.product, label: (r) => `${esc(r.product)} <span class="muted">· ${esc(r.mfr)}</span>`, name: "Product" },
      { key: (r) => r.version, label: (r) => `Version ${esc(r.version)}`, name: "Version" },
      { key: (r) => r.host, label: (r) => esc(r.host), name: "Host" },
    ],
    org: [
      { key: (r) => r.org, label: (r) => esc(r.org), name: "CIO org" },
      { key: (r) => r.group, label: (r) => esc(r.group), name: "Managed-by group" },
      { key: (r) => r.host, label: (r) => esc(r.host), name: "Host" },
    ],
  };
  function detailRows(includeNode = true) {
    const f = pageFilters.detail;
    const levels = LEVELS[detailState.view];
    return installs.filter((r) => matches(r, f) && (!includeNode || !detailState.node || detailState.node.every((k, i) => levels[i].key(r) === k)));
  }
  function groupBy(list, fn) { const m = new Map(); list.forEach((r) => { const k = fn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }); return m; }
  function nodeStats(list) {
    const past = list.filter((r) => r.past).length;
    const versions = new Set(list.map((r) => (detailState.view === "org" ? `${r.product} ${r.version}` : r.version)));
    const effs = list.map((r) => r.eff).filter((v) => v != null);
    const dp = list.map((r) => r.daysPast).filter((v) => v != null);
    const nc = list.map((r) => r.daysNC).filter((v) => v != null);
    return { n: list.length, past, p: ratio(past, list.length), version: versions.size === 1 ? [...versions][0] : `Multiple (${versions.size})`,
      eos: effs.length ? Math.min(...effs) : null, daysPast: dp.length ? Math.max(...dp) : null, daysNC: nc.length ? Math.max(...nc) : null };
  }
  function renderDetailMatrix() {
    const levels = LEVELS[detailState.view];
    el(".js-matrix-title").textContent = levels.map((l) => l.name).join(" → ");
    const rows = detailRows(false);
    const sortNodes = (m) => [...m.entries()].map(([k, list]) => ({ k, list, s: nodeStats(list) }))
      .sort((a, b) => b.s.past - a.s.past || (b.s.daysPast ?? -1) - (a.s.daysPast ?? -1) || String(a.k).localeCompare(String(b.k), undefined, { numeric: true }));
    const isSel = (path) => detailState.node && detailState.node.length === path.length && detailState.node.every((k, i) => k === path[i]);
    const line = (lvl, path, label, s, leaf) => {
      const id = JSON.stringify(path);
      const open = detailState.expanded.has(id);
      return `<tr class="lvl-${lvl} selectable ${isSel(path) ? "selected" : ""}" data-path='${esc(id)}'>
        <td><span class="toggle ${leaf ? "leaf" : ""}" ${leaf ? "" : `data-expand='${esc(id)}'`}>${leaf ? "" : open ? "▾" : "▸"}</span>${label}</td>
        <td>${n0(s.n)}</td><td>${n0(s.past)}</td><td class="rag rag-${rag(s.p)}">${pct(s.p)}</td>
        <td class="left">${esc(s.version)}</td><td>${s.eos == null ? '<span class="muted">Unknown</span>' : iso(s.eos)}</td>
        <td>${s.daysPast == null ? "–" : n0(s.daysPast)}</td><td>${s.daysNC == null ? "–" : n0(s.daysNC)}</td></tr>`;
    };
    let html = `<table class="mx"><thead><tr><th>${levels.map((l) => l.name).join(" / ")}</th><th>Installs</th><th>Past EOS</th><th>% past EOS</th>
      <th style="text-align:left">Version</th><th>Effective EOS date</th><th>Days past EOS</th><th>Days non-compliant</th></tr></thead><tbody>`;
    const walk = (list, depth, path) => {
      sortNodes(groupBy(list, levels[depth].key)).forEach(({ k, list: sub, s }) => {
        const p = [...path, k];
        const leaf = depth === levels.length - 1;
        html += line(depth, p, levels[depth].label(sub[0]), s, leaf);
        if (!leaf && detailState.expanded.has(JSON.stringify(p))) walk(sub, depth + 1, p);
      });
    };
    walk(rows, 0, []);
    const t = nodeStats(rows);
    html += `<tr class="total"><td>Total</td><td>${n0(t.n)}</td><td>${n0(t.past)}</td><td class="rag rag-${rag(t.p)}">${pct(t.p)}</td><td></td>
      <td>${t.eos == null ? "" : iso(t.eos)}</td><td>${t.daysPast == null ? "–" : n0(t.daysPast)}</td><td>${t.daysNC == null ? "–" : n0(t.daysNC)}</td></tr></tbody></table>`;
    const wrap = el("#detail-matrix");
    const scroll = wrap.scrollTop;
    wrap.innerHTML = html;
    wrap.scrollTop = scroll;
    els("[data-expand]", wrap).forEach((tg) => tg.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = tg.dataset.expand;
      detailState.expanded.has(id) ? detailState.expanded.delete(id) : detailState.expanded.add(id);
      renderDetailMatrix();
    }));
    els("tr[data-path]", wrap).forEach((tr) => tr.addEventListener("click", () => {
      const path = JSON.parse(tr.dataset.path);
      detailState.node = isSel(path) ? null : path;
      detailState.page = 0;
      renderDetailMatrix(); renderWorklist();
    }));
  }

  const WORKLIST_COLS = [
    { key: "host", label: "Host" }, { key: "env", label: "Environment" }, { key: "crit", label: "Criticality" },
    { key: "product", label: "Product" }, { key: "version", label: "Version" }, { key: "group", label: "Managed-by group" },
    { key: "org", label: "CIO org" }, { key: "status", label: "EOS status" }, { key: "eff", label: "Effective EOS", fmt: iso },
    { key: "daysPast", label: "Days past EOS", num: true }, { key: "daysNC", label: "Days non-compliant", num: true },
  ];
  const EXPORT_COLS = [
    ["install_id", "id"], ["host_name", "host"], ["ci_id", "ciId"], ["ci_type", "ciType"], ["environment", "env"],
    ["business_criticality", "crit"], ["city", "city"], ["country", "country"], ["normalized_product_name", "product"],
    ["normalized_version", "version"], ["normalized_manufacturer", "mfr"], ["edition", "edition"], ["product_category", "cat"],
    ["managed_by_group", "group"], ["managed_by_group_manager_name", "groupMgr"], ["cio_org_name", "org"], ["cio_org_manager_name", "orgMgr"],
    ["eos_status", "status"], ["end_of_life_date", "eol", iso], ["extended_support_end_date", "ext", iso], ["obsolete_date", "obs", iso],
    ["effective_eos_date", "eff", iso], ["effective_eos_basis", "basis"], ["days_past_eos", "daysPast"],
    ["aging_start_date", "aging", iso], ["days_non_compliant", "daysNC"], ["reaching_eos_within_6_months", "within6m", (v) => (v ? "Yes" : "No")],
  ];
  function sortedWorklist() {
    const { key, dir } = detailState.sort;
    return detailRows().slice().sort((a, b) => {
      const va = a[key], vb = b[key];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true })) * dir || a.host.localeCompare(b.host);
    });
  }
  function renderWorklist() {
    const list = sortedWorklist();
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    detailState.page = Math.min(detailState.page, pages - 1);
    const slice = list.slice(detailState.page * PAGE_SIZE, (detailState.page + 1) * PAGE_SIZE);
    const { key, dir } = detailState.sort;
    el("#worklist").innerHTML = `<table class="mx"><thead><tr>${WORKLIST_COLS.map((c) =>
      `<th class="sortable" data-sort="${c.key}" style="text-align:${c.num || c.key === "eff" ? "right" : "left"}">${c.label}${c.key === key ? ` <span class="sort-ind">${dir > 0 ? "▲" : "▼"}</span>` : ""}</th>`).join("")}</tr></thead><tbody>
      ${slice.map((r) => `<tr>${WORKLIST_COLS.map((c) => {
        const v = r[c.key];
        if (c.key === "status") return `<td class="left"><span class="status-pill status-${STATUS_CLASS[v]}">${v}</span></td>`;
        if (c.key === "eff") return `<td>${v == null ? '<span class="muted">Unknown</span>' : iso(v)}</td>`;
        if (c.num) return `<td>${v == null ? "–" : n0(v)}</td>`;
        return `<td class="left">${esc(v)}</td>`;
      }).join("")}</tr>`).join("") || `<tr><td colspan="${WORKLIST_COLS.length}" class="left muted">No installs match the current filters.</td></tr>`}
      </tbody></table>`;
    els("#worklist th[data-sort]").forEach((th) => th.addEventListener("click", () => {
      const k = th.dataset.sort;
      detailState.sort = { key: k, dir: detailState.sort.key === k ? -detailState.sort.dir : WORKLIST_COLS.find((c) => c.key === k).num ? -1 : 1 };
      renderWorklist();
    }));
    el(".js-row-count").textContent = `${n0(list.length)} rows`;
    const chip = el(".js-node-chip");
    chip.hidden = !detailState.node;
    if (detailState.node) {
      const levels = LEVELS[detailState.view];
      chip.innerHTML = `${detailState.node.map((k, i) => `${levels[i].name}: <b>${esc(k)}</b>`).join(" › ")}<button type="button" title="Clear">✕</button>`;
      el("button", chip).onclick = () => { detailState.node = null; renderDetailMatrix(); renderWorklist(); };
    }
    el("#worklist-pager").innerHTML = `<button type="button" data-pg="-1" ${detailState.page === 0 ? "disabled" : ""}>‹ Prev</button>
      <span>Page ${detailState.page + 1} of ${pages}</span><button type="button" data-pg="1" ${detailState.page >= pages - 1 ? "disabled" : ""}>Next ›</button>`;
    els("#worklist-pager [data-pg]").forEach((b) => b.addEventListener("click", () => { detailState.page += +b.dataset.pg; renderWorklist(); }));
  }
  function exportCsv() {
    const q = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [EXPORT_COLS.map((c) => c[0]).join(",")];
    sortedWorklist().forEach((r) => lines.push(EXPORT_COLS.map(([, k, fmt]) => q(fmt ? fmt(r[k]) : r[k])).join(",")));
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `eos_remediation_worklist_${iso(SNAP)}.csv` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function renderDetail() { renderDetailMatrix(); renderWorklist(); }

  /* ---------- wiring ---------- */
  const RENDER = { executive: renderExecutive, organization: renderOrganization, detail: renderDetail };
  buildSlicers("executive", renderExecutive);
  buildSlicers("organization", () => { orgState.selectedOrg = null; renderOrganization(); });
  buildSlicers("detail", () => { detailState.page = 0; renderDetail(); });

  els("[data-view]").forEach((b) => b.addEventListener("click", () => {
    els("[data-view]").forEach((x) => x.classList.toggle("active", x === b));
    detailState.view = b.dataset.view; detailState.expanded.clear(); detailState.node = null; detailState.page = 0;
    renderDetail();
  }));
  els("[data-tree]").forEach((b) => b.addEventListener("click", () => {
    detailState.expanded.clear();
    if (b.dataset.tree === "expand") {
      const levels = LEVELS[detailState.view];
      detailRows(false).forEach((r) => { detailState.expanded.add(JSON.stringify([levels[0].key(r)])); detailState.expanded.add(JSON.stringify([levels[0].key(r), levels[1].key(r)])); });
    }
    renderDetailMatrix();
  }));
  el("#export-csv").addEventListener("click", exportCsv);
  els(".js-asof").forEach((n) => (n.textContent = longDate(SNAP)));

  function show() {
    const page = RENDER[location.hash.slice(1)] ? location.hash.slice(1) : "executive";
    els(".canvas").forEach((c) => (c.hidden = c.dataset.page !== page));
    els(".page-tabs a").forEach((a) => a.classList.toggle("active", a.dataset.page === page));
    RENDER[page]();
    Object.values(charts).forEach((c) => c.resize());
  }
  window.addEventListener("hashchange", show);
  window.addEventListener("resize", () => Object.values(charts).forEach((c) => c.resize()));
  show();
})();
