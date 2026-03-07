-- Harden `web_google_session` token persistence:
-- 1) guarantee hash is present for every row
-- 2) ensure `session_token` stores only a non-sensitive deterministic row key
-- 3) enforce NOT NULL on `session_token_hash`

UPDATE web_google_session
   SET session_token_hash = UNHEX(SHA2(session_token, 256))
 WHERE session_token_hash IS NULL
   AND session_token IS NOT NULL;

UPDATE web_google_session
   SET session_token = LOWER(SUBSTRING(HEX(session_token_hash), 1, 36))
 WHERE session_token_hash IS NOT NULL
   AND session_token <> LOWER(SUBSTRING(HEX(session_token_hash), 1, 36));

ALTER TABLE web_google_session
  MODIFY COLUMN session_token_hash BINARY(32) NOT NULL;
