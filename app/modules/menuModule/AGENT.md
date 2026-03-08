# MenuModule Agent Guide

Este arquivo e destinado a agentes de IA para gerar respostas no contexto dos comandos deste modulo.

## Fonte de Verdade
- arquivo_base: `app/modules/menuModule/commandConfig.json`
- schema_version: `2.0.0`
- module_enabled: `true`
- generated_at: `2026-03-08T10:59:41.156Z`

## Escopo do Modulo
- module: `menuModule`
- source_files:
- menus.js
- total_commands: `1`
- total_enabled_commands: `1`

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
### menu
- aliases: (nenhum)
- enabled: true
- categoria: menu
- descricao: Exibe o menu principal ou um menu por categoria.
- permissao_necessaria: usuario comum
- limite_de_uso: sem limite especifico
- local_de_uso:
- privado
- grupo
- metodos_de_uso:
- <prefix>menu
- <prefix>menu anime
- <prefix>menu stats
- mensagens_uso (variantes):
- default:
- <prefix>menu
- <prefix>menu anime
- <prefix>menu stats
- subcomandos:
- figurinhas
- sticker
- stickers
- midia
- media
- quote
- quotes
- ia
- ai
- stats
- estatisticas
- anime
- argumentos:
- categoria | tipo: string | opcional | validacao: categoria suportada do menu | default: null
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
- comum: max=40, janela_ms=60000, escopo=usuario
- premium: max=160, janela_ms=60000, escopo=usuario
- informacoes_coletadas:
- identificador do chat (remoteJid)
- identificador do remetente (senderJid)
- texto do comando e argumentos
- contexto da mensagem (citacao e mencoes, quando existir)
- categoria solicitada no menu (quando informada)
- dependencias_externas:
- URL de imagem do menu (quando configurada)
- efeitos_colaterais:
- envia menu no chat
- respostas_padrao:
- sucesso: Comando executado com sucesso.
- erro_uso: Formato de uso inválido. Consulte metodos_de_uso.
- erro_permissao: Permissão insuficiente para executar este comando.
- mensagens_sistema:
- (nao informado)
- limites_operacionais:
- (nao informado)
- opcoes:
- (nao informado)
- observabilidade:
- evento_analytics: whatsapp_command_menu
- tags_log: whatsapp, command, menuModule, menu
- nivel_log: info
- privacidade:
- dados_sensiveis:
- identificador do chat
- identificador do remetente
- conteudo textual do comando
- retencao: conforme políticas de logs, banco de dados e arquivos temporários da aplicação
- base_legal: execução do serviço solicitado e legítimo interesse operacional
