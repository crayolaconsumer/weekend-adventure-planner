-- ===========================================
-- ROAM Database Schema
-- ===========================================
-- Run this SQL on your MySQL database to set up the required tables.
-- Database: plesk_go-roam
-- ===========================================

-- -------------------------------------------
-- USERS TABLE
-- Core authentication and profile data
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NULL, -- NULL for Google-only users
  username VARCHAR(50) NULL UNIQUE, -- @username style, optional initially
  display_name VARCHAR(100) NULL,
  avatar_url VARCHAR(500) NULL,
  google_id VARCHAR(255) NULL UNIQUE, -- For Google SSO
  apple_id VARCHAR(255) NULL UNIQUE, -- For Sign in with Apple SSO
  email_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP NULL,
  INDEX idx_email (email),
  INDEX idx_google_id (google_id),
  INDEX idx_apple_id (apple_id),
  INDEX idx_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------
-- USER PREFERENCES TABLE
-- Stores user preferences and settings
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS user_preferences (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  default_location_lat DECIMAL(10, 8) NULL,
  default_location_lng DECIMAL(11, 8) NULL,
  default_location_name VARCHAR(255) NULL,
  search_radius_km INT DEFAULT 25,
  preferred_categories JSON NULL, -- Array of category slugs
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------
-- SAVED PLACES TABLE
-- Places users have liked/saved
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS saved_places (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  place_id VARCHAR(255) NOT NULL, -- External ID from API
  place_data JSON NOT NULL, -- Cached place data (name, location, etc.)
  saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  visited BOOLEAN DEFAULT FALSE,
  visited_at TIMESTAMP NULL,
  notes TEXT NULL,
  UNIQUE KEY unique_user_place (user_id, place_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  INDEX idx_place_id (place_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------
-- SAVED EVENTS TABLE
-- Events users have saved
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS saved_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  event_id VARCHAR(255) NOT NULL, -- External ID from Eventbrite/etc.
  event_source VARCHAR(50) NOT NULL, -- 'eventbrite', 'ticketmaster', 'skiddle'
  event_data JSON NOT NULL, -- Cached event data
  saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_event (user_id, event_id, event_source),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------
-- COLLECTIONS TABLE
-- User-created collections (boards)
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS collections (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  emoji VARCHAR(10) DEFAULT '📍',
  description TEXT NULL,
  is_public BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  INDEX idx_is_public (is_public)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------
-- COLLECTION PLACES TABLE
-- Many-to-many: places in collections
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS collection_places (
  id INT AUTO_INCREMENT PRIMARY KEY,
  collection_id INT NOT NULL,
  place_id VARCHAR(255) NOT NULL,
  place_data JSON NOT NULL, -- Cached place data
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  sort_order INT DEFAULT 0,
  UNIQUE KEY unique_collection_place (collection_id, place_id),
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
  INDEX idx_collection_id (collection_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------
-- CONTRIBUTIONS TABLE
-- User contributions about places (tips, photos, etc.)
-- For Phase 3 community features
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS contributions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  place_id VARCHAR(255) NOT NULL,
  contribution_type ENUM('tip', 'photo', 'correction', 'story') NOT NULL,
  content TEXT NOT NULL, -- Text content or image URL
  metadata JSON NULL, -- Additional data (image dimensions, etc.)
  upvotes INT DEFAULT 0,
  downvotes INT DEFAULT 0,
  status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
  visibility ENUM('public', 'followers_only', 'private') DEFAULT 'public',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  INDEX idx_place_id (place_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------
-- CONTRIBUTION VOTES TABLE
-- Track who voted on what
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS contribution_votes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  contribution_id INT NOT NULL,
  vote_type ENUM('up', 'down') NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_vote (user_id, contribution_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (contribution_id) REFERENCES contributions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------
-- REFRESH TOKENS TABLE
-- For JWT refresh token rotation
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  revoked BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  INDEX idx_token_hash (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------
-- SWIPED PLACES TABLE
-- Track places user has seen (for not showing again)
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS swiped_places (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  place_id VARCHAR(255) NOT NULL,
  action ENUM('like', 'skip') NOT NULL,
  swiped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_swipe (user_id, place_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------
-- PUSH SUBSCRIPTIONS TABLE
-- Store push notification subscriptions
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  platform ENUM('web', 'ios', 'android') NOT NULL DEFAULT 'web',
  endpoint VARCHAR(500) NOT NULL, -- VAPID URL for web, device token for ios/android
  p256dh_key VARCHAR(255) NULL,    -- web only
  auth_key VARCHAR(255) NULL,      -- web only
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_endpoint (endpoint(255)),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  INDEX idx_platform (platform)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------
-- NOTIFICATIONS TABLE
-- In-app notifications for user activity
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  actor_id INT NULL, -- The user who triggered the notification (NULL for system notifications)
  type VARCHAR(50) NOT NULL, -- 'follow', 'follow_request', 'contribution_vote', 'badge_earned', etc.
  title VARCHAR(255) NOT NULL,
  message TEXT NULL,
  data JSON NULL, -- Additional context (place_id, contribution_id, etc.)
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_user_id (user_id),
  INDEX idx_user_read (user_id, is_read),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------
-- USER BADGES TABLE
-- Achievements and badges earned by users
-- -------------------------------------------
-- NOTE: This table was migrated in production to use badge_id/earned_at
-- (matching the code in api/users/badges.js). The original schema used
-- badge_type/badge_name/awarded_at — anyone running this from scratch
-- gets the current production shape below.
CREATE TABLE IF NOT EXISTS user_badges (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  badge_id VARCHAR(50) NOT NULL, -- e.g. 'first_visit', 'visits_10', 'contributor_10'
  earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_badge (user_id, badge_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  INDEX idx_badge_id (badge_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------
-- PLACE RATINGS TABLE
-- User ratings and reviews for places
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS place_ratings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  place_id VARCHAR(255) NOT NULL,
  rating TINYINT NOT NULL, -- 1-5 star rating
  review TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_place_rating (user_id, place_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  INDEX idx_place_id (place_id),
  INDEX idx_rating (rating),
  CONSTRAINT chk_rating CHECK (rating >= 1 AND rating <= 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------
-- VISITED PLACES TABLE
-- Places users have marked as visited
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS visited_places (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  place_id VARCHAR(255) NOT NULL,
  place_data JSON NULL, -- Cached place data (name, location, etc.)
  visited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  notes TEXT NULL,
  rating TINYINT NULL, -- Optional 1-5 rating at time of visit
  UNIQUE KEY unique_user_visited_place (user_id, place_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  INDEX idx_place_id (place_id),
  INDEX idx_visited_at (visited_at),
  CONSTRAINT chk_visited_rating CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------
-- USER STATS TABLE
-- Aggregated statistics for users (denormalized for performance)
-- -------------------------------------------
-- NOTE: Production has additional counter columns added in-place
-- (places_viewed, places_saved, events_viewed, events_saved,
--  total_swipes, swipes_right, swipes_left, plans_created,
--  plans_shared, contributions_made). This schema reflects the
-- live shape so a fresh DB rebuild matches what the API queries.
-- The legacy column contributions_count was renamed to
-- contributions_made.
CREATE TABLE IF NOT EXISTS user_stats (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  places_viewed INT DEFAULT 0,
  places_saved INT DEFAULT 0,
  places_visited INT DEFAULT 0,
  places_rated INT DEFAULT 0,
  events_viewed INT DEFAULT 0,
  events_saved INT DEFAULT 0,
  total_swipes INT DEFAULT 0,
  swipes_right INT DEFAULT 0,
  swipes_left INT DEFAULT 0,
  plans_created INT DEFAULT 0,
  plans_shared INT DEFAULT 0,
  contributions_made INT DEFAULT 0,
  -- Activity + streak tracking. Previously these lived only in
  -- localStorage which meant a user signing in on a new device lost
  -- their streak and counters. Server-side now so they persist
  -- across devices and feed the badge-award logic.
  times_went_out INT DEFAULT 0,
  boredom_busts INT DEFAULT 0,
  current_streak INT DEFAULT 0,
  best_streak INT DEFAULT 0,
  last_streak_date DATE NULL,
  last_activity_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------
-- USER PRIVACY SETTINGS TABLE
-- Per-user toggles for visibility (private account, search, lists, map)
-- Note: this table was added directly in production at some point and
-- backfilled into schema.sql here for local reference.
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS user_privacy_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  is_private_account TINYINT(1) DEFAULT 0,
  show_in_search TINYINT(1) DEFAULT 1,
  hide_followers_list TINYINT(1) DEFAULT 0,
  hide_following_list TINYINT(1) DEFAULT 0,
  is_map_public TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
