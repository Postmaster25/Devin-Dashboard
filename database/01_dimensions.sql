-- =============================================================================
-- 01_dimensions.sql  -  EOS star schema: cleaned staging view + dimensions
-- MySQL 8.0+. Idempotent: safe to re-run; dimension rows are upserted.
--
-- Input : staging_installs  (all TEXT columns, imported from
--         software_itam_eos_snapshots.csv with the Workbench Table Data
--         Import Wizard). Run this in the schema that holds staging_installs.
-- Output: v_staging_installs (view), snapshots, hosts, products
--
-- Date handling
--   Every value is cleaned with NULLIF(TRIM(...), '') (after stripping CR/LF/TAB
--   that the wizard can leave behind), then parsed with
--   STR_TO_DATE(value, '%Y-%m-%d').
--   STR_TO_DATE alone is not enough under the default STRICT_TRANS_TABLES
--   sql_mode: an impossible date such as '2026-02-30' or 'not a date' returns
--   NULL in a SELECT, but makes INSERT ... SELECT fail with error 1411/1292.
--   So each date is only passed to STR_TO_DATE after a YYYY-MM-DD pattern
--   check and a day-of-month check. Malformed values become NULL silently;
--   03_verify.sql reports how many were dropped per column.
-- =============================================================================

CREATE OR REPLACE VIEW v_staging_installs AS
SELECT
    CASE WHEN c.snapshot_date REGEXP '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' THEN
        CASE WHEN CAST(RIGHT(c.snapshot_date, 2) AS UNSIGNED) <= DAY(LAST_DAY(CONCAT(LEFT(c.snapshot_date, 7), '-01')))
             THEN STR_TO_DATE(c.snapshot_date, '%Y-%m-%d') END
    END AS snapshot_date,
    c.install_id,
    c.normalized_product_name,
    c.normalized_version,
    c.normalized_manufacturer,
    c.edition,
    c.product_category,
    CASE WHEN c.install_date REGEXP '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' THEN
        CASE WHEN CAST(RIGHT(c.install_date, 2) AS UNSIGNED) <= DAY(LAST_DAY(CONCAT(LEFT(c.install_date, 7), '-01')))
             THEN STR_TO_DATE(c.install_date, '%Y-%m-%d') END
    END AS install_date,
    CASE WHEN c.last_scanned_date REGEXP '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' THEN
        CASE WHEN CAST(RIGHT(c.last_scanned_date, 2) AS UNSIGNED) <= DAY(LAST_DAY(CONCAT(LEFT(c.last_scanned_date, 7), '-01')))
             THEN STR_TO_DATE(c.last_scanned_date, '%Y-%m-%d') END
    END AS last_scanned_date,
    c.discovery_source,
    c.software_operational_status,
    c.technopedia_product_id,
    c.technopedia_release_id,
    CASE WHEN c.general_availability_date REGEXP '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' THEN
        CASE WHEN CAST(RIGHT(c.general_availability_date, 2) AS UNSIGNED) <= DAY(LAST_DAY(CONCAT(LEFT(c.general_availability_date, 7), '-01')))
             THEN STR_TO_DATE(c.general_availability_date, '%Y-%m-%d') END
    END AS general_availability_date,
    CASE WHEN c.end_of_life_date REGEXP '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' THEN
        CASE WHEN CAST(RIGHT(c.end_of_life_date, 2) AS UNSIGNED) <= DAY(LAST_DAY(CONCAT(LEFT(c.end_of_life_date, 7), '-01')))
             THEN STR_TO_DATE(c.end_of_life_date, '%Y-%m-%d') END
    END AS end_of_life_date,
    CASE WHEN c.extended_support_end_date REGEXP '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' THEN
        CASE WHEN CAST(RIGHT(c.extended_support_end_date, 2) AS UNSIGNED) <= DAY(LAST_DAY(CONCAT(LEFT(c.extended_support_end_date, 7), '-01')))
             THEN STR_TO_DATE(c.extended_support_end_date, '%Y-%m-%d') END
    END AS extended_support_end_date,
    CASE WHEN c.obsolete_date REGEXP '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' THEN
        CASE WHEN CAST(RIGHT(c.obsolete_date, 2) AS UNSIGNED) <= DAY(LAST_DAY(CONCAT(LEFT(c.obsolete_date, 7), '-01')))
             THEN STR_TO_DATE(c.obsolete_date, '%Y-%m-%d') END
    END AS obsolete_date,
    c.ci_id,
    c.host_name,
    c.ci_type,
    c.environment,
    c.host_operational_status,
    c.business_criticality,
    c.address,
    c.city,
    c.state,
    c.country,
    c.managed_by_group,
    c.managed_by_group_manager_name,
    c.cio_org_name,
    c.cio_org_manager_name,
    c.cost_center,
    CASE WHEN c.host_last_discovered_date REGEXP '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' THEN
        CASE WHEN CAST(RIGHT(c.host_last_discovered_date, 2) AS UNSIGNED) <= DAY(LAST_DAY(CONCAT(LEFT(c.host_last_discovered_date, 7), '-01')))
             THEN STR_TO_DATE(c.host_last_discovered_date, '%Y-%m-%d') END
    END AS host_last_discovered_date,
    CASE WHEN c.aging_start_date REGEXP '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' THEN
        CASE WHEN CAST(RIGHT(c.aging_start_date, 2) AS UNSIGNED) <= DAY(LAST_DAY(CONCAT(LEFT(c.aging_start_date, 7), '-01')))
             THEN STR_TO_DATE(c.aging_start_date, '%Y-%m-%d') END
    END AS aging_start_date,
    c.potential_aging_cause
FROM (
    SELECT
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(snapshot_date, '\r', ''), '\n', ''), '\t', '')), '')                 AS snapshot_date,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(install_id, '\r', ''), '\n', ''), '\t', '')), '')                    AS install_id,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(normalized_product_name, '\r', ''), '\n', ''), '\t', '')), '')       AS normalized_product_name,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(normalized_version, '\r', ''), '\n', ''), '\t', '')), '')            AS normalized_version,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(normalized_manufacturer, '\r', ''), '\n', ''), '\t', '')), '')       AS normalized_manufacturer,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(edition, '\r', ''), '\n', ''), '\t', '')), '')                       AS edition,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(product_category, '\r', ''), '\n', ''), '\t', '')), '')              AS product_category,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(install_date, '\r', ''), '\n', ''), '\t', '')), '')                  AS install_date,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(last_scanned_date, '\r', ''), '\n', ''), '\t', '')), '')             AS last_scanned_date,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(discovery_source, '\r', ''), '\n', ''), '\t', '')), '')              AS discovery_source,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(software_operational_status, '\r', ''), '\n', ''), '\t', '')), '')   AS software_operational_status,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(technopedia_product_id, '\r', ''), '\n', ''), '\t', '')), '')        AS technopedia_product_id,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(technopedia_release_id, '\r', ''), '\n', ''), '\t', '')), '')        AS technopedia_release_id,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(general_availability_date, '\r', ''), '\n', ''), '\t', '')), '')     AS general_availability_date,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(end_of_life_date, '\r', ''), '\n', ''), '\t', '')), '')              AS end_of_life_date,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(extended_support_end_date, '\r', ''), '\n', ''), '\t', '')), '')     AS extended_support_end_date,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(obsolete_date, '\r', ''), '\n', ''), '\t', '')), '')                 AS obsolete_date,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(ci_id, '\r', ''), '\n', ''), '\t', '')), '')                         AS ci_id,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(host_name, '\r', ''), '\n', ''), '\t', '')), '')                     AS host_name,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(ci_type, '\r', ''), '\n', ''), '\t', '')), '')                       AS ci_type,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(environment, '\r', ''), '\n', ''), '\t', '')), '')                   AS environment,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(host_operational_status, '\r', ''), '\n', ''), '\t', '')), '')       AS host_operational_status,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(business_criticality, '\r', ''), '\n', ''), '\t', '')), '')          AS business_criticality,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(address, '\r', ''), '\n', ''), '\t', '')), '')                       AS address,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(city, '\r', ''), '\n', ''), '\t', '')), '')                          AS city,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(state, '\r', ''), '\n', ''), '\t', '')), '')                         AS state,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(country, '\r', ''), '\n', ''), '\t', '')), '')                       AS country,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(managed_by_group, '\r', ''), '\n', ''), '\t', '')), '')              AS managed_by_group,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(managed_by_group_manager_name, '\r', ''), '\n', ''), '\t', '')), '') AS managed_by_group_manager_name,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(cio_org_name, '\r', ''), '\n', ''), '\t', '')), '')                  AS cio_org_name,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(cio_org_manager_name, '\r', ''), '\n', ''), '\t', '')), '')          AS cio_org_manager_name,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(cost_center, '\r', ''), '\n', ''), '\t', '')), '')                   AS cost_center,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(host_last_discovered_date, '\r', ''), '\n', ''), '\t', '')), '')     AS host_last_discovered_date,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(aging_start_date, '\r', ''), '\n', ''), '\t', '')), '')              AS aging_start_date,
        NULLIF(TRIM(REPLACE(REPLACE(REPLACE(potential_aging_cause, '\r', ''), '\n', ''), '\t', '')), '')         AS potential_aging_cause
    FROM staging_installs
) AS c;

-- -----------------------------------------------------------------------------
-- snapshots  (one row per snapshot_date)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS snapshots (
    snapshot_date      DATE         NOT NULL,
    snapshot_number    INT UNSIGNED NOT NULL,
    snapshot_label     VARCHAR(20)  NOT NULL,
    is_latest_snapshot TINYINT(1)   NOT NULL DEFAULT 0,
    PRIMARY KEY (snapshot_date)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

INSERT INTO snapshots (snapshot_date, snapshot_number, snapshot_label, is_latest_snapshot)
SELECT src.snapshot_date, src.snapshot_number, src.snapshot_label, src.is_latest_snapshot
FROM (
    SELECT
        snapshot_date,
        ROW_NUMBER() OVER (ORDER BY snapshot_date)                          AS snapshot_number,
        DATE_FORMAT(snapshot_date, '%b %e, %Y')                             AS snapshot_label,
        CASE WHEN snapshot_date = MAX(snapshot_date) OVER () THEN 1 ELSE 0 END AS is_latest_snapshot
    FROM v_staging_installs
    WHERE snapshot_date IS NOT NULL
    GROUP BY snapshot_date
) AS src
ON DUPLICATE KEY UPDATE
    snapshot_number    = src.snapshot_number,
    snapshot_label     = src.snapshot_label,
    is_latest_snapshot = src.is_latest_snapshot;

-- Snapshots left over from an earlier staging load must not stay flagged as
-- latest. SQL_SAFE_UPDATES (on by default in Workbench) would block this
-- full-table UPDATE with error 1175, so it is switched off just for it.
SET @eos_old_safe_updates = @@SESSION.sql_safe_updates;
SET SESSION sql_safe_updates = 0;
UPDATE snapshots
SET is_latest_snapshot = CASE WHEN snapshot_date = (SELECT MAX(snapshot_date) FROM v_staging_installs) THEN 1 ELSE 0 END;
SET SESSION sql_safe_updates = @eos_old_safe_updates;

-- -----------------------------------------------------------------------------
-- hosts  (one row per ci_id; attributes are constant per host in the source)
-- host_operational_status and host_last_discovered_date change per snapshot,
-- so they live on installs instead.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hosts (
    ci_id                         VARCHAR(64)  NOT NULL,
    host_name                     VARCHAR(255) NULL,
    ci_type                       VARCHAR(100) NULL,
    environment                   VARCHAR(100) NULL,
    business_criticality          VARCHAR(100) NULL,
    address                       VARCHAR(255) NULL,
    city                          VARCHAR(100) NULL,
    state                         VARCHAR(100) NULL,
    country                       VARCHAR(100) NULL,
    managed_by_group              VARCHAR(255) NULL,
    managed_by_group_manager_name VARCHAR(255) NULL,
    cio_org_name                  VARCHAR(255) NULL,
    cio_org_manager_name          VARCHAR(255) NULL,
    cost_center                   VARCHAR(64)  NULL,
    PRIMARY KEY (ci_id),
    KEY ix_hosts_managed_by_group (managed_by_group),
    KEY ix_hosts_cio_org_name (cio_org_name)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

INSERT INTO hosts (ci_id, host_name, ci_type, environment, business_criticality, address, city, state, country,
                   managed_by_group, managed_by_group_manager_name, cio_org_name, cio_org_manager_name, cost_center)
SELECT src.*
FROM (
    SELECT
        ci_id,
        MAX(host_name)                     AS host_name,
        MAX(ci_type)                       AS ci_type,
        MAX(environment)                   AS environment,
        MAX(business_criticality)          AS business_criticality,
        MAX(address)                       AS address,
        MAX(city)                          AS city,
        MAX(state)                         AS state,
        MAX(country)                       AS country,
        MAX(managed_by_group)              AS managed_by_group,
        MAX(managed_by_group_manager_name) AS managed_by_group_manager_name,
        MAX(cio_org_name)                  AS cio_org_name,
        MAX(cio_org_manager_name)          AS cio_org_manager_name,
        MAX(cost_center)                   AS cost_center
    FROM v_staging_installs
    WHERE ci_id IS NOT NULL
    GROUP BY ci_id
) AS src
ON DUPLICATE KEY UPDATE
    host_name                     = src.host_name,
    ci_type                       = src.ci_type,
    environment                   = src.environment,
    business_criticality          = src.business_criticality,
    address                       = src.address,
    city                          = src.city,
    state                         = src.state,
    country                       = src.country,
    managed_by_group              = src.managed_by_group,
    managed_by_group_manager_name = src.managed_by_group_manager_name,
    cio_org_name                  = src.cio_org_name,
    cio_org_manager_name          = src.cio_org_manager_name,
    cost_center                   = src.cost_center;

-- -----------------------------------------------------------------------------
-- products  (one row per technopedia_release_id; lifecycle dates are constant
-- per release in the source). edition varies per install, so it lives on
-- installs.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
    technopedia_release_id    VARCHAR(64)  NOT NULL,
    technopedia_product_id    VARCHAR(64)  NULL,
    normalized_product_name   VARCHAR(255) NULL,
    normalized_version        VARCHAR(100) NULL,
    normalized_manufacturer   VARCHAR(255) NULL,
    product_category          VARCHAR(100) NULL,
    general_availability_date DATE         NULL,
    end_of_life_date          DATE         NULL,
    extended_support_end_date DATE         NULL,
    obsolete_date             DATE         NULL,
    effective_eos_date        DATE         NULL,
    eos_basis                 VARCHAR(30)  NOT NULL,
    PRIMARY KEY (technopedia_release_id),
    KEY ix_products_name_version (normalized_product_name, normalized_version)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

INSERT INTO products (technopedia_release_id, technopedia_product_id, normalized_product_name, normalized_version,
                      normalized_manufacturer, product_category, general_availability_date, end_of_life_date,
                      extended_support_end_date, obsolete_date, effective_eos_date, eos_basis)
SELECT src.*
FROM (
    SELECT
        g.technopedia_release_id, g.technopedia_product_id, g.normalized_product_name, g.normalized_version,
        g.normalized_manufacturer, g.product_category, g.general_availability_date, g.end_of_life_date,
        g.extended_support_end_date, g.obsolete_date,
        COALESCE(g.extended_support_end_date, g.obsolete_date, g.end_of_life_date) AS effective_eos_date,
        CASE
            WHEN g.extended_support_end_date IS NOT NULL THEN 'Extended support end'
            WHEN g.obsolete_date             IS NOT NULL THEN 'Obsolete'
            WHEN g.end_of_life_date          IS NOT NULL THEN 'End of life'
            ELSE 'None'
        END AS eos_basis
    FROM (
        SELECT
            technopedia_release_id,
            MAX(technopedia_product_id)    AS technopedia_product_id,
            MAX(normalized_product_name)   AS normalized_product_name,
            MAX(normalized_version)        AS normalized_version,
            MAX(normalized_manufacturer)   AS normalized_manufacturer,
            MAX(product_category)          AS product_category,
            MAX(general_availability_date) AS general_availability_date,
            MAX(end_of_life_date)          AS end_of_life_date,
            MAX(extended_support_end_date) AS extended_support_end_date,
            MAX(obsolete_date)             AS obsolete_date
        FROM v_staging_installs
        WHERE technopedia_release_id IS NOT NULL
        GROUP BY technopedia_release_id
    ) AS g
) AS src
ON DUPLICATE KEY UPDATE
    technopedia_product_id    = src.technopedia_product_id,
    normalized_product_name   = src.normalized_product_name,
    normalized_version        = src.normalized_version,
    normalized_manufacturer   = src.normalized_manufacturer,
    product_category          = src.product_category,
    general_availability_date = src.general_availability_date,
    end_of_life_date          = src.end_of_life_date,
    extended_support_end_date = src.extended_support_end_date,
    obsolete_date             = src.obsolete_date,
    effective_eos_date        = src.effective_eos_date,
    eos_basis                 = src.eos_basis;
