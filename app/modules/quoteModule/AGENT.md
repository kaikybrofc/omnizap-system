# QuoteModule Agent Guide

Este arquivo e destinado a agentes de IA para gerar respostas no contexto dos comandos deste modulo.

## Fonte de Verdade
- arquivo_base: `app/modules/quoteModule/commandConfig.json`
- schema_version: `2.0.0`
- module_enabled: `true`
- generated_at: `2026-03-08T10:59:41.156Z`

## Escopo do Modulo
- module: `quoteModule`
- source_files:
- quoteCommand.js
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
### citar
- aliases: qc, quote
- enabled: true
- categoria: midia
- descricao: Transforma texto em figurinha estilo quote.
- permissao_necessaria: usuario comum
- limite_de_uso: sujeito a timeouts internos de renderizacao
- local_de_uso:
- privado
- grupo
- metodos_de_uso:
- <prefix>citar seu texto
- <prefix>qc @usuario texto
- mensagens_uso (variantes):
- default:
- 🖼️ *Citar*
- Use assim:
- *<prefix>citar* sua mensagem
- Ou responda uma mensagem com:
- *<prefix>citar*
- subcomandos:
- (nenhum)
- argumentos:
- texto | tipo: string | opcional | validacao: texto livre ou conteúdo de mensagem citada | default: null
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
- comum: max=4, janela_ms=600000, escopo=usuario
- premium: max=15, janela_ms=600000, escopo=usuario
- informacoes_coletadas:
- identificador do chat (remoteJid)
- identificador do remetente (senderJid)
- texto do comando e argumentos
- contexto da mensagem (citacao e mencoes, quando existir)
- texto alvo da quote (digitado ou citado)
- mencoes para resolver autor/alvo da quote
- nome de exibicao e avatar para renderizacao
- dependencias_externas:
- canvas
- assets de emoji remotos
- efeitos_colaterais:
- renderiza imagem temporária
- envia figurinha quote
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
- evento_analytics: whatsapp_command_quote
- tags_log: whatsapp, command, quoteModule, quote
- nivel_log: info
- privacidade:
- dados_sensiveis:
- identificador do chat
- identificador do remetente
- conteudo textual do comando
- retencao: conforme políticas de logs, banco de dados e arquivos temporários da aplicação
- base_legal: execução do serviço solicitado e legítimo interesse operacional
