# Loading `installs` from `staging_installs` (MySQL 8.0+)

`load_installs.sql` fills the `installs` fact table in the `devin_dashboard` schema from `staging_installs`. That table has one TEXT column for each column in `software_itam_eos_snapshots.csv` and is loaded with the MySQL Workbench **Table Data Import Wizard**.

It works with the existing table design, which uses surrogate keys:

```
snapshots (snapshot_date)             ─┐
hosts     (host_key,    ci_id unique)  ─┼─< installs (install_key)
products  (release_key, technopedia_release_id unique) ─┘
```

## Run order

| # | Step | Notes |
|---|------|-------|
| 0 | Import the CSV into `staging_installs` (all columns `TEXT`) | Truncate the table first, or the rows are appended |
| 1 | Load `snapshots`, `hosts` and `products` | Must contain every `snapshot_date`, `ci_id` and `technopedia_release_id` in staging |
| 2 | Run `load_installs.sql` | Builds the new rows in a temporary `installs_load` table, replaces all `installs` rows in one transaction, then prints the checks below |

Safe to re-run. If building `installs_load` fails (for example error 1406), `installs` is not touched and keeps its previous rows. This also holds in Workbench with *continue on error* turned on.

## Output checks

| Result | Expected |
|--------|----------|
| `staging_rows` / `installs_rows` / `not_loaded` | `not_loaded` = 0 |
| Rows per snapshot | One row for each snapshot date |
| EOS status at latest snapshot | For the sample CSV (2026-09-19): 393 Past EOS (3.76%), 3,951 Extended, 5,427 Supported, 678 Unknown |
| Orphan and duplicate counts | All 0 |

Sample CSV totals: 70,617 installs, 7 snapshots, 1,667 hosts, 147 products.

A row is skipped, and counted in `not_loaded`, when:

- its `snapshot_date` or `install_id` is blank or malformed;
- its `ci_id` or `technopedia_release_id` has no match in `hosts` or `products`;
- it repeats an earlier `(snapshot_date, install_id)`, for example after importing the CSV twice.

## Derived columns

| Column | Rule |
|--------|------|
| `effective_eos_date` | `COALESCE(extended_support_end_date, obsolete_date, end_of_life_date)` |
| `eos_status` | `Unknown` if no effective date. `Past EOS` if effective date ≤ `snapshot_date`. `Extended` if `end_of_life_date` ≤ `snapshot_date`. Otherwise `Supported` |
| `is_past_eos` | 1 if `Past EOS`, else 0 |
| `days_past_eos` | `DATEDIFF(snapshot_date, effective_eos_date)` for `Past EOS`, else NULL |
| `days_non_compliant` | `DATEDIFF(snapshot_date, aging_start_date)` when `aging_start_date` is set, else NULL |

Status is measured against each row's `snapshot_date`, not today. Lifecycle dates come from the staging row. These rules match `Devin Dashboard.SemanticModel/definition/tables/Installs.tmdl`.

## Date handling

Each value has CR, LF and TAB characters stripped, then `NULLIF(TRIM(...), '')`, then `STR_TO_DATE(value, '%Y-%m-%d')`.

`STR_TO_DATE` alone is not enough. With the default `STRICT_TRANS_TABLES` sql_mode, an impossible date such as `2026-02-30` returns NULL in a plain `SELECT`, but in an `INSERT ... SELECT` it raises **error 1411** or **1292**. So the script only calls `STR_TO_DATE` after two checks:

- the value matches `YYYY-MM-DD`;
- the day exists in that month.

Malformed dates become NULL without an error.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Error 1292 / 1411 `Incorrect date(time) value` | A staging column was typed as `DATE` by the wizard, or `STR_TO_DATE` ran on a malformed value | Make every `staging_installs` column `TEXT` and use this script unchanged |
| Error 1146 `Table ... doesn't exist` | Wrong schema or table name | The script runs `USE devin_dashboard;`. Edit that line if your schema is different |
| Error 1054 `Unknown column 'snapshot_date'` | The CSV has a UTF-8 BOM, so the first column is named `ï»¿snapshot_date` | ``ALTER TABLE staging_installs RENAME COLUMN `ï»¿snapshot_date` TO snapshot_date;`` |
| `not_loaded` > 0 | Missing host, product or snapshot, a blank or bad key, or duplicate rows | Reload the dimension tables from staging, or truncate staging and re-import once |
| `staging_rows` is lower than the CSV line count minus 1 | The wizard skipped rows it could not parse | Load with `LOAD DATA LOCAL INFILE` (see below) |
| Error 1406 `Data too long for column` | A value is longer than its `installs` column | Widen it, e.g. `ALTER TABLE installs MODIFY potential_aging_cause VARCHAR(500);`. `installs` keeps its previous rows |
| Error 1175 (safe update mode) | Workbench `SQL_SAFE_UPDATES` | The `DELETE` already filters on the primary key. Keep that `WHERE` if you edit it |
| Error 2013 / Workbench timeout | The default 30 s read timeout is too short | *Edit → Preferences → SQL Editor → DBMS connection read timeout* = 600 |

### Loading staging without the wizard

The Workbench connection needs `OPT_LOCAL_INFILE=1` under *Advanced → Others*, and the server needs `local_infile=ON`.

```sql
TRUNCATE staging_installs;
LOAD DATA LOCAL INFILE 'C:/data/software_itam_eos_snapshots.csv'
INTO TABLE staging_installs CHARACTER SET utf8mb4
FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"'
LINES TERMINATED BY '\n'
IGNORE 1 LINES;
```

Stray `\r` characters from Windows line endings are stripped by `load_installs.sql`.
