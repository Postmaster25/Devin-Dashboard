'use strict';
require('dotenv').config();
const path = require('path');
const express = require('express');
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'devin_dashboard',
  dateStrings: true,
  decimalNumbers: true,
  connectionLimit: 5,
});

const BASE = `FROM installs i
  JOIN hosts h ON h.host_key = i.host_key
  JOIN products p ON p.release_key = i.release_key`;

const PRODUCT_VERSION = "CONCAT(p.normalized_product_name, ' ', p.normalized_version)";

// Query-string filter -> column. Values arrive as ?team=a&team=b.
const FILTERS = {
  team: 'h.managed_by_group',
  org: 'h.cio_org_name',
  env: 'h.environment',
  crit: 'h.business_criticality',
  hw: 'h.ci_type',
  product: PRODUCT_VERSION,
  mfr: 'p.normalized_manufacturer',
  cat: 'p.product_category',
};

const DIMENSIONS = { team: FILTERS.team, product: PRODUCT_VERSION, org: FILTERS.org };

const REACHING = `i.effective_eos_date > i.snapshot_date
  AND i.effective_eos_date <= DATE_ADD(i.snapshot_date, INTERVAL ? MONTH)`;

function list(v) {
  if (v == null || v === '') return [];
  return (Array.isArray(v) ? v : [v]).map(String).filter(Boolean).slice(0, 500);
}

function filterSql(q, skip = []) {
  const parts = [];
  const params = [];
  for (const [key, col] of Object.entries(FILTERS)) {
    if (skip.includes(key)) continue;
    const vals = list(q[key]);
    if (!vals.length) continue;
    parts.push(`${col} IN (${vals.map(() => '?').join(',')})`);
    params.push(...vals);
  }
  return { sql: parts.length ? ' AND ' + parts.join(' AND ') : '', params };
}

function months(q) {
  const n = parseInt(q.months, 10);
  return Number.isInteger(n) && n >= 1 && n <= 36 ? n : 6;
}

function topN(q, def) {
  const n = parseInt(q.top, 10);
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : def;
}

let snapshotCache = { at: 0, list: [] };
async function snapshots() {
  if (Date.now() - snapshotCache.at > 60_000) {
    const [rows] = await pool.query('SELECT snapshot_date FROM snapshots ORDER BY snapshot_date');
    snapshotCache = { at: Date.now(), list: rows.map((r) => r.snapshot_date) };
  }
  return snapshotCache.list;
}

async function resolveSnapshot(q) {
  const all = await snapshots();
  if (!all.length) throw Object.assign(new Error('No snapshots loaded'), { status: 404 });
  const idx = all.includes(q.snapshot) ? all.indexOf(q.snapshot) : all.length - 1;
  return { snapshot: all[idx], prev: idx > 0 ? all[idx - 1] : null, all };
}

const pct = (part, total) => (total ? (100 * part) / total : null);

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  next();
});

const api = (fn) => async (req, res) => {
  try {
    res.json(await fn(req.query));
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Database query failed' });
  }
};

app.get('/api/filters', api(async () => {
  const out = { snapshots: await snapshots() };
  for (const [key, col] of Object.entries(FILTERS)) {
    const [rows] = await pool.query(`SELECT DISTINCT ${col} AS v ${BASE} WHERE ${col} IS NOT NULL AND ${col} <> '' ORDER BY v`);
    out[key] = rows.map((r) => r.v);
  }
  return out;
}));

app.get('/api/summary', api(async (q) => {
  const { snapshot, prev } = await resolveSnapshot(q);
  const n = months(q);
  const f = filterSql(q);
  const [[cur]] = await pool.query(
    `SELECT COUNT(*) AS total,
       COALESCE(SUM(i.eos_status = 'Past EOS'), 0) AS past,
       COALESCE(SUM(i.eos_status = 'Extended'), 0) AS extended,
       COALESCE(SUM(i.eos_status = 'Supported'), 0) AS supported,
       COALESCE(SUM(i.eos_status = 'Unknown'), 0) AS unknown,
       COALESCE(SUM(${REACHING}), 0) AS reaching,
       COUNT(DISTINCT i.host_key) AS hosts,
       AVG(CASE WHEN i.eos_status = 'Past EOS' THEN i.days_non_compliant END) AS avg_days_non_compliant
     ${BASE} WHERE i.snapshot_date = ?${f.sql}`,
    [n, snapshot, ...f.params]);
  let previous = null;
  if (prev) {
    const [[p]] = await pool.query(
      `SELECT COUNT(*) AS total, COALESCE(SUM(i.eos_status = 'Past EOS'), 0) AS past
       ${BASE} WHERE i.snapshot_date = ?${f.sql}`, [prev, ...f.params]);
    previous = { snapshot: prev, ...p, pct: pct(p.past, p.total) };
  }
  return {
    snapshot, months: n, ...cur,
    pct: pct(cur.past, cur.total),
    projected_pct: pct(cur.past + cur.reaching, cur.total),
    previous,
  };
}));

app.get('/api/trend', api(async (q) => {
  const f = filterSql(q);
  const [rows] = await pool.query(
    `SELECT i.snapshot_date AS snapshot, COUNT(*) AS total,
       SUM(i.eos_status = 'Past EOS') AS past
     ${BASE} WHERE 1 = 1${f.sql}
     GROUP BY i.snapshot_date ORDER BY i.snapshot_date`, f.params);
  return rows.map((r) => ({ ...r, pct: pct(r.past, r.total) }));
}));

app.get('/api/past-eos', api(async (q) => {
  const by = DIMENSIONS[q.by] ? q.by : 'team';
  const dim = DIMENSIONS[by];
  const { snapshot, prev } = await resolveSnapshot(q);
  const f = filterSql(q);
  const [rows] = await pool.query(
    `SELECT ${dim} AS name,
       SUM(i.snapshot_date = ? AND i.eos_status = 'Past EOS') AS past,
       SUM(i.snapshot_date = ?) AS total,
       SUM(i.snapshot_date = ? AND i.eos_status = 'Past EOS') AS prev_past
     ${BASE} WHERE i.snapshot_date IN (?, ?)${f.sql}
     GROUP BY name HAVING past > 0 ORDER BY past DESC, name LIMIT ?`,
    [snapshot, snapshot, prev, snapshot, prev || snapshot, ...f.params, topN(q, by === 'product' ? 5 : 10)]);
  return {
    by, snapshot, prev,
    rows: rows.map((r) => ({ ...r, pct: pct(r.past, r.total), prev_past: prev ? r.prev_past : null })),
  };
}));

app.get('/api/reaching-eos', api(async (q) => {
  const { snapshot } = await resolveSnapshot(q);
  const n = months(q);
  const f = filterSql(q);
  if (q.by === 'month') {
    const [[base]] = await pool.query(
      `SELECT COUNT(*) AS total, COALESCE(SUM(i.eos_status = 'Past EOS'), 0) AS past
       ${BASE} WHERE i.snapshot_date = ?${f.sql}`, [snapshot, ...f.params]);
    const [rows] = await pool.query(
      `SELECT DATE_FORMAT(i.effective_eos_date, '%Y-%m') AS month, COUNT(*) AS reaching
       ${BASE} WHERE i.snapshot_date = ? AND ${REACHING}${f.sql}
       GROUP BY month ORDER BY month`, [snapshot, n, ...f.params]);
    const byMonth = Object.fromEntries(rows.map((r) => [r.month, r.reaching]));
    const out = [];
    const start = new Date(snapshot + 'T00:00:00Z');
    let cumulative = base.past;
    for (let k = 0; k <= n; k++) {
      const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + k, 1));
      const month = d.toISOString().slice(0, 7);
      const reaching = byMonth[month] || 0;
      cumulative += reaching;
      out.push({ month, reaching, projected_pct: pct(cumulative, base.total) });
    }
    return { by: 'month', snapshot, months: n, total: base.total, past: base.past, rows: out };
  }
  const by = DIMENSIONS[q.by] ? q.by : 'team';
  const [rows] = await pool.query(
    `SELECT ${DIMENSIONS[by]} AS name, COUNT(*) AS reaching
     ${BASE} WHERE i.snapshot_date = ? AND ${REACHING}${f.sql}
     GROUP BY name ORDER BY reaching DESC, name LIMIT ?`,
    [snapshot, n, ...f.params, topN(q, by === 'product' ? 5 : 10)]);
  return { by, snapshot, months: n, rows };
}));

app.get('/api/group-trend', api(async (q) => {
  const by = DIMENSIONS[q.by] ? q.by : 'team';
  const value = String(q.value || '');
  const f = filterSql(q, [by]);
  const [rows] = await pool.query(
    `SELECT i.snapshot_date AS snapshot, COUNT(*) AS total,
       SUM(i.eos_status = 'Past EOS') AS past,
       SUM(${REACHING}) AS reaching
     ${BASE} WHERE ${DIMENSIONS[by]} = ?${f.sql}
     GROUP BY i.snapshot_date ORDER BY i.snapshot_date`, [months(q), value, ...f.params]);
  return { by, value, rows: rows.map((r) => ({ ...r, pct: pct(r.past, r.total) })) };
}));

const DETAIL_COLUMNS = {
  host_name: 'h.host_name',
  managed_by_group: 'h.managed_by_group',
  cio_org_name: 'h.cio_org_name',
  environment: 'h.environment',
  business_criticality: 'h.business_criticality',
  ci_type: 'h.ci_type',
  product: 'p.normalized_product_name',
  version: 'p.normalized_version',
  manufacturer: 'p.normalized_manufacturer',
  category: 'p.product_category',
  effective_eos_date: 'i.effective_eos_date',
  eos_status: 'i.eos_status',
  days_past_eos: 'i.days_past_eos',
  days_non_compliant: 'i.days_non_compliant',
  aging_start_date: 'i.aging_start_date',
  potential_aging_cause: 'i.potential_aging_cause',
  install_id: 'i.install_id',
  last_scanned_date: 'i.last_scanned_date',
};

async function detailScope(q) {
  const { snapshot } = await resolveSnapshot(q);
  const type = q.type === 'future' ? 'future' : 'past';
  const n = months(q);
  const f = filterSql(q);
  let sql = ` WHERE i.snapshot_date = ?`;
  const params = [snapshot];
  if (type === 'past') sql += ` AND i.eos_status = 'Past EOS'`;
  else { sql += ` AND ${REACHING}`; params.push(n); }
  sql += f.sql;
  params.push(...f.params);
  const search = String(q.q || '').trim().slice(0, 100);
  if (search) {
    sql += ` AND (h.host_name LIKE ? OR ${PRODUCT_VERSION} LIKE ? OR h.managed_by_group LIKE ? OR i.install_id LIKE ?)`;
    const like = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    params.push(like, like, like, like);
  }
  return { snapshot, type, months: n, sql, params };
}

function orderBy(q, def, defDir = 'desc') {
  const col = DETAIL_COLUMNS[q.sort] || def;
  const dir = (q.dir || defDir) === 'asc' ? 'ASC' : 'DESC';
  return `${col} ${dir}, i.install_key`;
}

const SELECT_DETAIL = `SELECT ${Object.entries(DETAIL_COLUMNS).map(([k, c]) => `${c} AS ${k}`).join(', ')}`;

app.get('/api/details/products', api(async (q) => {
  const s = await detailScope(q);
  const [rows] = await pool.query(
    `SELECT p.normalized_product_name AS product, p.normalized_version AS version,
       p.normalized_manufacturer AS manufacturer, p.product_category AS category,
       p.end_of_life_date, p.extended_support_end_date, p.obsolete_date,
       MIN(i.effective_eos_date) AS effective_eos_date,
       COUNT(*) AS installs, COUNT(DISTINCT i.host_key) AS hosts
     ${BASE}${s.sql}
     GROUP BY p.release_key ORDER BY installs DESC, product, version`, s.params);
  return { snapshot: s.snapshot, type: s.type, months: s.months, rows };
}));

app.get('/api/details/installs', api(async (q) => {
  const s = await detailScope(q);
  const size = Math.min(Math.max(parseInt(q.size, 10) || 50, 1), 500);
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${BASE}${s.sql}`, s.params);
  const [rows] = await pool.query(
    `${SELECT_DETAIL} ${BASE}${s.sql} ORDER BY ${orderBy(q, s.type === 'past' ? 'i.days_past_eos' : 'i.effective_eos_date', s.type === 'past' ? 'desc' : 'asc')} LIMIT ? OFFSET ?`,
    [...s.params, size, (page - 1) * size]);
  return { snapshot: s.snapshot, type: s.type, months: s.months, total, page, size, rows };
}));

function csvCell(v) {
  if (v == null) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

app.get('/api/details/installs.csv', async (req, res) => {
  try {
    const s = await detailScope(req.query);
    const [rows] = await pool.query(
      `${SELECT_DETAIL} ${BASE}${s.sql} ORDER BY ${orderBy(req.query, s.type === 'past' ? 'i.days_past_eos' : 'i.effective_eos_date', s.type === 'past' ? 'desc' : 'asc')}`, s.params);
    const cols = Object.keys(DETAIL_COLUMNS);
    const lines = [cols.join(',')].concat(rows.map((r) => cols.map((c) => csvCell(r[c])).join(',')));
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="eos_${s.type}_${s.snapshot}.csv"`);
    res.send('\uFEFF' + lines.join('\r\n'));
  } catch (err) {
    console.error(err);
    res.status(500).send('Database query failed');
  }
});

app.use('/vendor', express.static(path.join(__dirname, 'node_modules', 'echarts', 'dist')));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
if (require.main === module) {
  app.listen(PORT, HOST, () => console.log(`EOS dashboard running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
}

module.exports = { app, pool };
