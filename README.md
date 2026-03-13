<img width="1318" height="352" alt="OmniZap banner" src="https://iili.io/qlAYvSf.png" />

# Omnizap

Projeto principal da organizacao **Omnizap**, focado em automacao para WhatsApp com bot, painel web, catalogo de figurinhas e operacao em producao.

[![CI](https://github.com/Omnizap-System/omnizap/actions/workflows/ci.yml/badge.svg)](https://github.com/Omnizap-System/omnizap/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Omnizap-System/omnizap/actions/workflows/codeql.yml/badge.svg)](https://github.com/Omnizap-System/omnizap/actions/workflows/codeql.yml)
[![Gitleaks](https://github.com/Omnizap-System/omnizap/actions/workflows/security-gitleaks.yml/badge.svg)](https://github.com/Omnizap-System/omnizap/actions/workflows/security-gitleaks.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

## Organizacao e Projeto

- Organizacao: [Omnizap](https://github.com/Omnizap-System)
- Perfil da organizacao: [Omnizap-System/.github](https://github.com/Omnizap-System/.github)
- Projeto principal: [Omnizap](https://github.com/Omnizap-System/omnizap)
- Pacote atual: `omnizap`

## Links Oficiais

- Site: https://omnizap.shop/
- Documentacao da API: https://omnizap.shop/api-docs/
- Painel do usuario: https://omnizap.shop/user/
- Catalogo de figurinhas: https://omnizap.shop/stickers/
- Wiki: https://github.com/Omnizap-System/omnizap/wiki

## Quick Start

1. Instale dependencias:

```bash
npm install
```

2. Configure ambiente:

```bash
cp .env.example .env
```

3. Inicialize banco e frontend:

```bash
npm run db:init
npm run build:frontend
```

4. Rode localmente:

```bash
npm run dev
```

## Stack

- Bot engine: `@whiskeysockets/baileys`
- Backend HTTP: Node.js
- Frontend: React + TailwindCSS + DaisyUI
- Banco de dados: MySQL
- Observabilidade: Prometheus + logs estruturados

## Estrutura do Repositorio

- `app/`: modulos do bot e servicos de dominio
- `server/`: rotas, middlewares e controladores HTTP
- `database/`: schema, init e evolucao de banco
- `public/`: frontend React e assets estaticos
- `scripts/`: automacoes de build, release e operacao
- `docs/`: runbooks de seguranca, compliance e SEO

## Seguranca

- Politica e processo de reporte em [SECURITY.md](./SECURITY.md)
- Fluxo de seguranca com CodeQL, Gitleaks e hardening de workflows
- Materiais de conformidade em `docs/compliance` e `docs/security`

## Licenca

Distribuido sob a licenca MIT. Consulte [LICENSE](./LICENSE).
