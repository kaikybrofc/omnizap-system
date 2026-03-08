# GameModule Agent Guide

Este arquivo e destinado a agentes de IA para gerar respostas no contexto dos comandos deste modulo.

## Fonte de Verdade
- arquivo_base: `app/modules/gameModule/commandConfig.json`
- schema_version: `2.0.0`
- module_enabled: `true`
- generated_at: `2026-03-08T10:59:41.156Z`

## Escopo do Modulo
- module: `gameModule`
- source_files:
- diceCommand.js
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
### dado
- aliases: dice
- enabled: true
- categoria: jogos
- descricao: Rola um dado com numero de lados opcional.
- permissao_necessaria: usuario comum
- limite_de_uso: lados entre 2 e 1000
- local_de_uso:
- privado
- grupo
- metodos_de_uso:
- <prefix>dado
- <prefix>dado 20
- <prefix>dice 100
- mensagens_uso (variantes):
- default:
- Formato de uso:
- <prefix>dado
- <prefix>dado <lados (2-1000)>
- <prefix>dice <lados (2-1000)>
- subcomandos:
- (nenhum)
- argumentos:
- lados | tipo: integer | opcional | validacao: 2 a 1000 | default: 6
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
- comum: max=20, janela_ms=300000, escopo=usuario
- premium: max=75, janela_ms=300000, escopo=usuario
- informacoes_coletadas:
- identificador do chat (remoteJid)
- identificador do remetente (senderJid)
- texto do comando e argumentos
- contexto da mensagem (citacao e mencoes, quando existir)
- numero de lados informado no argumento (quando houver)
- dependencias_externas:
- (nenhum)
- efeitos_colaterais:
- gera número aleatório
- envia resultado no chat
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
- evento_analytics: whatsapp_command_dado
- tags_log: whatsapp, command, gameModule, dado
- nivel_log: info
- privacidade:
- dados_sensiveis:
- identificador do chat
- identificador do remetente
- conteudo textual do comando
- retencao: conforme políticas de logs, banco de dados e arquivos temporários da aplicação
- base_legal: execução do serviço solicitado e legítimo interesse operacional
