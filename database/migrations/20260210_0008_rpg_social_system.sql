CREATE TABLE IF NOT EXISTS rpg_pvp_queue (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  chat_jid VARCHAR(255) NOT NULL,
  owner_jid VARCHAR(255) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'queued',
  matched_challenge_id BIGINT UNSIGNED NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rpg_pvp_queue_chat_owner_status (chat_jid, owner_jid, status),
  INDEX idx_rpg_pvp_queue_chat_status_expires (chat_jid, status, expires_at),
  INDEX idx_rpg_pvp_queue_owner_status (owner_jid, status),
  CONSTRAINT fk_rpg_pvp_queue_owner
    FOREIGN KEY (owner_jid) REFERENCES rpg_player(jid)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_rpg_pvp_queue_challenge
    FOREIGN KEY (matched_challenge_id) REFERENCES rpg_pvp_challenge(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rpg_pvp_weekly_stats (
  week_ref_date DATE NOT NULL,
  owner_jid VARCHAR(255) NOT NULL,
  matches_played INT UNSIGNED NOT NULL DEFAULT 0,
  wins INT UNSIGNED NOT NULL DEFAULT 0,
  losses INT UNSIGNED NOT NULL DEFAULT 0,
  points INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (week_ref_date, owner_jid),
  INDEX idx_rpg_pvp_weekly_points (week_ref_date, points DESC, wins DESC),
  CONSTRAINT fk_rpg_pvp_weekly_owner
    FOREIGN KEY (owner_jid) REFERENCES rpg_player(jid)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rpg_social_link (
  pair_key VARCHAR(600) PRIMARY KEY,
  user_a_jid VARCHAR(255) NOT NULL,
  user_b_jid VARCHAR(255) NOT NULL,
  friendship_score INT NOT NULL DEFAULT 0,
  rivalry_score INT NOT NULL DEFAULT 0,
  interactions_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_interaction_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rpg_social_link_pair_users (user_a_jid, user_b_jid),
  INDEX idx_rpg_social_link_user_a (user_a_jid),
  INDEX idx_rpg_social_link_user_b (user_b_jid),
  CONSTRAINT fk_rpg_social_link_user_a
    FOREIGN KEY (user_a_jid) REFERENCES rpg_player(jid)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_rpg_social_link_user_b
    FOREIGN KEY (user_b_jid) REFERENCES rpg_player(jid)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rpg_trade_offer (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  chat_jid VARCHAR(255) NULL,
  proposer_jid VARCHAR(255) NOT NULL,
  receiver_jid VARCHAR(255) NOT NULL,
  proposer_offer_json JSON NOT NULL,
  receiver_offer_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  accepted_at DATETIME NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_rpg_trade_status_expires (status, expires_at),
  INDEX idx_rpg_trade_proposer (proposer_jid),
  INDEX idx_rpg_trade_receiver (receiver_jid),
  CONSTRAINT fk_rpg_trade_proposer
    FOREIGN KEY (proposer_jid) REFERENCES rpg_player(jid)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_rpg_trade_receiver
    FOREIGN KEY (receiver_jid) REFERENCES rpg_player(jid)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rpg_group_coop_weekly (
  chat_jid VARCHAR(255) NOT NULL,
  week_ref_date DATE NOT NULL,
  capture_target INT UNSIGNED NOT NULL DEFAULT 20,
  raid_target INT UNSIGNED NOT NULL DEFAULT 3,
  capture_progress INT UNSIGNED NOT NULL DEFAULT 0,
  raid_progress INT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(24) NOT NULL DEFAULT 'active',
  completed_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (chat_jid, week_ref_date),
  INDEX idx_rpg_coop_weekly_status (status, week_ref_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rpg_group_coop_member (
  chat_jid VARCHAR(255) NOT NULL,
  week_ref_date DATE NOT NULL,
  owner_jid VARCHAR(255) NOT NULL,
  capture_contribution INT UNSIGNED NOT NULL DEFAULT 0,
  raid_contribution INT UNSIGNED NOT NULL DEFAULT 0,
  reward_claimed_at DATETIME NULL,
  last_contribution_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (chat_jid, week_ref_date, owner_jid),
  INDEX idx_rpg_coop_member_owner (owner_jid, week_ref_date),
  CONSTRAINT fk_rpg_coop_member_weekly
    FOREIGN KEY (chat_jid, week_ref_date) REFERENCES rpg_group_coop_weekly(chat_jid, week_ref_date)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_rpg_coop_member_owner
    FOREIGN KEY (owner_jid) REFERENCES rpg_player(jid)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rpg_group_event_weekly (
  chat_jid VARCHAR(255) NOT NULL,
  week_ref_date DATE NOT NULL,
  event_key VARCHAR(64) NOT NULL,
  target_value BIGINT UNSIGNED NOT NULL,
  progress_value BIGINT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(24) NOT NULL DEFAULT 'active',
  expires_at DATETIME NOT NULL,
  completed_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (chat_jid, week_ref_date),
  INDEX idx_rpg_event_weekly_status_expires (status, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rpg_group_event_member (
  chat_jid VARCHAR(255) NOT NULL,
  week_ref_date DATE NOT NULL,
  owner_jid VARCHAR(255) NOT NULL,
  contribution BIGINT UNSIGNED NOT NULL DEFAULT 0,
  reward_claimed_at DATETIME NULL,
  last_contribution_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (chat_jid, week_ref_date, owner_jid),
  INDEX idx_rpg_event_member_owner (owner_jid, week_ref_date),
  CONSTRAINT fk_rpg_event_member_weekly
    FOREIGN KEY (chat_jid, week_ref_date) REFERENCES rpg_group_event_weekly(chat_jid, week_ref_date)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_rpg_event_member_owner
    FOREIGN KEY (owner_jid) REFERENCES rpg_player(jid)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rpg_karma_profile (
  owner_jid VARCHAR(255) PRIMARY KEY,
  karma_score INT NOT NULL DEFAULT 0,
  positive_votes INT UNSIGNED NOT NULL DEFAULT 0,
  negative_votes INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_rpg_karma_profile_owner
    FOREIGN KEY (owner_jid) REFERENCES rpg_player(jid)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rpg_karma_vote_history (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  week_ref_date DATE NOT NULL,
  voter_jid VARCHAR(255) NOT NULL,
  target_jid VARCHAR(255) NOT NULL,
  vote_value TINYINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rpg_karma_week_vote (week_ref_date, voter_jid, target_jid),
  INDEX idx_rpg_karma_target_week (target_jid, week_ref_date),
  CONSTRAINT fk_rpg_karma_vote_voter
    FOREIGN KEY (voter_jid) REFERENCES rpg_player(jid)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_rpg_karma_vote_target
    FOREIGN KEY (target_jid) REFERENCES rpg_player(jid)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rpg_group_activity_daily (
  day_ref_date DATE NOT NULL,
  chat_jid VARCHAR(255) NOT NULL,
  owner_jid VARCHAR(255) NOT NULL,
  actions_count INT UNSIGNED NOT NULL DEFAULT 0,
  pvp_created_count INT UNSIGNED NOT NULL DEFAULT 0,
  pvp_completed_count INT UNSIGNED NOT NULL DEFAULT 0,
  coop_completed_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (day_ref_date, chat_jid, owner_jid),
  INDEX idx_rpg_activity_chat_day (chat_jid, day_ref_date),
  INDEX idx_rpg_activity_owner_day (owner_jid, day_ref_date),
  CONSTRAINT fk_rpg_activity_owner
    FOREIGN KEY (owner_jid) REFERENCES rpg_player(jid)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
