# Mudancas Recentes do Projeto (2026-03-08)

Referencia de versao: `v2.5.6`

## Commits de referencia

- `bce359e` chore: remove unused request logger middleware
- `3f181ea` refactor: centralize config and sync baileys/socket/message helpers
- `059c84d` feat(ai-help): support v2 command schema and regenerate module agents
- `49af593` refactor: migrate command configs to v2 and harden validation
- `de0ec01` feat: add script to generate commands catalog in JSON format

## Principais mudancas tecnicas

1. Configuracao e runtime do bot consolidados

- Entrada unica em `app/config/index.js`.
- Partes de configuracao organizadas em:
  - `app/configParts/baileysConfig.js`
  - `app/configParts/groupUtils.js`
  - `app/configParts/adminIdentity.js`
- Estado de socket e resolucao LID/JID agora concentrados no `baileysConfig` (sem os antigos services dedicados).

2. Reducao de duplicacao entre conexao e processamento de mensagem

- `app/connection/socketController.js` e `app/controllers/messageController.js` passaram a consumir helpers comuns de `app/config/index.js`.
- Beneficio principal: mesma regra para disponibilidade de socket, normalizacao de IDs e resolucao de remetente.

3. Limpeza de codigo orfao

- Removido `server/middleware/requestLogger.js` (sem referencias de runtime).
- Logging de request sensivel permanece coberto no `server/http/httpServer.js`.

4. Evolucao de schema e pipeline de IA

- Novas migracoes adicionadas para:
  - hardening de sessao web (`d31`)
  - cache de respostas de IA (`d32`)
  - tabelas de aprendizado (`d33`)
  - enriquecimento de config de comandos (`d34`)
- Runbook atualizado em `docs/database/production-db-evolution-runbook-2026q1.md`.

## Impacto para desenvolvimento

- Importar utilitarios compartilhados via `app/config/index.js`.
- Evitar recriar parser/normalizador local em controller/socket quando ja existir helper exportado.
- Para mudancas em DB, seguir fases e validacoes do runbook atualizado.
