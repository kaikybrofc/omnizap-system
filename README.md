# OmniZap System v2.0.2

O **OmniZap System** é um sistema profissional de automação para WhatsApp desenvolvido com Node.js e a biblioteca Baileys. Ele oferece uma plataforma robusta para gerenciar grupos, automatizar interações e estender as funcionalidades do WhatsApp com comandos personalizados, agora com suporte completo a banco de dados MySQL.

## 🌟 Novidades da Versão 2.0.2

Esta versão traz melhorias significativas na arquitetura e persistência de dados:

- **Suporte a MySQL:** Sistema totalmente integrado com MySQL para persistência robusta de dados.
- **Camada de Abstração de Dados:** Interface unificada para acesso ao banco de dados com validações e sanitização.
- **Cache Híbrido:** Sistema inteligente que combina cache em memória com persistência MySQL.
- **Tratamento de Erros:** Sistema robusto de tratamento de erros e logging.
- **Segurança Aprimorada:** Melhor proteção contra SQL injection e validação de dados.
- **Performance Otimizada:** Queries SQL otimizadas e índices adequados para melhor desempenho.

## ✨ Funcionalidades

- **Gerenciamento de Grupos:** Adicione, remova, promova e rebaixe membros.
- **Boas-vindas/Despedida Personalizáveis:** Configure mensagens e mídias personalizadas para novos membros e para aqueles que saíram.
- **Criação de Stickers:** Crie figurinhas rapidamente a partir de imagens e vídeos.
- **Informações do Grupo:** Obtenha estatísticas detalhadas e rankings de atividade para seus grupos.
- **Controles Administrativos:** Controle refinado sobre as configurações do grupo, incluindo nome, descrição e mensagens efêmeras.
- **Prefixo de Comando:** Prefixo de comando personalizável (o padrão é `/`).

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

### Desenvolvimento

Para iniciar o bot em modo de desenvolvimento usando `pm2`:

```bash
npm run pm2:dev
```

### Produção

Para iniciar o bot em modo de produção usando `pm2`:

```bash
npm run pm2:prod
```

### Início Padrão

Para iniciar o bot sem `pm2`:

```bash
npm start
```

### Monitoramento

Para monitorar os logs e performance:

```bash
# Visualizar logs do PM2
pm2 logs omnizap

# Monitorar recursos
pm2 monit
```

## 🤖 Comandos

A aqui está uma lista dos comandos disponíveis. Comandos administrativos exigem que o usuário seja um administrador do grupo.

### Comandos Gerais

| Comando         | Atalho | Descrição                                                                                             | Uso                                                  |
| --------------- | ------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `/sticker`      | `/s`   | Cria uma figurinha a partir de uma imagem ou vídeo. Você também pode responder a uma mídia com o comando. | `/sticker [pacote/autor]`                              |
| `/info`         |        | Exibe informações detalhadas sobre o grupo atual, incluindo estatísticas e atividade dos membros.       | `/info` ou `/info [id_do_grupo]`                       |
| `/info --inativos` |      | Mostra uma lista de usuários inativos no grupo com base em um limite de mensagens.                      | `/info --inativos [limite_de_mensagens]`               |

### Comandos de Administração de Grupo

| Comando           | Descrição                                                              | Uso                                                              |
| ----------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `/menuadm`        | Exibe o menu de administração do grupo.                                  | `/menuadm`                                                         |
| `/add`            | Adiciona um ou mais participantes ao grupo.                              | `/add @usuario1 @usuario2...`                                      |
| `/ban`            | Remove um ou mais participantes do grupo.                                | `/ban @usuario1 @usuario2...`                                      |
| `/up`             | Promove um ou mais participantes a administradores.                      | `/up @usuario1 @usuario2...`                                       |
| `/down`           | Rebaixa um ou mais administradores a participantes.                      | `/down @usuario1 @usuario2...`                                     |
| `/setsubject`     | Altera o nome do grupo.                                                  | `/setsubject <novo_nome>`                                          |
| `/setdesc`        | Altera a descrição do grupo.                                             | `/setdesc <nova_descrição>`                                        |
| `/setgroup`       | Altera as configurações do grupo (ex: quem pode enviar mensagens).       | `/setgroup <announcement\|not_announcement\|locked\|unlocked>`      |
| `/leave`          | O bot sai do grupo.                                                      | `/leave`                                                           |
| `/invite`         | Mostra o código de convite do grupo.                                     | `/invite`                                                          |
| `/revoke`         | Revoga o código de convite do grupo e gera um novo.                      | `/revoke`                                                          |
| `/requests`       | Lista as solicitações de entrada pendentes para o grupo.                 | `/requests`                                                        |
| `/updaterequests` | Aprova ou rejeita solicitações de entrada pendentes.                     | `/updaterequests <approve\|reject> @usuario1 @usuario2...`         |
| `/temp`           | Ativa ou desativa as mensagens efêmeras no grupo.                        | `/temp <duração_em_segundos>`                                      |
| `/addmode`        | Define quem pode adicionar novos membros ao grupo.                       | `/addmode <all_member_add\|admin_add>`                             |
| `/welcome`        | Gerencia as mensagens de boas-vindas para novos membros.                 | `/welcome <on\|off\|set> [mensagem ou mídia]`                      |
| `/farewell`       | Gerencia as mensagens de despedida para membros que saem.                | `/farewell <on\|off\|set> [mensagem ou mídia]`                     |

### Comandos do Dono do Bot

| Comando  | Descrição                                             | Uso                    |
| -------- | ----------------------------------------------------- | ---------------------- |
| `/eval`  | Executa um trecho de código JavaScript (apenas dono). | `/eval <código_js>`    |

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
*Este README foi gerado e atualizado pelo Gemini.*
