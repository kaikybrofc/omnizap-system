# OmniZap

Sistema profissional de automação WhatsApp com tecnologia Baileys

## 📋 Descrição

OmniZap é um sistema robusto e profissional para automação de mensagens WhatsApp, desenvolvido com a mais avançada tecnologia Baileys para máxima compatibilidade e estabilidade.

## ✨ Características

- 🚀 **Alta Performance**: Otimizado para processamento eficiente de mensagens
- 🔒 **Seguro**: Implementação segura com autenticação robusta
- 📱 **Compatível**: Totalmente compatível com WhatsApp Web
- 🔄 **Reconexão Automática**: Sistema inteligente de reconexão
- 📊 **Logs Detalhados**: Sistema completo de logging para monitoramento

## 🛠️ Tecnologias

- **Node.js** >= 16.0.0
- **Baileys** - API WhatsApp Web
- **Chalk** - Formatação colorida de console
- **Moment.js** - Manipulação de datas
- **Node Cache** - Sistema de cache
- **Pino** - Logger de alta performance

## 📦 Instalação

1. Clone o repositório:
```bash
git clone https://github.com/omnizap/omnizap.git
cd omnizap
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
4. O sistema está pronto para processar mensagens!

## 📁 Estrutura do Projeto

```
omnizap/
├── app/
│   ├── connection/
│   │   └── socketController.js    # Controle de conexão WhatsApp
│   └── controllers/
│       └── messageController.js   # Processamento de mensagens
├── qr-code/                       # Dados de autenticação (auto-gerado)
├── .env                          # Configurações do ambiente
├── .gitignore                    # Arquivos ignorados pelo Git
├── index.js                      # Arquivo principal
├── package.json                  # Dependências e scripts
└── README.md                     # Documentação
```

## ⚙️ Configuração

### Variáveis de Ambiente

- `QR_CODE_PATH`: Caminho para armazenar dados de autenticação (padrão: `./qr-code`)
- `NODE_ENV`: Ambiente de execução (`development` ou `production`)
- `LOG_LEVEL`: Nível de logging (`info`, `debug`, `error`)

## 🔧 Desenvolvimento

### Scripts Disponíveis

- `npm start`: Inicia o sistema em modo produção
- `npm run dev`: Inicia o sistema em modo desenvolvimento
- `npm test`: Executa os testes (quando implementados)

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

- 📧 Email: suporte@omnizap.com
- 🐛 Issues: [GitHub Issues](https://github.com/omnizap/omnizap/issues)
- 📖 Documentação: [Wiki](https://github.com/omnizap/omnizap/wiki)

## 🔄 Changelog

### v1.0.0
- Lançamento inicial do OmniZap
- Sistema completo de conexão WhatsApp
- Processamento robusto de mensagens
- Sistema de logging avançado
- Reconexão automática

---

**OmniZap** - Sistema Profissional de Automação WhatsApp © 2025
