# OmniZap Wiki

Bem-vindo a wiki oficial do **OmniZap System**.

Esta pagina e o ponto de entrada para entender o projeto, subir o ambiente local e navegar pelos principais fluxos tecnicos.

## Links rapidos

- Repositorio: https://github.com/kaikybrofc/omnizap-system
- Site: https://omnizap.shop/
- Login web: https://omnizap.shop/login/
- API Docs: https://omnizap.shop/api-docs/
- Termos: https://omnizap.shop/termos-de-uso/

## O que e o OmniZap

O OmniZap e uma plataforma open source com 3 camadas principais:

1. Bot WhatsApp (Baileys): comandos, automacoes e eventos.
2. Camada web: login, painel de usuario e catalogo de stickers.
3. Camada de dados e operacao: MySQL, workers, metricas e deploy.

## Quick Start (local)

```bash
npm install
cp .env.example .env
npm run db:init
npm run build:frontend
npm run dev
```

Rotas uteis apos subir:

- `http://localhost:3000/healthz`
- `http://localhost:3000/readyz`
- `http://localhost:3000/metrics`

## Mapa rapido de arquitetura

```text
WhatsApp (Baileys)
  -> app/connection + app/controllers + app/modules
  -> app/services (persistencia, filas, login-link, integracoes)
  -> database/ (MySQL)

HTTP Server
  -> server/routes/*
  -> public/ (paginas web)

Operacao
  -> scripts/
  -> observability/ (Prometheus, Grafana, Loki)
```

## Navegacao da wiki

Paginas recomendadas para criar em seguida:

- `[[Arquitetura]]`
- `[[Setup-Local]]`
- `[[Configuracao-.env]]`
- `[[Bot-e-Comandos]]`
- `[[Autenticacao-Web-e-Login-com-Google]]`
- `[[Deploy-e-Operacao]]`
- `[[Observabilidade]]`
- `[[Troubleshooting]]`
- `[[Contribuicao-e-Padroes]]`

## Diretrizes de documentacao

- Prefira exemplos executaveis (comandos reais).
- Sempre documente impacto de configuracoes em `.env`.
- Ao mudar fluxo de modulo/servico, atualize README + wiki.
- Evite duplicar regra de negocio: referencie arquivo fonte quando possivel.

---

Ultima atualizacao: `2026-03-06`
