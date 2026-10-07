-- ROAM marketing-asset seed cleanup
-- Run after all store/ad/social assets are captured.
-- Generated 2026-06-11. DB: plesk_go-roam (Aurora eu-west-2).
--
-- Two parts:
--   PART A — remove the seeded social/persona/visited data (this session)
--   PART B — remove the legacy QA/test accounts the user asked to purge
--            (KEEP appreview / id 12 — required for Apple release submissions)
--
-- Run inside a transaction so you can ROLLBACK if a count looks wrong.

START TRANSACTION;

-- ============================================================
-- PART A — seeded marketing data (personas 30-34 + appreview map rows)
-- ============================================================
-- Persona-owned rows
DELETE FROM contributions   WHERE user_id IN (30,31,32,33,34);
DELETE FROM visited_places  WHERE user_id IN (30,31,32,33,34);
DELETE FROM place_ratings   WHERE user_id IN (30,31,32,33,34);
DELETE FROM saved_places    WHERE user_id IN (30,31,32,33,34);
DELETE FROM follows         WHERE follower_id IN (30,31,32,33,34)
                               OR following_id IN (30,31,32,33,34);
DELETE FROM users           WHERE id IN (30,31,32,33,34);   -- @roam.seed personas

-- appreview (12) visited-map rows seeded THIS session (keeps original Cloud Cafe id 520)
DELETE FROM visited_places  WHERE id IN (533,534,535,536,537,538,539);

-- ============================================================
-- PART B — legacy QA/test accounts (user-requested purge; KEEP id 12 appreview)
--   7  qa-claude-1778550@example.com   "QA Bot"
--   11 simtest-1778616753@roam.test
--   13 delete-test-1778675559@example.com
--   14 delete-test-1778675578@example.com
--   15 delete-test-2-1778675599@example.com
--   28 test@example.com                "Test User"
-- Delete dependents first to satisfy FKs, then the users.
-- ============================================================
-- (uncomment to run — review counts from PART A first)
-- SET @victims = '7,11,13,14,15,28';
-- DELETE FROM contributions          WHERE user_id IN (7,11,13,14,15,28);
-- DELETE FROM visited_places         WHERE user_id IN (7,11,13,14,15,28);
-- DELETE FROM saved_places           WHERE user_id IN (7,11,13,14,15,28);
-- DELETE FROM place_ratings          WHERE user_id IN (7,11,13,14,15,28);
-- DELETE FROM swiped_places          WHERE user_id IN (7,11,13,14,15,28);
-- DELETE FROM collections            WHERE user_id IN (7,11,13,14,15,28);
-- DELETE FROM follows                WHERE follower_id IN (7,11,13,14,15,28) OR following_id IN (7,11,13,14,15,28);
-- DELETE FROM follow_requests        WHERE requester_id IN (7,11,13,14,15,28) OR target_id IN (7,11,13,14,15,28);
-- DELETE FROM activity_log           WHERE user_id IN (7,11,13,14,15,28);
-- DELETE FROM notifications          WHERE user_id IN (7,11,13,14,15,28);
-- DELETE FROM user_stats             WHERE user_id IN (7,11,13,14,15,28);
-- DELETE FROM user_preferences       WHERE user_id IN (7,11,13,14,15,28);
-- DELETE FROM user_privacy_settings  WHERE user_id IN (7,11,13,14,15,28);
-- DELETE FROM refresh_tokens         WHERE user_id IN (7,11,13,14,15,28);
-- DELETE FROM users                  WHERE id IN (7,11,13,14,15,28);   -- NEVER include 12 (appreview)

-- Review, then:
-- COMMIT;   -- or ROLLBACK;
