<img width="1318" height="352" alt="image" src="https://github.com/user-attachments/assets/d44835e7-021a-4c67-a0e7-5b858d51eb91" />

O **OmniZap System** é uma plataforma de automação para WhatsApp em Node.js com Baileys, oferecendo gerenciamento de grupos, automação de interações e comandos personalizados com suporte a MySQL.

## ✨ Recursos Principais

*   Automação e Gerenciamento de WhatsApp
*   Comandos Personalizados
*   Integração com MySQL
*   Gerenciamento de Mídia (figurinhas)
*   Normalização de IDs LID/JID (Baileys) com reconciliação automática
*   Monitoramento com PM2

## 🚀 Instalação

Siga os passos para configurar e executar:

## ✅ Pré-requisitos

*   Node.js 18+ (recomendado)
*   MySQL 8+
*   PM2 instalado globalmente (`npm i -g pm2`)
*   FFmpeg instalado no sistema para recursos de mídia (figurinhas)

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
    COMMAND_PREFIX=/
    USER_ADMIN=seu_jid_de_admin@s.whatsapp.net
    PM2_APP_NAME=omnizap-system
    LOG_LEVEL=info
    NODE_ENV=development

    # Configurações do MySQL
    DB_HOST=localhost
    DB_USER=seu_usuario
    DB_PASSWORD=sua_senha
    DB_NAME=omnizap
    DB_POOL_LIMIT=10

    # Paths e armazenamento
    STORE_PATH=./temp

    # FFmpeg (opcional) - se o binário não estiver no PATH do sistema
    # FFMPEG_PATH=/usr/bin/ffmpeg
    # IMAGE_MENU=https://example.com/assets/omnizap-banner.png
    ```

4.  **Prepare o banco de dados:**
    *   Crie o banco indicado em `DB_NAME`.
    *   Garanta que o usuário tenha permissões de leitura e escrita.
    *   Execute a migração de LID (produção/ambientes existentes):
        ```bash
        mysql -u <usuario> -p <seu_db> < database/migrations/2026-01-23_add_lid_map.sql
        ```

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

## 📦 Scripts úteis

```bash
npm run start   # node index.js
npm run dev     # node index.js
npm run pm2:dev
npm run pm2:prod
```

## 🛠️ Tecnologias Utilizadas

*   Node.js
*   MySQL
*   @whiskeysockets/baileys
*   mysql2/promise
*   Pino
*   FFmpeg
*   WebP
*   PM2
*   Dotenv

## 🤝 Contribuições

Para contribuir:
1.  Fork o repositório.
2.  Crie sua branch (`git checkout -b feature/sua-feature`).
3.  Commit suas alterações (`git commit -m 'Adiciona nova feature'`).
4.  Push para a branch (`git push origin feature/sua-feature`).
5.  Abra um Pull Request.

## 📄 Licença

Este projeto está licenciado sob a Licença MIT. Veja [LICENSE](LICENSE) para mais detalhes.
