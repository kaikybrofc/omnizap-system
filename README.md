<img width="1318" height="352" alt="OmniZap banner" src="https://github.com/user-attachments/assets/d44835e7-021a-4c67-a0e7-5b858d51eb91" />

# OmniZap System

Plataforma open source de automação para WhatsApp, com foco em figurinhas, catálogo web, painel de usuário, autenticação web e operação observável em produção.

## Sumário

- [Links oficiais](#links-oficiais)
- [Visão geral](#visão-geral)
- [Arquitetura](#arquitetura)
- [Funcionalidades principais](#funcionalidades-principais)
- [Stack técnica](#stack-técnica)
- [Como rodar localmente](#como-rodar-localmente)
- [Configuração de ambiente (.env)](#configuração-de-ambiente-env)
- [Scripts importantes](#scripts-importantes)
- [Rotas e endpoints principais](#rotas-e-endpoints-principais)
- [Deploy em produção](#deploy-em-produção)
- [Observabilidade](#observabilidade)
- [Snapshot dinâmico do sistema](#snapshot-dinâmico-do-sistema)
- [Estrutura de pastas](#estrutura-de-pastas)
- [Segurança e boas práticas](#segurança-e-boas-práticas)
- [Contribuição](#contribuição)
- [Licença](#licença)

## Links oficiais

- Site: https://omnizap.shop/
- Login web: https://omnizap.shop/login/
- Painel do usuário: https://omnizap.shop/user/
- Catálogo de figurinhas: https://omnizap.shop/stickers/
- Criar pack (web): https://omnizap.shop/stickers/create/
- API Docs: https://omnizap.shop/api-docs/
- Termos de uso: https://omnizap.shop/termos-de-uso/
- Licença: https://omnizap.shop/licenca/
- Repositório: https://github.com/kaikybrofc/omnizap-system

## Visão geral

O OmniZap integra 3 camadas principais:

1. Bot WhatsApp (Baileys): comandos, automações, coleta de eventos e interações em grupos e conversas privadas.
2. Camada web: login, painel de usuário, marketplace/catálogo de packs e painel administrativo.
3. Camada de dados e operação: MySQL, workers internos, automação de e-mail, métricas e deploy.

Projeto open source com foco em:

- operação real em produção,
- evolução colaborativa,
- segurança pragmática,
- transparência técnica (código, fluxos e configurações auditáveis).

## Arquitetura

Fluxo simplificado:

```text
WhatsApp (Baileys)
  -> app/controllers + app/modules
  -> services (queues, login-link, notificações)
  -> MySQL (database/)

HTTP Server (node:http)
  -> server/routes/*
  -> páginas web (public/) + APIs (/api/sticker-packs, /api/email)
  -> /healthz /readyz /metrics

Workers/Background
  -> classificação e curadoria de stickers
  -> snapshot de score
  -> automação de e-mail
```

Bootstrap principal em [`index.js`](./index.js):

- inicializa o banco,
- sobe o servidor HTTP,
- conecta ao WhatsApp,
- inicia runtimes auxiliares,
- aplica shutdown gracioso para SIGINT/SIGTERM/falhas fatais.

## Funcionalidades principais

### Bot e comandos

- Criação de stickers (`/s`, `/sticker`, `/st`, `/stw`, `/stb`).
- Conversões (`/toimg`, `/play`, `/playvid`, `/tiktok`, etc.).
- Gestão de packs (`/pack create`, `/pack add`, `/pack list`, `/pack send`, `/pack publish`).
- Perfil de usuário no bot (`/user perfil`).

### Web app

- Login web e sessão persistente.
- Painel do usuário (`/user/`) com dados de conta e suporte.
- Recuperação de senha via e-mail (fluxo web).
- Catálogo público de packs (`/stickers/`) e tela de criação de pack.
- API Docs e termos/licença em páginas React.

### Plataforma de stickers

- Upload e organização de stickers e packs.
- Pipeline de classificação, curadoria e rebuild.
- Controle de visibilidade de pack (`public`, `private` e `unlisted`).
- Endpoints públicos e administrativos para marketplace.

### Operação

- Rate limiting em rotas sensíveis.
- Endpoint de métricas Prometheus.
- Health/readiness checks.
- Deploy com cache-bust e validações de build.
- Stack de observabilidade com Prometheus + Grafana + Loki + Promtail.

## Stack técnica

- Runtime: Node.js (engine mínima no projeto: `>=16`)
- Linguagem: JavaScript ESM
- Bot WhatsApp: `@whiskeysockets/baileys`
- Web server: `node:http` (router próprio em `server/routes`)
- Frontend: React + htm + Vite + TailwindCSS + DaisyUI
- Banco de dados: MySQL (`mysql2`)
- Auth/Segurança: JWT, bcrypt, rate limit, headers de segurança
- E-mail: Nodemailer (SMTP)
- Observabilidade: `prom-client`, Prometheus, Grafana, Loki
- IA (opcional): OpenAI

## Como rodar localmente

### 1) Requisitos

- Node.js 18+ recomendado (16+ mínimo suportado pelo projeto)
- npm
- MySQL ativo
- Conta/número para conexão do bot WhatsApp

### 2) Instalar dependências

```bash
npm install
```

### 3) Configurar ambiente

```bash
cp .env.example .env
```

Edite `.env` com foco inicial nas variáveis P1/P2 (veja seção abaixo).

### 4) Inicializar banco

```bash
npm run db:init
```

### 5) Build de frontend (recomendado)

```bash
npm run build:frontend
```

### 6) Subir aplicação

```bash
npm run dev
```

Ou:

```bash
npm start
```

## Configuração de ambiente (.env)

O arquivo [`.env.example`](./.env.example) está organizado por prioridade:

- `PRIORIDADE 1`: crítico para startup
- `PRIORIDADE 2`: operação base
- `PRIORIDADE 3`: funcionalidades opcionais
- `PRIORIDADE 4`: tuning avançado/workers/IA
- `PRIORIDADE 5`: deploy/release/DevOps

### Variáveis mínimas para subir com segurança

- App/Core: `NODE_ENV`, `PM2_APP_NAME`, `SITE_ORIGIN`
- Banco: `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- WhatsApp/Auth: `USER_ADMIN`, `WHATSAPP_LOGIN_LINK_SECRET`, `WEB_AUTH_JWT_SECRET`, `WEB_USER_PASSWORD_RECOVERY_HASH_SECRET`
- Web/API: `STICKER_API_BASE_PATH`, `STICKER_WEB_PATH`, `USER_PROFILE_WEB_PATH`
- E-mail (se usar reset/comunicação): `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`

### Nginx/Proxy e IP real do usuário

Se estiver atrás de Nginx/Cloudflare, habilite confiança de headers no backend:

```env
APP_TRUST_PROXY=true
RATE_LIMIT_TRUST_PROXY=true
```

Isso permite ler `x-forwarded-for`/`x-real-ip` corretamente em rotas protegidas.

## Scripts importantes

### Execução e build

- `npm run dev`: sobe o sistema localmente.
- `npm start`: execução padrão.
- `npm run build`: build geral de frontend.
- `npm run build:frontend`: CSS + JS web.
- `npm run build:css`: compila todos os estilos.
- `npm run build:js`: gera bundles Vite.

### Banco e qualidade

- `npm run db:init`: inicializa schema/tabelas.
- `npm test`: suíte de testes Node.
- `npm run lint`: análise estática.
- `npm run lint:fix`: corrige lint automaticamente.
- `npm run format:check`: valida formatação.
- `npm run format`: aplica formatação.

### Operação

- `npm run pm2:prod`: sobe processos PM2 (`ecosystem.prod.config.cjs`).
- `npm run deploy`: pipeline de deploy com validações.
- `npm run deploy:dry-run`: simula deploy sem alterar o ambiente.
- `npm run readme:sync-snapshot`: atualiza o bloco dinâmico do README.
- `npm run loadtest:stickers`: load test de endpoints de sticker.
- `npm run worker:sticker:classification`: worker dedicado de classificação.
- `npm run worker:sticker:curation`: worker dedicado de curadoria.
- `npm run worker:sticker:rebuild`: worker dedicado de rebuild.

## Rotas e endpoints principais

### Web

- `/login/`: autenticação web
- `/user/`: área do usuário
- `/user/password-reset`: redefinição de senha
- `/user/systemadm`: painel administrativo
- `/stickers/`: catálogo de packs
- `/api-docs/`: documentação funcional de API
- `/termos-de-uso/`: termos de uso

### API/serviços

- `/api/sticker-packs`: API principal de packs/stickers
- `/api/sticker-packs/admin`: operações administrativas
- `/api/marketplace/stats`: resumo público de marketplace
- `/api/email`: automação e outbox de e-mail

### Operação

- `/healthz`: health check
- `/readyz`: readiness check
- `/metrics`: métricas Prometheus

## Deploy em produção

Pipeline principal:

```bash
npm run deploy
```

Modo simulação:

```bash
npm run deploy:dry-run
```

O script [`scripts/deploy.sh`](./scripts/deploy.sh) cobre:

- build de assets,
- verificação de bundles/arquivos obrigatórios,
- sincronização para diretório de deploy,
- cache-bust de assets e páginas,
- validação pós-sync,
- reload do Nginx,
- restart do PM2,
- hooks opcionais de notificação GitHub Deployments.

Variáveis de deploy comuns: `DEPLOY_TARGET_DIR`, `DEPLOY_SOURCE_DIR`, `DEPLOY_DRY_RUN`, `DEPLOY_PM2_APP_NAME`, `DEPLOY_NGINX_SERVICE`.

## Observabilidade

### Métricas da aplicação

Config padrão (via `.env`):

- `METRICS_ENABLED=true`
- `METRICS_HOST=0.0.0.0`
- `METRICS_PORT=9102`
- `METRICS_PATH=/metrics`

### Stack Prometheus/Grafana/Loki

Suba a stack local de observabilidade:

```bash
docker compose up -d
```

Serviços padrão:

- Prometheus: `:9090`
- Grafana: `:3003`
- Loki: `:3100`
- Promtail: `:9080`
- MySQL Exporter: `:9104`
- Node Exporter: `:9100`

Arquivo base: [`docker-compose.yml`](./docker-compose.yml)

## Snapshot dinâmico do sistema

Este bloco é alimentado automaticamente pela API (`/api/sticker-packs/readme-markdown`) via script `npm run readme:sync-snapshot`.

<!-- README_SNAPSHOT:START -->
### Snapshot do Sistema

> Atualizado em `2026-03-06T11:52:27.370Z` | cache `1800s`

| Métrica | Valor |
| --- | ---: |
| Usuários (lid_map) | 5.601 |
| Grupos | 119 |
| Packs | 357 |
| Stickers | 10.549 |
| Mensagens registradas | 484.108 |

#### Tipos de mensagem mais usados (amostra: 25.000)
| Tipo | Total |
| --- | ---: |
| `texto` | 15.410 |
| `figurinha` | 4.742 |
| `imagem` | 2.091 |
| `outros` | 1.277 |
| `reacao` | 1.089 |
| `video` | 226 |
| `audio` | 164 |
| `documento` | 1 |

<details><summary>Comandos disponíveis (64)</summary>

`/add` · `/addmode` · `/autorequests` · `/autosticker` · `/ban` · `/captcha` · `/cat` · `/catimg` · `/catprompt` · `/catprompt reset` · `/chatwindow` · `/dado` · `/down` · `/farewell` · `/groups` · `/info` · `/invite` · `/join` · `/leave` · `/menu anime` · `/menu figurinhas` · `/menu ia` · `/menu midia` · `/menu quote` · `/menu stats` · `/menuadm` · `/metadata` · `/newgroup` · `/noticias` · `/nsfw` · `/pack add` · `/pack create` · `/pack list` · `/pack send` · `/ping` · `/play` · `/playvid` · `/prefix` · `/premium` · `/quote` · `/ranking` · `/rankingglobal` · `/requests` · `/revoke` · `/s` · `/setdesc` · `/setgroup` · `/setsubject` · `/st` · `/stb` · `/sticker` · `/stickermode` · `/stickermsglimit` · `/stickertext` · `/stickertextblink` · `/stickertextwhite` · `/stw` · `/temp` · `/tiktok` · `/toimg` · `/up` · `/updaterequests` · `/user perfil` · `/welcome`

</details>
<!-- README_SNAPSHOT:END -->

## Estrutura de pastas

```text
.
├── app/                 # Bot, comandos, serviços e observabilidade de domínio
├── server/              # Servidor HTTP, rotas web/API, middleware e auth web
├── database/            # Inicialização e acesso MySQL
├── public/              # Frontend público (páginas, assets, bundles)
├── scripts/             # Deploy, release, workers e utilitários operacionais
├── observability/       # Configs Prometheus/Grafana/Loki/Promtail
├── ml/                  # Componentes de classificação (suporte ML)
├── docs/seo/            # Materiais de SEO e geração de páginas satélite
└── index.js             # Bootstrap principal da aplicação
```

## Segurança e boas práticas

- Não faça commit de `.env` com credenciais reais.
- Troque segredos padrão antes de produção (`WEB_AUTH_JWT_SECRET`, `WHATSAPP_LOGIN_LINK_SECRET`, etc.).
- Mantenha `NODE_ENV=production` em produção.
- Ative proxy trust atrás de Nginx/Cloudflare para IP real (`APP_TRUST_PROXY=true`).
- Use SMTP válido para fluxos de senha e comunicação.
- Revise periodicamente os termos em `/termos-de-uso/`.

## Contribuição

Contribuições são bem-vindas.

Fluxo sugerido:

1. Abra uma branch (`feat/*`, `fix/*`, `chore/*`).
2. Rode checks locais (`npm run lint`, `npm test`, `npm run build`).
3. Envie PR com descrição objetiva do impacto técnico.
4. Atualize a documentação quando alterar fluxo/ambiente/deploy.

Para issues e PRs: https://github.com/kaikybrofc/omnizap-system

## Licença

Este projeto está sob licença MIT. Veja [`LICENSE`](./LICENSE).
