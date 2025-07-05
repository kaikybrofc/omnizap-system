# OmniZap v1.0.5

Sistema profissional de automação WhatsApp com tecnologia Baileys e arquitetura modular avançada

## 📋 Descrição

OmniZap é um sistema robusto e profissional para automação de mensagens WhatsApp, desenvolvido com a mais avançada tecnologia Baileys para máxima compatibilidade e estabilidade. Com **arquitetura modular**, **sistema de cache avançado** e **processamento de eventos independente** para máxima performance e escalabilidade. A versão 1.0.4 introduz um **sistema completo de sticker packs**, **logging centralizado baseado em Winston** com rotação de arquivos, e **sub-comandos avançados** para gerenciamento inteligente de conteúdo.

## ✨ Características

- 🚀 **Alta Performance**: Otimizado para processamento eficiente de mensagens
- 🔒 **Seguro**: Implementação segura com autenticação robusta
- 📱 **Compatível**: Totalmente compatível com WhatsApp Web
- 🔄 **Reconexão Automática**: Sistema inteligente de reconexão
- 📊 **Logs Centralizados**: Sistema completo de logging com Winston para monitoramento e diagnóstico
- 🤖 **Sistema de Comandos**: Processamento inteligente de comandos com prefixos configuráveis
- ⚡ **Switch Case**: Arquitetura otimizada para processamento de comandos
- 🎯 **Respostas Inteligentes**: Sistema de respostas automáticas e contextuais
- 🏗️ **Arquitetura Modular**: Sistema dividido em módulos independentes
- 💾 **Cache Avançado**: Sistema de cache inteligente com TTL configurável
- 🎯 **Processamento de Eventos**: Handler independente para todos os eventos WhatsApp
- 📈 **Estatísticas Detalhadas**: Monitoramento completo do sistema e cache
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

## 🛠️ Tecnologias

### 📋 Principais Dependências
- **Node.js** >= 16.0.0
- **@whiskeysockets/baileys** ^6.7.0 - API WhatsApp Web de alta performance
- **Winston** ^3.17.0 - Sistema de logging centralizado
- **Winston Daily Rotate File** ^5.0.0 - Rotação automática de logs
- **Chalk** ^4.1.2 - Formatação colorida de console
- **Moment.js** ^0.5.48 - Manipulação de datas e timezones
- **Node Cache** ^5.1.2 - Sistema de cache avançado
- **Pino** ^7.11.0 - Logger de alta performance
- **Dotenv** ^16.5.0 - Gerenciamento de variáveis de ambiente
- **Envalid** ^8.0.0 - Validação de variáveis de ambiente
- **@hapi/boom** ^10.0.1 - Tratamento de erros HTTP
- **QRCode Terminal** ^0.12.0 - Geração de QR Code no terminal
- **FFmpeg** ^0.0.4 - Processamento de mídia para stickers

### 🎨 Sistema de Stickers - Dependências
- **webpmux** - Adiciona metadados EXIF aos stickers
- **ffmpeg** - Conversão de mídia (imagem/vídeo → WebP)
- **sharp** (opcional) - Processamento de imagem otimizado
- Sistema de arquivos nativo para persistência de dados

### 🔧 Instalação de Dependências do Sistema de Stickers

Para que o sistema de stickers funcione completamente, é necessário instalar algumas dependências do sistema:

#### Ubuntu/Debian:
```bash
sudo apt-get update
sudo apt-get install -y webp ffmpeg
```

#### CentOS/RHEL/Fedora:
```bash
sudo yum install -y libwebp-tools ffmpeg
# ou para Fedora:
sudo dnf install -y libwebp-tools ffmpeg
```

#### Windows:
1. Baixe o FFmpeg de https://ffmpeg.org/download.html
2. Baixe o WebP tools de https://developers.google.com/speed/webp/download
3. Adicione ambos ao PATH do sistema

## 💾 Sistema de Cache Avançado

O OmniZap utiliza um sistema de cache inteligente com múltiplas camadas:

### 📊 Tipos de Cache

| Tipo | TTL | Descrição |
|------|-----|-----------|
| **Mensagens** | 1 hora | Cache de mensagens recebidas e enviadas |
| **Eventos** | 30 min | Cache de eventos do WhatsApp |
| **Grupos** | 2 horas | Metadados de grupos |
| **Contatos** | 4 horas | Informações de contatos |
| **Chats** | 1 hora | Dados de conversas |

### 🔧 Funcionalidades do Cache

- **Hit/Miss Tracking**: Estatísticas detalhadas de performance
- **TTL Configurável**: Tempo de vida personalizado por tipo
- **Limpeza Automática**: Remoção inteligente de dados expirados
- **Backup Automático**: Backup periódico das estatísticas
- **Otimização de Memória**: Gerenciamento eficiente de recursos

## 📦 Instalação

1. Clone o repositório:
```bash
git clone https://github.com/Kaikygr/omnizap-system.git
cd omnizap-system
```

2. Instale as dependências:
```bash
npm install
```

3. Configure as variáveis de ambiente:
```bash
cp .env.example .env
```

4. Execute o sistema:
```bash
npm start
```

## 🚀 Uso

1. Execute o sistema:
```bash
npm start
```

2. Escaneie o QR Code que aparecerá no terminal com seu WhatsApp ou, se preferir, use o método de pareamento por código.
3. Aguarde a mensagem de conexão bem-sucedida
4. O sistema está pronto para processar mensagens e comandos!

## 📁 Estrutura do Projeto

```
omnizap-system/
├── app/
│   ├── cache/
│   │   └── cacheManager.js        # Sistema de cache avançado
│   ├── commandModules/
│   │   └── stickerModules/        # Módulos de sticker
│   │       ├── stickerCommand.js      # Criação de stickers
│   │       ├── stickerPackManager.js  # Gerenciamento de packs
│   │       └── stickerSubCommands.js  # Sub-comandos de admin
│   ├── connection/
│   │   └── socketController.js    # Controle de conexão WhatsApp
│   ├── controllers/
│   │   └── messageController.js   # Processamento de mensagens e comandos
│   ├── events/
│   │   └── eventHandler.js        # Processamento independente de eventos
│   └── utils/
│       ├── baileys/               # Utilitários do Baileys
│       │   ├── mediaHelper.js         # Manipulação de mídia
│       │   └── messageHelper.js       # Processamento de mensagens
│       ├── logger/                # Sistema de logging
│       │   └── loggerModule.js        # Logger centralizado Winston
│       ├── constants.js           # Constantes globais
│       └── messageUtils.js        # Utilitários de mensagem
├── logs/                          # Logs do sistema (auto-gerado)
├── temp/                          # Arquivos temporários
│   ├── stickers/                  # Stickers temporários
│   ├── stickerPacks/             # Packs de usuários
│   └── prefs/                    # Preferências de usuário
├── qr-code/                       # Dados de autenticação (auto-gerado)
├── .env                          # Configurações do ambiente
├── .env.example                  # Template de configurações
├── .gitignore                    # Arquivos ignorados pelo Git
├── index.js                      # Arquivo principal
├── package.json                  # Dependências e scripts
├── LICENSE                       # Licença MIT
└── README.md                     # Documentação
```

### 📦 Descrição dos Módulos

#### Core System
- **`index.js`**: Arquivo principal que inicializa o sistema

#### Módulos da Aplicação
- **`app/cache/cacheManager.js`**: Gerenciador de cache com TTL e estatísticas
- **`app/connection/socketController.js`**: Controlador de conexão WhatsApp
- **`app/controllers/messageController.js`**: Processador de mensagens e comandos
- **`app/events/eventHandler.js`**: Processador independente de eventos

#### Módulos de Comando
- **`app/commandModules/stickerModules/`**: Sistema completo de sticker packs
  - **`stickerCommand.js`**: Processamento e criação de stickers
  - **`stickerPackManager.js`**: Gerenciamento de packs por usuário
  - **`stickerSubCommands.js`**: Sub-comandos de administração

#### Utilitários
- **`app/utils/baileys/`**: Helpers específicos do Baileys
  - **`mediaHelper.js`**: Manipulação de mídia
  - **`messageHelper.js`**: Processamento de mensagens
- **`app/utils/logger/loggerModule.js`**: Sistema de logging centralizado
- **`app/utils/constants.js`**: Constantes globais do sistema
- **`app/utils/messageUtils.js`**: Utilitários de envio de mensagens

#### Configuração e Dados
- **`logs/`**: Sistema de logs com rotação automática
- **`temp/`**: Diretórios de arquivos temporários
  - **`stickers/`**: Stickers em processamento
  - **`stickerPacks/`**: Packs organizados por usuário
  - **`prefs/`**: Preferências personalizadas
- **`qr-code/`**: Diretório para dados de autenticação (criado automaticamente)
- **`.env`**: Variáveis de ambiente do sistema

## ⚙️ Configuração

### Variáveis de Ambiente

#### Configurações Principais
- `QR_CODE_PATH`: Caminho para armazenar dados de autenticação (padrão: `./app/connection/qr-code`)
- `COMMAND_PREFIX`: Prefixo dos comandos do bot (padrão: `/`)

#### Exemplo de Configuração (.env)
```bash
# Configurações do OmniZap
QR_CODE_PATH=./app/connection/qr-code
COMMAND_PREFIX=/

# Configurações de autenticação
# Defina PAIRING_CODE como true para usar o método de pareamento por código
PAIRING_CODE=false
# Insira o número de telefone com o código do país (ex: 5511999999999)
PHONE_NUMBER=

# Configurações de logging
NODE_ENV=development
LOG_LEVEL=debug
ECOSYSTEM_NAME=omnizap-system

# Configurações opcionais de cache (implementação futura)
# CACHE_TTL_MESSAGES=3600
# CACHE_TTL_EVENTS=1800
# CACHE_TTL_GROUPS=7200
# CACHE_TTL_CONTACTS=14400
# CACHE_TTL_CHATS=3600
```

### 🎨 Configurações do Sistema de Stickers

O sistema de stickers possui configurações avançadas definidas em `app/utils/constants.js`:

```javascript
// Configurações de Sticker Packs
STICKERS_PER_PACK: 30          // Stickers por pack
MAX_FILE_SIZE: 10 * 1024 * 1024 // 10MB limite de arquivo
DEFAULT_PACK_NAME: '🤖 OmniZap Pack'
DEFAULT_AUTHOR: '👤 OmniZap User'

// Rate Limiting para envio
BATCH_SIZE: 5                   // Stickers por lote
DELAY_BETWEEN_STICKERS: 1000    // 1s entre stickers
DELAY_BETWEEN_BATCHES: 3000     // 3s entre lotes

// Formatos suportados
SUPPORTED_FORMATS: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']
```

### 📁 Estrutura de Arquivos de Stickers

```
temp/
├── stickers/                  # Stickers temporários durante processamento
├── stickerPacks/             # Packs organizados por usuário
│   ├── [userID].json         # Dados do usuário (packs, estatísticas)
│   └── [userID]/             # Diretório do usuário
│       ├── pack_0/           # Pack 1
│       ├── pack_1/           # Pack 2
│       └── ...
└── prefs/                    # Preferências de usuário
    └── [userID].json         # Nomes e autores preferidos
```

Veja o arquivo `.env.example` para mais detalhes sobre todas as configurações disponíveis.

## 🚀 Performance e Otimizações

### ⚡ Melhorias de Performance

- **Processamento Assíncrono**: Todos os eventos são processados de forma não-bloqueante
- **Cache Inteligente**: Sistema de cache com diferentes TTLs para otimizar acesso a dados
- **Modularização**: Separação de responsabilidades reduz overhead
- **Logging Otimizado**: Sistema de logs colorido e estruturado
- **Rate Limiting**: Controle de envio para evitar bloqueios do WhatsApp
- **Processamento de Mídia**: Conversão otimizada com FFmpeg
- **Persistência Eficiente**: Sistema de arquivos JSON estruturado por usuário

### 🎨 Otimizações do Sistema de Stickers

- **Metadados EXIF**: Inserção automática de informações de pack
- **Compressão Inteligente**: Otimização de tamanho mantendo qualidade
- **Cache de Preferências**: Memorização de nomes e autores por usuário
- **Limpeza Automática**: Remoção de arquivos temporários
- **Envio Escalonado**: Prevenção de rate limiting com delays configuráveis
- **Validação de Mídia**: Verificação de formato e tamanho antes do processamento

### 📊 Métricas de Sistema

O sistema monitora automaticamente:
- Taxa de hits/misses do cache
- Uso de memória por módulo
- Tempo de resposta dos comandos
- Estatísticas de stickers por usuário (total, packs, completos/incompletos)
- Taxa de sucesso no envio de stickers
- Quantidade de eventos processados
- Status de conexão em tempo real

### 🔧 Otimizações Implementadas

- **Lazy Loading**: Módulos carregados sob demanda
- **Memory Management**: Limpeza automática de cache
- **Event Batching**: Processamento em lote de eventos similares
- **Connection Pooling**: Reutilização eficiente de conexões

## 🔧 Desenvolvimento

### Scripts Disponíveis

- `npm start`: Inicia o sistema em modo produção

### 🛠️ Desenvolvimento Local

#### Configuração do Ambiente
```bash
# Clone o repositório
git clone https://github.com/Kaikygr/omnizap-system.git
cd omnizap-system

# Instale as dependências
npm install

# Configure as variáveis de ambiente
cp .env.example .env

# Execute o sistema
npm start
```


### 📁 Estrutura de Desenvolvimento

#### Adicionando Novos Comandos
1. **Para comandos simples:**
   - Edite `app/controllers/messageController.js`
   - Adicione o novo case no switch statement
   - Implemente a lógica correspondente
   
2. **Para comandos complexos (como stickers):**
   - Crie um novo módulo em `app/commandModules/`
   - Implemente os sub-comandos necessários
   - Integre com o Message Controller
   - Adicione testes e documentação

#### Adicionando Novos Módulos de Comando
1. Crie diretório em `app/commandModules/[nomeModulo]/`
2. Implemente arquivos principais:
   - `[nomeModulo]Command.js` - Lógica principal
   - `[nomeModulo]Manager.js` - Gerenciamento de dados
   - `[nomeModulo]SubCommands.js` - Sub-comandos (se aplicável)
3. Integre com `messageController.js`
4. Adicione logging apropriado

#### Adicionando Novos Eventos
1. Edite `app/events/eventHandler.js`
2. Adicione o novo processador de evento
3. Integre com o Cache Manager se necessário
4. Adicione logs estruturados com o logger Winston

### Contribuindo

1. Faça um fork do projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

#### 📋 Guidelines de Contribuição

- **Código**: Siga o padrão de nomenclatura existente
- **Commits**: Use mensagens descritivas em português
- **Testes**: Teste todas as funcionalidades antes do PR
- **Documentação**: Atualize a documentação quando necessário
- **Modularidade**: Mantenha a arquitetura modular

## 📝 Licença

Este projeto está sob a licença MIT. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.

## 🤝 Suporte

Para suporte e dúvidas:

- 📧 Email: kaikygomesribeiroof@gmail.com
- 🐛 Issues: [GitHub Issues](https://github.com/Kaikygr/omnizap-system/issues)
- 📖 Documentação: [Wiki](https://github.com/Kaikygr/omnizap-system/wiki)

### 🆘 Problemas Comuns

#### Sistema de Stickers
- **Erro "webpmux não encontrado"**: Instale as dependências do sistema (ver seção de instalação)
- **Stickers muito grandes**: Reduza o tamanho da mídia antes de enviar
- **Erro de permissão**: Verifique as permissões da pasta `temp/`

#### Conexão WhatsApp
- **QR Code não aparece**: Verifique se a pasta `qr-code/` existe e tem permissões. Se estiver usando o modo de pareamento por código, o QR Code não será exibido.
- **Código de pareamento não funciona**: Certifique-se de que o `PHONE_NUMBER` está correto no arquivo `.env` e que a variável `PAIRING_CODE` está definida como `true`.
- **Desconexões frequentes**: Pode ser rate limiting do WhatsApp, aguarde um tempo
- **Erro de autenticação**: Delete a pasta `qr-code/` e escaneie novamente o QR Code ou use o código de pareamento.

#### Logs e Monitoramento
- **Logs não aparecem**: Verifique as permissões da pasta `logs/`
- **Arquivos de log muito grandes**: O sistema roda rotação automática, mas você pode ajustar em `loggerModule.js`


**OmniZap v1.0.4** - Sistema Profissional de Automação WhatsApp com Arquitetura Modular © 2025
