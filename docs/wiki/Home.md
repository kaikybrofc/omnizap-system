# OmniZap Wiki

Bem-vindo à wiki oficial do **OmniZap System**.

Esta página é o ponto de entrada para entender o projeto, subir o ambiente local e navegar pelos principais fluxos técnicos e operacionais.

## Links rápidos

- Repositório: https://github.com/kaikybrofc/omnizap-system
- Site: https://omnizap.shop/
- Login web: https://omnizap.shop/login/
- API Docs: https://omnizap.shop/api-docs/
- Termos: https://omnizap.shop/termos-de-uso/
- Segurança: https://github.com/kaikybrofc/omnizap-system/blob/main/SECURITY.md
- Código de Conduta: https://github.com/kaikybrofc/omnizap-system/blob/main/CODE_OF_CONDUCT.md

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

## Navegação da wiki

Páginas recomendadas para criar/expandir em seguida:

- `[[Arquitetura]]`
- `[[Setup-Local]]`
- `[[Configuracao-.env]]`
- `[[Bot-e-Comandos]]`
- `[[Autenticacao-Web-e-Login-com-Google]]`
- `[[Deploy-e-Operacao]]`
- `[[Observabilidade]]`
- `[[Troubleshooting]]`
- `[[Contribuicao-e-Padroes]]`
- `[[Seguranca-e-Resposta-a-Incidentes]]`

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

## Referências externas úteis

- Node.js Docs: https://nodejs.org/docs/latest/api/
- MySQL 8.0 Reference Manual: https://dev.mysql.com/doc/refman/8.0/en/
- Prometheus Docs: https://prometheus.io/docs/introduction/overview/
- Grafana Docs: https://grafana.com/docs/

---

Última atualização: `2026-03-07`
