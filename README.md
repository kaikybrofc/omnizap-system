# OmniZap v1.0.5

Sistema profissional de automação WhatsApp com tecnologia Baileys e arquitetura modular avançada

## 📋 Descrição

OmniZap é um sistema robusto e profissional para automação de mensagens WhatsApp, desenvolvido com a mais avançada tecnologia Baileys para máxima compatibilidade e estabilidade. Com **arquitetura modular**, **banco de dados MySQL integrado** e **processamento de eventos independente** para máxima performance e escalabilidade. A versão 1.0.5 introduz **persistência completa de dados** com banco de dados MySQL, **sistema aprimorado de sticker packs** com suporte a múltiplos pacotes por usuário, **logging centralizado com rotação de arquivos** baseado em Winston, e **sistema avançado de sub-comandos** para gerenciamento inteligente de conteúdo.

## ✨ Características

- 🚀 **Alta Performance**: Otimizado para processamento eficiente de mensagens
- 🔒 **Seguro**: Implementação segura com autenticação robusta
- 📱 **Compatível**: Totalmente compatível com WhatsApp Web e multi-dispositivo
- 🔄 **Reconexão Automática**: Sistema inteligente de reconexão e recuperação de sessão
- 📊 **Logs Centralizados**: Sistema completo de logging com Winston para monitoramento e diagnóstico
- 🤖 **Sistema de Comandos**: Processamento inteligente de comandos com prefixos configuráveis
- ⚡ **Switch Case**: Arquitetura otimizada para processamento de comandos
- 🎯 **Respostas Inteligentes**: Sistema de respostas automáticas e contextuais
- 🏗️ **Arquitetura Modular**: Sistema dividido em módulos independentes
- 💾 **Persistência de Dados**: Banco de dados MySQL para armazenamento confiável
- 🎯 **Processamento de Eventos**: Handler independente para todos os eventos WhatsApp
- 📈 **Estatísticas Detalhadas**: Monitoramento completo do sistema e armazenamento
- 🖼️ **Sticker Packs**: Sistema completo de criação e gerenciamento de pacotes de stickers
- 🔁 **Rotação de Logs**: Sistema automático de rotação e compressão de arquivos de log
- 🔄 **Processamento Assíncrono**: Execução assíncrona para melhor desempenho
- 📝 **Rotação de Logs**: Sistema automatizado de rotação e compressão de logs

### ⚙️ Configuração de Comandos

O prefixo dos comandos é configurável através da variável `COMMAND_PREFIX` no arquivo `.env`:

```bash
# Prefixo padrão: /
COMMAND_PREFIX=/

# Exemplos de outros prefixos:
# COMMAND_PREFIX=!
# COMMAND_PREFIX=.
# COMMAND_PREFIX=#
```

### 🔧 Arquitetura de Comandos

- **Switch Case**: Processamento otimizado com estrutura switch/case
- **Extração Inteligente**: Suporte a diferentes tipos de mensagem (texto, legendas de mídia)
- **Validação**: Sistema robusto de validação de comandos
- **Tratamento de Erros**: Respostas amigáveis para erros e comandos inválidos
- **Respostas Modulares**: Sistema modular para diferentes tipos de resposta

## 🤖 Sistema de Comandos Avançado

O OmniZap v1.0.4 apresenta um sistema completo de comandos com funcionalidades avançadas:

### 🎨 Comandos de Sticker Packs

#### Criação de Stickers
- **`/s Nome do Pack | Autor`** - Cria sticker a partir de mídia
- Suporte a imagens, vídeos e documentos
- Sistema de metadados EXIF automático  
- Formatação inteligente de nomes com variáveis (#nome, #id, #data)

#### Gerenciamento de Packs
- **`/s packs`** - Lista todos os seus packs
- **`/s stats`** - Exibe estatísticas detalhadas
- **`/s info [número]`** - Mostra detalhes de um pack específico
- **`/s send [número]`** - Envia pack completo (funciona mesmo com packs incompletos)
- **`/s rename [nº] [nome] | [autor]`** - Renomeia pack e/ou autor
- **`/s delete [número]`** - Remove pack completamente
- **`/s help`** - Ajuda completa do sistema

#### Características do Sistema de Stickers
- 📦 **30 stickers por pack** (configurável)
- 🔄 **Criação automática** de novos packs
- 💾 **Persistência de dados** por usuário
- 🎯 **Envio individual** otimizado com rate limiting
- 📊 **Estatísticas detalhadas** de uso
- 🏷️ **Sistema de preferências** personalizadas
- ⚡ **Processamento assíncrono** para melhor performance

### 📝 Exemplos Práticos de Uso

#### Criação de Sticker Pack
```
1. Envie uma imagem com: /s Meus Emojis | João Silva
2. Continue adicionando stickers até completar 30
3. Use /s send 1 para compartilhar o pack completo
```

#### Gerenciamento de Packs
```
# Ver todos os packs
/s packs

# Ver estatísticas
/s stats

# Ver detalhes de um pack específico
/s info 1

# Renomear um pack
/s rename 1 Novo Nome | Novo Autor

# Deletar um pack
/s delete 2
```

#### Variáveis Dinâmicas
Use variáveis especiais nos nomes:
- `#nome` - Nome do usuário
- `#id` - ID do usuário  
- `#data` - Data atual

Exemplo: `/s Pack do #nome | Criado em #data`

## 🏗️ Arquitetura Modular

O OmniZap v1.0.4 aprimora a **arquitetura modular avançada** que separa responsabilidades e melhora a manutenibilidade:

### 📦 Módulos Principais

#### 🔗 Socket Controller (`app/connection/socketController.js`)
- **Responsabilidade**: Gerenciamento da conexão WhatsApp
- **Funcionalidades**: 
  - Conexão e reconexão automática
  - Processamento de QR Code
  - Distribuição de eventos para outros módulos
  - Tratamento de diferentes tipos de conexão
  - Suporte a múltiplas sessões
  - Integração com sistema centralizado de logging

#### 🔄 Cache Manager (`app/cache/cacheManager.js`)
- **Responsabilidade**: Sistema de cache inteligente
- **Funcionalidades**:
  - Cache de mensagens (TTL: 1 hora)
  - Cache de eventos (TTL: 30 minutos)
  - Cache de grupos (TTL: 2 horas)
  - Cache de contatos (TTL: 4 horas)
  - Cache de chats (TTL: 1 hora)
  - Limpeza automática e otimização
  - Estatísticas detalhadas de performance

#### 🎯 Event Handler (`app/events/eventHandler.js`)
- **Responsabilidade**: Processamento independente de eventos
- **Funcionalidades**:
  - Processamento assíncrono de todos os eventos WhatsApp
  - Integração com o Cache Manager
  - Logging detalhado de atividades através do sistema centralizado
  - Tratamento especializado para cada tipo de evento
  - Pré-carregamento inteligente de dados de grupo

#### 💬 Message Controller (`app/controllers/messageController.js`)
- **Responsabilidade**: Lógica de negócios e processamento de comandos
- **Funcionalidades**:
  - Processamento de mensagens recebidas
  - Sistema de comandos com switch/case
  - Extração inteligente de conteúdo de diferentes tipos de mensagens
  - Respostas inteligentes e contextuais
  - Integração com módulos de comando
  - Tratamento de erros e validações
  - Suporte a mensagens de grupo

#### 🎨 Command Modules (`app/commandModules/`)
- **Responsabilidade**: Módulos especializados de comandos
- **Estrutura Modular**:
  - **StickerModules**: Sistema completo de stickers
    - `stickerCommand.js` - Processamento e criação de stickers
    - `stickerPackManager.js` - Gerenciamento de packs por usuário
    - `stickerSubCommands.js` - Sub-comandos de administração
  - Arquitetura extensível para novos comandos
  - Isolamento de funcionalidades específicas

#### 🛠️ Utils Modules (`app/utils/`)
- **Responsabilidade**: Utilitários e helpers do sistema
- **Componentes**:
  - **baileys/**: Helpers específicos do Baileys
    - `messageHelper.js` - Processamento de mensagens
    - `mediaHelper.js` - Manipulação de mídia
  - `constants.js` - Constantes globais do sistema
  - `messageUtils.js` - Utilitários de envio de mensagens
  - **logger/**: Sistema de logging centralizado
  - Tratamento de erros e validações
  - Suporte a mensagens de grupo

#### 📝 Logger Module (`app/utils/logger/loggerModule.js`)
- **Responsabilidade**: Sistema centralizado de logging
- **Funcionalidades**:
  - Logs em múltiplos níveis (error, warn, info, debug)
  - Rotação automática de arquivos de log
  - Compressão automática de logs antigos
  - Logs separados por tipo (aplicação, erro, aviso)
  - Formatação avançada para console e arquivos
  - Captura de exceções não tratadas

### � Atualizações da v1.0.4

- **🔧 Melhorias técnicas:**
  - Implementação de sistema centralizado de logging baseado em Winston
  - Padronização de todos os arquivos com cabeçalhos de documentação
  - Substituição completa de console.log/error por logger estruturado
  - Melhor tratamento e captura de erros em todos os módulos
  - Rotação e compressão automática de arquivos de log

- **✨ Novos recursos:**
  - Sistema completo de sticker packs com 30 stickers por pack
  - Sub-comandos avançados para gerenciamento de stickers
  - Sistema de preferências personalizadas por usuário
  - Metadados EXIF automáticos em stickers
  - Rate limiting inteligente para envio de packs
  - Sistema de logging em múltiplos níveis (error, warn, info, debug)
  - Logs separados por tipo (aplicação, erro, aviso)
  - Cabeçalhos padronizados em todos os módulos com versão e autoria
  - Mensagens de erro mais detalhadas com stack traces
  
- **🐛 Correções:**
  - Melhorias na captura e log de exceções não tratadas
  - Padronização do formato de logs em todos os módulos
  - Melhor rastreabilidade de erros através do sistema centralizado
  - Otimizações no processamento de mídia para stickers
  - Melhor validação de comandos e tratamento de erros

## 📝 Sistema de Logging Centralizado

O OmniZap v1.0.4 introduz um sistema avançado de logging centralizado com Winston:

### 📊 Níveis de Log

| Nível | Descrição | Uso Típico |
|------|-----|-----------|
| **error** | Erros críticos | Falhas de conexão, exceções não tratadas |
| **warn** | Avisos importantes | Reconexões, timeouts, problemas não críticos |
| **info** | Informações operacionais | Conexões, desconexões, eventos importantes |
| **debug** | Informações detalhadas | Detalhes de processamento, útil para desenvolvimento |

### 🔧 Funcionalidades do Logger

- **Rotação de Arquivos**: Logs são divididos por data (formato YYYY-MM-DD)
- **Compressão Automática**: Arquivos antigos são comprimidos em .gz
- **Logs Separados**: Arquivos independentes para erros, avisos e logs gerais
- **Formatação Rica**: Logs coloridos no console, formato JSON em arquivos
- **Captura de Exceções**: Registra automaticamente exceções não tratadas
- **Metadados**: Inclui informações de serviço, instância e ambiente
- **Configurável**: Ajuste de nível de log por ambiente (development/production)

### 📁 Estrutura de Logs

```
logs/
├── application-YYYY-MM-DD.log     # Logs gerais da aplicação
├── error-YYYY-MM-DD.log           # Logs de erro específicos
├── warn-YYYY-MM-DD.log            # Logs de avisos
├── *.log.gz                       # Arquivos comprimidos automaticamente
└── *.log.[1-30]                   # Rotação de arquivos por número
```

## 🔄 Fluxo de Eventos

```
                           ┌─────────────────┐
                           │   Logger Module  │
                           │     (Logging)    │
                           └─────────────────┘
                                   ▲
                                   │
      ┌─────────────────┐         │         ┌─────────────────┐
      │  Socket Controller │ ─────┼─────── │  Cache Manager  │
      │   (Conexão)        │         │         │ (Armazenamento) │
      └─────────────────┘         │         └─────────────────┘
               │                     │                     │
               │                     │                     │
               v                     v                     v
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Event Handler   │ <-> │     OmniZap Main    │ <-> │ Message Controller │
│(Processamento)  │     │   (Coordenação)    │     │ (Lógica Negócio) │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                 │
                                 │
                                 v
                    ┌─────────────────┐
                    │ Command Modules │
                    │  (Sticker Packs) │
                    └─────────────────┘
```

### ⚡ Vantagens da Arquitetura Modular

- **Escalabilidade**: Cada módulo pode ser otimizado independentemente
- **Manutenibilidade**: Código organizado e fácil de manter
- **Performance**: Processamento assíncrono e cache inteligente
- **Flexibilidade**: Fácil adição de novos recursos
- **Monitoramento**: Logs detalhados para cada módulo
- **Resiliente**: Tratamento avançado de erros e reconexão automática
- **Eficiente**: Uso de setImmediate para processamento em segundo plano

## 🛠️ Tecnologias Utilizadas

- [Baileys](https://github.com/whiskeysockets/baileys): Framework de comunicação com WhatsApp Web
- [Node.js](https://nodejs.org/): Ambiente de execução JavaScript
- [MySQL](https://www.mysql.com/): Banco de dados relacional para persistência
- [Winston](https://github.com/winstonjs/winston): Sistema avançado de logging
- [FFmpeg](https://ffmpeg.org/): Processamento de mídia para stickers

## 📦 Estrutura do Projeto

```
omnizap-system/
├── app/                          # Diretório principal da aplicação
│   ├── commandModules/           # Módulos de comandos do sistema
│   │   └── stickerModules/       # Sistema completo de stickers
│   ├── connection/               # Controlador de conexão WhatsApp
│   │   └── qr-code/              # Armazenamento de QR e credenciais
│   ├── controllers/              # Controladores da aplicação
│   ├── database/                 # Gerenciamento de banco de dados
│   ├── events/                   # Handler de eventos do WhatsApp
│   └── utils/                    # Utilitários do sistema
│       ├── baileys/              # Helpers para a API Baileys
│       └── logger/               # Sistema de logging
├── logs/                         # Diretório de logs rotacionados
├── temp/                         # Arquivos temporários
│   ├── stickerPacks/             # Pacotes de stickers por usuário
│   └── stickers/                 # Stickers temporários
├── index.js                      # Ponto de entrada da aplicação
└── package.json                  # Dependências e configurações
```

## ⚙️ Instalação

1. Clone o repositório:
```bash
git clone https://github.com/Kaikygr/omnizap-system.git
cd omnizap-system
```

2. Instale as dependências:
```bash
npm install
```

3. Configure o ambiente:
```bash
cp .env.example .env
# Edite o arquivo .env com suas configurações
```

4. Instale FFmpeg (necessário para criação de stickers):
```bash
# Ubuntu/Debian
sudo apt-get install ffmpeg

# macOS
brew install ffmpeg

# Windows
# Baixe do site oficial e adicione ao PATH
```

5. Inicie o sistema:
```bash
npm start
```

6. Escaneie o QR Code que aparecerá no terminal ou use o código de pareamento (se configurado).

## 🚀 Principais Recursos

### Sistema de Stickers

O OmniZap conta com um sistema completo de criação e gerenciamento de stickers:

- **Criação de Stickers**: Converte imagens e vídeos em stickers WhatsApp
- **Gerenciamento de Pacotes**: Organize stickers em pacotes personalizados
- **Customização**: Configure nome e autor para cada pacote
- **Compartilhamento**: Envie pacotes completos para outros usuários

Comandos disponíveis:
- `/sticker` - Cria um sticker a partir de mídia
- `/sticker list` - Lista todos os pacotes disponíveis
- `/sticker info [número]` - Mostra detalhes de um pacote
- `/sticker send [número]` - Envia um pacote de stickers
- `/sticker rename [número] [nome]|[autor]` - Renomeia um pacote
- `/sticker delete [número]` - Exclui um pacote

### Banco de Dados Integrado

A partir da versão 1.0.5, o OmniZap utiliza MySQL para persistência completa de dados:

- **Mensagens**: Armazenamento completo de histórico de mensagens
- **Eventos**: Registro de todos os eventos do WhatsApp
- **Grupos**: Metadados de grupos e participantes
- **Contatos**: Informações de contatos

### Sistema de Logging Avançado

Sistema centralizado de logging baseado em Winston:

- **Níveis de Log**: Suporte a múltiplos níveis (error, warn, info, debug)
- **Rotação de Arquivos**: Compressão e rotação automática por data
- **Formatação Personalizada**: Formato rico com timestamp e contexto
- **Separação por Categoria**: Arquivos separados para erros, alertas e informações

## 🧩 Arquitetura Modular

O OmniZap foi construído com uma arquitetura modular para facilitar a manutenção e expansão:

- **Event Handler**: Processamento independente de eventos do WhatsApp
- **Command Modules**: Sistema modular para processamento de comandos
- **Database Manager**: Camada de abstração para acesso ao banco de dados
- **Media Helper**: Utilitários para processamento de mídia
- **Message Utils**: Ferramentas para formatação e envio de mensagens

## 🔒 Ambiente e Configuração

O OmniZap utiliza variáveis de ambiente para configuração:

- `COMMAND_PREFIX`: Prefixo para comandos (padrão: "/")
- `DB_HOST`: Host do banco de dados MySQL
- `DB_USER`: Usuário do banco de dados
- `DB_PASSWORD`: Senha do banco de dados
- `DB_NAME`: Nome do banco de dados
- `LOG_LEVEL`: Nível de detalhamento dos logs
- `QR_CODE_PATH`: Caminho para salvar QR Code e credenciais
- `PAIRING_CODE`: Usar código de pareamento em vez de QR Code
- `PHONE_NUMBER`: Número para código de pareamento

## 📜 Licença

Este projeto está licenciado sob a licença MIT - veja o arquivo [LICENSE](LICENSE) para mais detalhes.

## 🤝 Contribuição

Contribuições são bem-vindas! Sinta-se à vontade para abrir issues ou enviar pull requests.

## 📞 Contato

- GitHub: [Kaikygr](https://github.com/Kaikygr)
- Repositório: [omnizap-system](https://github.com/Kaikygr/omnizap-system)
