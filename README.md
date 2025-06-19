# OmniZap

Sistema profissional de automação WhatsApp com tecnologia Baileys e sistema de comandos inteligente

## 📋 Descrição

OmniZap é um sistema robusto e profissional para automação de mensagens WhatsApp, desenvolvido com a mais avançada tecnologia Baileys para máxima compatibilidade e estabilidade. Agora com sistema de comandos baseado em prefixos configuráveis para interação inteligente com usuários.

## ✨ Características

- 🚀 **Alta Performance**: Otimizado para processamento eficiente de mensagens
- 🔒 **Seguro**: Implementação segura com autenticação robusta
- 📱 **Compatível**: Totalmente compatível com WhatsApp Web
- 🔄 **Reconexão Automática**: Sistema inteligente de reconexão
- 📊 **Logs Detalhados**: Sistema completo de logging para monitoramento
- 🤖 **Sistema de Comandos**: Processamento inteligente de comandos com prefixos configuráveis
- ⚡ **Switch Case**: Arquitetura otimizada para processamento de comandos
- 🎯 **Respostas Inteligentes**: Sistema de respostas automáticas e contextuais

## 🤖 Sistema de Comandos

O OmniZap possui um sistema avançado de processamento de comandos baseado em prefixos configuráveis:

### 📝 Comandos Disponíveis

- `/help` - Lista de comandos disponíveis

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

## 🛠️ Tecnologias

- **Node.js** >= 16.0.0
- **Baileys** - API WhatsApp Web
- **Chalk** - Formatação colorida de console
- **Moment.js** - Manipulação de datas
- **Node Cache** - Sistema de cache
- **Pino** - Logger de alta performance
- **Dotenv** - Gerenciamento de variáveis de ambiente

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
/help - Ver todos os comandos
```

## 📁 Estrutura do Projeto

```
omnizap/
├── app/
│   ├── connection/
│   │   └── socketController.js    # Controle de conexão WhatsApp
│   └── controllers/
│       └── messageController.js   # Processamento de mensagens e comandos
├── qr-code/                       # Dados de autenticação (auto-gerado)
├── .env                          # Configurações do ambiente
├── .env.example                  # Template de configurações
├── .gitignore                    # Arquivos ignorados pelo Git
├── index.js                      # Arquivo principal
├── package.json                  # Dependências e scripts
└── README.md                     # Documentação
```

## ⚙️ Configuração

### Variáveis de Ambiente

#### Configurações Obrigatórias
- `QR_CODE_PATH`: Caminho para armazenar dados de autenticação (padrão: `./qr-code`)
- `COMMAND_PREFIX`: Prefixo dos comandos do bot (padrão: `/`)

Veja o arquivo `.env.example` para mais detalhes sobre todas as configurações disponíveis.

## 🔧 Desenvolvimento

### Scripts Disponíveis

- `npm start`: Inicia o sistema em modo produção

### Contribuindo

1. Faça um fork do projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## 📝 Licença

Este projeto está sob a licença MIT. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.

## 🤝 Suporte

Para suporte e dúvidas:

- 📧 Email: kaikygomesribeiroof@gmail.com
- 🐛 Issues: [GitHub Issues](https://github.com/Kaikygr/omnizap-system/issues)
- 📖 Documentação: [Wiki](https://github.com/Kaikygr/omnizap-system/wiki)


**OmniZap** - Sistema Profissional de Automação WhatsApp © 2025
