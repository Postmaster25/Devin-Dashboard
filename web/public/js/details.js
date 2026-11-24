'use strict';
Object.assign(toggles, { type: state.params.get('type') === 'future' ? 'future' : 'past' });

const PRODUCT_COLS = [
  ['product', 'Product'], ['version', 'Version'], ['manufacturer', 'Manufacturer'], ['category', 'Software type'],
  ['end_of_life_date', 'End of life'], ['extended_support_end_date', 'Extended support end'], ['obsolete_date', 'Obsolete'],
  ['effective_eos_date', 'Effective EOS'], ['installs', 'Installs', 'num'], ['hosts', 'Hosts', 'num'],
];
const INSTALL_COLS = [
  ['host_name', 'Host'], ['managed_by_group', 'Responsible team'], ['cio_org_name', 'CIO org'], ['environment', 'Environment'],
  ['business_criticality', 'Criticality'], ['ci_type', 'HW type'], ['product', 'Product'], ['version', 'Version'],
  ['manufacturer', 'Manufacturer'], ['effective_eos_date', 'Effective EOS'], ['eos_status', 'Status'],
  ['days_past_eos', 'Days past EOS', 'num'], ['days_non_compliant', 'Days non-compliant', 'num'],
  ['aging_start_date', 'Aging start'], ['potential_aging_cause', 'Aging cause'], ['install_id', 'Install ID'], ['last_scanned_date', 'Last scanned'],
];

const view = {
  page: 1, size: 50,
  sort: state.params.get('sort') || '', dir: state.params.get('dir') || '',
  q: state.params.get('q') || '',
  productSort: { key: 'installs', dir: 'desc' },
  products: [],
};

function showError(err) {
  const el = document.getElementById('error');
  el.hidden = !err;
  el.textContent = err ? `Could not load data: ${err.message}` : '';
}

function extra() {
  return { type: toggles.type, q: view.q, sort: view.sort, dir: view.dir };
}

function cell(key, v) {
  if (key === 'eos_status') {
    const cls = { 'Past EOS': 'past', Extended: 'extended', Supported: 'supported' }[v] || '';
    return `<span class="status ${cls}">${esc(v)}</span>`;
  }
  if (typeof v === 'number') return fmtInt(v);
  return esc(v ?? '–');
}

function header(table, cols, sortKey, dir, onSort) {
  const thead = table.querySelector('thead');
  thead.innerHTML = `<tr>${cols.map(([k, label, cls]) => `<th data-k="${k}" class="${cls || ''}${k === sortKey ? ` sorted ${dir}` : ''}">${esc(label)}</th>`).join('')}</tr>`;
  thead.querySelectorAll('th').forEach((th) => th.addEventListener('click', () => onSort(th.dataset.k)));
}

function renderProducts() {
  const { key, dir } = view.productSort;
  const rows = view.products.slice().sort((a, b) => {
    const x = a[key], y = b[key];
    const c = x == null ? 1 : y == null ? -1 : typeof x === 'number' ? x - y : String(x).localeCompare(String(y));
    return dir === 'asc' ? c : -c;
  });
  const table = document.getElementById('products');
  header(table, PRODUCT_COLS, key, dir, (k) => {
    view.productSort = { key: k, dir: view.productSort.key === k && view.productSort.dir === 'desc' ? 'asc' : 'desc' };
    renderProducts();
  });
  const selected = state.filters.product;
  table.querySelector('tbody').innerHTML = rows.map((r) => {
    const name = `${r.product} ${r.version}`;
    return `<tr data-name="${esc(name)}" class="${selected.length === 1 && selected[0] === name ? 'selected' : ''}" style="cursor:pointer">${PRODUCT_COLS.map(([k, , cls]) => `<td class="${cls || ''}">${cell(k, r[k])}</td>`).join('')}</tr>`;
  }).join('') || `<tr><td colspan="${PRODUCT_COLS.length}" class="muted">No products match the filters</td></tr>`;
  table.querySelectorAll('tbody tr[data-name]').forEach((tr) => tr.addEventListener('click', () => {
    const name = tr.dataset.name;
    state.filters.product = selected.length === 1 && selected[0] === name ? [] : [name];
    filterUi.refresh();
    load();
  }));
  document.getElementById('products-count').textContent = `${rows.length} products`;
}

async function loadInstalls() {
  const res = await api('details/installs', { ...extra(), page: view.page, size: view.size });
  const table = document.getElementById('installs');
  const defaultSort = toggles.type === 'past' ? 'days_past_eos' : 'effective_eos_date';
  const defaultDir = toggles.type === 'past' ? 'desc' : 'asc';
  const curSort = view.sort || defaultSort;
  const curDir = view.dir || (view.sort ? 'desc' : defaultDir);
  header(table, INSTALL_COLS, curSort, curDir, (k) => {
    view.dir = curSort === k && curDir === 'desc' ? 'asc' : 'desc';
    view.sort = k;
    view.page = 1;
    syncAll();
    loadInstalls().catch(showError);
  });
  table.querySelector('tbody').innerHTML = res.rows.map((r) => `<tr>${INSTALL_COLS.map(([k, , cls]) => `<td class="${cls || ''}">${cell(k, r[k])}</td>`).join('')}</tr>`).join('')
    || `<tr><td colspan="${INSTALL_COLS.length}" class="muted">No installs match the filters</td></tr>`;
  const from = res.total ? (res.page - 1) * res.size + 1 : 0;
  const to = Math.min(res.page * res.size, res.total);
  document.getElementById('page-info').textContent = `${fmtInt(from)}–${fmtInt(to)} of ${fmtInt(res.total)} installs`;
  document.getElementById('prev').disabled = res.page <= 1;
  document.getElementById('next').disabled = to >= res.total;
  document.getElementById('installs-title').textContent = toggles.type === 'past'
    ? `Installs past end of support at ${res.snapshot}`
    : `Installs reaching end of support within ${res.months} months of ${res.snapshot}`;
}

function syncAll() {
  syncUrl(extra());
  document.getElementById('csv').href = `/api/details/installs.csv?${queryString(extra())}`;
  document.querySelectorAll('[data-nav=past]').forEach((a) => { a.href = `details.html?${queryString({ type: 'past' })}`; a.classList.toggle('active', toggles.type === 'past'); });
  document.querySelectorAll('[data-nav=future]').forEach((a) => { a.href = `details.html?${queryString({ type: 'future' })}`; a.classList.toggle('active', toggles.type === 'future'); });
  document.querySelectorAll('[data-nav=home]').forEach((a) => { a.href = `index.html?${queryString()}`; });
  document.getElementById('months-wrap').hidden = toggles.type !== 'future';
  const title = toggles.type === 'past' ? 'Details (Past End of Support)' : 'Details (Future End of Support)';
  document.getElementById('page-title').textContent = title;
  document.title = `${title} · Software End of Support Dashboard`;
}

let loadSeq = 0;
async function load() {
  const seq = ++loadSeq;
  view.page = 1;
  syncAll();
  renderChips(document.getElementById('chips'), () => { filterUi.refresh(); load(); });
  try {
    const res = await api('details/products', extra());
    if (seq !== loadSeq) return;
    view.products = res.rows;
    document.getElementById('products-title').textContent = toggles.type === 'past'
      ? 'Software products past end of support' : `Software products reaching end of support in the next ${res.months} months`;
    renderProducts();
    await loadInstalls();
    showError(null);
  } catch (err) {
    if (seq === loadSeq) showError(err);
  }
}

let filterUi;
(async function init() {
  initTheme();
  try {
    const options = await api('filters');
    fillSnapshots(document.getElementById('snapshot'), options.snapshots, load);
    fillMonths(document.getElementById('months'), load);
    filterUi = renderFilters(document.getElementById('filters'), options, load);
    document.getElementById('reset').addEventListener('click', () => {
      for (const k of Object.keys(state.filters)) state.filters[k] = [];
      filterUi.refresh();
      load();
    });
    initToggles(() => { view.sort = ''; view.dir = ''; load(); });
    const search = document.getElementById('search');
    search.value = view.q;
    let t;
    search.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { view.q = search.value.trim(); load(); }, 300);
    });
    document.getElementById('prev').addEventListener('click', () => { view.page -= 1; loadInstalls().catch(showError); });
    document.getElementById('next').addEventListener('click', () => { view.page += 1; loadInstalls().catch(showError); });
    await load();
  } catch (err) {
    showError(err);
  }
})();
