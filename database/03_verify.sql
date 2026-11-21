-- =============================================================================
-- 03_verify.sql  -  sanity checks for the EOS star schema (read-only)
-- Run after 01_dimensions.sql and 02_facts.sql. Each query returns a small
-- result set; in Workbench every query opens its own Result tab.
-- A check with a `status` column returns 'OK' or 'CHECK' per row.
-- =============================================================================

-- 1. Row counts: staging vs installs -------------------------------------------
SELECT
    t.staging_rows,
    t.rejected_rows,
    t.staging_rows - t.rejected_rows - t.loadable_distinct AS duplicate_rows,
    t.loadable_distinct                                     AS expected_installs,
    (SELECT COUNT(*) FROM installs)                         AS installs_rows,
    CASE WHEN (SELECT COUNT(*) FROM installs) = t.loadable_distinct THEN 'OK' ELSE 'CHECK' END AS status
FROM (
    SELECT
        COUNT(*) AS staging_rows,
        SUM(snapshot_date IS NULL OR install_id IS NULL OR ci_id IS NULL OR technopedia_release_id IS NULL) AS rejected_rows,
        COUNT(DISTINCT CASE WHEN ci_id IS NOT NULL AND technopedia_release_id IS NOT NULL
                            THEN CONCAT(snapshot_date, '|', install_id) END)                       AS loadable_distinct
    FROM v_staging_installs
) AS t;

-- 2. Row counts per snapshot (duplicates and rejected rows are excluded from
--    expected_installs, so status is OK even when staging has them)
SELECT
    s.snapshot_number,
    s.snapshot_date,
    s.is_latest_snapshot,
    COALESCE(st.staging_rows, 0)      AS staging_rows,
    COALESCE(st.expected_installs, 0) AS expected_installs,
    COALESCE(i.installs_rows, 0)      AS installs_rows,
    CASE WHEN COALESCE(st.expected_installs, 0) = COALESCE(i.installs_rows, 0) THEN 'OK' ELSE 'CHECK' END AS status
FROM snapshots s
LEFT JOIN (
    SELECT snapshot_date,
           COUNT(*) AS staging_rows,
           COUNT(DISTINCT CASE WHEN install_id IS NOT NULL AND ci_id IS NOT NULL AND technopedia_release_id IS NOT NULL
                               THEN install_id END) AS expected_installs
    FROM v_staging_installs
    WHERE snapshot_date IS NOT NULL
    GROUP BY snapshot_date
) AS st ON st.snapshot_date = s.snapshot_date
LEFT JOIN (
    SELECT snapshot_date, COUNT(*) AS installs_rows FROM installs GROUP BY snapshot_date
) AS i ON i.snapshot_date = s.snapshot_date
ORDER BY s.snapshot_date;

-- 3. Dimension row counts vs distinct natural keys in staging --------------------
SELECT 'snapshots' AS dimension, (SELECT COUNT(*) FROM snapshots) AS dim_rows,
       (SELECT COUNT(DISTINCT snapshot_date) FROM v_staging_installs) AS staging_distinct_keys
UNION ALL
SELECT 'hosts', (SELECT COUNT(*) FROM hosts),
       (SELECT COUNT(DISTINCT ci_id) FROM v_staging_installs)
UNION ALL
SELECT 'products', (SELECT COUNT(*) FROM products),
       (SELECT COUNT(DISTINCT technopedia_release_id) FROM v_staging_installs);

-- 4. Date values that were non-blank in staging but did not parse (became NULL)
--    All zeros = clean. Non-zero values are listed in 4b.
SELECT
    r.snapshot_date - p.snapshot_date             AS bad_snapshot_date,
    r.install_date - p.install_date              AS bad_install_date,
    r.last_scanned_date - p.last_scanned_date         AS bad_last_scanned_date,
    r.general_availability_date - p.general_availability_date AS bad_general_availability_date,
    r.end_of_life_date - p.end_of_life_date          AS bad_end_of_life_date,
    r.extended_support_end_date - p.extended_support_end_date AS bad_extended_support_end_date,
    r.obsolete_date - p.obsolete_date             AS bad_obsolete_date,
    r.host_last_discovered_date - p.host_last_discovered_date AS bad_host_last_discovered_date,
    r.aging_start_date - p.aging_start_date          AS bad_aging_start_date
FROM (
    SELECT
        SUM(NULLIF(TRIM(REPLACE(REPLACE(REPLACE(snapshot_date, '\r', ''), '\n', ''), '\t', '')), '') IS NOT NULL)             AS snapshot_date,
        SUM(NULLIF(TRIM(REPLACE(REPLACE(REPLACE(install_date, '\r', ''), '\n', ''), '\t', '')), '') IS NOT NULL)              AS install_date,
        SUM(NULLIF(TRIM(REPLACE(REPLACE(REPLACE(last_scanned_date, '\r', ''), '\n', ''), '\t', '')), '') IS NOT NULL)         AS last_scanned_date,
        SUM(NULLIF(TRIM(REPLACE(REPLACE(REPLACE(general_availability_date, '\r', ''), '\n', ''), '\t', '')), '') IS NOT NULL) AS general_availability_date,
        SUM(NULLIF(TRIM(REPLACE(REPLACE(REPLACE(end_of_life_date, '\r', ''), '\n', ''), '\t', '')), '') IS NOT NULL)          AS end_of_life_date,
        SUM(NULLIF(TRIM(REPLACE(REPLACE(REPLACE(extended_support_end_date, '\r', ''), '\n', ''), '\t', '')), '') IS NOT NULL) AS extended_support_end_date,
        SUM(NULLIF(TRIM(REPLACE(REPLACE(REPLACE(obsolete_date, '\r', ''), '\n', ''), '\t', '')), '') IS NOT NULL)             AS obsolete_date,
        SUM(NULLIF(TRIM(REPLACE(REPLACE(REPLACE(host_last_discovered_date, '\r', ''), '\n', ''), '\t', '')), '') IS NOT NULL) AS host_last_discovered_date,
        SUM(NULLIF(TRIM(REPLACE(REPLACE(REPLACE(aging_start_date, '\r', ''), '\n', ''), '\t', '')), '') IS NOT NULL)          AS aging_start_date
    FROM staging_installs
) AS r
CROSS JOIN (
    SELECT
        COUNT(snapshot_date)             AS snapshot_date,
        COUNT(install_date)              AS install_date,
        COUNT(last_scanned_date)         AS last_scanned_date,
        COUNT(general_availability_date) AS general_availability_date,
        COUNT(end_of_life_date)          AS end_of_life_date,
        COUNT(extended_support_end_date) AS extended_support_end_date,
        COUNT(obsolete_date)             AS obsolete_date,
        COUNT(host_last_discovered_date) AS host_last_discovered_date,
        COUNT(aging_start_date)          AS aging_start_date
    FROM v_staging_installs
) AS p;

-- 4b. Sample of the raw values that did not parse (up to 20) --------------------
SELECT col, raw_value, COUNT(*) AS occurrences
FROM (
    SELECT 'snapshot_date' AS col, snapshot_date AS raw_value FROM staging_installs
    UNION ALL SELECT 'install_date',              install_date              FROM staging_installs
    UNION ALL SELECT 'last_scanned_date',         last_scanned_date         FROM staging_installs
    UNION ALL SELECT 'general_availability_date', general_availability_date FROM staging_installs
    UNION ALL SELECT 'end_of_life_date',          end_of_life_date          FROM staging_installs
    UNION ALL SELECT 'extended_support_end_date', extended_support_end_date FROM staging_installs
    UNION ALL SELECT 'obsolete_date',             obsolete_date             FROM staging_installs
    UNION ALL SELECT 'host_last_discovered_date', host_last_discovered_date FROM staging_installs
    UNION ALL SELECT 'aging_start_date',          aging_start_date          FROM staging_installs
) AS d
WHERE NULLIF(TRIM(REPLACE(REPLACE(REPLACE(raw_value, '\r', ''), '\n', ''), '\t', '')), '') IS NOT NULL
  AND NOT (TRIM(REPLACE(REPLACE(REPLACE(raw_value, '\r', ''), '\n', ''), '\t', ''))
           REGEXP '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
       AND CAST(RIGHT(TRIM(REPLACE(REPLACE(REPLACE(raw_value, '\r', ''), '\n', ''), '\t', '')), 2) AS UNSIGNED)
           <= DAY(LAST_DAY(CONCAT(LEFT(TRIM(REPLACE(REPLACE(REPLACE(raw_value, '\r', ''), '\n', ''), '\t', '')), 7), '-01'))))
GROUP BY col, raw_value
ORDER BY occurrences DESC
LIMIT 20;

-- 5. eos_status distribution at the latest snapshot ------------------------------
SELECT
    i.eos_status,
    COUNT(*)                                             AS installs,
    ROUND(100 * COUNT(*) / SUM(COUNT(*)) OVER (), 2)     AS pct_of_installs
FROM installs i
JOIN snapshots s ON s.snapshot_date = i.snapshot_date AND s.is_latest_snapshot = 1
GROUP BY i.eos_status, i.eos_status_order
ORDER BY i.eos_status_order;

-- 6. % past EOS per snapshot (latest flagged); RAG: <=3% Green, <=5% Amber, else Red
SELECT
    s.snapshot_date,
    s.is_latest_snapshot,
    COUNT(*)                                   AS installs,
    SUM(i.is_past_eos)                         AS installs_past_eos,
    ROUND(100 * SUM(i.is_past_eos) / COUNT(*), 2) AS pct_past_eos,
    CASE WHEN SUM(i.is_past_eos) / COUNT(*) <= 0.03 THEN 'Green'
         WHEN SUM(i.is_past_eos) / COUNT(*) <= 0.05 THEN 'Amber'
         ELSE 'Red' END                        AS rag
FROM installs i
JOIN snapshots s ON s.snapshot_date = i.snapshot_date
GROUP BY s.snapshot_date, s.is_latest_snapshot
ORDER BY s.snapshot_date;

-- 7. Orphan keys: installs without a dimension row, and dimension rows with no installs
SELECT 'installs -> snapshots' AS check_name, COUNT(*) AS orphan_rows,
       CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'CHECK' END AS status
FROM installs i LEFT JOIN snapshots s ON s.snapshot_date = i.snapshot_date WHERE s.snapshot_date IS NULL
UNION ALL
SELECT 'installs -> hosts', COUNT(*), CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'CHECK' END
FROM installs i LEFT JOIN hosts h ON h.ci_id = i.ci_id WHERE h.ci_id IS NULL
UNION ALL
SELECT 'installs -> products', COUNT(*), CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'CHECK' END
FROM installs i LEFT JOIN products p ON p.technopedia_release_id = i.technopedia_release_id WHERE p.technopedia_release_id IS NULL
UNION ALL
SELECT 'snapshots without installs', COUNT(*), CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'CHECK' END
FROM snapshots s WHERE NOT EXISTS (SELECT 1 FROM installs i WHERE i.snapshot_date = s.snapshot_date)
UNION ALL
SELECT 'hosts without installs', COUNT(*), CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'CHECK' END
FROM hosts h WHERE NOT EXISTS (SELECT 1 FROM installs i WHERE i.ci_id = h.ci_id)
UNION ALL
SELECT 'products without installs', COUNT(*), CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'CHECK' END
FROM products p WHERE NOT EXISTS (SELECT 1 FROM installs i WHERE i.technopedia_release_id = p.technopedia_release_id);

-- 8. Derived-column consistency (every count should be 0) -----------------------
SELECT
    SUM(eos_status NOT IN ('Unknown', 'Past EOS', 'Extended', 'Supported'))           AS bad_status_value,
    SUM((eos_status = 'Unknown') <> (effective_eos_date IS NULL))                     AS unknown_mismatch,
    SUM(is_past_eos <> (eos_status = 'Past EOS'))                                     AS is_past_eos_mismatch,
    SUM(eos_status = 'Past EOS' AND (days_past_eos IS NULL OR days_past_eos < 0))     AS bad_days_past_eos,
    SUM(eos_status <> 'Past EOS' AND days_past_eos IS NOT NULL)                       AS unexpected_days_past_eos,
    SUM((aging_start_date IS NULL) <> (days_non_compliant IS NULL))                   AS days_non_compliant_mismatch,
    SUM(eos_status = 'Supported' AND effective_eos_date <= snapshot_date)             AS supported_but_past
FROM installs;
