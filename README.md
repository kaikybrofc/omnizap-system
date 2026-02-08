<img width="1318" height="352" alt="OmniZap banner" src="https://github.com/user-attachments/assets/d44835e7-021a-4c67-a0e7-5b858d51eb91" />

![Node.js](https://img.shields.io/badge/Node.js-18%2B-3C873A?logo=node.js&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?logo=javascript&logoColor=000)
![MySQL](https://img.shields.io/badge/MySQL-8%2B-4479A1?logo=mysql&logoColor=white)
![Baileys](https://img.shields.io/badge/Baileys-WhatsApp%20SDK-25D366?logo=whatsapp&logoColor=white)
![PM2](https://img.shields.io/badge/PM2-Process%20Manager-2B037A?logo=pm2&logoColor=white)
![OpenAI](https://img.shields.io/badge/OpenAI-SDK-111111?logo=openai&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-0B6E4F?logo=opensourceinitiative&logoColor=white)

O **OmniZap System** é uma plataforma de automação para WhatsApp usando **Node.js + Baileys**, com foco em:

- comando por chat (grupos e privado)
- persistência em MySQL
- automações administrativas
- mídia/figurinhas com packs persistentes
- observabilidade (Prometheus/Grafana/Loki)

## Recursos principais

- Gerenciamento de grupos (admin, boas-vindas, despedida, anti-link, captcha).
- Prefixo de comando por grupo.
- Comandos de mídia (`play`, `playvid`, stickers e conversões).
- Sticker packs persistentes com CRUD e envio com fallback.
- Recursos de IA (`cat`, `catimg`, `catprompt`) com OpenAI.
- Estatísticas (`ranking`, `rankingglobal`, `social`, `semmsg`, `user perfil`).
- Suporte a LID/JID com reconciliação automática (`lid_map`).
- Métricas e logs estruturados para operação em produção.

## Pré-requisitos

- Node.js 18+ recomendado.
- MySQL 8+.
- FFmpeg instalado e acessível no `PATH`.
- PM2 (opcional): `npm i -g pm2`.
- Docker Compose (opcional, para stack de observabilidade).

## Instalação rápida

1. Clone o repositório:

```bash
git clone https://github.com/Kaikygr/omnizap-system.git
cd omnizap-system
```

2. Instale dependências:

```bash
npm install
```

3. Crie o `.env` a partir do exemplo:

```bash
cp .env.example .env
```

4. Ajuste as variáveis mínimas obrigatórias no `.env`:

```env
DB_HOST=localhost
DB_USER=seu_usuario
DB_PASSWORD=sua_senha
DB_NAME=omnizap
USER_ADMIN=seu_jid@s.whatsapp.net
IMAGE_MENU=https://example.com/menu.png
```

5. Inicialize banco e tabelas:

```bash
npm run db:init
```

6. Inicie o bot:

```bash
npm run start
```

7. Escaneie o QR Code no terminal.

## Observações importantes de ambiente

- `DB_NAME` recebe sufixo automaticamente:
  - `NODE_ENV=development` => `_dev`
  - `NODE_ENV=production` => `_prod`
  - Se já terminar com `_dev` ou `_prod`, o nome é preservado.
- `COMMAND_PREFIX` pode ser global e também por grupo (via comandos admin).
- `LID_BACKFILL_ON_START=true` habilita backfill de `lid_map` no boot.
- `LID_BACKFILL_BATCH` padrão do serviço: `50000`.

## Scripts npm

- `npm run start`: inicia o app (`node index.js`).
- `npm run dev`: alias de start.
- `npm run db:init`: cria/valida schema e executa migrations.
- `npm run pm2:prod`: sobe com PM2 usando `ecosystem.prod.config.cjs`.
- `npm run test`: executa testes Node (`node --test`).
- `npm run lint`: lint com ESLint.
- `npm run lint:fix`: lint com correções automáticas.

## Execução com PM2

Após conectar o QR uma primeira vez em modo normal:

```bash
npm run pm2:prod
```

Comandos úteis:

```bash
pm2 status
pm2 logs
pm2 restart omnizap-system-production
```

> O QR Code não é exibido no fluxo do PM2. Conecte primeiro no modo normal.

## Comandos principais

Use `menu` para ver os comandos por categoria. Exemplos:

- `<prefix>menu`
- `<prefix>menu figurinhas`
- `<prefix>menu midia`
- `<prefix>menu ia`
- `<prefix>menu stats`
- `<prefix>menuadm`

Comandos mais usados:

- `<prefix>sticker` / `<prefix>s`
- `<prefix>stickertext` / `<prefix>st` / `<prefix>stw` / `<prefix>stb`
- `<prefix>toimg` / `<prefix>tovideo`
- `<prefix>play <busca|url>`
- `<prefix>playvid <busca|url>`
- `<prefix>quote`
- `<prefix>cat`, `<prefix>catimg`, `<prefix>catprompt`
- `<prefix>ranking`, `<prefix>rankingglobal`, `<prefix>social`, `<prefix>semmsg`
- `<prefix>user perfil`

## Sticker packs persistentes

Exemplos de fluxo:

```text
<prefix>pack create "Meu Pack"
<prefix>pack add <pack>
<prefix>pack list
<prefix>pack info <pack>
<prefix>pack send <pack>
<prefix>pack publish <pack> <private|public|unlisted>
<prefix>pack delete <pack>
```

Notas:

- Edição de pack é restrita ao dono (`owner_jid`).
- O envio tenta sticker pack nativo e faz fallback automático quando necessário.
- O sistema captura “última figurinha” para simplificar `add` e `setcover`.

### Catálogo web de packs

O servidor HTTP de observabilidade também expõe um catálogo web simples para os packs publicados:

- Página web: `http://localhost:9102/stickers`
- API: `http://localhost:9102/api/sticker-packs`
- Endpoint de métricas permanece em: `http://localhost:9102/metrics`

Principais rotas da API:

- `GET /api/sticker-packs?q=&visibility=public|unlisted|all&limit=&offset=`
- `GET /api/sticker-packs/orphan-stickers?q=&limit=&offset=` (figurinhas salvas sem pack)
- `GET /api/sticker-packs/:packKey`
- `GET /api/sticker-packs/:packKey/stickers/:stickerId.webp`
- `GET /api/sticker-packs/data-files?q=&limit=&offset=` (lista imagens da pasta `data`)
- `GET /data/<caminho-da-imagem>` (acesso direto ao arquivo de imagem)

## Suporte a LID/JID

O WhatsApp pode alternar IDs entre `@lid` e `@s.whatsapp.net`.  
O OmniZap resolve isso com um `sender_id` canônico para manter métricas/rankings consistentes.

- Tabela dedicada: `lid_map`.
- Cache em memória com TTL.
- Reconciliação automática quando o JID real aparece.
- Backfill opcional no startup.

## Observabilidade (Prometheus + Grafana + Loki)

O projeto inclui `docker-compose.yml` com:

- Prometheus
- Grafana
- Loki
- Promtail
- MySQL Exporter
- Node Exporter

Subir stack:

```bash
docker compose up -d
```

Setup recomendado de métricas MySQL:

```bash
sudo mysql < observability/mysql-setup.sql
```

Acessos padrão:

- Grafana: `http://localhost:3003`
- Prometheus: `http://localhost:9090`
- Loki: `http://localhost:3100`
- Métricas do app: `http://localhost:9102/metrics`

Arquivos úteis:

- `observability/prometheus.yml`
- `observability/alert-rules.yml`
- `observability/grafana/dashboards/omnizap-overview.json`
- `observability/grafana/dashboards/omnizap-mysql.json`

## Troubleshooting

**QR não aparece no PM2**

- Inicie com `npm run start`, conecte o QR e depois volte para PM2.
- Se necessário, limpe sessão salva e reconecte.

**Erro de conexão MySQL**

- Verifique `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.
- Confirme se o usuário possui permissão de leitura/escrita.

**FFmpeg não encontrado**

- Instale FFmpeg no sistema ou configure `FFMPEG_PATH`/`FFPROBE_PATH`.

**Comando `play` falhando**

- Verifique se o serviço configurado em `YTDLS_BASE_URL`/`YT_DLS_BASE_URL` está ativo.

## Tecnologias

- Node.js
- MySQL (`mysql2`)
- Baileys (`@whiskeysockets/baileys`)
- OpenAI SDK
- Axios
- Canvas
- PM2
- Prometheus / Grafana / Loki

## Contribuições

1. Faça um fork.
2. Crie uma branch: `git checkout -b feature/minha-feature`.
3. Commit: `git commit -m "feat: minha feature"`.
4. Push: `git push origin feature/minha-feature`.
5. Abra um Pull Request.

## Licença

Licença MIT. Veja [`LICENSE`](LICENSE).
