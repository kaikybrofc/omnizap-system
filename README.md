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

> ✅ Observação: As configurações de `ecosystem` do PM2 foram atualizadas para garantir que o comando de inicialização do banco (`database/init.js`) seja executado **antes** do `index.js`. Isso evita que a aplicação tente se conectar ao banco antes de o banco estar disponível.

O nome do banco é composto a partir da variável `DB_NAME` adicionada com um sufixo baseado em `NODE_ENV`:

| NODE_ENV | DB name example |
|---|---|
| development | omnizap_dev |
| production  | omnizap_prod |

Se preferir rodar a inicialização do banco manualmente, use:
```bash
npm run db:init
```

**Pré-requisitos e Configuração Antes do Início**

- **Node.js**: : `>=16.0.0` (verifique com `node -v`).
- **NPM/Yarn**: para instalar dependências (`npm install`).
- **FFmpeg**: obrigatório para conversão de mídia; instale via `apt`, `brew` ou gerenciador de sua distro. Verifique com `ffmpeg -version` e `ffprobe -version`.
- **MySQL**: serviço ativo e com um usuário dedicado ao sistema. Crie o banco de dados e conceda privilégios ao usuário antes de rodar `npm run db:init` (o script também tenta criar o banco automaticamente quando possível).
- **PM2 (opcional)**: recomendado em produção; instale globalmente com `npm i -g pm2`.

- **Variáveis de ambiente obrigatórias**: crie um arquivo `.env` na raiz com pelo menos as variáveis abaixo (exemplo):

```env
# Configurações do Bot
COMMAND_PREFIX=/
USER_ADMIN=seu_jid_de_admin@s.whatsapp.net

# Configurações do MySQL
DB_HOST=localhost
DB_USER=seu_usuario
DB_PASSWORD=sua_senha
DB_NAME=omnizap

# Opcional
PM2_APP_NAME=omnizap
# NODE_ENV=development
```

- **Diretórios necessários**: garanta que a aplicação tenha permissão para criar/escrever em:
  - `logs/` — logs da aplicação
  - `temp/stickers/` — diretório temporário e de armazenamento de stickers por usuário
  - `sessions/` — (usado pela biblioteca/baileys para armazenar sessão)

- **Credenciais e sessões do WhatsApp**: se estiver migrando de outro servidor, restaure a pasta `sessions/` com os arquivos de sessão; caso contrário, a sessão será criada na primeira execução.

- **Binaries e permissões**: o processo precisa do binário `ffmpeg` disponível no PATH e permissões para criar arquivos em `temp/` e `logs/`.

- **Verificações pré-execução** (execute antes do primeiro start):
  - `node -v` — confirma versão do Node.
  - `npm install` — instala dependências.
  - `ffmpeg -version` — confirma FFmpeg instalado.
  - `sudo service mysql status` — MySQL ativo.
  - `cat .env` — revisar variáveis essenciais.

- **Inicialização sugerida (desenvolvimento)**:

```bash
# instalar dependências
npm install

# inicializar banco (opcional se não usar PM2)
npm run db:init

# iniciar com pm2 (modo dev)
npm run pm2:dev
```

- **Inicialização sugerida (produção)**:

```bash
# instalar dependências
npm install --production

# inicializar banco
npm run db:init

# iniciar com pm2 (modo prod)
npm run pm2:prod
```

- **Testes rápidos após start**:
  - Verifique logs via `pm2 logs` ou `tail -f logs/omnizap-out.log`.
  - Envie uma imagem pequena para o bot e execute `/sticker` para validar pipeline de stickers.

Se quiser, eu posso adicionar um arquivo `env.example` na raiz com o template acima — quer que eu crie esse arquivo? 

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
