'use strict';
Object.assign(toggles, { trendMode: 'pct', pastBy: 'team', futureBy: 'team' });

const charts = {};
const data = {};
const sparkCache = new Map();

function chart(id) {
  if (!charts[id]) charts[id] = echarts.init(document.getElementById(id), null, { renderer: 'canvas' });
  return charts[id];
}

function resetCharts() {
  Object.values(charts).forEach((c) => c.dispose());
  for (const k of Object.keys(charts)) delete charts[k];
}

function showError(err) {
  const el = document.getElementById('error');
  el.hidden = !err;
  el.textContent = err ? `Could not load data: ${err.message}` : '';
}

function deltaHtml(cur, prev, unit, digits = 0) {
  if (prev == null || cur == null) return '';
  const d = cur - prev;
  if (Math.abs(d) < 1e-9) return 'no change vs prior snapshot';
  const txt = unit === 'pts' ? `${Math.abs(d).toFixed(2)} pts` : fmtInt(Math.abs(d).toFixed(digits));
  return `<span class="delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${txt}</span> vs prior snapshot`;
}

const KRI_LINES = [['3% Target', GREEN_MAX, '--rag-green'], ['5% Limit', AMBER_MAX, '--rag-red']];

function renderKpis() {
  const s = data.summary;
  const r = rag(s.pct);
  const pr = rag(s.projected_pct);
  const set = (id, cls, html) => { const el = document.getElementById(id); el.className = `card kpi ${cls}`; el.innerHTML = html; };
  const pctEl = document.getElementById('kpi-pct');
  pctEl.className = `kri-main rag-${r}`;
  pctEl.innerHTML = `<div class="kri-label">Software %<br>Past End of Support</div><div class="kri-value">${fmtPct(s.pct)}</div>`;
  const above = (limit) => Math.max(0, Math.floor(s.past - (s.total * limit) / 100));
  const overLimit = above(AMBER_MAX), overTarget = above(GREEN_MAX);
  document.getElementById('kpi-counts').innerHTML = `
    <div><div class="kri-k">Count Above 5% Limit</div><div class="kri-v${overLimit ? ' bad' : ''}">${fmtInt(overLimit)}</div></div>
    <div><div class="kri-k">Count Above 3% Target</div><div class="kri-v${overTarget ? ' warn' : ''}">${fmtInt(overTarget)}</div></div>
    <div><div class="kri-k">Count of Software Past End of Support</div><div class="kri-v">${fmtInt(s.past)}</div></div>
    <div><div class="kri-k">Total Software Count</div><div class="kri-v">${fmtInt(s.total)}</div></div>`;
  set('kpi-reaching', '', `
    <div class="label">Installs Reaching End of Support</div>
    <div class="value">${fmtInt(s.reaching)}</div>
    <div class="meta">in the next ${s.months} months · ${fmtPct(s.total ? (100 * s.reaching) / s.total : null)} of installs</div>
    <div class="meta">Extended ${fmtInt(s.extended)} · Supported ${fmtInt(s.supported)} · Unknown ${fmtInt(s.unknown)}</div>`);
  set('kpi-projected', `rag-${pr}`, `
    <div class="label">Projected % Past End of Support</div>
    <div class="value">${fmtPct(s.projected_pct)}</div>
    <div class="meta">in ${s.months} months if nothing is remediated</div>
    ${pr ? `<span class="badge ${pr}">${RAG_LABEL[pr]}</span>` : ''}`);
}

const axisStyle = () => ({
  axisLine: { lineStyle: { color: cssVar('--border') } },
  axisLabel: { color: cssVar('--text-muted'), fontSize: 11 },
  splitLine: { lineStyle: { color: cssVar('--border'), type: 'dashed' } },
});

function ragLines(values) {
  return {
    silent: true, symbol: 'none',
    label: { position: 'insideEndTop', fontSize: 10, formatter: (p) => p.name },
    data: values.map(([name, v, color]) => ({ name, yAxis: v, lineStyle: { color, type: 'dashed', width: 1.5 }, label: { color } })),
  };
}

const shortDate = (iso) => { const [y, m, d] = iso.split('-'); return `${Number(m)}/${Number(d)}/${y}`; };

function renderTrend() {
  const rows = data.trend;
  const pctMode = toggles.trendMode === 'pct';
  const line = cssVar('--series-1');
  const muted = cssVar('--text-muted');
  const values = rows.map((r) => (pctMode ? r.pct : r.past));
  const kri = KRI_LINES.map(([name, limit, color]) => ({
    name, limit, color: cssVar(color),
    data: rows.map((r) => (pctMode ? limit : (r.total * limit) / 100)),
  }));
  const all = values.concat(...kri.map((k) => k.data)).filter((v) => v != null);
  const lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo || 1) * 0.25;
  const fmt = (v) => (pctMode ? fmtPct(v) : fmtInt(Math.round(v)));
  const series = [{
    name: pctMode ? '% past EOS' : 'Installs past EOS', type: 'line', data: values, smooth: 0.4, z: 3,
    symbol: 'circle', symbolSize: 10, showAllSymbol: true,
    lineStyle: { color: line, width: 3 },
    itemStyle: { color: cssVar('--card-bg'), borderColor: line, borderWidth: 2.5 },
    label: { show: true, position: 'top', distance: 8, fontSize: 13, fontWeight: 600, color: muted, formatter: (p) => fmt(p.value) },
  }, ...kri.map((k) => ({
    name: k.name, type: 'line', data: k.data, symbol: 'none', silent: true, z: 2,
    lineStyle: { color: k.color, type: [6, 5], width: 2, opacity: 0.6 },
    markPoint: {
      symbol: 'rect', symbolSize: 1, silent: true,
      data: [{ coord: [0, k.data[0]], label: { show: true, position: k.limit === AMBER_MAX ? 'top' : 'bottom', align: 'left', offset: [-6, k.limit === AMBER_MAX ? -2 : 2], color: k.color, fontSize: 12, formatter: `${k.name}: ${fmtPct(k.limit)}` } }],
      itemStyle: { color: 'transparent' },
    },
  }))];
  chart('chart-trend').setOption({
    animation: false,
    grid: { left: 30, right: 30, top: 34, bottom: 34 },
    tooltip: {
      trigger: 'axis',
      formatter: (ps) => {
        const r = rows[ps[0].dataIndex];
        return `<b>${esc(shortDate(r.snapshot))}</b><br>${fmtPct(r.pct)} past EOS<br>${fmtInt(r.past)} of ${fmtInt(r.total)} installs`;
      },
    },
    xAxis: {
      type: 'category', data: rows.map((r) => r.snapshot), boundaryGap: ['4%', '4%'],
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: muted, fontSize: 12, margin: 16, formatter: shortDate },
    },
    yAxis: { type: 'value', show: false, scale: true, min: lo - pad * 1.6, max: hi + pad },
    series,
  }, true);
}

function sparkSvg(values, color) {
  const w = 160, h = 40, pad = 3;
  const nums = values.map((v) => v || 0);
  const max = Math.max(...nums, 1), min = Math.min(...nums, 0);
  const pts = nums.map((v, i) => [pad + (i * (w - 2 * pad)) / Math.max(nums.length - 1, 1), h - pad - ((v - min) * (h - 2 * pad)) / (max - min || 1)]);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="${color}" stroke-width="2" points="${pts.map((p) => p.join(',')).join(' ')}"/>${pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="2" fill="${color}"/>`).join('')}</svg>`;
}

function sparkTooltip(kind, by) {
  return (params, ticket, callback) => {
    const p = Array.isArray(params) ? params[0] : params;
    const name = p.name;
    const key = `${queryString()}|${by}|${name}`;
    const render = (res) => {
      const rows = res.rows;
      const last = rows[rows.length - 1] || {};
      const values = rows.map((r) => (kind === 'past' ? r.pct : r.reaching));
      const head = kind === 'past'
        ? `${fmtInt(p.data.past ?? p.value)} past EOS · ${fmtPct(p.data.pct)} of ${fmtInt(p.data.total)} installs`
        : `${fmtInt(p.value)} reaching EOS in ${state.months} months`;
      return `<div class="spark-tip"><b>${esc(name)}</b>${head}<br>
        <span style="color:#888">${kind === 'past' ? '% past EOS' : 'Reaching EOS'} by snapshot</span><br>
        ${sparkSvg(values, cssVar('--series-1'))}<br>
        <span style="color:#888">${esc(rows[0] ? rows[0].snapshot : '')} → ${esc(last.snapshot || '')}</span></div>`;
    };
    if (sparkCache.has(key)) return render(sparkCache.get(key));
    api('group-trend', { by, value: name }).then((res) => {
      sparkCache.set(key, res);
      callback(ticket, render(res));
    }).catch(() => callback(ticket, esc(name)));
    return `<b>${esc(name)}</b><br>Loading trend…`;
  };
}

function barChart(id, rows, opts) {
  const names = rows.map((r) => r.name).reverse();
  const c = chart(id);
  const series = [];
  if (opts.prev) {
    series.push({ name: 'Prior snapshot', type: 'bar', data: rows.map((r) => r.prev_past).reverse(), barWidth: '70%', barGap: '-100%',
      itemStyle: { color: cssVar('--series-3'), opacity: .55 }, silent: true, z: 1 });
  }
  series.push({
    name: opts.label, type: 'bar', barWidth: opts.prev ? '45%' : '60%', z: 2,
    data: rows.map((r) => ({ value: r[opts.field], ...r })).reverse(),
    itemStyle: { color: opts.color || cssVar('--series-1'), borderRadius: [0, 3, 3, 0] },
    label: { show: true, position: 'right', fontSize: 11, color: cssVar('--text'),
      formatter: (p) => {
        if (!opts.prev || p.data.prev_past == null) return fmtInt(p.value);
        const d = p.data.past - p.data.prev_past;
        return `${fmtInt(p.value)}${d ? ` (${d > 0 ? '+' : ''}${d})` : ''}`;
      } },
  });
  c.setOption({
    animation: false,
    grid: { left: 8, right: 52, top: 6, bottom: 6, containLabel: true },
    tooltip: { trigger: 'item', confine: true, formatter: sparkTooltip(opts.kind, opts.by) },
    xAxis: { type: 'value', show: false },
    yAxis: { type: 'category', data: names, axisTick: { show: false }, axisLine: { show: false },
      axisLabel: { color: cssVar('--text'), fontSize: 11, width: 150, overflow: 'truncate' } },
    series,
  }, true);
  c.off('click');
  c.on('click', (p) => { if (p.seriesName === opts.label) location.href = detailsLink(opts.kind, { [opts.by]: p.name }); });
  document.getElementById(id).style.height = `${Math.max(170, names.length * 24 + 20)}px`;
  c.resize();
}

function renderPastBars() {
  barChart('chart-past', data.past.rows, { kind: 'past', by: data.past.by, field: 'past', label: 'Past EOS', prev: true });
}

function renderFutureBars() {
  barChart('chart-future', data.futureBy.rows, { kind: 'future', by: data.futureBy.by, field: 'reaching', label: 'Reaching EOS', color: cssVar('--series-2') });
}

function renderMonths() {
  const rows = data.month.rows;
  const green = cssVar('--rag-green');
  const red = cssVar('--rag-red');
  const c = chart('chart-month');
  c.setOption({
    animation: false,
    grid: { left: 40, right: 44, top: 24, bottom: 28 },
    tooltip: { trigger: 'axis', formatter: (ps) => {
      const r = rows[ps[0].dataIndex];
      return `<b>${esc(monthLabel(r.month))}</b><br>${fmtInt(r.reaching)} installs reach EOS<br>Projected ${fmtPct(r.projected_pct)} past EOS`;
    } },
    xAxis: { type: 'category', data: rows.map((r) => monthLabel(r.month)), ...axisStyle() },
    yAxis: [
      { type: 'value', min: 0, ...axisStyle() },
      { type: 'value', min: 0, max: (v) => Math.max(6, Math.ceil(v.max + 1)), ...axisStyle(), splitLine: { show: false },
        axisLabel: { ...axisStyle().axisLabel, formatter: '{value}%' } },
    ],
    series: [
      { name: 'Reaching EOS', type: 'bar', data: rows.map((r) => r.reaching), itemStyle: { color: cssVar('--series-2') }, barMaxWidth: 30,
        label: { show: true, position: 'top', fontSize: 10, color: cssVar('--text'), formatter: (p) => (p.value ? fmtInt(p.value) : '') } },
      { name: 'Projected % past EOS', type: 'line', yAxisIndex: 1, data: rows.map((r) => r.projected_pct), symbolSize: 6,
        lineStyle: { color: cssVar('--series-1'), width: 2 }, itemStyle: { color: cssVar('--series-1') },
        markLine: ragLines([['5%', AMBER_MAX, red], ['3%', GREEN_MAX, green]]) },
    ],
  }, true);
  c.off('click');
  c.on('click', () => { location.href = detailsLink('future'); });
}

function renderAll() {
  if (!data.summary) return;
  renderKpis(); renderTrend(); renderPastBars(); renderFutureBars(); renderMonths();
}

function updateNav() {
  document.querySelectorAll('[data-nav=past]').forEach((a) => { a.href = detailsLink('past'); });
  document.querySelectorAll('[data-nav=future]').forEach((a) => { a.href = detailsLink('future'); });
}

let loadSeq = 0;
async function load(which = 'all') {
  const seq = ++loadSeq;
  syncUrl(document.body.dataset.theme === 'wf' && state.params.get('theme') ? { theme: 'wf' } : {});
  renderChips(document.getElementById('chips'), () => { filterUi.refresh(); load(); });
  updateNav();
  try {
    const jobs = {
      summary: () => api('summary'),
      trend: () => api('trend'),
      past: () => api('past-eos', { by: toggles.pastBy }),
      month: () => api('reaching-eos', { by: 'month' }),
      futureBy: () => api('reaching-eos', { by: toggles.futureBy }),
    };
    const keys = which === 'all' ? Object.keys(jobs) : which;
    const results = await Promise.all(keys.map((k) => jobs[k]()));
    if (seq !== loadSeq) return;
    keys.forEach((k, i) => { data[k] = results[i]; });
    showError(null);
    if (which === 'all') renderAll();
    else { if (keys.includes('past')) renderPastBars(); if (keys.includes('futureBy')) renderFutureBars(); }
  } catch (err) {
    if (seq === loadSeq) showError(err);
  }
}

let filterUi;
(async function init() {
  initTheme(() => { resetCharts(); renderAll(); });
  try {
    const options = await api('filters');
    fillSnapshots(document.getElementById('snapshot'), options.snapshots, () => load());
    fillMonths(document.getElementById('months'), () => load());
    filterUi = renderFilters(document.getElementById('filters'), options, () => load());
    document.getElementById('reset').addEventListener('click', () => {
      for (const k of Object.keys(state.filters)) state.filters[k] = [];
      filterUi.refresh();
      load();
    });
    const sw = document.getElementById('trend-switch');
    sw.addEventListener('click', () => {
      toggles.trendMode = toggles.trendMode === 'pct' ? 'count' : 'pct';
      sw.setAttribute('aria-checked', String(toggles.trendMode === 'count'));
      renderTrend();
    });
    initToggles((key) => {
      if (key === 'pastBy') load(['past']);
      if (key === 'futureBy') load(['futureBy']);
    });
    window.addEventListener('resize', () => Object.values(charts).forEach((c) => c.resize()));
    await load();
  } catch (err) {
    showError(err);
  }
})();
