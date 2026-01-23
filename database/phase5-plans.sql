-- ===========================================
-- ROAM Database Schema - Phase 5: Plans
-- ===========================================
-- Shareable adventure plans with multi-modal transport support
-- ===========================================

-- -------------------------------------------
-- PLANS TABLE
-- User-created adventure plans
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS plans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL, -- NULL for anonymous plans
  share_code VARCHAR(12) UNIQUE,
  title VARCHAR(100) NOT NULL,
  vibe VARCHAR(50) NOT NULL,
  duration_hours INT NOT NULL,
  default_transport ENUM('walk', 'transit', 'drive') DEFAULT 'walk',
  is_public BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_user_id (user_id),
  INDEX idx_share_code (share_code),
  INDEX idx_is_public (is_public)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------
-- PLAN STOPS TABLE
-- Individual stops in a plan with transport info
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS plan_stops (
  id INT AUTO_INCREMENT PRIMARY KEY,
  plan_id INT NOT NULL,
  place_id VARCHAR(255) NOT NULL,
  place_data JSON NOT NULL, -- Cached place data (name, location, etc.)
  sort_order INT NOT NULL,
  scheduled_time TIME NULL,
  duration_minutes INT DEFAULT 60,
  transport_to_next ENUM('walk', 'transit', 'drive') DEFAULT 'walk',
  travel_time_to_next INT NULL, -- Minutes to next stop
  travel_distance_to_next DECIMAL(10, 3) NULL, -- Km to next stop
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE,
  INDEX idx_plan_id (plan_id),
  INDEX idx_sort_order (plan_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------
-- Migration script for existing plans table (if needed)
-- Run these ALTER statements if plans table already exists
-- -------------------------------------------

-- ALTER TABLE plans ADD COLUMN default_transport ENUM('walk', 'transit', 'drive') DEFAULT 'walk' AFTER duration_hours;

-- ALTER TABLE plan_stops ADD COLUMN transport_to_next ENUM('walk', 'transit', 'drive') DEFAULT 'walk' AFTER duration_minutes;
-- ALTER TABLE plan_stops ADD COLUMN travel_time_to_next INT NULL AFTER transport_to_next;
-- ALTER TABLE plan_stops ADD COLUMN travel_distance_to_next DECIMAL(10, 3) NULL AFTER travel_time_to_next;
