# OmniZap System

Sistema profissional de automação WhatsApp com tecnologia Baileys.

## 🚀 Visão Geral

O OmniZap System é uma solução robusta e escalável para automação de mensagens no WhatsApp, construída sobre a poderosa biblioteca Baileys. Ele oferece funcionalidades essenciais para gerenciar conexões, processar mensagens, lidar com grupos e monitorar o desempenho do sistema, ideal para empresas e desenvolvedores que buscam integrar o WhatsApp em seus fluxos de trabalho.

## ✨ Funcionalidades Principais

*   **Conexão Flexível:** Suporte para conexão via QR Code e Código de Pareamento (Pairing Code) para maior conveniência e segurança.
*   **Gerenciamento de Sessão:** Persistência automática das credenciais de autenticação para reconexões rápidas e sem interrupções.
*   **Processamento de Mensagens:** Lida com o recebimento e atualização de mensagens, incluindo suporte a enquetes.
*   **Gerenciamento Avançado de Grupos:** Funções globais para acessar informações detalhadas de grupos (assunto, participantes, administradores, descrição, etc.) e comando `/grupoinfo` para consulta direta.
*   **Armazenamento Detalhado de Mensagens:** Persistência de mensagens de chat e de mensagens raw (objetos completos do Baileys) com limites e retenção configuráveis via variáveis de ambiente.
*   **Sistema de Logs Avançado:** Logs detalhados com rotação diária de arquivos, múltiplos níveis de log (info, warn, error, debug, etc.) e formatação colorida para fácil depuração. Eventos genéricos e mensagens são logados separadamente.
*   **Monitoramento de Métricas:** Coleta e log de métricas de uso de CPU e memória do sistema para acompanhamento de desempenho.
*   **Reconexão Automática:** Lógica de reconexão robusta com tentativas limitadas em caso de desconexões inesperadas.

## 🛠️ Tecnologias Utilizadas

*   **Node.js** (>=16.0.0)
*   **Baileys** (`@whiskeysockets/baileys`): Biblioteca principal para interação com o WhatsApp.
*   **Winston**: Para um sistema de logging configurável e eficiente.
*   **Winston Daily Rotate File**: Para rotação automática de arquivos de log.
*   **Dotenv**: Para carregamento de variáveis de ambiente.
*   **Envalid**: Para validação de variáveis de ambiente.
*   **Chalk**: Para estilização de saída de terminal.
*   **Node-Cache**: Para cache de dados em memória.
*   **Moment-Timezone**: Para manipulação de datas e fusos horários.
*   **Qrcode-terminal**: Para exibição do QR Code no terminal.
*   **fs.promises**: Para escrita segura de arquivos.
*   **@hapi/boom**: Para tratamento de erros HTTP.

## ⚙️ Instalação

Siga os passos abaixo para configurar e executar o OmniZap System em sua máquina local.

### Pré-requisitos

Certifique-se de ter o Node.js (versão 16 ou superior) e o npm (gerenciador de pacotes do Node.js) instalados em seu sistema.

### 1. Clonar o Repositório

```bash
git clone https://github.com/Kaikygr/omnizap-system.git
cd omnizap-system
```

### 2. Instalar Dependências

```bash
npm install
```

### 3. Configurar Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto, copiando o conteúdo de `.env.example` e preenchendo as variáveis conforme suas necessidades. As variáveis de ambiente controlam o comportamento da conexão, do bot e do armazenamento de dados.

```dotenv
# Configurações de Conexão do WhatsApp
PAIRING_CODE=true # Defina como 'true' para usar o código de pareamento, 'false' para QR Code
PHONE_NUMBER=55XXYYYYYYYYY # Seu número de telefone com código do país (ex: 5511987654321) - Necessário se PAIRING_CODE=true

# Configurações do Bot
COMMAND_PREFIX=/ # Prefixo para comandos do bot (ex: /, !, #)

# Configurações de Armazenamento de Dados
STORE_PATH=./temp/ # Caminho relativo para a pasta onde os arquivos de dados serão salvos (ex: ./temp/)

# Configurações de Retenção de Mensagens de Chat (messages.json)
OMNIZAP_MAX_MESSAGES_PER_CHAT=1000 # Número máximo de mensagens de chat a serem salvas por conversa
OMNIZAP_MESSAGE_RETENTION_DAYS=30 # Número de dias para reter mensagens de chat

# Configurações de Retenção de Mensagens Raw (rawMessages.json)
OMNIZAP_MAX_RAW_MESSAGES_PER_CHAT=5000 # Número máximo de mensagens raw a serem salvas por conversa
OMNIZAP_RAW_MESSAGE_RETENTION_DAYS=90 # Número de dias para reter mensagens raw

# Configurações de Limpeza Periódica
OMNIZAP_CLEANUP_INTERVAL_MS=86400000 # Intervalo em milissegundos para a execução da rotina de limpeza (86400000 ms = 24 horas)

# Nível de log (development, production, test)
NODE_ENV=development
# Nível mínimo de log a ser exibido (error, warn, info, debug, etc.)
LOG_LEVEL=debug
# Nome do serviço para logs (opcional)
ECOSYSTEM_NAME=omnizap-system
```

### 4. Criar o Diretório de Armazenamento

Certifique-se de que o diretório especificado em `STORE_PATH` (por padrão `./temp/`) exista. Se não existir, crie-o manualmente ou execute o comando:

```bash
mkdir -p ./temp
```

## ▶️ Como Usar

Para iniciar o OmniZap System, utilize o script `start_socket.sh`. Este script oferece opções para iniciar uma nova sessão ou reconectar a uma sessão existente.

```bash
./start_socket.sh
```

Ao executar o script, você será solicitado a escolher um método de conexão:

1.  **Reconectar com a sessão salva:** Tenta usar as credenciais de sessão salvas anteriormente em `./app/connection/auth_info_baileys`.
2.  **Iniciar nova sessão com QR Code:** Limpa qualquer sessão anterior e gera um novo QR Code no terminal para você escanear com seu WhatsApp.
3.  **Iniciar nova sessão com Código de Pareamento:** Limpa qualquer sessão anterior e solicita um número de telefone para gerar um código de pareamento. Você deve inserir este código no seu WhatsApp (WhatsApp > Aparelhos Conectados > Conectar um Aparelho > Conectar com número de telefone).

### Estrutura de Pastas

*   `app/`: Contém a lógica principal da aplicação.
    *   `connection/`: Gerencia a conexão com o WhatsApp (Baileys).
        *   `socketController.js`: Lógica de conexão, eventos e persistência de sessão.
        *   `auth_info_baileys/`: Diretório onde as credenciais de autenticação do Baileys são salvas.
    *   `controllers/`: Lida com a lógica de negócios.
        *   `messageController.js`: Processa mensagens e comandos do bot.
        *   `eventHandler.js`: Lida com eventos genéricos do WhatsApp que não são mensagens.
    *   `store/`: Gerencia o armazenamento e persistência de dados.
        *   `dataStore.js`: Objeto central para gerenciar dados como chats, contatos, mensagens (chat e raw), grupos, etc.
        *   `persistence.js`: Funções de baixo nível para leitura e escrita de arquivos JSON, incluindo gerenciamento de locks.
    *   `utils/`: Utilitários e módulos auxiliares.
        *   `logger/`: Módulo de logging configurável.
        *   `systemMetrics/`: Módulo para coletar métricas do sistema.
        *   `groupUtils.js`: Funções utilitárias para interagir com os dados de grupos.
*   `logs/`: Diretório onde os arquivos de log são armazenados (incluindo `raw_messages.log`).
*   `index.js`: Ponto de entrada da aplicação.
*   `start_socket.sh`: Script shell para iniciar a aplicação e gerenciar opções de conexão.
*   `.env.example`: Exemplo de arquivo de configuração de variáveis de ambiente.

## 📝 Logs

O sistema de logs é configurado com `winston` e `winston-daily-rotate-file` para garantir logs detalhados e organizados.

*   Os logs são salvos no diretório `logs/`.
*   Arquivos de log são rotacionados diariamente.
*   Níveis de log configuráveis via variável de ambiente `LOG_LEVEL`.
*   Logs de erro e aviso são separados em arquivos dedicados.
*   Mensagens raw são salvas em `logs/raw_messages.log`.

## 🗺️ Roadmap (Planos Futuros)

Estamos constantemente trabalhando para melhorar o OmniZap System. Abaixo estão algumas das funcionalidades e melhorias planejadas para o futuro:

*   **Expansão de Comandos do Bot:** Adicionar mais comandos interativos e personalizáveis para diversas funcionalidades.
*   **Integração com Banco de Dados:** Implementar opções de persistência de dados em bancos de dados (SQL/NoSQL) para maior escalabilidade e consulta.
*   **Interface de Usuário (Web UI):** Desenvolver uma interface web intuitiva para gerenciar o bot, visualizar logs e interagir com as funcionalidades.
*   **Suporte a Múltiplos Usuários/Instâncias:** Permitir que o sistema gerencie múltiplas contas WhatsApp simultaneamente.
*   **Melhorias na Modularidade e Extensibilidade:** Refatorar e otimizar a arquitetura para facilitar a adição de novos módulos e funcionalidades por parte da comunidade.
*   **Testes Automatizados:** Aumentar a cobertura de testes para garantir a estabilidade e confiabilidade do sistema.

## 🤝 Contribuição

Contribuições são bem-vindas! Se você deseja contribuir, por favor, siga estas diretrizes:

1.  Faça um fork do repositório.
2.  Crie uma nova branch (`git checkout -b feature/sua-feature`).
3.  Faça suas alterações e adicione testes, se aplicável.
4.  Commit suas alterações (`git commit -m 'feat: Adiciona nova funcionalidade'`).
5.  Envie para a branch (`git push origin feature/sua-feature`).
6.  Abra um Pull Request.

## 📄 Licença

Este projeto está licenciado sob a Licença MIT. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.

## 📧 Contato

Para dúvidas ou suporte, por favor, abra uma issue no repositório do GitHub:
[https://github.com/Kaikygr/omnizap-system/issues](https://github.com/Kaikygr/omnizap-system/issues)