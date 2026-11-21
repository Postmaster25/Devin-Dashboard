# EOS star schema (MySQL 8.0+)

These scripts build a star schema from `staging_installs`. That table has one TEXT column for each column in `software_itam_eos_snapshots.csv` and is loaded with the MySQL Workbench **Table Data Import Wizard**.

```
snapshots (snapshot_date) ─┐
hosts     (ci_id)         ─┼─< installs (snapshot_date, install_id)
products  (technopedia_release_id) ─┘
```

## Run order

Run every script in the schema that holds `staging_installs` (Workbench: double-click the schema so it is bold, or `USE your_schema;`).

| # | Script | What it does | Re-runnable |
|---|--------|--------------|-------------|
| 0 | Import wizard | Load the CSV into `staging_installs` (all columns `TEXT`) | Truncate or drop the table first, or rows are appended |
| 1 | `01_dimensions.sql` | Creates the `v_staging_installs` cleaning view. Creates and upserts `snapshots`, `hosts` and `products` | Yes (upsert) |
| 2 | `02_facts.sql` | Creates `installs`, then truncates and reloads it with the derived EOS columns | Yes (full reload) |
| 3 | `03_verify.sql` | Read-only sanity checks. Rows with a `status` column should all say `OK` | Yes |

The sample CSV takes about 10 s for scripts 1 and 2 combined. Expected results for it: 70,617 installs, 7 snapshots, 1,667 hosts and 147 products. At the latest snapshot (2026-09-19) the split is 393 Past EOS (3.76%), 3,951 Extended, 5,427 Supported and 678 Unknown.

## Derived columns (`installs`)

| Column | Rule |
|--------|------|
| `effective_eos_date` | `COALESCE(extended_support_end_date, obsolete_date, end_of_life_date)` |
| `eos_status` | `Unknown` if no effective date. `Past EOS` if effective date ≤ `snapshot_date`. `Extended` if `end_of_life_date` ≤ `snapshot_date`. Otherwise `Supported` |
| `eos_status_order` | 1 Past EOS, 2 Extended, 3 Supported, 4 Unknown |
| `is_past_eos` | 1 if `Past EOS`, else 0 |
| `days_past_eos` | `DATEDIFF(snapshot_date, effective_eos_date)` for `Past EOS`, else NULL |
| `days_non_compliant` | `DATEDIFF(snapshot_date, aging_start_date)` when `aging_start_date` is set, else NULL |

Status is measured against each row's `snapshot_date`, not today. Lifecycle dates come from the staging row.

## Date handling

The `v_staging_installs` view cleans every column with `NULLIF(TRIM(...), '')` after stripping CR, LF and TAB characters. Date columns are then parsed with `STR_TO_DATE(value, '%Y-%m-%d')`.

`STR_TO_DATE(NULLIF(TRIM(col), ''), '%Y-%m-%d')` alone is not enough. With the default `STRICT_TRANS_TABLES` sql_mode, an impossible date such as `2026-02-30` returns NULL in a plain `SELECT`, but in an `INSERT ... SELECT` it raises **error 1411** (`Incorrect datetime value ... for function str_to_date`). So the view only calls `STR_TO_DATE` after two checks:

- the value matches `YYYY-MM-DD`;
- the day exists in that month.

Malformed dates become NULL without an error, and check 4 in `03_verify.sql` counts and lists them.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Error 1292 / 1411 `Incorrect date(time) value` | A date column was typed as `DATE`/`DATETIME` by the wizard, or `STR_TO_DATE` ran on a malformed value under strict mode | Make every `staging_installs` column `TEXT` (wizard: change the *Field Type* for each date column) and use these scripts unchanged |
| Error 1146 `Table 'staging_installs' doesn't exist` | Wrong default schema, or the wizard used another table name | `USE` the schema, or rename: `RENAME TABLE your_table TO staging_installs;` |
| Error 1054 `Unknown column 'snapshot_date'` | The CSV was saved with a UTF-8 BOM, so the first column is named `ï»¿snapshot_date` (or the header row was not used for names) | ``ALTER TABLE staging_installs RENAME COLUMN `ï»¿snapshot_date` TO snapshot_date;`` (check names with `SHOW COLUMNS FROM staging_installs;`) |
| Check 1 shows `duplicate_rows` > 0 | The CSV was imported twice into the same table | `02_facts.sql` keeps one row per `(snapshot_date, install_id)` anyway. To clean up: `TRUNCATE staging_installs;` and re-import |
| `staging_rows` is lower than the CSV line count minus 1 | The wizard skipped rows (it is slow and drops rows it cannot parse) | Load with `LOAD DATA` instead (see below) |
| Error 1175 (safe update mode) | Workbench `SQL_SAFE_UPDATES` | `01_dimensions.sql` turns it off only around its single `UPDATE` and restores it. If you edit the scripts, keep that pattern |
| Error 1701 `Cannot truncate a table referenced in a foreign key` | You added a table that references `installs` | Drop or disable that foreign key before running `02_facts.sql` |
| Error 1451 when dropping or deleting a dimension | `installs` references it | Drop `installs` first (see *Full reset*) |
| Error 1406 `Data too long for column` | A text value is longer than the column size (columns are sized well above the sample data) | Widen it: `ALTER TABLE hosts MODIFY host_name VARCHAR(500);` |
| Error 2013 / Workbench timeout | The default 30 s read timeout is too short on a slow server | *Edit → Preferences → SQL Editor → DBMS connection read timeout* = 600 |
| Old hosts/products still listed after reloading staging with different data | Dimensions are upserted, never pruned | Run a full reset |

### Full reset

```sql
DROP TABLE IF EXISTS installs;
DROP TABLE IF EXISTS snapshots, hosts, products;
DROP VIEW  IF EXISTS v_staging_installs;
-- then run 01, 02, 03 again
```

### Loading staging without the wizard

Run this in the Workbench connection. The connection needs `OPT_LOCAL_INFILE=1` under *Advanced → Others*, and the server needs `local_infile=ON`.

```sql
CREATE TABLE IF NOT EXISTS staging_installs (
  snapshot_date TEXT, install_id TEXT, normalized_product_name TEXT, normalized_version TEXT,
  normalized_manufacturer TEXT, edition TEXT, product_category TEXT, install_date TEXT,
  last_scanned_date TEXT, discovery_source TEXT, software_operational_status TEXT,
  technopedia_product_id TEXT, technopedia_release_id TEXT, general_availability_date TEXT,
  end_of_life_date TEXT, extended_support_end_date TEXT, obsolete_date TEXT, ci_id TEXT,
  host_name TEXT, ci_type TEXT, environment TEXT, host_operational_status TEXT,
  business_criticality TEXT, address TEXT, city TEXT, state TEXT, country TEXT,
  managed_by_group TEXT, managed_by_group_manager_name TEXT, cio_org_name TEXT,
  cio_org_manager_name TEXT, cost_center TEXT, host_last_discovered_date TEXT,
  aging_start_date TEXT, potential_aging_cause TEXT
) DEFAULT CHARSET = utf8mb4;

TRUNCATE staging_installs;
LOAD DATA LOCAL INFILE 'C:/data/software_itam_eos_snapshots.csv'
INTO TABLE staging_installs CHARACTER SET utf8mb4
FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"'
LINES TERMINATED BY '\n'
IGNORE 1 LINES;
```

Stray `\r` characters from Windows line endings are stripped by the cleaning view.
