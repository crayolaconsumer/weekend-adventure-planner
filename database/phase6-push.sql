-- ═══════════════════════════════════════════════════════
-- ROAM Phase 6: Push Notifications
-- ═══════════════════════════════════════════════════════
-- This migration adds push notification subscription storage

-- Push notification subscriptions table
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  endpoint VARCHAR(500) NOT NULL UNIQUE,
  p256dh_key VARCHAR(255) NOT NULL,
  auth_key VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_user_id (user_id),
  INDEX idx_endpoint (endpoint(191))
);

-- Notification preferences (optional)
CREATE TABLE IF NOT EXISTS notification_preferences (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  new_contribution BOOLEAN DEFAULT TRUE,
  new_follower BOOLEAN DEFAULT TRUE,
  plan_shared BOOLEAN DEFAULT TRUE,
  weekly_digest BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
