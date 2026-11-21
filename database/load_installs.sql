-- =============================================================================
-- load_installs.sql - (re)load devin_dashboard.installs from staging_installs
-- Keeps the existing design (install_key / host_key / release_key surrogates).
-- Safe to re-run: the DELETE + INSERT run in one transaction, so a failed load
-- leaves the previous installs rows in place.
-- Every date is cleaned (strip CR/LF/TAB, TRIM, '' -> NULL) and only passed to
-- STR_TO_DATE(..., '%Y-%m-%d') after a YYYY-MM-DD + real-calendar-day check,
-- so malformed values become NULL instead of raising error 1292/1411.
-- EOS logic matches Installs.tmdl: effective = COALESCE(extended, obsolete, EOL),
-- status evaluated against each row's snapshot_date.
-- Rows are skipped (and counted in not_loaded below) when snapshot_date or
-- install_id is blank/malformed, the ci_id or technopedia_release_id has no
-- match in hosts/products, or the row duplicates an earlier (snapshot_date,
-- install_id).
-- Run after snapshots, hosts and products are loaded.
-- =============================================================================
USE devin_dashboard;

START TRANSACTION;

DELETE FROM installs WHERE install_key > 0;   -- WHERE on PK keeps Workbench safe-update mode happy

INSERT INTO installs (
    snapshot_date, install_id, host_key, release_key,
    install_date, last_scanned_date, discovery_source,
    software_operational_status, host_operational_status,
    effective_eos_date, eos_status, is_past_eos, days_past_eos, days_non_compliant,
    aging_start_date, potential_aging_cause
)
SELECT
    t.snapshot_date, t.install_id, h.host_key, p.release_key,
    t.install_date, t.last_scanned_date, t.discovery_source,
    t.software_operational_status, t.host_operational_status,
    t.effective_eos_date,
    t.eos_status,
    CASE WHEN t.eos_status = 'Past EOS' THEN 1 ELSE 0 END,
    CASE WHEN t.eos_status = 'Past EOS' THEN DATEDIFF(t.snapshot_date, t.effective_eos_date) END,
    CASE WHEN t.aging_start_date IS NOT NULL THEN DATEDIFF(t.snapshot_date, t.aging_start_date) END,
    t.aging_start_date, t.potential_aging_cause
FROM (
    SELECT e.*,
        ROW_NUMBER() OVER (PARTITION BY e.snapshot_date, e.install_id
                           ORDER BY e.ci_id, e.technopedia_release_id) AS rn,
        CASE
            WHEN e.effective_eos_date IS NULL THEN 'Unknown'
            WHEN e.effective_eos_date <= e.snapshot_date THEN 'Past EOS'
            WHEN e.end_of_life_date IS NOT NULL AND e.end_of_life_date <= e.snapshot_date THEN 'Extended'
            ELSE 'Supported'
        END AS eos_status
    FROM (
        SELECT r.*,
            COALESCE(r.extended_support_end_date, r.obsolete_date, r.end_of_life_date) AS effective_eos_date
        FROM (
            SELECT
                CASE WHEN NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.snapshot_date, '\r', ''), '\n', ''), '\t', '')), '') REGEXP '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
                  AND CAST(RIGHT(NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.snapshot_date, '\r', ''), '\n', ''), '\t', '')), ''), 2) AS UNSIGNED) <= DAY(LAST_DAY(CONCAT(LEFT(NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.snapshot_date, '\r', ''), '\n', ''), '\t', '')), ''), 7), '-01')))
             THEN STR_TO_DATE(NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.snapshot_date, '\r', ''), '\n', ''), '\t', '')), ''), '%Y-%m-%d') END AS snapshot_date,
                NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.install_id, '\r', ''), '\n', ''), '\t', '')), '') AS install_id,
                NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.ci_id, '\r', ''), '\n', ''), '\t', '')), '') AS ci_id,
                NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.technopedia_release_id, '\r', ''), '\n', ''), '\t', '')), '') AS technopedia_release_id,
                CASE WHEN NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.install_date, '\r', ''), '\n', ''), '\t', '')), '') REGEXP '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
                  AND CAST(RIGHT(NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.install_date, '\r', ''), '\n', ''), '\t', '')), ''), 2) AS UNSIGNED) <= DAY(LAST_DAY(CONCAT(LEFT(NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.install_date, '\r', ''), '\n', ''), '\t', '')), ''), 7), '-01')))
             THEN STR_TO_DATE(NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.install_date, '\r', ''), '\n', ''), '\t', '')), ''), '%Y-%m-%d') END AS install_date,
                CASE WHEN NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.last_scanned_date, '\r', ''), '\n', ''), '\t', '')), '') REGEXP '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
                  AND CAST(RIGHT(NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.last_scanned_date, '\r', ''), '\n', ''), '\t', '')), ''), 2) AS UNSIGNED) <= DAY(LAST_DAY(CONCAT(LEFT(NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.last_scanned_date, '\r', ''), '\n', ''), '\t', '')), ''), 7), '-01')))
             THEN STR_TO_DATE(NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.last_scanned_date, '\r', ''), '\n', ''), '\t', '')), ''), '%Y-%m-%d') END AS last_scanned_date,
                NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.discovery_source, '\r', ''), '\n', ''), '\t', '')), '') AS discovery_source,
                NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.software_operational_status, '\r', ''), '\n', ''), '\t', '')), '') AS software_operational_status,
                NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.host_operational_status, '\r', ''), '\n', ''), '\t', '')), '') AS host_operational_status,
                CASE WHEN NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.end_of_life_date, '\r', ''), '\n', ''), '\t', '')), '') REGEXP '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
                  AND CAST(RIGHT(NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.end_of_life_date, '\r', ''), '\n', ''), '\t', '')), ''), 2) AS UNSIGNED) <= DAY(LAST_DAY(CONCAT(LEFT(NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.end_of_life_date, '\r', ''), '\n', ''), '\t', '')), ''), 7), '-01')))
             THEN STR_TO_DATE(NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.end_of_life_date, '\r', ''), '\n', ''), '\t', '')), ''), '%Y-%m-%d') END AS end_of_life_date,
                CASE WHEN NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.extended_support_end_date, '\r', ''), '\n', ''), '\t', '')), '') REGEXP '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
                  AND CAST(RIGHT(NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.extended_support_end_date, '\r', ''), '\n', ''), '\t', '')), ''), 2) AS UNSIGNED) <= DAY(LAST_DAY(CONCAT(LEFT(NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.extended_support_end_date, '\r', ''), '\n', ''), '\t', '')), ''), 7), '-01')))
             THEN STR_TO_DATE(NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.extended_support_end_date, '\r', ''), '\n', ''), '\t', '')), ''), '%Y-%m-%d') END AS extended_support_end_date,
                CASE WHEN NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.obsolete_date, '\r', ''), '\n', ''), '\t', '')), '') REGEXP '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
                  AND CAST(RIGHT(NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.obsolete_date, '\r', ''), '\n', ''), '\t', '')), ''), 2) AS UNSIGNED) <= DAY(LAST_DAY(CONCAT(LEFT(NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.obsolete_date, '\r', ''), '\n', ''), '\t', '')), ''), 7), '-01')))
             THEN STR_TO_DATE(NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.obsolete_date, '\r', ''), '\n', ''), '\t', '')), ''), '%Y-%m-%d') END AS obsolete_date,
                CASE WHEN NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.aging_start_date, '\r', ''), '\n', ''), '\t', '')), '') REGEXP '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
                  AND CAST(RIGHT(NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.aging_start_date, '\r', ''), '\n', ''), '\t', '')), ''), 2) AS UNSIGNED) <= DAY(LAST_DAY(CONCAT(LEFT(NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.aging_start_date, '\r', ''), '\n', ''), '\t', '')), ''), 7), '-01')))
             THEN STR_TO_DATE(NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.aging_start_date, '\r', ''), '\n', ''), '\t', '')), ''), '%Y-%m-%d') END AS aging_start_date,
                NULLIF(TRIM(REPLACE(REPLACE(REPLACE(s.potential_aging_cause, '\r', ''), '\n', ''), '\t', '')), '') AS potential_aging_cause
            FROM staging_installs s
        ) AS r
    ) AS e
) AS t
JOIN hosts    h ON h.ci_id = t.ci_id
JOIN products p ON p.technopedia_release_id = t.technopedia_release_id
WHERE t.snapshot_date IS NOT NULL
  AND t.install_id IS NOT NULL
  AND t.rn = 1;   -- one row per (snapshot_date, install_id) if the CSV was imported twice

COMMIT;

-- ---- verification -----------------------------------------------------------
SELECT (SELECT COUNT(*) FROM staging_installs) AS staging_rows,
       (SELECT COUNT(*) FROM installs)         AS installs_rows,
       (SELECT COUNT(*) FROM staging_installs) - (SELECT COUNT(*) FROM installs) AS not_loaded;

SELECT snapshot_date, COUNT(*) AS installs_rows FROM installs GROUP BY snapshot_date ORDER BY snapshot_date;

SELECT i.eos_status, COUNT(*) AS installs,
       ROUND(100 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS pct
FROM installs i
WHERE i.snapshot_date = (SELECT MAX(snapshot_date) FROM installs)
GROUP BY i.eos_status
ORDER BY FIELD(i.eos_status, 'Past EOS', 'Extended', 'Supported', 'Unknown');

SELECT
    (SELECT COUNT(*) FROM installs i LEFT JOIN snapshots s ON s.snapshot_date = i.snapshot_date WHERE s.snapshot_date IS NULL) AS orphan_snapshot,
    (SELECT COUNT(*) FROM installs i LEFT JOIN hosts h     ON h.host_key = i.host_key           WHERE h.host_key IS NULL)      AS orphan_host,
    (SELECT COUNT(*) FROM installs i LEFT JOIN products p  ON p.release_key = i.release_key     WHERE p.release_key IS NULL)   AS orphan_product,
    (SELECT COUNT(*) FROM (SELECT 1 FROM installs GROUP BY snapshot_date, install_id HAVING COUNT(*) > 1) x) AS duplicate_installs;
