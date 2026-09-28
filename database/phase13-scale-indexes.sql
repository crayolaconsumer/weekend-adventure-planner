-- =====================================================================
-- Phase 13 — indexes for campaign-scale reads (scale audit, 28 Sep 2026)
-- =====================================================================
-- Additions only; nothing dropped. Each serves a query that otherwise
-- scans or filesorts a whole table as it grows:
--   saved_places   (saved_at)                 trending 30-day window (api/places/trending.js)
--   visited_places (visited_at)               trending 30-day window
--   contributions  (status, created_at)       trending 30-day window
--   saved_places   (planned_date)             daily visit-reminder cron (api/lib/pushNotifications.js)
--   follows        (following_id, created_at) follower list ORDER BY created_at (api/social/index.js)
--   follows        (follower_id, created_at)  following list ORDER BY created_at
--   notifications  (user_id, created_at)      notification list ORDER BY created_at (api/notifications/index.js)
--
-- ALGORITHM=INPLACE, LOCK=NONE: reads and writes carry on. A 5 s metadata
-- lock wait means it gives up (error 1205, nothing changed) rather than
-- stalling traffic behind it; just run it again. Idempotent: each index is
-- added only if its name is not already there.
-- =====================================================================

SET SESSION lock_wait_timeout = 5;

DROP PROCEDURE IF EXISTS roam_add_index;
DELIMITER //
CREATE PROCEDURE roam_add_index(IN t VARCHAR(64), IN i VARCHAR(64), IN cols VARCHAR(255))
BEGIN
  IF (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = t AND index_name = i) = 0 THEN
    SET @sql = CONCAT('ALTER TABLE `', t, '` ADD INDEX `', i, '` (', cols, '), ALGORITHM=INPLACE, LOCK=NONE');
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

CALL roam_add_index('saved_places', 'idx_saved_at', 'saved_at');
CALL roam_add_index('visited_places', 'idx_visited_at', 'visited_at');
CALL roam_add_index('contributions', 'idx_status_created', 'status, created_at');
CALL roam_add_index('saved_places', 'idx_planned_date', 'planned_date');
CALL roam_add_index('follows', 'idx_following_created', 'following_id, created_at');
CALL roam_add_index('follows', 'idx_follower_created', 'follower_id, created_at');
CALL roam_add_index('notifications', 'idx_user_created', 'user_id, created_at');

DROP PROCEDURE roam_add_index;

-- Check (expect 7 rows):
--   SELECT table_name, index_name FROM information_schema.statistics
--    WHERE table_schema = DATABASE() AND index_name IN ('idx_saved_at', 'idx_visited_at',
--      'idx_status_created', 'idx_planned_date', 'idx_following_created', 'idx_follower_created', 'idx_user_created')
--    GROUP BY table_name, index_name;
