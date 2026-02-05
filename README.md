<img width="1318" height="352" alt="image" src="https://github.com/user-attachments/assets/d44835e7-021a-4c67-a0e7-5b858d51eb91" />

![Node.js](https://img.shields.io/badge/Node.js-18%2B-3C873A?logo=node.js&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?logo=javascript&logoColor=000)
![MySQL](https://img.shields.io/badge/MySQL-8%2B-4479A1?logo=mysql&logoColor=white)
![Baileys](https://img.shields.io/badge/Baileys-WhatsApp%20SDK-25D366?logo=whatsapp&logoColor=white)
![PM2](https://img.shields.io/badge/PM2-Process%20Manager-2B037A?logo=pm2&logoColor=white)
![OpenAI](https://img.shields.io/badge/OpenAI-SDK-111111?logo=openai&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-0B6E4F?logo=opensourceinitiative&logoColor=white)

O **OmniZap System** é uma plataforma de automação para WhatsApp em Node.js com Baileys, oferecendo gerenciamento de grupos, automação de interações e comandos personalizados com suporte a MySQL.

## ✨ Recursos Principais

*   Automação e Gerenciamento de WhatsApp
*   Comandos Personalizados
*   Integração com MySQL
*   Gerenciamento de Mídia (figurinhas)
*   Sticker Packs persistentes por usuário (CRUD + envio com fallback)
*   Normalização de IDs LID/JID (Baileys) com reconciliação automática
*   Monitoramento com PM2

## 🚀 Instalação

Siga os passos para configurar e executar:

## ✅ Pré-requisitos

*   Node.js 18+ (recomendado)
*   MySQL 8+
*   PM2 instalado globalmente (`npm i -g pm2`)
*   FFmpeg instalado no sistema para recursos de mídia (figurinhas)
*   Docker + Docker Compose (opcional, para observabilidade)

1.  **Clone o repositório:**
    ```bash
    git clone https://github.com/Kaikybrofc/omnizap-system.git
    cd omnizap-system
    ```

2.  **Instale as dependências:**
    ```bash
    npm install
    ```

3.  **Configure as variáveis de ambiente:** Crie um arquivo `.env` na raiz do projeto:

    ```env
    # Configurações do Bot
    COMMAND_PREFIX=#
    COMMAND_REACT_EMOJI=🤖
    USER_ADMIN=seu_jid_de_admin@s.whatsapp.net
    PM2_APP_NAME=omnizap-system
    LOG_LEVEL=info
    NODE_ENV=development
    IMAGE_MENU=https://example.com/assets/omnizap-banner.png
    BAILEYS_VERSION=

    # Configurações do MySQL
    DB_HOST=localhost
    DB_USER=user1
    DB_PASSWORD=1234
    DB_NAME=omnizap
    DB_POOL_LIMIT=10

    # Observabilidade (Prometheus)
    METRICS_ENABLED=true
    METRICS_HOST=0.0.0.0
    METRICS_PORT=9102
    METRICS_PATH=/metrics

    # Monitor de DB (logs estruturados)
    DB_MONITOR_ENABLED=true
    DB_MONITOR_LOG_PATH=./logs/db-monitor.log
    DB_SLOW_QUERY_MS=500
    DB_QUERY_ALERT_THRESHOLDS=500,1000

    # Paths e armazenamento
    STORE_PATH=./temp

    # Backfill do lid_map ao iniciar (default: true)
    LID_BACKFILL_ON_START=true

    # Tamanho do batch do backfill (default: 50000)
    LID_BACKFILL_BATCH=5000000

    # OpenAI
    OPENAI_API_KEY=
    OPENAI_MODEL=gpt-5-nano
    OPENAI_SYSTEM_PROMPT=
    OPENAI_SESSION_TTL_SECONDS=21600
    OPENAI_TTS_MODEL=gpt-4o-mini-tts
    OPENAI_TTS_VOICE=alloy
    OPENAI_TTS_FORMAT=mp3
    OPENAI_TTS_PTT=false
    OPENAI_TTS_MAX_CHARS=4096
    OPENAI_MAX_IMAGE_MB=50

    # Quote API
    QUOTE_API_URL=https://bot.lyo.su/quote/generate.png
    QUOTE_BG_COLOR=#0b141a
    QUOTE_TIMEOUT_MS=20000

    # Waifu.pics
    WAIFU_PICS_BASE=https://api.waifu.pics
    WAIFU_PICS_TIMEOUT_MS=15000
    WAIFU_PICS_ALLOW_NSFW=false

    # YT-DL/Play
    YTDLS_BASE_URL=http://127.0.0.1:3000
    YT_DLS_BASE_URL=
    PLAY_API_TIMEOUT_MS=900000
    PLAY_API_DOWNLOAD_TIMEOUT_MS=1800000
    PLAY_MAX_MB=100
    PLAY_QUEUE_STATUS_TIMEOUT_MS=8000

    # FFmpeg (opcional) - se o binário não estiver no PATH do sistema
    # FFMPEG_PATH=/usr/bin/ffmpeg
    ```

4.  **Prepare o banco de dados:**
    *   Crie o banco indicado em `DB_NAME`.
    *   Garanta que o usuário tenha permissões de leitura e escrita.

## 🧩 Suporte a LID/JID (Baileys)

O WhatsApp (Baileys) pode retornar participantes em formato `@lid`. O OmniZap agora resolve um **sender_id canônico** para manter rankings, logs e análises consistentes:

*   Sempre que possível, usa o JID real (`xxx@s.whatsapp.net`).
*   Quando não há JID real, usa o LID (`xxx@lid`) temporariamente.
*   Quando o JID real aparece depois, ocorre **reconciliação automática** (migrando mensagens antigas do LID para o JID).

Banco de dados:

*   Nova tabela `lid_map` (LID → JID) com `first_seen`, `last_seen` e `source`.
*   Cache em memória com TTL para evitar consultas por mensagem.
*   Captura de `participantAlt` em `messages.upsert` e `contacts.update` quando disponível.
*   Backfill automático no boot usando mensagens salvas (`participantAlt`).

Configurações opcionais:

```env
# Backfill do lid_map ao iniciar (default: true)
LID_BACKFILL_ON_START=true

# Tamanho do batch do backfill (default: 50000)
LID_BACKFILL_BATCH=50000
```

## ▶️ Como Executar

Para iniciar direto via Node:

```bash
npm run start
# ou
node index.js
```

Para iniciar com PM2:

```bash
pm2 start ecosystem.prod.config.js # Produção
```

Alerta: use o PM2 somente depois de conectar o QR code no modo normal, pois o PM2 não exibe o QR de conexão.

## 📦 Sticker Packs (Persistente)

O bot agora suporta packs de figurinhas salvos no MySQL + storage local (`STICKER_STORAGE_DIR`).

Comandos principais:

```text
/pack create "Nome" | publisher="..." | desc="..."
/pack list
/pack info <pack>
/pack rename <pack> "Novo Nome"
/pack setpub <pack> "Publisher"
/pack setdesc <pack> "Descrição"
/pack add <pack>               (responda uma figurinha ou use a última salva)
/pack remove <pack> <index|stickerId>
/pack setcover <pack>          (responda uma figurinha ou use a última salva)
/pack reorder <pack> <ordem>
/pack clone <pack> "Novo Nome"
/pack publish <pack> <private|public|unlisted>
/pack send <pack>              (nativo quando suportado; fallback em preview+envio individual)
/pack delete <pack>
```

Observações:
*   Edição é sempre restrita ao dono (`owner_jid`).
*   O envio tenta `stickerPack` nativo primeiro e cai automaticamente no fallback se o cliente/lib não suportar.
*   Figurinhas recebidas são capturadas para facilitar `add`/`setcover` com “última figurinha”.
*   Figurinhas criadas pelo usuário via comandos (`/sticker`, `/st`, `/stb`) entram automaticamente no pack mais recente dele (com criação automática de pack quando necessário).

## 📈 Observabilidade (Grafana/Prometheus/Loki)

O projeto inclui um stack completo de observabilidade com Docker Compose.

### 0) Configurar variáveis do Docker Compose

O `docker-compose.yml` lê variáveis do arquivo `.env` automaticamente (ou do arquivo que você indicar com `--env-file`). Para customizar portas, versões de imagens, caminhos e credenciais, ajuste as variáveis no `.env` (veja `.env.example`).

Exemplo usando um arquivo dedicado:

```bash
docker compose --env-file .env.docker up -d
```

Principais variáveis:

*   `STACK_NAME`: prefixo dos volumes (ex.: `omnizap`)
*   `PROMETHEUS_*`: versão, retenção, paths e porta (`PROMETHEUS_PORT`)
*   `GRAFANA_*`: admin, root URL, timezone, paths e porta (`GRAFANA_PORT`)
*   `LOKI_*`: versão, config e porta (`LOKI_PORT`)
*   `PROMTAIL_*`: versão, config, paths de logs e porta (`PROMTAIL_PORT`)
*   `MYSQL_EXPORTER_*`: versão, DSN, arquivo `.cnf` e porta (`MYSQL_EXPORTER_PORT`)
*   `NODE_EXPORTER_*`: versão e porta (`NODE_EXPORTER_PORT`)

> Dica: se o MySQL não estiver em `host.docker.internal:3306`, ajuste `MYSQL_EXPORTER_DSN` e/ou `observability/mysql-exporter.cnf`. Se os logs da aplicação estiverem em outro diretório, atualize `APP_LOGS_PATH`.

### 1) Subir o stack

```bash
docker compose up -d
```

### 2) MySQL: métricas e slow log

Execute o setup (habilita performance_schema, slow log e cria usuário de métricas):

```bash
sudo mysql < observability/mysql-setup.sql
```

Atualize as credenciais do exporter em:

```
observability/mysql-exporter.cnf
```

> Dica: esse arquivo está no `.gitignore`. Use uma senha forte que atenda à política do MySQL.

### 3) Acessos rápidos

*   Grafana: `http://localhost:3003`
*   Prometheus: `http://localhost:9090`
*   Loki: `http://localhost:3100`
*   Node /metrics: `http://localhost:9102/metrics`

### 4) Dashboards prontos

Os dashboards são provisionados automaticamente:

*   `observability/grafana/dashboards/omnizap-overview.json`
*   `observability/grafana/dashboards/omnizap-mysql.json`

### 5) Alertas

Os alertas do Prometheus ficam em:

```
observability/alert-rules.yml
```

## 🧰 Troubleshooting

**QR não aparece no PM2**

*   Inicie primeiro sem PM2 para escanear o QR: `npm run start` ou `node index.js`.
*   Depois de conectar, finalize o processo e inicie via PM2.
*   Se necessário, apague a sessão salva e reconecte.

**Erro de MySQL**

*   Verifique `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.
*   Garanta que o banco existe e o usuário tem permissão de leitura/escrita.
*   Confirme se o MySQL está rodando e acessível na porta correta.

**FFmpeg não encontrado**

*   Instale o FFmpeg no sistema e certifique-se de que está no `PATH`.
*   Alternativamente, configure `FFMPEG_PATH` no `.env`.

**Target omnizap DOWN no Prometheus**

*   Verifique se o app está rodando e se o `/metrics` responde em `http://localhost:9102/metrics`.
*   Garanta `METRICS_HOST=0.0.0.0` no `.env`.

## 🛠️ Tecnologias Utilizadas

*   Node.js
*   MySQL
*   @whiskeysockets/baileys
*   mysql2
*   Pino + Winston (logs)
*   OpenAI SDK
*   Axios
*   Canvas
*   FFmpeg + WebP (webp-conv)
*   PM2
*   Dotenv + Envalid

## 🤝 Créditos e links úteis

*   Baileys (WhatsApp Web API): https://github.com/WhiskeySockets/Baileys
*   WhatsApp: https://www.whatsapp.com

## 🤝 Contribuições

Para contribuir:
1.  Fork o repositório.
2.  Crie sua branch (`git checkout -b feature/sua-feature`).
3.  Commit suas alterações (`git commit -m 'Adiciona nova feature'`).
4.  Push para a branch (`git push origin feature/sua-feature`).
5.  Abra um Pull Request.

## 📄 Licença

Este projeto está licenciado sob a Licença MIT. Veja [LICENSE](LICENSE) para mais detalhes.
