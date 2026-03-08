CREATE TABLE IF NOT EXISTS `ai_command_config_enrichment_cursor` (
  `id` tinyint(3) unsigned NOT NULL DEFAULT 1,
  `last_learning_event_id` bigint(20) unsigned NOT NULL DEFAULT 0,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_command_config_enrichment_suggestion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `module_key` varchar(64) NOT NULL,
  `command_name` varchar(64) NOT NULL,
  `source_tool` varchar(64) DEFAULT NULL,
  `source_event_id` bigint(20) unsigned DEFAULT NULL,
  `user_question` varchar(512) DEFAULT NULL,
  `normalized_question` varchar(512) DEFAULT NULL,
  `suggestion_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`suggestion_json`)),
  `confidence` decimal(5,4) NOT NULL DEFAULT 0.5000,
  `model_name` varchar(80) DEFAULT NULL,
  `source` varchar(32) NOT NULL DEFAULT 'llm',
  `status` enum('pending','applied','rejected') NOT NULL DEFAULT 'pending',
  `suggestion_hash` char(64) NOT NULL,
  `review_notes` varchar(255) DEFAULT NULL,
  `applied_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ai_command_cfg_enrichment_suggestion_hash` (`suggestion_hash`),
  KEY `idx_ai_command_cfg_enrichment_module_command_status` (`module_key`,`command_name`,`status`,`updated_at`),
  KEY `idx_ai_command_cfg_enrichment_source_event` (`source_event_id`,`updated_at`),
  KEY `idx_ai_command_cfg_enrichment_status_updated` (`status`,`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_command_config_enrichment_state` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `module_key` varchar(64) NOT NULL,
  `command_name` varchar(64) NOT NULL,
  `overlay_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`overlay_json`)),
  `version` int(10) unsigned NOT NULL DEFAULT 1,
  `confidence` decimal(5,4) NOT NULL DEFAULT 0.5000,
  `last_suggestion_id` bigint(20) unsigned DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ai_command_cfg_enrichment_state_module_command` (`module_key`,`command_name`),
  KEY `idx_ai_command_cfg_enrichment_state_updated` (`updated_at`),
  KEY `idx_ai_command_cfg_enrichment_state_last_suggestion` (`last_suggestion_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
