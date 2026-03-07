-- D1 rollback

SET @migration_key := '20260307_d1_terms_acceptance';

DROP TABLE IF EXISTS web_terms_acceptance_event;

UPDATE schema_change_log
   SET status = 'rolled_back',
       notes = 'D1 rollback executado',
       updated_at = CURRENT_TIMESTAMP
 WHERE migration_key = @migration_key;
