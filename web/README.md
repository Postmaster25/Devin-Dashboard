# EOS Dashboard website (local)

A local website version of the **EOS Dashboard** Power BI report, reading the existing
`devin_dashboard` MySQL tables (`installs`, `hosts`, `products`, `snapshots`) that
[`database/load_installs.sql`](../database/load_installs.sql) loads.

## Run it

Needs Node 18+ and a MySQL login with `SELECT` on `devin_dashboard`.

```bash
cd web
npm install
cp .env.example .env   # then set DB_USER and DB_PASSWORD
npm start              # http://localhost:3000
```

The server listens on `127.0.0.1` only. It runs read-only, parameterized queries.

Optional read-only login (run as an admin in Workbench):

```sql
CREATE USER 'eos_web'@'localhost' IDENTIFIED BY '<password>';
GRANT SELECT ON devin_dashboard.* TO 'eos_web'@'localhost';
```

## Pages

| Page | Report page it replaces | What it shows |
|---|---|---|
| Home (`index.html`) | Home + the three tooltip pages | % past EOS with RAG, past EOS count, % / count trend with 3% and 5% lines, past EOS by team or top 5 product version (vs prior snapshot), reaching EOS in the next N months by month and by team or product, projected % past EOS. Hovering a bar shows a small trend for that team or product. |
| Details (`details.html?type=past` / `future`) | Details (Past EoS) / Details (Future EoS) | Product summary and paged install list, sortable, searchable, CSV export. Selecting a product filters the install list. |

Filters (sidebar, multi-select): responsible team, product version, manufacturer, software type,
CIO org, environment, business criticality and HW type. Filters, snapshot and months are kept
in the URL, so a link reopens the same view.

## Rules

- EOS fields come from `installs` as `load_installs.sql` stores them: effective EOS date =
  extended support end, then obsolete, then end of life; status is evaluated against each row's
  `snapshot_date`.
- **Past EOS** = `eos_status = 'Past EOS'`. **Reaching EOS in N months** = effective EOS date after
  the snapshot date and on or before snapshot date + N months.
- **RAG** (from `mockups/`): green ≤ 3%, amber > 3% to 5%, red > 5% past EOS.
- **Projected %** = (past EOS + reaching EOS in N months) ÷ installs at the selected snapshot.

## Theme

The default theme follows the report (CJB teal). The **Wells Fargo** button in the sidebar, or
`?theme=wf` in the URL, switches to the Wells Fargo palette from `mockups/`.

## Field mapping from the report

| Report field | `devin_dashboard` column |
|---|---|
| Responsible team | `hosts.managed_by_group` |
| Software type | `products.product_category` |
| HW type | `hosts.ci_type` |
| Product version | `products.normalized_product_name` + `normalized_version` |
| Manufacturer | `products.normalized_manufacturer` |
| Snapshot date | `installs.snapshot_date` |
| Aging start date | `installs.aging_start_date` |
