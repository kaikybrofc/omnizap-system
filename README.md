# OmniZap System v2.0.2

O **OmniZap System** é um sistema profissional de automação para WhatsApp desenvolvido com Node.js e a biblioteca Baileys. Ele oferece uma plataforma robusta para gerenciar grupos, automatizar interações e estender as funcionalidades do WhatsApp com comandos personalizados, agora com suporte completo a banco de dados MySQL.

## 🚀 Instalação

1.  **Clone o repositório:**
    ```bash
    git clone https://github.com/Kaikygr/omnizap-system.git
    cd omnizap-system
    ```

2.  **Instale as dependências:**
    ```bash
    npm install
    ```

3.  **Configure as variáveis de ambiente:**
    Crie um arquivo `.env` no diretório raiz e adicione as seguintes variáveis:
    ```env
    # Configurações do Bot
    COMMAND_PREFIX=/
    USER_ADMIN=seu_jid_de_admin@s.whatsapp.net

    # Configurações do MySQL
    DB_HOST=localhost
    DB_USER=seu_usuario
    DB_PASSWORD=sua_senha
    DB_NAME=omnizap
    ```
    *   `COMMAND_PREFIX`: O prefixo para todos os comandos (ex: `/`, `!`, `.`).
    *   `USER_ADMIN`: O JID do usuário com privilégios administrativos para o bot.
    *   `DB_HOST`: Host do servidor MySQL.
    *   `DB_USER`: Usuário do MySQL.
    *   `DB_PASSWORD`: Senha do MySQL.
    *   `DB_NAME`: Nome do banco de dados.

## ⚡️ Uso

### Inicialização do Banco

Antes de iniciar o bot, certifique-se de que o MySQL está configurado corretamente:

```bash
# Inicia o serviço MySQL (se necessário)
sudo service mysql start

# Verifica status do MySQL
sudo service mysql status
```

O sistema criará automaticamente o banco de dados e as tabelas necessárias na primeira execução.

> ✅ Observação: As configurações de `ecosystem` do PM2 foram atualizadas para garantir que o comando de inicialização do banco (`database/init.js`) seja executado **antes** do `index.js`. Isso evita que a aplicação tente se conectar ao banco antes de o banco estar disponível.

O nome do banco é composto a partir da variável `DB_NAME` adicionada com um sufixo baseado em `NODE_ENV`:

| NODE_ENV | DB name example |
|---|---|
| development | omnizap_dev |
| production  | omnizap_prod |

## 🛠️ Tecnologias Utilizadas

- **Node.js:** Ambiente de execução JavaScript
- **MySQL:** Sistema de gerenciamento de banco de dados robusto
- **@whiskeysockets/baileys:** Biblioteca principal para a API do WhatsApp Web
- **mysql2/promise:** Driver MySQL com suporte a promises e prepared statements
- **Pino:** Sistema de logging de alta performance
- **FFmpeg:** Processamento de mídia (criação de figurinhas)
- **PM2:** Gerenciador de processos para Node.js
- **Dotenv:** Gerenciamento de variáveis de ambiente

### 📊 Estrutura do Banco de Dados

O sistema utiliza as seguintes tabelas principais:

- **messages:** Armazena histórico de mensagens com suporte a JSON
  - Campos otimizados com índices para consultas frequentes
  - Suporte a mensagens de mídia via JSON
  - Tracking de timestamps para análises

- **groups_metadata:** Gerencia metadados dos grupos
  - Informações como nome, descrição, dono
  - Lista de participantes em formato JSON
  - Tracking de alterações com timestamps

- **chats:** Mantém informações sobre conversas
  - Dados de configuração por chat
  - Suporte a dados extras via JSON
  - Atualização automática de timestamps

## 🤝 Contribuições

Contribuições são bem-vindas! Se você deseja contribuir com o projeto, siga estas etapas:

1.  Faça um fork do repositório.
2.  Crie uma nova branch para sua feature (`git checkout -b feature/nova-feature`).
3.  Faça commit de suas alterações (`git commit -m 'Adiciona nova feature'`).
4.  Faça push para a branch (`git push origin feature/nova-feature`).
5.  Abra um Pull Request.

## 📄 Licença

Este projeto está licenciado sob a Licença MIT. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.

## 🔗 Repositório

- **GitHub:** [https://github.com/Kaikygr/omnizap-system](https://github.com/Kaikygr/omnizap-system)

---
