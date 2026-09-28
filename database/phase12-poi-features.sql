-- =====================================================================
-- Phase 12 — relevance-cap features on the POI tables (features_version 1)
-- =====================================================================
-- Adds pois.q / cat / flags (written by scripts/poi/build.mjs from
-- shared/poiRank.mjs, re-checked by api/admin/poi-load.js toPoiRow) and
-- the covering index ix_rank that api/lib/poiQuery.js reads in phase 1 of a
-- capped Discover answer. Same shape as database/phase11-pois.sql, which a
-- fresh database uses instead of this file.
--
-- Tables: pois, pois_prev (the rollback target) and pois_staging (a load in
-- progress: begin RESUMES a half-loaded staging table rather than re-creating
-- it, so staging made before this migration must be altered too), each only
-- if it exists. Nothing else is touched.
--
-- Serving is unaffected: the existing rows get q = cat = flags = 0, and their
-- build has no features_version in its gate_report, so it is served exactly as
-- before (uncapped) until a build with features goes live. Order does not
-- matter for serving. Nor for loading: without this migration the new loader
-- still loads, without the feature columns, and the build goes live uncapped
-- (features_version 0) with a warning email; with it, builds carry features
-- and can be capped once poiCapPct allows.
--
-- ALGORITHM=INPLACE, LOCK=NONE: reads and writes carry on (MySQL refuses the
-- statement rather than taking a stronger lock). It still REBUILDS each table
-- (ADD COLUMN ... AFTER) and builds ix_rank, so it needs free storage of about
-- each table's size, takes a brief exclusive metadata lock at start and end,
-- and on a t4g.micro takes minutes per table. Run it outside the nightly load.
--
-- Idempotent: each ALTER runs only if its table exists without column q.
--
-- Metadata locks: each ALTER needs an exclusive metadata lock on its table at start
-- and end, and while it WAITS for one, every new read of that table queues behind it.
-- The session limits below make it give up after 5 s instead (error 1205, nothing
-- changed) so serving never stalls behind it. Run it off-peak and never during a
-- nightly load (the loader holds these tables); if it times out, just run it again later.
-- =====================================================================

SET SESSION lock_wait_timeout = 5;
SET SESSION innodb_lock_wait_timeout = 5;

SET @alter_pois = CONCAT('ALTER TABLE %s',
  ' ADD COLUMN q TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER has_wikidata,',
  ' ADD COLUMN cat TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER q,',
  ' ADD COLUMN flags TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER cat,',
  ' ADD KEY ix_rank (cell, min_lat, max_lat, min_lon, max_lon, has_name_tag,',
  ' k_amenity, k_tourism, k_leisure, k_historic, k_shop, k_natural, k_man_made, q, cat, flags),',
  ' ALGORITHM=INPLACE, LOCK=NONE');

-- 1. pois
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'pois') = 1 AND
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'pois' AND column_name = 'q') = 0,
  REPLACE(@alter_pois, '%s', 'pois'), 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. pois_prev (the rollback target) and 3. pois_staging (a load in progress), when they exist
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'pois_prev') = 1 AND
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'pois_prev' AND column_name = 'q') = 0,
  REPLACE(@alter_pois, '%s', 'pois_prev'), 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'pois_staging') = 1 AND
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'pois_staging' AND column_name = 'q') = 0,
  REPLACE(@alter_pois, '%s', 'pois_staging'), 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Check (expect q, cat, flags on each table that exists, and ix_rank with 16 parts):
--   SELECT table_name, column_name FROM information_schema.columns
--    WHERE table_schema = DATABASE() AND table_name IN ('pois', 'pois_prev', 'pois_staging') AND column_name IN ('q', 'cat', 'flags');
--   SELECT table_name, COUNT(*) FROM information_schema.statistics
--    WHERE table_schema = DATABASE() AND index_name = 'ix_rank' GROUP BY table_name;
