# AdminModule Agent Guide

Guia operacional para agentes de IA no contexto do modulo administrativo.

## Fonte de Verdade

- arquivo_base: `app/modules/adminModule/commandConfig.json`
- schema_version: `2.0.0`
- module: `adminModule`
- module_enabled: `true`
- generated_at: `2026-03-08T09:12:20.918Z`

## Escopo do Modulo

- source_files:
- groupCommandHandlers.js
- groupEventHandlers.js
- adminConfigRuntime.js
- total_commands: `32`
- total_enabled_commands: `32`

## Defaults V2

- inheritance_mode: deep_merge_with_command_overrides
- compatibility_mode: legacy_and_v2_fields
- default.requirements:
- require_group: sim
- require_group_admin: sim
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- default.command:
- category: admin
- version: 1.0.0
- stability: stable
- deprecated: nao
- risk_level: medium

## Configuracao AI Help

- enabled: true
- mode: hybrid_rag
- rag_sources:
- commandConfig.json
- AGENT.md
- faq.cache_file: data/cache/admin-ai-faq-cache.json
- faq.interval_ms: 21600000
- faq.auto_generate_on_start: true
- llm.enabled: true
- llm.model: gpt-5-nano
- llm.max_agent_context_chars: 12000
- llm.max_response_chars: 3400
- llm.timeout_ms: 25000

## Protocolo de Resposta para IA

- Passo 1: identificar comando pelo token apos o prefixo e resolver por `name` ou `aliases`.
- Passo 2: validar `enabled`, `contexts`, `requirements` e permissao necessaria.
- Passo 3: quando houver erro de uso, priorizar `docs.usage_variants`, depois `mensagens_uso`, depois `usage`/`metodos_de_uso`.
- Passo 4: nao inventar comandos, subcomandos ou argumentos fora do JSON.
- Passo 5: usar respostas conservadoras para permissoes e contexto (grupo/privado).
- Passo 6: considerar `privacy`, `observability` e `risk_level` em orientacoes sensiveis.

## Compatibilidade

- O schema v2 coexiste com campos legados v1.
- Campos legados criticos mantidos: `name`, `aliases`, `metodos_de_uso`, `argumentos`, `pre_condicoes`, `categoria`, `enabled`.
- Para runtime atual, tratar `name` como canonico e `aliases` como rotas retrocompativeis.

## Catalogo de Comandos

### adicionar

- id: admin.adicionar
- aliases: add
- enabled: true
- categoria: admin
- description: Adiciona participantes ao grupo atual.
- permission: admin do grupo
- contexts: grupo
- behavior.type: action_target
- behavior.allowed_actions: (nenhum)
- usage:
- <prefix>adicionar @participante
- requirements:
- require_group: sim
- require_group_admin: sim
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- participantes | tipo: array | obrigatorio | validacao: mencoes/JIDs validos | default: []
- observability.event_key: admin.adicionar
- observability.analytics_event: whatsapp_command_add
- risk_level: high
- stability: stable
- deprecated: nao
- premium_only: nao
- discovery.keywords: adicionar, admin, grupo

### antilink

- id: admin.antilink
- aliases: (nenhum)
- enabled: true
- categoria: admin
- description: Gerencia bloqueio de links permitidos no grupo.
- permission: admin do grupo
- contexts: grupo
- behavior.type: list_management
- behavior.allowed_actions: add, remove, list
- usage:
- <prefix>antilink on
- <prefix>antilink off
- <prefix>antilink list
- <prefix>antilink allow <rede>
- <prefix>antilink disallow <rede>
- <prefix>antilink add <dominio>
- <prefix>antilink remove <dominio>
- requirements:
- require_group: sim
- require_group_admin: sim
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- subcomando | tipo: string | obrigatorio | validacao: on|off|list|allow|disallow|add|remove | default: null
- alvos | tipo: array | opcional | validacao: redes ou dominios | default: []
- observability.event_key: admin.antilink
- observability.analytics_event: whatsapp_command_antilink
- risk_level: low
- stability: stable
- deprecated: nao
- premium_only: nao
- discovery.keywords: antilink, admin, grupo

### assunto

- id: admin.assunto
- aliases: setsubject
- enabled: true
- categoria: admin
- description: Altera assunto do grupo.
- permission: admin do grupo
- contexts: grupo
- behavior.type: argument_driven
- behavior.allowed_actions: (nenhum)
- usage:
- <prefix>assunto novo assunto
- requirements:
- require_group: sim
- require_group_admin: sim
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- assunto | tipo: string | obrigatorio | validacao: texto nao vazio | default: null
- observability.event_key: admin.assunto
- observability.analytics_event: whatsapp_command_setsubject
- risk_level: low
- stability: stable
- deprecated: nao
- premium_only: nao
- discovery.keywords: assunto, admin, grupo

### atualizarsolicitacoes

- id: admin.atualizarsolicitacoes
- aliases: updaterequests
- enabled: true
- categoria: admin
- description: Aprova ou rejeita solicitacoes de entrada no grupo.
- permission: admin do grupo
- contexts: grupo
- behavior.type: moderation_decision
- behavior.allowed_actions: approve, reject
- usage:
- <prefix>atualizarsolicitacoes approve @participante
- <prefix>atualizarsolicitacoes reject @participante
- requirements:
- require_group: sim
- require_group_admin: sim
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- acao | tipo: string | obrigatorio | validacao: approve|reject | default: null
- participantes | tipo: array | obrigatorio | validacao: mencoes/JIDs validos | default: []
- observability.event_key: admin.atualizarsolicitacoes
- observability.analytics_event: whatsapp_command_updaterequests
- risk_level: high
- stability: stable
- deprecated: nao
- premium_only: nao
- discovery.keywords: atualizarsolicitacoes, admin, grupo

### autofigurinha

- id: admin.autofigurinha
- aliases: autosticker
- enabled: true
- categoria: admin
- description: Ativa/desativa a geracao automatica de figurinhas no grupo.
- permission: admin do grupo
- contexts: grupo
- behavior.type: toggle
- behavior.allowed_actions: on, off, status
- usage:
- <prefix>autofigurinha on
- <prefix>autofigurinha off
- <prefix>autofigurinha status
- requirements:
- require_group: sim
- require_group_admin: sim
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- acao | tipo: string | obrigatorio | validacao: on|off|status | default: null
- observability.event_key: admin.autofigurinha
- observability.analytics_event: whatsapp_command_autosticker
- risk_level: medium
- stability: stable
- deprecated: nao
- premium_only: nao
- discovery.keywords: autofigurinha, admin, grupo

### autosolicitacoes

- id: admin.autosolicitacoes
- aliases: autorequests
- enabled: true
- categoria: admin
- description: Ativa/desativa auto aprovacao de solicitacoes no grupo.
- permission: admin do grupo
- contexts: grupo
- behavior.type: toggle
- behavior.allowed_actions: on, off, status
- usage:
- <prefix>autosolicitacoes on
- <prefix>autosolicitacoes off
- <prefix>autosolicitacoes status
- requirements:
- require_group: sim
- require_group_admin: sim
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- acao | tipo: string | obrigatorio | validacao: on|off|status | default: null
- observability.event_key: admin.autosolicitacoes
- observability.analytics_event: whatsapp_command_autorequests
- risk_level: medium
- stability: stable
- deprecated: nao
- premium_only: nao
- discovery.keywords: autosolicitacoes, admin, grupo

### banir

- id: admin.banir
- aliases: remover, ban
- enabled: true
- categoria: admin
- description: Remove participantes do grupo atual.
- permission: admin do grupo
- contexts: grupo
- behavior.type: action_target
- behavior.allowed_actions: (nenhum)
- usage:
- <prefix>banir @participante
- requirements:
- require_group: sim
- require_group_admin: sim
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- participantes | tipo: array | obrigatorio | validacao: mencoes/JIDs validos | default: []
- observability.event_key: admin.banir
- observability.analytics_event: whatsapp_command_ban
- risk_level: high
- stability: stable
- deprecated: nao
- premium_only: nao
- discovery.keywords: banir, admin, grupo

### boasvindas

- id: admin.boasvindas
- aliases: welcome
- enabled: true
- categoria: admin
- description: Configura mensagens/midia de boas-vindas no grupo.
- permission: admin do grupo
- contexts: grupo
- behavior.type: subcommand
- behavior.allowed_actions: on, off, set
- usage:
- <prefix>boasvindas on
- <prefix>boasvindas off
- <prefix>boasvindas set <mensagem_ou_midia>
- requirements:
- require_group: sim
- require_group_admin: sim
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- acao | tipo: string | obrigatorio | validacao: on|off|set | default: null
- mensagem_ou_midia | tipo: string | opcional | validacao: texto, caminho local ou midia anexada | default: null
- observability.event_key: admin.boasvindas
- observability.analytics_event: whatsapp_command_welcome
- risk_level: medium
- stability: stable
- deprecated: nao
- premium_only: nao
- discovery.keywords: boasvindas, admin, grupo

### captcha

- id: admin.captcha
- aliases: (nenhum)
- enabled: true
- categoria: admin
- description: Ativa/desativa captcha para novos membros no grupo.
- permission: admin do grupo
- contexts: grupo
- behavior.type: toggle
- behavior.allowed_actions: on, off, status
- usage:
- <prefix>captcha on
- <prefix>captcha off
- <prefix>captcha status
- requirements:
- require_group: sim
- require_group_admin: sim
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- acao | tipo: string | obrigatorio | validacao: on|off|status | default: null
- observability.event_key: admin.captcha
- observability.analytics_event: whatsapp_command_captcha
- risk_level: medium
- stability: stable
- deprecated: nao
- premium_only: nao
- discovery.keywords: captcha, admin, grupo

### configgrupo

- id: admin.configgrupo
- aliases: setgroup
- enabled: true
- categoria: admin
- description: Define estado do grupo (anuncio/aberto/locked/unlocked).
- permission: admin do grupo
- contexts: grupo
- behavior.type: subcommand
- behavior.allowed_actions: announcement, not_announcement, locked, unlocked
- usage:
- <prefix>configgrupo announcement
- <prefix>configgrupo not_announcement
- <prefix>configgrupo locked
- <prefix>configgrupo unlocked
- requirements:
- require_group: sim
- require_group_admin: sim
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- modo | tipo: string | obrigatorio | validacao: announcement|not_announcement|locked|unlocked | default: null
- observability.event_key: admin.configgrupo
- observability.analytics_event: whatsapp_command_setgroup
- risk_level: high
- stability: stable
- deprecated: nao
- premium_only: nao
- discovery.keywords: configgrupo, admin, grupo

### convite

- id: admin.convite
- aliases: invite
- enabled: true
- categoria: admin
- description: Mostra codigo de convite atual do grupo.
- permission: admin do grupo
- contexts: grupo
- behavior.type: single_action
- behavior.allowed_actions: (nenhum)
- usage:
- <prefix>convite
- requirements:
- require_group: sim
- require_group_admin: sim
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- (nenhum)
- observability.event_key: admin.convite
- observability.analytics_event: whatsapp_command_invite
- risk_level: low
- stability: stable
- deprecated: nao
- premium_only: nao
- discovery.keywords: convite, admin, grupo

### descricao

- id: admin.descricao
- aliases: setdesc
- enabled: true
- categoria: admin
- description: Altera descricao do grupo.
- permission: admin do grupo
- contexts: grupo
- behavior.type: argument_driven
- behavior.allowed_actions: (nenhum)
- usage:
- <prefix>descricao nova descricao
- requirements:
- require_group: sim
- require_group_admin: sim
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- descricao | tipo: string | obrigatorio | validacao: texto nao vazio | default: null
- observability.event_key: admin.descricao
- observability.analytics_event: whatsapp_command_setdesc
- risk_level: low
- stability: stable
- deprecated: nao
- premium_only: nao
- discovery.keywords: descricao, admin, grupo

### despedida

- id: admin.despedida
- aliases: farewell
- enabled: true
- categoria: admin
- description: Configura mensagens/midia de despedida no grupo.
- permission: admin do grupo
- contexts: grupo
- behavior.type: subcommand
- behavior.allowed_actions: on, off, set
- usage:
- <prefix>despedida on
- <prefix>despedida off
- <prefix>despedida set <mensagem_ou_midia>
- requirements:
- require_group: sim
- require_group_admin: sim
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- acao | tipo: string | obrigatorio | validacao: on|off|set | default: null
- mensagem_ou_midia | tipo: string | opcional | validacao: texto, caminho local ou midia anexada | default: null
- observability.event_key: admin.despedida
- observability.analytics_event: whatsapp_command_farewell
- risk_level: medium
- stability: stable
- deprecated: nao
- premium_only: nao
- discovery.keywords: despedida, admin, grupo

### entrar

- id: admin.entrar
- aliases: join
- enabled: true
- categoria: admin
- description: Faz o bot entrar em grupo por codigo de convite.
- permission: usuario comum
- contexts: privado, grupo
- behavior.type: argument_driven
- behavior.allowed_actions: (nenhum)
- usage:
- <prefix>entrar <codigo_de_convite>
- requirements:
- require_group: nao
- require_group_admin: nao
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- codigo_convite | tipo: string | obrigatorio | validacao: token de convite valido | default: null
- observability.event_key: admin.entrar
- observability.analytics_event: whatsapp_command_join
- risk_level: low
- stability: stable
- deprecated: nao
- premium_only: nao
- discovery.keywords: entrar, admin, privado, grupo

### infoconvite

- id: admin.infoconvite
- aliases: infofrominvite
- enabled: true
- categoria: admin
- description: Consulta dados de um grupo usando codigo de convite.
- permission: usuario comum
- contexts: privado, grupo
- behavior.type: argument_driven
- behavior.allowed_actions: (nenhum)
- usage:
- <prefix>infoconvite <codigo_de_convite>
- requirements:
- require_group: nao
- require_group_admin: nao
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- codigo_convite | tipo: string | obrigatorio | validacao: token de convite valido | default: null
- observability.event_key: admin.infoconvite
- observability.analytics_event: whatsapp_command_infofrominvite
- risk_level: low
- stability: stable
- deprecated: nao
- premium_only: nao
- discovery.keywords: infoconvite, admin, privado, grupo

### janelachat

- id: admin.janelachat
- aliases: chat, chatwindow
- enabled: true
- categoria: admin
- description: Abre/fecha janela temporaria de chat livre no modo sticker.
- permission: admin do grupo
- contexts: grupo
- behavior.type: toggle
- behavior.allowed_actions: on, off, status
- usage:
- <prefix>janelachat on
- <prefix>janelachat off
- <prefix>janelachat status
- <prefix>janelachat on 15
- requirements:
- require_group: sim
- require_group_admin: sim
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- acao | tipo: string | obrigatorio | validacao: on|off|status | default: null
- minutos | tipo: integer | opcional | validacao: inteiro positivo dentro dos limites do modulo | default: null
- observability.event_key: admin.janelachat
- observability.analytics_event: whatsapp_command_chatwindow
- risk_level: medium
- stability: stable
- deprecated: nao
- premium_only: nao
- discovery.keywords: janelachat, chat, admin, grupo

### limitefigurinha

- id: admin.limitefigurinha
- aliases: smsglimit, stickertextlimit, stextlimit, stickermsglimit
- enabled: true
- categoria: admin
- description: Define limite de mensagens por usuario no modo sticker.
- permission: admin do grupo
- contexts: grupo
- behavior.type: subcommand
- behavior.allowed_actions: set, status, reset
- usage:
- <prefix>limitefigurinha 5
- <prefix>limitefigurinha status
- <prefix>limitefigurinha reset
- requirements:
- require_group: sim
- require_group_admin: sim
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- valor | tipo: string | obrigatorio | validacao: minutos|status|reset | default: null
- observability.event_key: admin.limitefigurinha
- observability.analytics_event: whatsapp_command_stickermsglimit
- risk_level: medium
- stability: stable
- deprecated: nao
- premium_only: nao
- discovery.keywords: limitefigurinha, smsglimit, stickertextlimit, stextlimit, admin, grupo

### menuadmin

- id: admin.menuadmin
- aliases: adm, menuadm
- enabled: true
- categoria: admin
- description: Exibe menu administrativo do bot para o grupo.
- permission: admin do grupo
- contexts: grupo
- behavior.type: subcommand
- behavior.allowed_actions: ajuda, faq, perguntar
- usage:
- <prefix>menuadmin
- <prefix>menuadmin ajuda <comando>
- <prefix>menuadmin faq
- <prefix>menuadmin perguntar <pergunta>
- requirements:
- require_group: sim
- require_group_admin: sim
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- (nenhum)
- observability.event_key: admin.menuadmin
- observability.analytics_event: whatsapp_command_menuadm
- risk_level: medium
- stability: stable
- deprecated: nao
- premium_only: nao
- discovery.keywords: menuadmin, admin, grupo

### metadados

- id: admin.metadados
- aliases: metadata
- enabled: true
- categoria: admin
- description: Retorna metadados de um grupo informado ou do grupo atual.
- permission: admin do grupo alvo
- contexts: privado, grupo
- behavior.type: argument_driven
- behavior.allowed_actions: (nenhum)
- usage:
- <prefix>metadados
- <prefix>metadados <group_jid>
- requirements:
- require_group: nao
- require_group_admin: sim
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- group_id | tipo: string | opcional | validacao: JID de grupo valido | default: "grupo atual"
- observability.event_key: admin.metadados
- observability.analytics_event: whatsapp_command_metadata
- risk_level: low
- stability: stable
- deprecated: nao
- premium_only: nao
- discovery.keywords: metadados, admin, privado, grupo

### modoadicao

- id: admin.modoadicao
- aliases: addmode
- enabled: true
- categoria: admin
- description: Define quem pode adicionar participantes no grupo.
- permission: admin do grupo
- contexts: grupo
- behavior.type: argument_driven
- behavior.allowed_actions: (nenhum)
- usage:
- <prefix>modoadicao all_member_add
- <prefix>modoadicao admin_add
- requirements:
- require_group: sim
- require_group_admin: sim
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- modo | tipo: string | obrigatorio | validacao: all_member_add|admin_add | default: null
- observability.event_key: admin.modoadicao
- observability.analytics_event: whatsapp_command_addmode
- risk_level: low
- stability: stable
- deprecated: nao
- premium_only: nao
- discovery.keywords: modoadicao, admin, grupo

### modofigurinha

- id: admin.modofigurinha
- aliases: smode, stickermode
- enabled: true
- categoria: admin
- description: Controla modo foco em figurinhas no grupo.
- permission: admin do grupo
- contexts: grupo
- behavior.type: toggle
- behavior.allowed_actions: on, off, status
- usage:
- <prefix>modofigurinha on
- <prefix>modofigurinha off
- <prefix>modofigurinha status
- requirements:
- require_group: sim
- require_group_admin: sim
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- acao | tipo: string | obrigatorio | validacao: on|off|status | default: null
- observability.event_key: admin.modofigurinha
- observability.analytics_event: whatsapp_command_stickermode
- risk_level: medium
- stability: stable
- deprecated: nao
- premium_only: nao
- discovery.keywords: modofigurinha, smode, admin, grupo

### noticias

- id: admin.noticias
- aliases: news, noticia
- enabled: true
- categoria: admin
- description: Ativa/desativa envio automatico de noticias no grupo.
- permission: admin do grupo
- contexts: grupo
- behavior.type: toggle
- behavior.allowed_actions: on, off, status
- usage:
- <prefix>noticias on
- <prefix>noticias off
- <prefix>noticias status
- <prefix>news status
- requirements:
- require_group: sim
- require_group_admin: sim
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- acao | tipo: string | obrigatorio | validacao: on|off|status | default: null
- observability.event_key: admin.noticias
- observability.analytics_event: whatsapp_command_noticias
- risk_level: medium
- stability: stable
- deprecated: nao
- premium_only: nao
- discovery.keywords: noticias, news, admin, grupo

### novogrupo

- id: admin.novogrupo
- aliases: newgroup
- enabled: true
- categoria: admin
- description: Cria um novo grupo com participantes informados.
- permission: usuario comum
- contexts: privado, grupo
- behavior.type: argument_driven
- behavior.allowed_actions: (nenhum)
- usage:
- <prefix>novogrupo <titulo> <participante1> <participante2>
- requirements:
- require_group: nao
- require_group_admin: nao
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- titulo | tipo: string | obrigatorio | validacao: texto nao vazio | default: null
- participantes | tipo: array | obrigatorio | validacao: minimo 1 participante | default: []
- observability.event_key: admin.novogrupo
- observability.analytics_event: whatsapp_command_newgroup
- risk_level: low
- stability: stable
- deprecated: nao
- premium_only: nao
- discovery.keywords: novogrupo, admin, privado, grupo

### nsfw

- id: admin.nsfw
- aliases: (nenhum)
- enabled: true
- categoria: admin
- description: Ativa/desativa status de NSFW no grupo.
- permission: admin do grupo
- contexts: grupo
- behavior.type: toggle
- behavior.allowed_actions: on, off, status
- usage:
- <prefix>nsfw on
- <prefix>nsfw off
- <prefix>nsfw status
- requirements:
- require_group: sim
- require_group_admin: sim
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- acao | tipo: string | obrigatorio | validacao: on|off|status | default: null
- observability.event_key: admin.nsfw
- observability.analytics_event: whatsapp_command_nsfw
- risk_level: medium
- stability: stable
- deprecated: nao
- premium_only: sim
- discovery.keywords: nsfw, admin, grupo

### prefixo

- id: admin.prefixo
- aliases: prefix
- enabled: true
- categoria: admin
- description: Define prefixo personalizado de comandos para o grupo.
- permission: admin do grupo
- contexts: grupo
- behavior.type: subcommand
- behavior.allowed_actions: set, status, reset
- usage:
- <prefixo>prefixo <novo_prefixo>
- <prefixo>prefixo status
- <prefixo>prefixo reset
- requirements:
- require_group: sim
- require_group_admin: sim
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- valor | tipo: string | obrigatorio | validacao: novo prefixo|status|reset | default: null
- observability.event_key: admin.prefixo
- observability.analytics_event: whatsapp_command_prefix
- risk_level: medium
- stability: stable
- deprecated: nao
- premium_only: nao
- discovery.keywords: prefixo, admin, grupo

### premium

- id: admin.premium
- aliases: vip
- enabled: true
- categoria: admin
- description: Gerencia usuarios premium do sistema.
- permission: admin principal do bot
- contexts: privado, grupo
- behavior.type: list_management
- behavior.allowed_actions: add, remove, list
- usage:
- <prefix>premium list
- <prefix>premium add @usuario
- <prefix>premium remove @usuario
- requirements:
- require_group: nao
- require_group_admin: nao
- require_bot_owner: sim
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- acao | tipo: string | obrigatorio | validacao: add|remove|list | default: null
- usuarios | tipo: array | opcional | validacao: mencoes/JIDs para add/remove | default: []
- observability.event_key: admin.premium
- observability.analytics_event: whatsapp_command_premium
- risk_level: high
- stability: stable
- deprecated: nao
- premium_only: nao
- discovery.keywords: premium, admin, privado, grupo

### promover

- id: admin.promover
- aliases: up
- enabled: true
- categoria: admin
- description: Promove participantes a administradores do grupo.
- permission: admin do grupo
- contexts: grupo
- behavior.type: action_target
- behavior.allowed_actions: (nenhum)
- usage:
- <prefix>promover @participante
- requirements:
- require_group: sim
- require_group_admin: sim
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- participantes | tipo: array | obrigatorio | validacao: mencoes/JIDs validos | default: []
- observability.event_key: admin.promover
- observability.analytics_event: whatsapp_command_up
- risk_level: high
- stability: stable
- deprecated: nao
- premium_only: nao
- discovery.keywords: promover, admin, grupo

### rebaixar

- id: admin.rebaixar
- aliases: down
- enabled: true
- categoria: admin
- description: Rebaixa administradores para membros comuns.
- permission: admin do grupo
- contexts: grupo
- behavior.type: action_target
- behavior.allowed_actions: (nenhum)
- usage:
- <prefix>rebaixar @participante
- requirements:
- require_group: sim
- require_group_admin: sim
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- participantes | tipo: array | obrigatorio | validacao: mencoes/JIDs validos | default: []
- observability.event_key: admin.rebaixar
- observability.analytics_event: whatsapp_command_down
- risk_level: high
- stability: stable
- deprecated: nao
- premium_only: nao
- discovery.keywords: rebaixar, admin, grupo

### revogarconvite

- id: admin.revogarconvite
- aliases: revoke
- enabled: true
- categoria: admin
- description: Revoga o codigo de convite e gera novo codigo.
- permission: admin do grupo
- contexts: grupo
- behavior.type: single_action
- behavior.allowed_actions: (nenhum)
- usage:
- <prefix>revogarconvite
- requirements:
- require_group: sim
- require_group_admin: sim
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- (nenhum)
- observability.event_key: admin.revogarconvite
- observability.analytics_event: whatsapp_command_revoke
- risk_level: high
- stability: stable
- deprecated: nao
- premium_only: nao
- discovery.keywords: revogarconvite, admin, grupo

### sair

- id: admin.sair
- aliases: leave
- enabled: true
- categoria: admin
- description: Faz o bot sair do grupo.
- permission: admin do grupo
- contexts: grupo
- behavior.type: single_action
- behavior.allowed_actions: (nenhum)
- usage:
- <prefix>sair
- requirements:
- require_group: sim
- require_group_admin: sim
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- (nenhum)
- observability.event_key: admin.sair
- observability.analytics_event: whatsapp_command_leave
- risk_level: high
- stability: stable
- deprecated: nao
- premium_only: nao
- discovery.keywords: sair, admin, grupo

### solicitacoes

- id: admin.solicitacoes
- aliases: requests
- enabled: true
- categoria: admin
- description: Lista solicitacoes pendentes para entrar no grupo.
- permission: admin do grupo
- contexts: grupo
- behavior.type: single_action
- behavior.allowed_actions: (nenhum)
- usage:
- <prefix>solicitacoes
- requirements:
- require_group: sim
- require_group_admin: sim
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- (nenhum)
- observability.event_key: admin.solicitacoes
- observability.analytics_event: whatsapp_command_requests
- risk_level: low
- stability: stable
- deprecated: nao
- premium_only: nao
- discovery.keywords: solicitacoes, admin, grupo

### temporarias

- id: admin.temporarias
- aliases: temp
- enabled: true
- categoria: admin
- description: Define tempo de mensagens temporarias (ephemeral) no grupo.
- permission: admin do grupo
- contexts: grupo
- behavior.type: argument_driven
- behavior.allowed_actions: (nenhum)
- usage:
- <prefix>temporarias <duracao_em_segundos>
- requirements:
- require_group: sim
- require_group_admin: sim
- require_bot_owner: nao
- require_google_login: sim
- require_nsfw_enabled: nao
- require_media: nao
- require_reply_message: nao
- arguments:
- duracao_segundos | tipo: integer | obrigatorio | validacao: inteiro positivo | default: null
- observability.event_key: admin.temporarias
- observability.analytics_event: whatsapp_command_temp
- risk_level: low
- stability: stable
- deprecated: nao
- premium_only: nao
- discovery.keywords: temporarias, admin, grupo
