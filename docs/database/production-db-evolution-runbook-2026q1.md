# Runbook de Evolução de Banco em Produção (2026 Q1)

Escopo: hardening e evolução gradual de esquema em MySQL/InnoDB, com foco em mudanças não destrutivas nas fases iniciais.

## Objetivo

Este runbook define o processo operacional para aplicar, validar e, se necessário, reverter as migrações planejadas para o ciclo 2026 Q1, minimizando risco de indisponibilidade e regressão de desempenho.

## Arquivos alvo

- `database/migrations/20260307_d0_hardening_up.sql`
- `database/migrations/20260307_d0_hardening_down.sql`
- `database/migrations/20260314_d7_canonical_sender_up.sql`
- `database/migrations/20260314_d7_canonical_sender_down.sql`
- `database/migrations/20260406_d30_security_analytics_up.sql`
- `database/migrations/20260406_d30_security_analytics_down.sql`

## 1) Pré-requisitos

1. Confirmar engine e versão do MySQL:

```sql
SELECT VERSION() AS mysql_version;
```

Recomendado: MySQL 8.0.16+ (suporte consistente a `CHECK` e `DROP CHECK`).

2. Confirmar política de scheduler de eventos:

```sql
SHOW VARIABLES LIKE 'event_scheduler';
```

Se a política do ambiente permitir jobs de retenção/rollup no banco, mantenha `event_scheduler=ON` em nível de servidor.

3. Garantir estratégia de backup antes de cada fase:

- backup lógico do schema de destino;
- cadeia de recuperação point-in-time (binlog + snapshots);
- teste de restauração em ambiente de homologação.

4. Postura operacional:

- executar em janelas de menor pressão de escrita;
- manter a aplicação online na D0;
- D+7 e D+30 podem ser online, com monitoramento ativo de latência.

## 2) Comando padrão de execução

Uso recomendado via `mysql` CLI:

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/<arquivo>.sql
```

## 3) Fase D0 - Hardening não disruptivo

### Aplicar

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/20260307_d0_hardening_up.sql
```

### Validar

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

### Rollback lógico

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/20260307_d0_hardening_down.sql
```

## 4) Fase D+7 - Migração para remetente canônico

### Aplicar

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/20260314_d7_canonical_sender_up.sql
```

### Validar

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

### Checkpoint de rollout da aplicação

Após D+7, publicar ajustes de aplicação/queries que priorizem `messages.canonical_sender_id` em caminhos de ranking e analytics.

### Rollback lógico

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/20260314_d7_canonical_sender_down.sql
```

## 5) Fase D+30 - Segurança, analytics e retenção

### Aplicar

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/20260406_d30_security_analytics_up.sql
```

### Validar

```sql
SELECT migration_key, phase, status, updated_at
  FROM schema_change_log
 WHERE migration_key = '20260406_d30_security_analytics';

SHOW COLUMNS FROM web_google_session LIKE 'session_token_hash';
SHOW INDEX FROM web_google_session;

SELECT COUNT(*) AS null_session_hash
  FROM web_google_session
 WHERE session_token_hash IS NULL;

SELECT COUNT(*) AS message_activity_daily_rows
  FROM message_activity_daily;

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

### Pós-checagem de constraints

Se alguma `CHECK` for ignorada, o script emitirá mensagens `SKIPPED`. Nesse caso:

1. corrigir os dados violadores;
2. reexecutar a migração D+30 (`up`);
3. repetir as validações da fase.

### Rollback lógico

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/20260406_d30_security_analytics_down.sql
```

## 6) Checklist de monitoramento (todas as fases)

Monitorar por 30-60 minutos após cada fase:

- `Threads_running`, waits de lock InnoDB e latência p95/p99;
- profundidade de filas e workers presos (`status='processing'` com `locked_at` obsoleto);
- picos em slow query log para `messages` e tabelas de fila.

Consultas rápidas recomendadas:

```sql
SELECT status, COUNT(*) FROM domain_event_outbox GROUP BY status;
SELECT status, COUNT(*) FROM email_outbox GROUP BY status;
SELECT status, COUNT(*) FROM sticker_worker_task_queue GROUP BY status;
```

## 7) Critério de avanço (go/no-go)

Prosseguir para a próxima fase somente se:

- status da migração atual estiver `applied` em `schema_change_log`;
- validações obrigatórias estiverem consistentes;
- não houver degradação sustentada de latência/erros.

Suspender avanço se houver:

- aumento persistente de lock waits;
- crescimento anômalo de filas sem drenagem;
- erros de aplicação relacionados às colunas/índices alterados.

## 8) Política de roll-forward

Quando rollback não for estritamente necessário e os dados estiverem íntegros:

1. manter a fase aplicada;
2. ajustar queries da aplicação para os novos índices/colunas;
3. repetir validações;
4. registrar postmortem e observações em `schema_change_log.notes`.

## 9) Notas de segurança operacional

- DDL no MySQL faz auto-commit. Scripts de `down` são rollbacks lógicos, não undo transacional.
- Não usar `db:init` como mecanismo de migração em produção, pois ele aplica schema consolidado e pode mascarar drift.
- Após execução em produção, tratar arquivos de migração como imutáveis. Mudanças devem entrar em novos arquivos/versionamentos.

## 10) Referências

- MySQL 8.0 Reference Manual (DDL): https://dev.mysql.com/doc/refman/8.0/en/sql-data-definition-statements.html
- MySQL `CHECK` constraints: https://dev.mysql.com/doc/refman/8.0/en/create-table-check-constraints.html
- MySQL Event Scheduler: https://dev.mysql.com/doc/refman/8.0/en/event-scheduler.html
- InnoDB locking e monitoramento: https://dev.mysql.com/doc/refman/8.0/en/innodb-locking.html
- Guia interno de banco (projeto): `database/` e `docs/database/`
