CREATE TABLE IF NOT EXISTS web_visit_event (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  visitor_key VARCHAR(80) NOT NULL,
  session_key VARCHAR(80) NOT NULL,
  page_path VARCHAR(255) NOT NULL,
  referrer VARCHAR(1024) NULL,
  user_agent VARCHAR(512) NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'web',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_web_visit_created_at (created_at),
  INDEX idx_web_visit_page_created (page_path, created_at),
  INDEX idx_web_visit_visitor_created (visitor_key, created_at),
  INDEX idx_web_visit_session_created (session_key, created_at),
  INDEX idx_web_visit_source_created (source, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
