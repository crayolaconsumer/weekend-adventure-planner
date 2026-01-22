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
  email_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP NULL,
  INDEX idx_email (email),
  INDEX idx_google_id (google_id),
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
