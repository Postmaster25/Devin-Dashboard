# Devin-Dashboard

## End of Support report (Power BI)

Open `Devin Dashboard.pbip` in Power BI Desktop, then select **Refresh**.

- **Data source:** the `SourceCsvPath` Power Query parameter (Transform data → Edit parameters). By default it reads `data/software_itam_eos_snapshots.csv` from this repo on GitHub. It also accepts a local path such as `C:\data\software_itam_eos_snapshots.csv`.
- **Pages:** Executive Summary, Risk by Organization, and Lifecycle Detail & Remediation.
- **Rules:** effective EOS date = extended support end, then obsolete, then end of life. "Current" values use the latest snapshot. Projections run forward from that snapshot, not from today. The RAG bands are ≤3% green, 3–5% amber and >5% red.
- **Design reference:** see [`mockups/`](mockups/).

## MySQL star schema

See [`database/`](database/) for `load_installs.sql`, which loads the MySQL `installs` table from a `staging_installs` table imported from the CSV, with safe date parsing and the derived EOS columns.
