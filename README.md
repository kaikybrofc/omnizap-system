# OmniZap System

Sistema profissional de automação para WhatsApp, construído com a poderosa biblioteca Baileys.

## 🚀 Visão Geral

O OmniZap System é uma solução de automação para WhatsApp robusta e escalável. Desenvolvido sobre a biblioteca Baileys, ele oferece um conjunto completo de funcionalidades para gerenciamento de grupos, processamento de mensagens, e monitoramento de sistema. É a ferramenta ideal para empresas e desenvolvedores que buscam integrar o WhatsApp em seus fluxos de trabalho de forma eficiente e controlada.

## ✨ Funcionalidades Principais

*   **Gerenciamento de Sessão:** Persistência automática de credenciais de autenticação para reconexões rápidas e estáveis.
*   **Processamento Inteligente de Mensagens:** Responde a mensagens citando-as e respeita as configurações de mensagens efêmeras.
*   **Gerenciamento Completo de Grupos:** Um conjunto extenso de comandos de administração para controle total sobre os grupos.
*   **Mensagens de Boas-Vindas e Saída:** Configure mensagens automáticas e personalizadas (com texto, imagem ou vídeo) para novos membros e para aqueles que saem. Suporta placeholders dinâmicos para criar mensagens mais ricas.
*   **Análise Avançada de Grupos:** O comando `/info` oferece estatísticas detalhadas, incluindo ranking de mensagens, uso de mídia, horários de pico de atividade e identificação de membros inativos.
*   **Armazenamento de Dados Robusto:** Utiliza streaming para ler e escrever arquivos de dados (JSON), garantindo baixo consumo de memória. Inclui um sistema de lock de arquivos para prevenir corrupção de dados.
*   **Sistema de Logs de Produção:** Logs detalhados com rotação diária de arquivos, múltiplos níveis (info, warn, error), e formato JSON estruturado para fácil análise. Integrado ao PM2 para capturar logs por instância.
*   **Monitoramento de Métricas:** Coleta e loga métricas de uso de CPU e memória para acompanhamento de desempenho.
*   **Reconexão Automática:** Lógica de reconexão robusta com tentativas limitadas em caso de desconexões inesperadas.
*   **Integração com PM2:** Pronto para produção com arquivos de configuração para o gerenciador de processos PM2.

## 🛠️ Tecnologias Utilizadas

*   **Node.js** (>=16.0.0)
*   **@whiskeysockets/baileys**: Biblioteca principal para interação com o WhatsApp.
*   **PM2**: Gerenciador de processos para produção.
*   **Winston** & **Winston Daily Rotate File**: Para um sistema de logging configurável e eficiente.
*   **Dotenv** & **Envalid**: Para gerenciamento e validação de variáveis de ambiente.
*   **stream-json**: Para parsing de grandes arquivos JSON com baixo uso de memória.
*   **proper-lockfile**: Para prevenir condições de corrida na escrita de arquivos.
*   E outras bibliotecas de suporte como `pino`, `chalk`, e `moment-timezone`.

## ⚙️ Instalação

Siga os passos abaixo para configurar e executar o OmniZap System.

### Pré-requisitos

Certifique-se de ter o **Node.js (versão 16 ou superior)** e o **npm** instalados.

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

Crie um arquivo `.env` na raiz do projeto (você pode copiar de `.env.example`) e preencha as variáveis.

```dotenv
# =======================================
# CONFIGURAÇÕES GERAIS
# =======================================
# Prefixo para comandos do bot (ex: /, !, #)
COMMAND_PREFIX=/

# Caminho para a pasta onde os arquivos de dados serão salvos (ex: ./temp/)
# O sistema criará o diretório se ele não existir.
STORE_PATH=./temp/

# =======================================
# CONFIGURAÇÕES DE LOG
# =======================================
# Ambiente de execução (development, production, test)
NODE_ENV=development
# Nível mínimo de log a ser exibido (error, warn, info, debug)
LOG_LEVEL=debug
# Nome do serviço para os logs (útil ao usar PM2)
ECOSYSTEM_NAME=omnizap-system

# =======================================
# CONFIGURAÇÕES DE RETENÇÃO DE DADOS
# =======================================
# Intervalo em milissegundos para a limpeza de mensagens antigas (padrão: 24 horas)
OMNIZAP_CLEANUP_INTERVAL_MS=86400000

# --- Mensagens de Chat (messages.json) ---
# Número máximo de mensagens a serem salvas por conversa
OMNIZAP_MAX_MESSAGES_PER_CHAT=1000
# Número de meses para reter mensagens de chat
OMNIZAP_MESSAGE_RETENTION_MONTHS=3

# --- Mensagens Raw (rawMessages.json) ---
# Número máximo de mensagens "raw" (objeto completo do Baileys) a serem salvas por conversa
OMNIZAP_MAX_RAW_MESSAGES_PER_CHAT=5000
# Número de meses para reter mensagens raw
OMNIZAP_RAW_MESSAGE_RETENTION_MONTHS=3
```

## ▶️ Como Usar

### Para Desenvolvimento

Inicie a aplicação com o script padrão do npm. Na primeira execução, um QR Code será exibido no terminal para ser escaneado com seu WhatsApp.

```bash
npm start
```

### Para Produção com PM2

O sistema está configurado para ser gerenciado pelo PM2. Utilize os scripts abaixo para iniciar a aplicação em modo de produção ou desenvolvimento.

```bash
# Iniciar em modo de desenvolvimento com PM2
npm run pm2:dev

# Iniciar em modo de produção com PM2
npm run pm2:prod

# Para monitorar os logs
pm2 logs omnizap-system

# Para parar a aplicação
pm2 stop omnizap-system
```

## 🤖 Comandos do Bot

A seguir, a lista de comandos de administração disponíveis. A maioria dos comandos requer que o bot e o usuário que executa o comando sejam administradores do grupo.

### Menu de Administração
| Comando | Descrição |
| :--- | :--- |
| **/menuadm** | Exibe a lista completa de comandos de administração. |

### Gerenciamento de Membros
| Comando | Descrição |
| :--- | :--- |
| **/add @user** | Adiciona um ou mais participantes ao grupo. |
| **/ban @user** | Remove um ou mais participantes do grupo. |
| **/up @user** | Promove um ou mais participantes a administradores. |
| **/down @user** | Remove o cargo de administrador de um ou mais participantes. |

### Gerenciamento de Grupo
| Comando | Descrição |
| :--- | :--- |
| **/setsubject <texto>** | Altera o nome do grupo. |
| **/setdesc <texto>** | Altera a descrição do grupo. |
| **/setgroup <opt>** | `announcement`: Fecha o grupo.<br>`not_announcement`: Abre o grupo.<br>`locked`: Restringe a edição de dados.<br>`unlocked`: Libera a edição de dados. |
| **/addmode <opt>** | `all_member_add`: Todos podem adicionar.<br>`admin_add`: Apenas admins podem adicionar. |
| **/temp <segundos>** | Ativa/desativa mensagens efêmeras. Use `0` para desativar. |
| **/invite** | Mostra o código de convite do grupo. |
| **/revoke** | Revoga e cria um novo código de convite. |
| **/leave** | O bot sai do grupo. |

### Informações e Análise
| Comando | Descrição |
| :--- | :--- |
| **/info [id_do_grupo]** | Mostra informações e estatísticas detalhadas do grupo atual ou do grupo especificado. |
| **/info --inativos <N>** | Mostra uma lista de membros com menos de `N` mensagens, além das estatísticas completas. |
| **/metadata [id_do_grupo]**| Obtém os metadados brutos de um grupo. |

### Mensagens Automáticas
| Comando | Descrição |
| :--- | :--- |
| **/welcome <on\|off>** | Ativa ou desativa a mensagem de boas-vindas. |
| **/welcome set <msg>** | Define a mensagem de boas-vindas. Pode ser texto, ou uma mídia (imagem/vídeo) enviada com o comando na legenda. |
| **/farewell <on\|off>** | Ativa ou desativa a mensagem de saída. |
| **/farewell set <msg>** | Define a mensagem de saída (texto ou mídia). |

#### Placeholders para Mensagens Automáticas
Você pode usar as seguintes variáveis em suas mensagens de boas-vindas/saída para torná-las dinâmicas:
*   `@user`: Menciona o usuário que entrou/saiu.
*   `@groupname`: Nome do grupo.
*   `@desc`: Descrição do grupo.
*   `@membercount`: Número total de membros.

## 📂 Estrutura de Pastas

*   `app/`: Contém a lógica principal da aplicação.
    *   `connection/`: Gerencia a conexão com o WhatsApp (Baileys).
    *   `controllers/`: Lida com o processamento de mensagens e eventos.
    *   `modules/`: Contém módulos de funcionalidades específicas, como os comandos de admin.
    *   `store/`: Gerencia o armazenamento e a persistência de dados (mensagens, grupos, etc.).
    *   `utils/`: Utilitários como o logger, métricas de sistema e download de mídia.
*   `logs/`: Diretório onde os arquivos de log são armazenados.
*   `temp/`: Diretório padrão para armazenar os arquivos de estado da sessão e dados.
*   `index.js`: Ponto de entrada da aplicação.
*   `ecosystem.config.js`: Arquivo de configuração para o PM2.

## 🗺️ Roadmap

*   **Expansão de Comandos:** Adicionar mais comandos interativos.
*   **Integração com Banco de Dados:** Suporte opcional a bancos de dados como PostgreSQL ou MongoDB.
*   **Interface Web:** Uma UI para gerenciar o bot, visualizar estatísticas e logs.
*   **Melhorar Modularidade:** Refatorar a arquitetura para facilitar a criação de novos módulos pela comunidade.
*   **Testes Automatizados:** Aumentar a cobertura de testes para garantir a estabilidade.

## 🤝 Contribuição

Contribuições são muito bem-vindas! Se você deseja contribuir, por favor, siga estas diretrizes:

1.  Faça um fork do repositório.
2.  Crie uma nova branch (`git checkout -b feature/sua-feature`).
3.  Faça suas alterações.
4.  Commit suas alterações (`git commit -m 'feat: Adiciona nova funcionalidade'`).
5.  Envie para a branch (`git push origin feature/sua-feature`).
6.  Abra um Pull Request.

## 📄 Licença

Este projeto está licenciado sob a Licença MIT. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.

## 📧 Contato

Para dúvidas ou suporte, abra uma issue no repositório do GitHub:
[https://github.com/Kaikygr/omnizap-system/issues](https://github.com/Kaikygr/omnizap-system/issues)
