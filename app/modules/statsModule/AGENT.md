# StatsModule Agent Guide

Este arquivo e destinado a agentes de IA para gerar respostas no contexto dos comandos deste modulo.

## Fonte de Verdade

- arquivo_base: `app/modules/statsModule/commandConfig.json`
- schema_version: `2.0.0`
- module_enabled: `true`
- generated_at: `2026-03-08T10:59:41.156Z`

## Escopo do Modulo

- module: `statsModule`
- source_files:
- rankingCommand.js
- globalRankingCommand.js
- total_commands: `2`
- total_enabled_commands: `2`

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

### classificacao

- aliases: rank, top5, ranking
- enabled: true
- categoria: estatisticas
- descricao: Mostra top 5 mais ativos do grupo.
- permissao_necessaria: usuario comum
- limite_de_uso: retorna top 5
- local_de_uso:
- grupo
- metodos_de_uso:
- <prefix>classificacao
- <prefix>rank
- <prefix>top5
- mensagens_uso (variantes):
- default:
- <prefix>classificacao
- <prefix>rank
- <prefix>top5
- subcomandos:
- (nenhum)
- argumentos:
- (nenhum)
- pre_condicoes:
- requer_grupo: sim
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
- comum: max=25, janela_ms=60000, escopo=usuario
- premium: max=120, janela_ms=60000, escopo=usuario
- informacoes_coletadas:
- identificador do chat (remoteJid)
- identificador do remetente (senderJid)
- texto do comando e argumentos
- contexto da mensagem (citacao e mencoes, quando existir)
- escopo do grupo (group id)
- estatisticas de mensagens agregadas no banco
- nomes de exibicao para composicao do ranking
- dependencias_externas:
- banco de dados de mensagens
- efeitos_colaterais:
- consulta agregações no banco
- envia ranking
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
- evento_analytics: whatsapp_command_ranking
- tags_log: whatsapp, command, statsModule, ranking
- nivel_log: info
- privacidade:
- dados_sensiveis:
- identificador do chat
- identificador do remetente
- conteudo textual do comando
- retencao: conforme políticas de logs, banco de dados e arquivos temporários da aplicação
- base_legal: execução do serviço solicitado e legítimo interesse operacional

### classificacaoglobal

- aliases: rankglobal, globalrank, globalranking, rankingglobal
- enabled: true
- categoria: estatisticas
- descricao: Mostra top 5 global de atividade.
- permissao_necessaria: usuario comum
- limite_de_uso: retorna top 5
- local_de_uso:
- privado
- grupo
- metodos_de_uso:
- <prefix>classificacaoglobal
- <prefix>globalrank
- mensagens_uso (variantes):
- default:
- <prefix>classificacaoglobal
- <prefix>globalrank
- subcomandos:
- (nenhum)
- argumentos:
- (nenhum)
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
- comum: max=25, janela_ms=60000, escopo=usuario
- premium: max=120, janela_ms=60000, escopo=usuario
- informacoes_coletadas:
- identificador do chat (remoteJid)
- identificador do remetente (senderJid)
- texto do comando e argumentos
- contexto da mensagem (citacao e mencoes, quando existir)
- estatisticas globais de mensagens agregadas no banco
- nomes de exibicao para composicao do ranking
- dependencias_externas:
- banco de dados de mensagens
- efeitos_colaterais:
- consulta agregações no banco
- envia ranking
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
- evento_analytics: whatsapp_command_rankingglobal
- tags_log: whatsapp, command, statsModule, rankingglobal
- nivel_log: info
- privacidade:
- dados_sensiveis:
- identificador do chat
- identificador do remetente
- conteudo textual do comando
- retencao: conforme políticas de logs, banco de dados e arquivos temporários da aplicação
- base_legal: execução do serviço solicitado e legítimo interesse operacional
