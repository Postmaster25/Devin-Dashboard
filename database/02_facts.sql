-- =============================================================================
-- 02_facts.sql  -  EOS star schema: installs fact table
-- MySQL 8.0+. Idempotent: installs is truncated and fully reloaded each run.
-- Run 01_dimensions.sql first (it creates v_staging_installs and the
-- dimension tables that installs references).
--
-- Grain : one row per (snapshot_date, install_id).
-- Derived columns use the same rules as the EOS dashboard:
--   effective_eos_date = COALESCE(extended_support_end_date, obsolete_date, end_of_life_date)
--   eos_status         = 'Unknown'   when effective_eos_date IS NULL
--                        'Past EOS'  when effective_eos_date <= snapshot_date
--                        'Extended'  when end_of_life_date   <= snapshot_date (still in extended support)
--                        'Supported' otherwise
--   eos_status_order   = 1 Past EOS, 2 Extended, 3 Supported, 4 Unknown
--   is_past_eos        = 1 when eos_status = 'Past EOS', else 0
--   days_past_eos      = DATEDIFF(snapshot_date, effective_eos_date) when Past EOS, else NULL
--   days_non_compliant = DATEDIFF(snapshot_date, aging_start_date) when aging_start_date is set, else NULL
-- The lifecycle dates come from each staging row (as in the dashboard), not
-- from products.
--
-- Rows are skipped when snapshot_date, install_id, ci_id or
-- technopedia_release_id is blank/malformed; exact duplicates of
-- (snapshot_date, install_id), e.g. from importing the CSV twice, are loaded
-- once. 03_verify.sql reports both.
-- =============================================================================

CREATE TABLE IF NOT EXISTS installs (
    snapshot_date               DATE             NOT NULL,
    install_id                  VARCHAR(64)      NOT NULL,
    ci_id                       VARCHAR(64)      NOT NULL,
    technopedia_release_id      VARCHAR(64)      NOT NULL,
    edition                     VARCHAR(100)     NULL,
    install_date                DATE             NULL,
    last_scanned_date           DATE             NULL,
    discovery_source            VARCHAR(100)     NULL,
    software_operational_status VARCHAR(100)     NULL,
    host_operational_status     VARCHAR(100)     NULL,
    host_last_discovered_date   DATE             NULL,
    aging_start_date            DATE             NULL,
    potential_aging_cause       VARCHAR(255)     NULL,
    effective_eos_date          DATE             NULL,
    eos_status                  VARCHAR(10)      NOT NULL,
    eos_status_order            TINYINT UNSIGNED NOT NULL,
    is_past_eos                 TINYINT UNSIGNED NOT NULL,
    days_past_eos               INT              NULL,
    days_non_compliant          INT              NULL,
    PRIMARY KEY (snapshot_date, install_id),
    KEY ix_installs_ci_id (ci_id),
    KEY ix_installs_release (technopedia_release_id),
    KEY ix_installs_snapshot_status (snapshot_date, eos_status),
    CONSTRAINT fk_installs_snapshot FOREIGN KEY (snapshot_date)          REFERENCES snapshots (snapshot_date),
    CONSTRAINT fk_installs_host     FOREIGN KEY (ci_id)                  REFERENCES hosts (ci_id),
    CONSTRAINT fk_installs_product  FOREIGN KEY (technopedia_release_id) REFERENCES products (technopedia_release_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

TRUNCATE TABLE installs;

INSERT INTO installs (snapshot_date, install_id, ci_id, technopedia_release_id, edition, install_date,
                      last_scanned_date, discovery_source, software_operational_status, host_operational_status,
                      host_last_discovered_date, aging_start_date, potential_aging_cause, effective_eos_date,
                      eos_status, eos_status_order, is_past_eos, days_past_eos, days_non_compliant)
SELECT
    st.snapshot_date, st.install_id, st.ci_id, st.technopedia_release_id, st.edition, st.install_date,
    st.last_scanned_date, st.discovery_source, st.software_operational_status, st.host_operational_status,
    st.host_last_discovered_date, st.aging_start_date, st.potential_aging_cause, st.effective_eos_date,
    st.eos_status,
    CASE st.eos_status WHEN 'Past EOS' THEN 1 WHEN 'Extended' THEN 2 WHEN 'Supported' THEN 3 ELSE 4 END,
    CASE WHEN st.eos_status = 'Past EOS' THEN 1 ELSE 0 END,
    CASE WHEN st.eos_status = 'Past EOS' THEN DATEDIFF(st.snapshot_date, st.effective_eos_date) END,
    CASE WHEN st.aging_start_date IS NOT NULL THEN DATEDIFF(st.snapshot_date, st.aging_start_date) END
FROM (
    SELECT
        e.*,
        CASE
            WHEN e.effective_eos_date IS NULL                                       THEN 'Unknown'
            WHEN e.effective_eos_date <= e.snapshot_date                            THEN 'Past EOS'
            WHEN e.end_of_life_date IS NOT NULL AND e.end_of_life_date <= e.snapshot_date THEN 'Extended'
            ELSE 'Supported'
        END AS eos_status
    FROM (
        SELECT
            v.*,
            COALESCE(v.extended_support_end_date, v.obsolete_date, v.end_of_life_date) AS effective_eos_date,
            ROW_NUMBER() OVER (PARTITION BY v.snapshot_date, v.install_id ORDER BY v.snapshot_date) AS dup_rank
        FROM v_staging_installs v
        WHERE v.snapshot_date          IS NOT NULL
          AND v.install_id             IS NOT NULL
          AND v.ci_id                  IS NOT NULL
          AND v.technopedia_release_id IS NOT NULL
    ) AS e
    WHERE e.dup_rank = 1
) AS st;
