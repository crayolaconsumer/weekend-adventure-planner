-- ===========================================
-- ROAM Phase 4: Social Features Schema
-- ===========================================
-- Run this SQL to add social features tables.
-- Prerequisites: Run schema.sql first
-- ===========================================

-- -------------------------------------------
-- FOLLOWS TABLE
-- Track user-to-user follows
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS follows (
  id INT AUTO_INCREMENT PRIMARY KEY,
  follower_id INT NOT NULL,
  following_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_follow (follower_id, following_id),
  FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_follower (follower_id),
  INDEX idx_following (following_id),
  -- Prevent self-follows at DB level
  CONSTRAINT no_self_follow CHECK (follower_id != following_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------
-- USER BIO FIELD
-- Add bio field to users table if not exists
-- -------------------------------------------
-- Note: Run this as ALTER if bio column doesn't exist
-- ALTER TABLE users ADD COLUMN bio VARCHAR(280) NULL AFTER avatar_url;

-- -------------------------------------------
-- ACTIVITY LOG TABLE
-- Track user actions for activity feed
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS activity_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  activity_type ENUM('contribution', 'follow', 'save', 'visit') NOT NULL,
  target_type ENUM('place', 'user', 'contribution') NOT NULL,
  target_id VARCHAR(255) NOT NULL, -- Can be place_id, user_id, or contribution_id
  metadata JSON NULL, -- Additional context (place name, etc.)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  INDEX idx_activity_type (activity_type),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------
-- HELPFUL VIEWS
-- -------------------------------------------

-- View for user stats (followers, following, contributions count)
-- Note: MySQL 8+ supports views, but for serverless we'll compute these in queries

-- -------------------------------------------
-- SAMPLE QUERIES FOR REFERENCE
-- -------------------------------------------

-- Get follower count for a user:
-- SELECT COUNT(*) FROM follows WHERE following_id = ?

-- Get following count for a user:
-- SELECT COUNT(*) FROM follows WHERE follower_id = ?

-- Check if user A follows user B:
-- SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?

-- Get activity feed for users you follow:
-- SELECT a.*, u.username, u.display_name, u.avatar_url
-- FROM activity_log a
-- JOIN users u ON a.user_id = u.id
-- WHERE a.user_id IN (SELECT following_id FROM follows WHERE follower_id = ?)
-- ORDER BY a.created_at DESC
-- LIMIT 50

-- Get users with similar interests (saved same places):
-- SELECT u.id, u.username, u.display_name, u.avatar_url, COUNT(*) as common_saves
-- FROM users u
-- JOIN saved_places sp ON u.id = sp.user_id
-- WHERE sp.place_id IN (SELECT place_id FROM saved_places WHERE user_id = ?)
-- AND u.id != ?
-- GROUP BY u.id
-- ORDER BY common_saves DESC
-- LIMIT 10
