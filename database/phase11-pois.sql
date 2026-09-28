-- =====================================================================
-- Phase 11 — Self-built place database (replaces live public Overpass)
-- =====================================================================
-- Nightly GitHub Actions build publishes a Release; api/admin/poi-load.js
-- pulls it chunk by chunk into pois_staging / poi_photos_staging, runs the
-- finalize gates, then swaps with one atomic RENAME (keeping *_prev for
-- rollback). pois_staging, pois_prev, poi_photos_staging and poi_photos_prev
-- are created by the loader with CREATE TABLE ... LIKE, so they are not here.
--
-- cell = FLOOR((lat + 90) * 10) * 3600 + FLOOR((lon + 180) * 10)
-- (shared/poiCell.mjs; a 0.1° cell, leading clustered-PK column, so a bbox
-- query is a few contiguous PK range scans. No SPATIAL index on purpose.)
--
-- New tables only; no existing table is touched. All idempotent.
-- =====================================================================

-- 1. Live POIs. One row per named OSM element the app can ask for.
CREATE TABLE IF NOT EXISTS pois (
  cell         INT UNSIGNED     NOT NULL,             -- 0.1° grid cell of the element's centre
  osm_type     TINYINT UNSIGNED NOT NULL,             -- 1 node, 2 way, 3 relation (Overpass output order)
  osm_id       BIGINT UNSIGNED  NOT NULL,
  lat          DOUBLE           NOT NULL,             -- node position, or bbox centre (= Overpass `center`)
  lon          DOUBLE           NOT NULL,
  min_lat      DOUBLE           NOT NULL,             -- bounds (nodes: = lat/lon). Overpass (bbox) matches
  min_lon      DOUBLE           NOT NULL,             -- elements that INTERSECT the box, so the query side
  max_lat      DOUBLE           NOT NULL,             -- scans cells padded by CELL_PAD_DEG and filters on these
  max_lon      DOUBLE           NOT NULL,
  k_amenity    VARCHAR(48) COLLATE utf8mb4_0900_bin NULL, -- exact, NO PAD: 'cafe ' <> 'cafe', as in Overpass
  k_tourism    VARCHAR(48) COLLATE utf8mb4_0900_bin NULL,
  k_leisure    VARCHAR(48) COLLATE utf8mb4_0900_bin NULL,
  k_historic   VARCHAR(48) COLLATE utf8mb4_0900_bin NULL,
  k_shop       VARCHAR(48) COLLATE utf8mb4_0900_bin NULL,
  k_natural    VARCHAR(48) COLLATE utf8mb4_0900_bin NULL,     -- NATURAL is reserved, hence the k_ prefix
  k_man_made   VARCHAR(48) COLLATE utf8mb4_0900_bin NULL,
  has_name     TINYINT(1) NOT NULL,                   -- name or name:en present
  has_name_tag TINYINT(1) NOT NULL,                   -- the `name` tag itself (Overpass ["name"])
  has_wikidata TINYINT(1) NOT NULL,
  q            TINYINT UNSIGNED NOT NULL DEFAULT 0,   -- relevance-cap features (shared/poiRank.mjs, phase12):
  cat          TINYINT UNSIGNED NOT NULL DEFAULT 0,   --   deck score 0-100, category code,
  flags        TINYINT UNSIGNED NOT NULL DEFAULT 0,   --   open slots / has hours / eligible / skip bits
  el           TEXT NOT NULL,                         -- finished Overpass element JSON, served as-is
  PRIMARY KEY (cell, osm_type, osm_id),
  UNIQUE KEY uq_osm (osm_type, osm_id),               -- id lookups (placeLookup, fetchPlaceById), cap phase 2
  -- Covering index for the cap's phase 1 (poiQuery buildCandidateSql): the bbox WHERE plus the
  -- features, so dense answers are ranked without reading el. 16 parts, MySQL's maximum;
  -- osm_type/osm_id come free as the PK suffix. has_wikidata is left out (no Discover query uses it).
  KEY ix_rank (cell, min_lat, max_lat, min_lon, max_lon, has_name_tag, k_amenity, k_tourism, k_leisure, k_historic, k_shop, k_natural, k_man_made, q, cat, flags)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Licensed photos keyed by Wikidata QID ('Q42') or element ('n123'/'w123').
CREATE TABLE IF NOT EXISTS poi_photos (
  photo_key   VARCHAR(64)  NOT NULL,
  url         VARCHAR(512) NOT NULL,                  -- Commons Special:FilePath ...?width=800, or Geograph thumb
  width       SMALLINT UNSIGNED NULL,
  height      SMALLINT UNSIGNED NULL,
  source      ENUM('wikidata','commons-osm','geograph') NOT NULL,
  artist      VARCHAR(255) NULL,                      -- HTML stripped
  license     VARCHAR(64)  NOT NULL,                  -- e.g. 'CC BY-SA 4.0'
  license_url VARCHAR(255) NULL,
  page_url    VARCHAR(512) NOT NULL,                  -- file / photo page, for the credit link
  checked_on  DATE NOT NULL,
  PRIMARY KEY (photo_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. One row per build the loader has seen: resume point and gate report.
CREATE TABLE IF NOT EXISTS poi_builds (
  build_id       VARCHAR(40) NOT NULL,                -- 'uk-20261001T0215Z'
  release_tag    VARCHAR(64) NOT NULL,                -- 'poi-<build_id>'
  schema_version SMALLINT    NOT NULL,                -- must equal POI_SCHEMA_VERSION (api/lib/poiQuery.js)
  osm_timestamp  DATETIME    NOT NULL,                -- data freshness (UTC)
  chunks_total   SMALLINT    NOT NULL,
  chunks_loaded  SMALLINT    NOT NULL DEFAULT 0,      -- resume point: chunks 0..chunks_loaded-1 are in staging
  row_count      INT NULL,
  photo_count    INT NULL,
  coverage       JSON NULL,                           -- array of cells fully inside the extract .poly
  status ENUM('loading','validating','active','previous','failed','rolled_back') NOT NULL,
  gate_report    JSON NULL,
  manifest_sha256 CHAR(64) NULL,                      -- release revision pinned at begin: resume never mixes revisions
  coverage_sha256 CHAR(64) NULL,
  gen_pending    TINYINT(1) NOT NULL DEFAULT 0,       -- tables changed, roam:poiGen INCR not yet confirmed
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  activated_at   DATETIME NULL,
  PRIMARY KEY (build_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
