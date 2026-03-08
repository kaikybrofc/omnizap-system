# Runbook de Evolucao de Banco em Producao (2026 Q1-Q2)

Escopo: hardening e evolucao gradual de schema MySQL/InnoDB com foco em rollout online, validacao objetiva e rollback logico por fase.

## Objetivo

Definir o processo para aplicar, validar e (quando necessario) reverter as migracoes do ciclo `d0` ate `d34`, minimizando risco de indisponibilidade e regressao de desempenho.

## Arquivos alvo (ordem recomendada)

- `database/migrations/20260307_d0_hardening_up.sql`
- `database/migrations/20260307_d0_hardening_down.sql`
- `database/migrations/20260307_d1_terms_acceptance_up.sql`
- `database/migrations/20260307_d1_terms_acceptance_down.sql`
- `database/migrations/20260307_d2_auth_hardening_up.sql`
- `database/migrations/20260307_d2_auth_hardening_down.sql`
- `database/migrations/20260314_d7_canonical_sender_up.sql`
- `database/migrations/20260314_d7_canonical_sender_down.sql`
- `database/migrations/20260406_d30_security_analytics_up.sql`
- `database/migrations/20260406_d30_security_analytics_down.sql`
- `database/migrations/20260407_d31_web_google_session_token_hardening_up.sql`
- `database/migrations/20260407_d31_web_google_session_token_hardening_down.sql`
- `database/migrations/20260408_d32_ai_help_response_cache_up.sql`
- `database/migrations/20260408_d32_ai_help_response_cache_down.sql`
- `database/migrations/20260409_d33_ai_learning_tables_up.sql`
- `database/migrations/20260409_d33_ai_learning_tables_down.sql`
- `database/migrations/20260410_d34_command_config_enrichment_up.sql`
- `database/migrations/20260410_d34_command_config_enrichment_down.sql`

## 1) Pre-requisitos

1. Confirmar versao e engine:

```sql
SELECT VERSION() AS mysql_version;
```

Recomendado: MySQL `8.0.16+`.

2. Confirmar politica de scheduler:

```sql
SHOW VARIABLES LIKE 'event_scheduler';
```

3. Garantir backup e recuperacao:

- backup logico do schema alvo;
- cadeia PITR (binlog + snapshots);
- restore testado em homologacao.

4. Postura operacional:

- aplicar em janela de menor pressao de escrita;
- manter aplicacao online quando possivel;
- monitorar p95/p99 e lock waits durante e apos cada fase.

## 2) Comando padrao de execucao

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/<arquivo>.sql
```

## 3) Fases de rollout

### Fase D0 - Hardening nao disruptivo

Aplicar:

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/20260307_d0_hardening_up.sql
```

Validar:

```sql
SELECT migration_key, phase, status, updated_at
  FROM schema_change_log
 WHERE migration_key = '20260307_d0_hardening';

SHOW INDEX FROM messages;
SHOW INDEX FROM domain_event_outbox;
SHOW INDEX FROM email_outbox;
SHOW INDEX FROM sticker_worker_task_queue;
SHOW INDEX FROM sticker_asset_reprocess_queue;
```

Rollback:

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/20260307_d0_hardening_down.sql
```

### Fase D1 - Aceite de termos versionado

Aplicar:

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/20260307_d1_terms_acceptance_up.sql
```

Validar:

```sql
SELECT migration_key, phase, status, updated_at
  FROM schema_change_log
 WHERE migration_key = '20260307_d1_terms_acceptance';

SHOW TABLES LIKE 'web_terms_acceptance_event';
SHOW INDEX FROM web_terms_acceptance_event;
```

Rollback:

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/20260307_d1_terms_acceptance_down.sql
```

### Fase D2 - Auth hardening

Aplicar:

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/20260307_d2_auth_hardening_up.sql
```

Validar:

```sql
SELECT migration_key, phase, status, updated_at
  FROM schema_change_log
 WHERE migration_key = '20260307_d2_auth_hardening';

SHOW TABLES LIKE 'web_user_password_login_throttle';
SHOW COLUMNS FROM web_user_password_recovery_code LIKE 'email_hash';
SHOW COLUMNS FROM web_user_password_recovery_code LIKE 'requested_ip_hash';
SHOW COLUMNS FROM web_user_password_recovery_code LIKE 'requested_user_agent_hash';
SHOW INDEX FROM web_user_password_recovery_code;
```

Rollback:

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/20260307_d2_auth_hardening_down.sql
```

### Fase D+7 - Canonical sender

Aplicar:

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/20260314_d7_canonical_sender_up.sql
```

Validar:

```sql
SELECT migration_key, phase, status, updated_at
  FROM schema_change_log
 WHERE migration_key = '20260314_d7_canonical_sender';

SHOW COLUMNS FROM messages LIKE 'canonical_sender_id';
SHOW INDEX FROM messages;

SELECT COUNT(*) AS null_canonical_sender
  FROM messages
 WHERE canonical_sender_id IS NULL;
```

Rollback:

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/20260314_d7_canonical_sender_down.sql
```

### Fase D+30 - Security analytics e retencao

Aplicar:

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/20260406_d30_security_analytics_up.sql
```

Validar:

```sql
SELECT migration_key, phase, status, updated_at
  FROM schema_change_log
 WHERE migration_key = '20260406_d30_security_analytics';

SHOW COLUMNS FROM web_google_session LIKE 'session_token_hash';
SHOW INDEX FROM web_google_session;

SELECT COUNT(*) AS null_session_hash
  FROM web_google_session
 WHERE session_token_hash IS NULL;

SHOW EVENTS
 WHERE Db = DATABASE()
   AND Name IN (
     'ev_rollup_message_activity_daily',
     'ev_purge_baileys_event_journal',
     'ev_purge_message_analysis_event',
     'ev_purge_web_visit_event',
     'ev_purge_sticker_pack_interaction_event'
   );
```

Rollback:

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/20260406_d30_security_analytics_down.sql
```

### Fase D+31 - Hardening de token de sessao web

Aplicar:

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/20260407_d31_web_google_session_token_hardening_up.sql
```

Validar:

```sql
SHOW COLUMNS FROM web_google_session LIKE 'session_token_hash';

SELECT COUNT(*) AS inconsistent_rows
  FROM web_google_session
 WHERE session_token_hash IS NULL
    OR session_token <> LOWER(SUBSTRING(HEX(session_token_hash), 1, 36));
```

Rollback:

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/20260407_d31_web_google_session_token_hardening_down.sql
```

### Fase D+32 - Cache de respostas de AI Help

Aplicar:

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/20260408_d32_ai_help_response_cache_up.sql
```

Validar:

```sql
SHOW TABLES LIKE 'ai_help_response_cache';
SHOW INDEX FROM ai_help_response_cache;
```

Rollback:

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/20260408_d32_ai_help_response_cache_down.sql
```

### Fase D+33 - Tabelas de aprendizado de IA

Aplicar:

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/20260409_d33_ai_learning_tables_up.sql
```

Validar:

```sql
SHOW TABLES LIKE 'ai_learning_events';
SHOW TABLES LIKE 'ai_learned_patterns';
SHOW TABLES LIKE 'ai_learned_keywords';
SHOW TABLES LIKE 'ai_question_embeddings';

SHOW INDEX FROM ai_learning_events;
SHOW INDEX FROM ai_learned_patterns;
SHOW INDEX FROM ai_learned_keywords;
SHOW INDEX FROM ai_question_embeddings;
```

Rollback:

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/20260409_d33_ai_learning_tables_down.sql
```

### Fase D+34 - Enriquecimento de command config

Aplicar:

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/20260410_d34_command_config_enrichment_up.sql
```

Validar:

```sql
SHOW TABLES LIKE 'ai_command_config_enrichment_cursor';
SHOW TABLES LIKE 'ai_command_config_enrichment_suggestion';
SHOW TABLES LIKE 'ai_command_config_enrichment_state';

SHOW INDEX FROM ai_command_config_enrichment_suggestion;
SHOW INDEX FROM ai_command_config_enrichment_state;
```

Rollback:

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/20260410_d34_command_config_enrichment_down.sql
```

## 4) Checklist de monitoramento (todas as fases)

Monitorar por 30-60 minutos apos cada fase:

- `Threads_running`, lock waits InnoDB, latencia p95/p99;
- profundidade de filas (`domain_event_outbox`, `email_outbox`, `sticker_worker_task_queue`);
- falhas em workers e jobs/event scheduler.

Consultas rapidas:

```sql
SELECT status, COUNT(*) FROM domain_event_outbox GROUP BY status;
SELECT status, COUNT(*) FROM email_outbox GROUP BY status;
SELECT status, COUNT(*) FROM sticker_worker_task_queue GROUP BY status;
```

## 5) Criterio de avance (go/no-go)

Avancar somente se:

- migracao atual estiver `applied` (quando registrada em `schema_change_log`);
- validacoes estruturais e de indice estiverem consistentes;
- sem degradacao sustentada de erro/latencia.

Suspender se houver:

- lock waits persistentes;
- crescimento anomalo de filas sem drenagem;
- erro de aplicacao relacionado a novas colunas/tabelas.

## 6) Politica de roll-forward

Quando rollback nao for necessario e dados estiverem integros:

1. manter a fase aplicada;
2. ajustar query/indice no codigo;
3. repetir validacoes;
4. registrar observacoes em `schema_change_log.notes`.

## 7) Notas de seguranca operacional

- DDL no MySQL faz auto-commit. `down` e rollback logico, nao undo transacional.
- Nao usar `db:init` para migracao em producao.
- Migracoes aplicadas em producao devem permanecer imutaveis.

## 8) Referencias

- MySQL 8.0 DDL: https://dev.mysql.com/doc/refman/8.0/en/sql-data-definition-statements.html
- MySQL CHECK constraints: https://dev.mysql.com/doc/refman/8.0/en/create-table-check-constraints.html
- MySQL Event Scheduler: https://dev.mysql.com/doc/refman/8.0/en/event-scheduler.html
- InnoDB locking: https://dev.mysql.com/doc/refman/8.0/en/innodb-locking.html
- Referencia interna: `database/` e `docs/database/`
