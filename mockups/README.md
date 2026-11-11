# Software End of Support dashboard: design mockups

> **Status: DESIGN MOCKUP, pending user approval.** These pages are a visual and interaction spec for the Power BI
> "End of Support" report. They are for review **before** any Power BI development starts. Nothing here changes the
> `.pbip` project (`Devin Dashboard.Report` / `Devin Dashboard.SemanticModel`).

## How to open

1. Open `mockups/index.html` in a browser (double-click it, or `start mockups/index.html` / `open mockups/index.html`).
   You don't need a server or a build step.
2. Charts load [Apache ECharts 5.5.1](https://echarts.apache.org/) from the jsDelivr CDN, so you need internet access.
3. Use the tabs at the top to move between the three report pages (`#executive`, `#organization`, `#detail`).

The page canvases are sized like Power BI pages: 1280 × 720 (16:9) for pages 1–2, and a taller custom page for page 3.

## Pages

| # | Page | Visuals | Slicers |
|---|------|---------|---------|
| 1 | **Executive Summary** | KPI cards (total installs, % past EOS with RAG, installs past EOS, installs reaching EOS within 6 months). Lifecycle-status donut (Supported / Extended / Past EOS / Unknown). % past EOS across 7 snapshots with 3% and 5% reference lines. Top-10 products past EOS. "Upcoming 6 months" combo: columns show installs crossing EOS per month, and the line shows cumulative projected % past EOS on the secondary axis. | CIO org, environment, business criticality |
| 2 | **Risk by Organization** | RAG KPI strip. Drillable matrix CIO org → managed-by group with installs, past-EOS count, % past EOS (RAG background), change vs prior snapshot and a 7-snapshot sparkline. Bar chart ranking managed-by groups by average days non-compliant, with bar colour set by the group's RAG. Clicking an org row in the matrix cross-filters the bar chart. | Environment, business criticality |
| 3 | **Lifecycle Detail & Remediation** | "View by" toggle (Product / Organization), standing in for a Power BI **field parameter**. Drillable matrix Product → Version → Host or CIO org → Managed-by group → Host, with version, effective EOS date, days past EOS and days non-compliant. Host-grain remediation worklist (one row per install) that you can sort, page through and **Export CSV** from. Clicking a matrix row filters the worklist. | Environment, business criticality, EOS status, managed-by group, product category |

## Business rules shown in the mockups

- **Effective EOS date** = `COALESCE(extended_support_end_date, obsolete_date, end_of_life_date)`, in that order.
- **EOS status**, evaluated per snapshot:
  - **Past EOS**: effective EOS date ≤ snapshot date.
  - **Unknown**: all three dates are blank.
  - **Supported**: any other install.
  - The donut also splits Supported into **Extended** (`end_of_life_date` has passed but the effective EOS date has not, so the install is running on extended or obsolete support) and plain **Supported**. *Needs confirmation.*
- **KPI** = % of installs past EOS. RAG bands: ≤ 3% green, > 3% to 5% amber, > 5% red. The thresholds are fixed and are applied at whatever grain is in context (estate, CIO org, managed-by group, product, host).
- **Hierarchy**: `cio_org_name` → `managed_by_group` → `host_name`. Each host has exactly one managed-by group.
- **Days non-compliant** = latest snapshot − `aging_start_date`, which is filled only for past-EOS installs.
  **Days past EOS** = latest snapshot − effective EOS date.
- **Upcoming / projection** metrics anchor to `MAX(snapshot_date)` (19 Sep 2026 in the sample), not `TODAY()`.
  - Reaching EOS within 6 months: effective EOS date is in (latest snapshot, `EDATE(latest, 6)`].
  - Projected % past EOS at month M = (installs already past EOS + installs whose effective EOS date falls between the latest snapshot and the end of M) / total installs. This is a "do nothing" scenario that assumes no remediation.
  - The combo chart shows the 6 calendar months after the snapshot month. The first column also includes any installs that reach EOS in the rest of the snapshot month.
- In matrices, group rows show `MIN` effective EOS date and `MAX` days past EOS / days non-compliant. When a group row covers more than one version, it shows "Multiple (n)".
- Trend indicators compare against the previous snapshot. ▲ (red) means the % past EOS went up; ▼ (green) means it went down.

## Theme

Wells Fargo brand palette:

- Primary red `#D71E28` (header band, primary series, Past EOS)
- Gold accent `#FFBB41` (header rule, Extended / upcoming, amber RAG)
- Dark neutral text `#3B3331`
- White visual backgrounds

RAG uses green `#2E8B47`, gold and red. Amber *text* uses a darker `#B47A00` so it stays readable on white. The font stack is `Wells Fargo Sans` → `Segoe UI`.

## Data

The figures come from the repo's `software_itam_eos_snapshots.zip` so that sizes and shapes look realistic. The
measures are **not** validated. `assets/mock-data.js` is a compact extract: every install at the latest snapshot, plus a
snapshot × group × environment × criticality cube that feeds the trend visuals. To regenerate it from the repo root, run:

```bash
python mockups/scripts/build_mock_data.py
```

## Files

```
mockups/
├── index.html                 # three report pages with tab navigation
├── assets/styles.css          # Wells Fargo theme + Power BI-style canvas
├── assets/app.js              # business rules, slicers, charts, matrices, CSV export
├── assets/mock-data.js        # generated data extract
└── scripts/build_mock_data.py # regenerates mock-data.js from the CSV zip
```
