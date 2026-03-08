# AiModule Agent Guide

Este arquivo e destinado a agentes de IA para gerar respostas no contexto dos comandos deste modulo.

## Fonte de Verdade

- arquivo_base: `app/modules/aiModule/commandConfig.json`
- schema_version: `1.1.0`
- module_enabled: `true`
- generated_at: `2026-03-08T03:38:51.150Z`

## Escopo do Modulo

- module: `aiModule`
- source_files:
- catCommand.js
- total_commands: `3`
- total_enabled_commands: `3`

## Protocolo de Resposta para IA

- Passo 1: identificar comando pelo token apos o prefixo.
- Passo 2: resolver alias para nome canonico usando campo `aliases`.
- Passo 3: validar `enabled`, `pre_condicoes`, permissao e local de uso.
- Passo 4: se houver erro de uso, responder com `mensagens_uso` (quando existir) ou `metodos_de_uso`.
- Passo 5: seguir `respostas_padrao` como fallback de texto.
- Passo 6: considerar `informacoes_coletadas`, `privacidade` e `observabilidade` ao elaborar resposta.

## Regras de Seguranca para IA

- A IA orienta, mas nao executa acao administrativa automaticamente.
- Nao inventar comandos, subcomandos ou permissao fora do JSON.
- Sempre informar onde pode usar (grupo/privado) e quem pode usar.
- Em duvida de permissao, responder com orientacao conservadora.

## Catalogo de Comandos

### cat

- aliases: (nenhum)
- enabled: true
- categoria: ia
- descricao: Perguntas para IA com suporte opcional a resposta em audio.
- permissao_necessaria: usuario comum
- limite_de_uso: texto sujeito a limites da API
- local_de_uso:
- privado
- grupo
- metodos_de_uso:
- <prefix>cat sua pergunta
- <prefix>cat --audio sua pergunta
- subcomandos:
- (nenhum)
- argumentos:
- prompt | tipo: string | opcional | validacao: texto livre; pode usar contexto de mídia | default: null
- flags | tipo: array<string> | opcional | validacao: aliases de áudio/texto suportados | default: []
- pre_condicoes:
- requer_grupo: nao
- requer_admin: nao
- requer_admin_principal: nao
- requer_google_login: sim
- requer_nsfw: nao
- requer_midia: nao
- requer_mensagem_respondida: nao
- rate_limit:
- max: null
- janela_ms: null
- escopo: sem_rate_limit_explicito
- acesso:
- somente_premium: nao
- planos_permitidos: comum, premium
- limite_uso_por_plano:
- comum: max=8, janela_ms=300000, escopo=usuario
- premium: max=40, janela_ms=300000, escopo=usuario
- informacoes_coletadas:
- identificador do chat (remoteJid)
- identificador do remetente (senderJid)
- texto do comando e argumentos
- contexto da mensagem (citacao e mencoes, quando existir)
- prompt textual enviado ao modelo de IA
- flags de resposta (ex.: audio/voz)
- midia anexada/citada para analise multimodal (quando houver)
- identidade do usuario para sessao e contexto de conversa
- dependencias_externas:
- OpenAI API
- efeitos_colaterais:
- envia resposta textual/áudio de IA
- respostas_padrao:
- sucesso: Comando executado com sucesso.
- erro_uso: Formato de uso inválido. Consulte metodos_de_uso.
- erro_permissao: Permissão insuficiente para executar este comando.
- observabilidade:
- evento_analytics: whatsapp_command_cat
- tags_log: whatsapp, command, aiModule, cat
- nivel_log: info
- privacidade:
- dados_sensiveis:
- identificador do chat
- identificador do remetente
- prompt textual enviado
- conteúdo de mídia anexada/citada (quando houver)
- retencao: conforme políticas de logs, banco de dados e arquivos temporários da aplicação
- base_legal: execução do serviço solicitado e legítimo interesse operacional

### catimg

- aliases: catimage
- enabled: true
- categoria: ia
- descricao: Gera/edita imagem com IA por prompt.
- permissao_necessaria: usuario comum
- limite_de_uso: imagem de entrada ate OPENAI_MAX_IMAGE_MB (padrao 50 MB)
- local_de_uso:
- privado
- grupo
- metodos_de_uso:
- <prefix>catimg seu prompt
- <prefix>catimg --size 1536x1024 seu prompt
- subcomandos:
- (nenhum)
- argumentos:
- prompt | tipo: string | opcional | validacao: texto livre para gerar/editar imagem | default: null
- size | tipo: string | opcional | validacao: auto|1024x1024|1024x1536|1536x1024 | default: "auto"
- quality | tipo: string | opcional | validacao: auto|low|medium|high | default: "auto"
- format | tipo: string | opcional | validacao: png|jpeg|webp | default: "png"
- pre_condicoes:
- requer_grupo: nao
- requer_admin: nao
- requer_admin_principal: nao
- requer_google_login: sim
- requer_nsfw: nao
- requer_midia: nao
- requer_mensagem_respondida: nao
- rate_limit:
- max: null
- janela_ms: null
- escopo: sem_rate_limit_explicito
- acesso:
- somente_premium: sim
- planos_permitidos: premium
- limite_uso_por_plano:
- comum: max=8, janela_ms=300000, escopo=usuario
- premium: max=40, janela_ms=300000, escopo=usuario
- informacoes_coletadas:
- identificador do chat (remoteJid)
- identificador do remetente (senderJid)
- texto do comando e argumentos
- contexto da mensagem (citacao e mencoes, quando existir)
- prompt de geracao/edicao de imagem
- opcoes de geracao (size, quality, format, background)
- imagem enviada/citada para edicao (quando houver)
- dependencias_externas:
- OpenAI API
- efeitos_colaterais:
- envia imagem gerada/editada por IA
- respostas_padrao:
- sucesso: Comando executado com sucesso.
- erro_uso: Formato de uso inválido. Consulte metodos_de_uso.
- erro_permissao: Permissão insuficiente para executar este comando.
- observabilidade:
- evento_analytics: whatsapp_command_catimg
- tags_log: whatsapp, command, aiModule, catimg
- nivel_log: info
- privacidade:
- dados_sensiveis:
- identificador do chat
- identificador do remetente
- prompt de imagem
- imagem anexada/citada (quando houver)
- retencao: conforme políticas de logs, banco de dados e arquivos temporários da aplicação
- base_legal: execução do serviço solicitado e legítimo interesse operacional

### catprompt

- aliases: iaprompt, promptia
- enabled: true
- categoria: ia
- descricao: Define ou reseta o prompt personalizado da IA para o usuario.
- permissao_necessaria: usuario comum
- limite_de_uso: 1 prompt por usuario (atualizavel)
- local_de_uso:
- privado
- grupo
- metodos_de_uso:
- <prefix>catprompt novo prompt
- <prefix>catprompt reset
- subcomandos:
- reset
- argumentos:
- conteudo | tipo: string | obrigatorio | validacao: texto do prompt ou reset | default: null
- pre_condicoes:
- requer_grupo: nao
- requer_admin: nao
- requer_admin_principal: nao
- requer_google_login: sim
- requer_nsfw: nao
- requer_midia: nao
- requer_mensagem_respondida: nao
- rate_limit:
- max: null
- janela_ms: null
- escopo: sem_rate_limit_explicito
- acesso:
- somente_premium: nao
- planos_permitidos: comum, premium
- limite_uso_por_plano:
- comum: max=8, janela_ms=300000, escopo=usuario
- premium: max=40, janela_ms=300000, escopo=usuario
- informacoes_coletadas:
- identificador do chat (remoteJid)
- identificador do remetente (senderJid)
- texto do comando e argumentos
- contexto da mensagem (citacao e mencoes, quando existir)
- prompt personalizado informado pelo usuario
- identidade do usuario para salvar/atualizar preferencia
- dependencias_externas:
- store interno de prompt de IA
- efeitos_colaterais:
- salva ou reseta prompt personalizado do usuário
- respostas_padrao:
- sucesso: Comando executado com sucesso.
- erro_uso: Formato de uso inválido. Consulte metodos_de_uso.
- erro_permissao: Permissão insuficiente para executar este comando.
- observabilidade:
- evento_analytics: whatsapp_command_catprompt
- tags_log: whatsapp, command, aiModule, catprompt
- nivel_log: info
- privacidade:
- dados_sensiveis:
- identificador do remetente
- prompt personalizado salvo pelo usuário
- retencao: conforme políticas de logs, banco de dados e arquivos temporários da aplicação
- base_legal: execução do serviço solicitado e legítimo interesse operacional
