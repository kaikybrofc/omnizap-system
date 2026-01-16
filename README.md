[![fSNGag2.md.png](https://iili.io/fSNGag2.md.png)](https://freeimage.host/i/fSNGag2)

O **OmniZap System** é uma plataforma profissional de automação para WhatsApp, desenvolvida em Node.js e utilizando a biblioteca Baileys. Ele oferece funcionalidades robustas para gerenciamento de grupos, automação de interações e extensão do WhatsApp com comandos personalizados, incluindo suporte completo a banco de dados MySQL.

## ✨ Recursos Principais

*   **Automação de WhatsApp:** Gerencie interações e grupos de forma eficiente.
*   **Comandos Personalizados:** Estenda as funcionalidades do WhatsApp com comandos definidos pelo usuário.
*   **Integração com MySQL:** Suporte completo a banco de dados para armazenamento persistente.
*   **Gerenciamento de Mídia:** Processamento de mídia para figurinhas e otimização.
*   **Gerenciamento de Processos:** Utilização do PM2 para monitoramento e manutenção da aplicação.

## 🚀 Instalação

Para configurar e executar o OmniZap System, siga os passos abaixo:

1.  **Clone o repositório:**
    ```bash
    git clone https://github.com/Kaikybrofc/omnizap-system.git
    cd omnizap-system
    ```

2.  **Instale as dependências:**
    ```bash
    npm install
    ```

3.  **Configure as variáveis de ambiente:**
    Crie um arquivo `.env` no diretório raiz do projeto com as seguintes variáveis:

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
    ```

    | Variável         | Descrição                                                                      | Exemplo/Padrão                                   |
    | :--------------- | :----------------------------------------------------------------------------- | :----------------------------------------------- |
    | `COMMAND_PREFIX` | Prefixo para todos os comandos do bot.                                         | `/`                                              |
    | `USER_ADMIN`     | JID do usuário com privilégios administrativos.                                | `seu_jid_de_admin@s.whatsapp.net`                |
    | `PM2_APP_NAME`   | Nome da aplicação para o PM2.                                                  | `omnizap-system`                                 |
    | `LOG_LEVEL`      | Nível de detalhe dos logs (`debug`, `info`, `warn`, `error`).                  | `info`                                           |
    | `NODE_ENV`       | Ambiente da aplicação (`development` ou `production`).                         | `development`                                    |
    | `DB_HOST`        | Host do servidor MySQL.                                                        | `localhost`                                      |
    | `DB_USER`        | Usuário do MySQL.                                                              | `seu_usuario`                                    |
    | `DB_PASSWORD`    | Senha do MySQL.                                                                | `sua_senha`                                      |
    | `DB_NAME`        | Nome base do banco de dados (o sistema adiciona sufixo `_dev` ou `_prod`).    | `omnizap`                                        |
    | `DB_POOL_LIMIT`  | Limite de conexões do pool MySQL.                                              | `10`                                             |
    | `STORE_PATH`     | Caminho relativo para armazenar arquivos temporários e stores.                 | `./temp`                                         |
    | `FFMPEG_PATH`    | Caminho para o binário do FFmpeg (opcional, se não estiver no `PATH`).         | `/usr/bin/ffmpeg`                                |

## ▶️ Como Executar

Para iniciar o sistema, utilize o PM2:

```bash
pm2 start ecosystem.dev.config.js # Para ambiente de desenvolvimento
# ou
pm2 start ecosystem.prod.config.js # Para ambiente de produção
```

## 🛠️ Tecnologias Utilizadas

*   **Node.js:** Ambiente de execução JavaScript.
*   **MySQL:** Sistema de gerenciamento de banco de dados robusto.
*   **@whiskeysockets/baileys:** Biblioteca principal para a API do WhatsApp Web.
*   **mysql2/promise:** Driver MySQL com suporte a promises.
*   **Pino:** Sistema de logging de alta performance.
*   **FFmpeg:** Processamento de mídia (criação de figurinhas).
*   **WebP:** Formato de imagem eficiente.
*   **PM2:** Gerenciador de processos para Node.js.
*   **Dotenv:** Gerenciamento de variáveis de ambiente.

## 🤝 Contribuições

Contribuições são bem-vindas! Se você deseja contribuir com o projeto, siga estas etapas:

1.  Faça um fork do repositório.
2.  Crie uma nova branch para sua feature (`git checkout -b feature/nova-feature`).
3.  Faça commit de suas alterações (`git commit -m 'Adiciona nova feature'`).
4.  Faça push para a branch (`git push origin feature/nova-feature`).
5.  Abra um Pull Request.

## 📄 Licença

Este projeto está licenciado sob a Licença MIT. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.