'use strict';
/* Shared helpers: URL state, filters, formatting, RAG, theme. */
const GREEN_MAX = 3;
const AMBER_MAX = 5;

const FILTER_LABELS = {
  team: 'Responsible team',
  product: 'Product version',
  mfr: 'Manufacturer',
  cat: 'Software type',
  org: 'CIO org',
  env: 'Environment',
  crit: 'Business criticality',
  hw: 'HW type',
};

const state = (() => {
  const p = new URLSearchParams(location.search);
  const s = { snapshot: p.get('snapshot') || '', months: Number(p.get('months')) || 6, filters: {} };
  for (const k of Object.keys(FILTER_LABELS)) s.filters[k] = p.getAll(k);
  s.params = p;
  return s;
})();

function queryString(extra = {}) {
  const p = new URLSearchParams();
  if (state.snapshot) p.set('snapshot', state.snapshot);
  p.set('months', state.months);
  for (const [k, vals] of Object.entries(state.filters)) vals.forEach((v) => p.append(k, v));
  for (const [k, v] of Object.entries(extra)) if (v != null && v !== '') p.set(k, v);
  return p.toString();
}

function syncUrl(extra = {}) {
  history.replaceState(null, '', `${location.pathname}?${queryString(extra)}`);
}

async function api(path, extra = {}) {
  const res = await fetch(`/api/${path}?${queryString(extra)}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtInt = (n) => (n == null ? '–' : Number(n).toLocaleString('en-US'));
const fmtPct = (p, d = 2) => (p == null ? '–' : `${Number(p).toFixed(d)}%`);
const fmtDate = (d) => d || '–';
const rag = (p) => (p == null ? '' : p <= GREEN_MAX ? 'green' : p <= AMBER_MAX ? 'amber' : 'red');
const RAG_LABEL = { green: 'Green ≤3%', amber: 'Amber 3–5%', red: 'Red >5%' };
const cssVar = (name) => getComputedStyle(document.body).getPropertyValue(name).trim();

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

/* Theme: report (CJB) by default, Wells Fargo preview with ?theme=wf. */
function initTheme(onChange) {
  const fromUrl = state.params.get('theme');
  const theme = fromUrl || localStorage.getItem('eos-theme') || 'cjb';
  document.body.dataset.theme = theme === 'wf' ? 'wf' : 'cjb';
  document.querySelectorAll('[data-theme-set]').forEach((btn) => {
    btn.classList.toggle('on', btn.dataset.themeSet === document.body.dataset.theme);
    btn.addEventListener('click', () => {
      document.body.dataset.theme = btn.dataset.themeSet;
      localStorage.setItem('eos-theme', btn.dataset.themeSet);
      document.querySelectorAll('[data-theme-set]').forEach((b) => b.classList.toggle('on', b === btn));
      onChange && onChange();
    });
  });
}

/* Sidebar multi-select filters. */
function renderFilters(container, options, onChange) {
  container.innerHTML = Object.entries(FILTER_LABELS).map(([key, label]) => `
    <details class="filter" data-key="${key}">
      <summary><span class="filter-label">${esc(label)}</span><span class="filter-value"></span></summary>
      <div class="filter-pop">
        <input type="search" placeholder="Search…" aria-label="Search ${esc(label)}">
        <div class="filter-opts">${(options[key] || []).map((v) => `
          <label><input type="checkbox" value="${esc(v)}"${state.filters[key].includes(v) ? ' checked' : ''}> ${esc(v)}</label>`).join('')}
        </div>
        <button type="button" class="link clear">Clear</button>
      </div>
    </details>`).join('');

  const refreshLabels = () => container.querySelectorAll('.filter').forEach((el) => {
    const vals = state.filters[el.dataset.key];
    el.querySelector('.filter-value').textContent = !vals.length ? 'All' : vals.length === 1 ? vals[0] : `${vals.length} selected`;
    el.classList.toggle('active', vals.length > 0);
  });
  refreshLabels();

  container.querySelectorAll('.filter').forEach((el) => {
    const key = el.dataset.key;
    el.addEventListener('toggle', () => {
      if (el.open) container.querySelectorAll('.filter[open]').forEach((o) => o !== el && (o.open = false));
    });
    el.querySelector('input[type=search]').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      el.querySelectorAll('.filter-opts label').forEach((l) => { l.hidden = !l.textContent.toLowerCase().includes(q); });
    });
    el.querySelector('.filter-opts').addEventListener('change', () => {
      state.filters[key] = [...el.querySelectorAll('.filter-opts input:checked')].map((i) => i.value);
      refreshLabels();
      onChange();
    });
    el.querySelector('.clear').addEventListener('click', () => {
      el.querySelectorAll('.filter-opts input').forEach((i) => { i.checked = false; });
      state.filters[key] = [];
      refreshLabels();
      onChange();
    });
  });
  if (!container.dataset.bound) {
    container.dataset.bound = '1';
    document.addEventListener('click', (e) => {
      if (!container.contains(e.target)) container.querySelectorAll('.filter[open]').forEach((o) => { o.open = false; });
    });
  }
  return { refresh: () => { renderFilters(container, options, onChange); } };
}

function renderChips(container, onChange) {
  const chips = [];
  for (const [k, vals] of Object.entries(state.filters)) {
    vals.forEach((v) => chips.push(`<button type="button" class="chip" data-k="${k}" data-v="${esc(v)}" title="Remove filter">${esc(FILTER_LABELS[k])}: ${esc(v)} ×</button>`));
  }
  container.innerHTML = chips.join('') || '<span class="muted">No filters applied</span>';
  container.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
    state.filters[c.dataset.k] = state.filters[c.dataset.k].filter((v) => v !== c.dataset.v);
    onChange(true);
  }));
}

function fillSnapshots(select, snapshots, onChange) {
  if (!state.snapshot || !snapshots.includes(state.snapshot)) state.snapshot = snapshots[snapshots.length - 1] || '';
  select.innerHTML = snapshots.slice().reverse().map((s) => `<option${s === state.snapshot ? ' selected' : ''}>${esc(s)}</option>`).join('');
  select.addEventListener('change', () => { state.snapshot = select.value; onChange(); });
}

function fillMonths(select, onChange) {
  select.innerHTML = [1, 2, 3, 6, 9, 12, 18, 24].map((n) => `<option value="${n}"${n === state.months ? ' selected' : ''}>${n}</option>`).join('');
  if (![...select.options].some((o) => o.selected)) { state.months = 6; select.value = '6'; }
  select.addEventListener('change', () => { state.months = Number(select.value); onChange(); });
}

function initToggles(onChange) {
  document.querySelectorAll('.toggle').forEach((t) => {
    const key = t.dataset.toggle;
    const set = (v) => t.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    set(toggles[key]);
    t.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      toggles[key] = b.dataset.v;
      set(b.dataset.v);
      onChange(key);
    });
  });
}
const toggles = {};

function detailsLink(type, extraFilters = {}) {
  const p = new URLSearchParams(queryString());
  for (const [k, v] of Object.entries(extraFilters)) { p.delete(k); p.append(k, v); }
  p.set('type', type);
  return `details.html?${p}`;
}
