# OmniZap Wiki

Bem-vindo à wiki oficial do **OmniZap System**.

Esta página é o ponto de entrada para entender o projeto, subir o ambiente local e navegar pelos principais fluxos técnicos e operacionais.

## Status Atual

- Versão do projeto: `2.5.6`
- Snapshot desta wiki: `2026-03-08`
- Roadmap técnico recente: consolidação de configuração/tempo de execução do bot e redução de duplicação entre controlador/socket.

## Links rápidos

- Repositório: https://github.com/Omnizap-System/bot-de-omnizap
- Site: https://omnizap.shop/
- Login web: https://omnizap.shop/login/
- API Docs: https://omnizap.shop/api-docs/
- Termos: https://omnizap.shop/termos-de-uso/
- Segurança: https://github.com/Omnizap-System/bot-de-omnizap/blob/main/SECURITY.md
- Código de Conduta: https://github.com/Omnizap-System/bot-de-omnizap/blob/main/CODE_OF_CONDUCT.md

## O que é o OmniZap

O OmniZap é uma plataforma open source com 3 camadas principais:

1. Bot WhatsApp (Baileys): comandos, automações e eventos.
2. Camada web: login, painel de usuário e catálogo de stickers.
3. Camada de dados e operação: MySQL, workers, métricas e deploy.

## Quick Start (local)

```bash
npm install
cp .env.example .env
npm run db:init
npm run build:frontend
npm run dev
```

Rotas úteis após subir:

- `http://localhost:3000/healthz`
- `http://localhost:3000/readyz`
- `http://localhost:3000/metrics`

## Mapa rápido de arquitetura

```text
WhatsApp (Baileys)
  -> app/connection + app/controllers + app/modules
  -> app/services (persistência, filas, login-link, integrações)
  -> database/ (MySQL)

HTTP Server
  -> server/routes/*
  -> public/ (páginas web)

Operação
  -> scripts/
  -> observability/ (Prometheus, Grafana, Loki)
```

## Mudanças Recentes

- Refatoração de configuração: entrada unificada em `app/config/index.js` com reexport de `app/configParts/*`.
- Consolidação de estado/socket/LID no `baileysConfig` e sincronização de consumo em:
  - `app/connection/socketController.js`
  - `app/controllers/messageController.js`
- Remoção de arquivo órfão de middleware HTTP:
  - `server/middleware/requestLogger.js`
- Atualização dos audits de `stickerCatalogController` para novo snapshot.
- Atualização do runbook de banco para incluir migrações `d31` a `d34`.

## Navegação da wiki

Páginas recomendadas para criar/expandir em seguida:

- `[[Arquitetura]]`
- `[[Setup-Local]]`
- `[[Configuração-.env]]`
- `[[Bot-e-Comandos]]`
- `[[Autenticação-Web-e-Login-com-Google]]`
- `[[Deploy-e-Operação]]`
- `[[Observabilidade]]`
- `[[Troubleshooting]]`
- `[[Contribuição-e-Padrões]]`
- `[[Segurança-e-Resposta-a-Incidentes]]`

## Governança de documentação

- Prefira exemplos executáveis (comandos reais e verificáveis).
- Sempre documente impacto de configurações em `.env`.
- Ao mudar fluxo de módulo/serviço, atualize README + wiki + runbooks.
- Evite duplicar regra de negócio: referencie arquivo-fonte quando possível.
- Mantenha data de atualização ao final da página.

## Referências internas

- README principal: `README.md`
- Runbook de evolução de banco: `docs/database/production-db-evolution-runbook-2026q1.md`
- Runbook de hardening de rede: `docs/security/network-hardening-runbook-2026-03-07.md`
- Runbook de incidentes LGPD/ANPD: `docs/security/incident-response-lgpd-anpd-runbook-2026-03-07.md`
- Checklist mensal de compliance: `docs/compliance/monthly-compliance-checklist-2026-03-07.md`
- Playbook SEO BR: `docs/seo/omnizap-seo-playbook-br-2026-02-28.md`
- Template de páginas satélite: `docs/seo/satellite-page-template.md`
- Mudanças recentes (detalhado): `docs/wiki/recent-changes-2026-03-08.md`
- Audit (escopo): `docs/audits/stickerCatalogController-out-of-scope.md`
- Audit (símbolos): `docs/audits/stickerCatalogController-symbols.md`

## Referências externas úteis

- Node.js Docs: https://nodejs.org/docs/latest/api/
- MySQL 8.0 Reference Manual: https://dev.mysql.com/doc/refman/8.0/en/
- Prometheus Docs: https://prometheus.io/docs/introduction/overview/
- Grafana Docs: https://grafana.com/docs/

---

Última atualização: `2026-03-08`
