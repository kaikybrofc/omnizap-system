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

## 🛠️ Tecnologias Utilizadas

- **Node.js:** Ambiente de execução JavaScript
- **MySQL:** Sistema de gerenciamento de banco de dados robusto
- **@whiskeysockets/baileys:** Biblioteca principal para a API do WhatsApp Web
- **mysql2/promise:** Driver MySQL com suporte a promises e prepared statements
- **Pino:** Sistema de logging de alta performance
- **FFmpeg:** Processamento de mídia (criação de figurinhas)
- **WebP:** Formato de imagem eficiente usado para figurinhas e otimização de mídia
- **PM2:** Gerenciador de processos para Node.js
- **Dotenv:** Gerenciamento de variáveis de ambiente


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
