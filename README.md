# OmniZap

Sistema profissional de automação WhatsApp com tecnologia Baileys e arquitetura modular avançada

## 📋 Descrição

OmniZap é um sistema robusto e profissional para automação de mensagens WhatsApp, desenvolvido com a mais avançada tecnologia Baileys para máxima compatibilidade e estabilidade. Agora com **arquitetura modular**, **sistema de cache avançado** e **processamento de eventos independente** para máxima performance e escalabilidade.

## ✨ Características

- 🚀 **Alta Performance**: Otimizado para processamento eficiente de mensagens
- 🔒 **Seguro**: Implementação segura com autenticação robusta
- 📱 **Compatível**: Totalmente compatível com WhatsApp Web
- 🔄 **Reconexão Automática**: Sistema inteligente de reconexão
- 📊 **Logs Detalhados**: Sistema completo de logging para monitoramento
- 🤖 **Sistema de Comandos**: Processamento inteligente de comandos com prefixos configuráveis
- ⚡ **Switch Case**: Arquitetura otimizada para processamento de comandos
- 🎯 **Respostas Inteligentes**: Sistema de respostas automáticas e contextuais
- 🏗️ **Arquitetura Modular**: Sistema dividido em módulos independentes
- 💾 **Cache Avançado**: Sistema de cache inteligente com TTL configurável
- 🎯 **Processamento de Eventos**: Handler independente para todos os eventos WhatsApp
- 📈 **Estatísticas Detalhadas**: Monitoramento completo do sistema e cache

## 🤖 Sistema de Comandos

O OmniZap possui um sistema avançado de processamento de comandos baseado em prefixos configuráveis:

### 📝 Comandos Disponíveis

- `/help` ou `/ajuda` - Lista de comandos disponíveis e ajuda completa
- `/status` - Status detalhado do sistema com estatísticas de cache e memória
- `/cache` - Detalhes avançados do sistema de cache com métricas de performance

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

## 🏗️ Arquitetura Modular

O OmniZap v1.0.2 introduz uma **arquitetura modular avançada** que separa responsabilidades e melhora a manutenibilidade:

### 📦 Módulos Principais

#### 🔗 Socket Controller (`app/connection/socketController.js`)
- **Responsabilidade**: Gerenciamento da conexão WhatsApp
- **Funcionalidades**: 
  - Conexão e reconexão automática
  - Processamento de QR Code
  - Distribuição de eventos para outros módulos
  - Tratamento de diferentes tipos de conexão

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
  - Logging detalhado de atividades
  - Tratamento especializado para cada tipo de evento

#### 💬 Message Controller (`app/controllers/messageController.js`)
- **Responsabilidade**: Lógica de negócios e processamento de comandos
- **Funcionalidades**:
  - Processamento de mensagens recebidas
  - Sistema de comandos com switch/case
  - Respostas inteligentes e contextuais
  - Tratamento de erros e validações

### 🔄 Fluxo de Dados

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Socket Controller  │ -> │   Event Handler   │ -> │  Cache Manager  │
│  (Conexão)         │    │  (Processamento)  │    │  (Armazenamento)│
└─────────────────┘     └──────────────────┘    └─────────────────┘
         │                                              │
         v                                              │
┌─────────────────┐                                     │
│ Message Controller │ <-----------------------------------┘
│ (Lógica Negócio) │
└─────────────────┘
```

### ⚡ Vantagens da Arquitetura Modular

- **Escalabilidade**: Cada módulo pode ser otimizado independentemente
- **Manutenibilidade**: Código organizado e fácil de manter
- **Performance**: Processamento assíncrono e cache inteligente
- **Flexibilidade**: Fácil adição de novos recursos
- **Monitoramento**: Logs detalhados para cada módulo

## 🛠️ Tecnologias

- **Node.js** >= 16.0.0
- **Baileys** - API WhatsApp Web
- **Chalk** - Formatação colorida de console
- **Moment.js** - Manipulação de datas
- **Node Cache** - Sistema de cache avançado
- **Pino** - Logger de alta performance
- **Dotenv** - Gerenciamento de variáveis de ambiente
- **Envalid** - Validação de variáveis de ambiente
- **@hapi/boom** - Tratamento de erros HTTP
- **QRCode Terminal** - Geração de QR Code no terminal

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

1. Execute o comando `npm start`
2. Escaneie o QR Code que aparecerá no terminal com seu WhatsApp
3. Aguarde a mensagem de conexão bem-sucedida
4. O sistema está pronto para processar mensagens e comandos!

### 💬 Interagindo com o Bot

Após a conexão, você pode enviar comandos para o bot usando o prefixo configurado (padrão `/`):

```
/help - Ver todos os comandos disponíveis
/status - Status completo do sistema
/cache - Detalhes do sistema de cache
```

### 📊 Monitoramento do Sistema

O OmniZap oferece comandos avançados para monitoramento:

- **`/status`**: Mostra estatísticas completas do sistema, incluindo:
  - Tempo de atividade
  - Uso de memória
  - Estatísticas de cache por módulo
  - Taxa de hits/misses
  - Arquitetura modular ativa

- **`/cache`**: Exibe detalhes avançados do cache:
  - TTL por tipo de cache
  - Número de chaves por categoria
  - Performance detalhada
  - Taxa de eficiência

## 📁 Estrutura do Projeto

```
omnizap-system/
├── app/
│   ├── cache/
│   │   └── cacheManager.js        # Sistema de cache avançado
│   ├── connection/
│   │   └── socketController.js    # Controle de conexão WhatsApp
│   ├── controllers/
│   │   └── messageController.js   # Processamento de mensagens e comandos
│   └── events/
│       └── eventHandler.js        # Processamento independente de eventos
├── qr-code/                       # Dados de autenticação (auto-gerado)
├── .env                          # Configurações do ambiente
├── .env.example                  # Template de configurações
├── .gitignore                    # Arquivos ignorados pelo Git
├── index.js                      # Arquivo principal
├── package.json                  # Dependências e scripts
├── start.sh                      # Script de inicialização
├── LICENSE                       # Licença MIT
└── README.md                     # Documentação
```

### 📦 Descrição dos Módulos

#### Core System
- **`index.js`**: Arquivo principal que inicializa o sistema
- **`start.sh`**: Script bash para inicialização com verificações

#### Módulos da Aplicação
- **`app/cache/cacheManager.js`**: Gerenciador de cache com TTL e estatísticas
- **`app/connection/socketController.js`**: Controlador de conexão WhatsApp
- **`app/controllers/messageController.js`**: Processador de mensagens e comandos
- **`app/events/eventHandler.js`**: Processador independente de eventos

#### Configuração e Dados
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

# Configurações opcionais de cache (implementação futura)
# CACHE_TTL_MESSAGES=3600
# CACHE_TTL_EVENTS=1800
# CACHE_TTL_GROUPS=7200
# CACHE_TTL_CONTACTS=14400
# CACHE_TTL_CHATS=3600
```

Veja o arquivo `.env.example` para mais detalhes sobre todas as configurações disponíveis.

## 🚀 Performance e Otimizações

### ⚡ Melhorias de Performance

- **Processamento Assíncrono**: Todos os eventos são processados de forma não-bloqueante
- **Cache Inteligente**: Sistema de cache com diferentes TTLs para otimizar acesso a dados
- **Modularização**: Separação de responsabilidades reduz overhead
- **Logging Otimizado**: Sistema de logs colorido e estruturado

### 📊 Métricas de Sistema

O sistema monitora automaticamente:
- Taxa de hits/misses do cache
- Uso de memória por módulo
- Tempo de resposta dos comandos
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
- `./start.sh`: Script bash alternativo com verificações automáticas

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
# ou
chmod +x start.sh && ./start.sh
```

#### 🧪 Testando Módulos

Cada módulo pode ser testado independentemente:

```bash
# Testar Cache Manager
node -e "const { cacheManager } = require('./app/cache/cacheManager'); console.log(cacheManager.getStats());"

# Testar Event Handler
node -e "const { eventHandler } = require('./app/events/eventHandler'); console.log('Event Handler carregado!');"
```

### 📁 Estrutura de Desenvolvimento

#### Adicionando Novos Comandos
1. Edite `app/controllers/messageController.js`
2. Adicione o novo case no switch statement
3. Implemente a função correspondente
4. Teste com o comando no WhatsApp

#### Adicionando Novos Eventos
1. Edite `app/events/eventHandler.js`
2. Adicione o novo processador de evento
3. Integre com o Cache Manager se necessário
4. Adicione logs apropriados

### 🎯 Roadmap de Desenvolvimento

- [ ] **Interface Web**: Painel de controle via web
- [ ] **API REST**: Endpoints para integração externa
- [ ] **Banco de Dados**: Persistência de dados
- [ ] **Webhooks**: Integração com sistemas externos
- [ ] **Scheduled Messages**: Mensagens agendadas
- [ ] **Group Management**: Gerenciamento avançado de grupos
- [ ] **Media Processing**: Processamento avançado de mídia
- [ ] **Analytics Dashboard**: Dashboard de análises

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

## 📈 Changelog

### v1.0.2 (Atual)
- ✅ **Arquitetura Modular**: Sistema dividido em módulos independentes
- ✅ **Cache Manager**: Sistema de cache avançado com TTL configurável
- ✅ **Event Handler**: Processamento independente de eventos
- ✅ **Comandos Avançados**: `/status` e `/cache` para monitoramento
- ✅ **Performance**: Otimizações significativas de performance
- ✅ **Logs Melhorados**: Sistema de logging mais detalhado e colorido

### v1.0.1
- ✅ Sistema de comandos com switch/case
- ✅ Processamento inteligente de mensagens
- ✅ Comando `/help` básico

### v1.0.0
- ✅ Conexão básica com WhatsApp
- ✅ Sistema de QR Code
- ✅ Reconexão automática

## 🌟 Recursos em Destaque

### 🏗️ Arquitetura Modular v1.0.2
- **4 módulos independentes** trabalhando em harmonia
- **Processamento assíncrono** para máxima performance
- **Cache inteligente** com estatísticas detalhadas
- **Sistema de eventos** completamente independente

### 📊 Sistema de Monitoramento
- **Estatísticas em tempo real** via comando `/status`
- **Métricas de cache** detalhadas via comando `/cache`
- **Monitoramento de memória** e performance
- **Logs coloridos** para facilitar debugging

### ⚡ Performance Otimizada
- **TTL configurável** para diferentes tipos de dados
- **Limpeza automática** de cache expirado
- **Processamento não-bloqueante** de eventos
- **Gerenciamento eficiente** de recursos

---

**OmniZap v1.0.2** - Sistema Profissional de Automação WhatsApp com Arquitetura Modular © 2025
