<img width="1318" height="352" alt="OmniZap banner" src="https://github.com/user-attachments/assets/d44835e7-021a-4c67-a0e7-5b858d51eb91" />

# OmniZap System

[![CI](https://github.com/Omnizap-System/omnizap-system/actions/workflows/ci.yml/badge.svg)](https://github.com/Omnizap-System/omnizap-system/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Omnizap-System/omnizap-system/actions/workflows/codeql.yml/badge.svg)](https://github.com/Omnizap-System/omnizap-system/actions/workflows/codeql.yml)
[![Gitleaks](https://github.com/Omnizap-System/omnizap-system/actions/workflows/security-gitleaks.yml/badge.svg)](https://github.com/Omnizap-System/omnizap-system/actions/workflows/security-gitleaks.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

Plataforma open source de automação para WhatsApp com foco em figurinhas, catálogo web, painel de usuário e operação profissional em produção.

---

## 🚀 Links Rápidos

- **Site Oficial:** [omnizap.shop](https://omnizap.shop/)
- **Documentação da API:** [/api-docs/](https://omnizap.shop/api-docs/)
- **Painel do Usuário:** [/user/](https://omnizap.shop/user/)
- **Catálogo de Figurinha:** [/stickers/](https://omnizap.shop/stickers/)
- **Wiki do Projeto:** [GitHub Wiki](https://github.com/Omnizap-System/omnizap-system/wiki)

---

## 🛠️ Quick Start (Local)

1. **Instalar dependências:**

   ```bash
   npm install
   ```

2. **Configurar Ambiente:**

   ```bash
   cp .env.example .env
   # Edite o .env com suas credenciais MySQL e segredos JWT
   ```

3. **Inicializar Banco e Frontend:**

   ```bash
   npm run db:init
   npm run build:frontend
   ```

4. **Rodar:**
   ```bash
   npm run dev
   ```

---

## 🏗️ Arquitetura & Stack

O sistema é dividido em 3 camadas integradas:

- **Bot Engine:** Baseado em `@whiskeysockets/baileys` (WhatsApp multi-device).
- **Web Server:** Node.js puro (`node:http`) com roteamento customizado e alta performance.
- **Frontend:** React com TailwindCSS e DaisyUI (Vite bundle).
- **Dados:** MySQL para persistência de mensagens, usuários e metadados de grupos.

---

## ✨ Funcionalidades Principais

- **Automação de Stickers:** Criação instantânea via comandos (`/s`, `/st`, etc.).
- **Gestão de Packs:** Criação, edição e publicação de pacotes de figurinhas via bot ou web.
- **Painel Web:** Autenticação segura, recuperação de senha e gestão de perfil.
- **Marketplace:** Catálogo público com SEO otimizado e busca dinâmica.
- **Observabilidade:** Métricas nativas para Prometheus e logs estruturados com Pino.

---

## 📊 Snapshot do Sistema

<!-- README_SNAPSHOT:START -->

> Os dados abaixo são atualizados automaticamente via script.

<!-- README_SNAPSHOT:END -->

---

## 📁 Estrutura do Projeto

- `app/`: Core do bot, módulos de comandos e serviços de domínio.
- `server/`: Rotas HTTP, middlewares de segurança e controladores web.
- `database/`: Schemas, migrações e inicialização do MySQL.
- `public/`: Código-fonte do frontend (React) e assets estáticos.
- `scripts/`: Utilitários de deploy, release e workers de background.
- `docs/`: Runbooks de segurança, conformidade (LGPD) e playbooks de SEO.

---

## 🛡️ Segurança e Compliance

Projeto desenvolvido com foco em conformidade e boas práticas:

- **LGPD:** Runbooks prontos para DSAR e Incidentes ANPD em `docs/`.
- **Hardening:** Esteira de segurança com SAST, Gitleaks e ZAP Scan.
- **AUP:** Política de Uso Aceitável rigorosa para evitar spam e abusos.

Para reportar vulnerabilidades, consulte [SECURITY.md](./SECURITY.md).

---

## 📄 Licença

Distribuído sob a licença **MIT**. Veja `LICENSE` para mais detalhes.
