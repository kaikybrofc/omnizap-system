# UserModule Agent Guide

Este arquivo e destinado a agentes de IA para gerar respostas no contexto dos comandos deste modulo.

## Fonte de Verdade

- arquivo_base: `app/modules/userModule/commandConfig.json`
- schema_version: `1.1.0`
- module_enabled: `true`
- generated_at: `2026-03-08T08:14:27.803Z`

## Escopo do Modulo

- module: `userModule`
- source_files:
- userCommand.js
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

### user

- aliases: usuario
- enabled: true
- categoria: usuario
- descricao: Consulta perfil e estatisticas de um usuario.
- permissao_necessaria: usuario comum
- limite_de_uso: consulta por um alvo por comando
- local_de_uso:
- privado
- grupo
- metodos_de_uso:
- <prefix>user perfil
- <prefix>user perfil <id|telefone>
- <prefix>usuario perfil @contato
- mensagens_uso (variantes):
- default:
- Formato de uso:
- <prefix>user perfil <id|telefone>
- Dica:
- • Você pode mencionar alguém.
- • Ou responder a mensagem do usuário desejado.
- subcomandos:
- perfil
- profile
- argumentos:
- subcomando | tipo: string | obrigatorio | validacao: perfil|profile | default: null
- alvo | tipo: string | opcional | validacao: id, telefone, menção ou reply | default: null
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
- comum: max=30, janela_ms=60000, escopo=usuario
- premium: max=120, janela_ms=60000, escopo=usuario
- informacoes_coletadas:
- identificador do chat (remoteJid)
- identificador do remetente (senderJid)
- texto do comando e argumentos
- contexto da mensagem (citacao e mencoes, quando existir)
- alvo do perfil (mencao, resposta, id ou telefone)
- mapeamento de identidade jid/lid para usuario canonico
- dados de perfil/atividade/premium/bloqueio no banco e stores
- dependencias_externas:
- banco de dados de mensagens/perfil
- stores internas de premium/blocklist
- efeitos_colaterais:
- consulta perfil/estatísticas no banco
- envia painel de usuário
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
- evento_analytics: whatsapp_command_user
- tags_log: whatsapp, command, userModule, user
- nivel_log: info
- privacidade:
- dados_sensiveis:
- identificador do remetente
- telefone/ID alvo informado ou mencionado
- métricas de atividade e perfil consultadas
- retencao: conforme políticas de logs, banco de dados e arquivos temporários da aplicação
- base_legal: execução do serviço solicitado e legítimo interesse operacional
