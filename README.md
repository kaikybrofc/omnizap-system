# OmniZap System v2.0.1

O **OmniZap System** é um sistema profissional de automação para WhatsApp desenvolvido com Node.js e a biblioteca Baileys. Ele oferece uma plataforma robusta para gerenciar grupos, automatizar interações e estender as funcionalidades do WhatsApp com comandos personalizados.

## 🌟 Novidades da Versão 2.0.1

Esta versão traz melhorias significativas de desempenho, novos recursos e maior estabilidade.

- **Refatoração do Módulo de Comandos:** O sistema de comandos foi totalmente reescrito para maior modularidade e extensibilidade.
- **Melhorias no Desempenho:** Otimização do uso de memória e CPU para uma operação mais eficiente.
- **Novos Comandos Administrativos:** Adicionados novos comandos para gerenciamento avançado de grupos.
- **Correções de Bugs:** Diversas correções de bugs para aumentar a estabilidade do sistema.

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
    COMMAND_PREFIX=/
    USER_ADMIN=seu_jid_de_admin@s.whatsapp.net
    ```
    *   `COMMAND_PREFIX`: O prefixo para todos os comandos (ex: `/`, `!`, `.`).
    *   `USER_ADMIN`: O JID do usuário com privilégios administrativos para o bot.

## ⚡️ Uso

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

- **Node.js:** Ambiente de execução JavaScript.
- **@whiskeysockets/baileys:** A biblioteca principal para a API do WhatsApp Web.
- **Pino:** Para logs de alta performance.
- **FFmpeg:** Para processamento de mídia (criação de figurinhas).
- **Dotenv:** Para gerenciamento de variáveis de ambiente.

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
