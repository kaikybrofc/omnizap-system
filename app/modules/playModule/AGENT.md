# PlayModule Agent Guide

Este arquivo e destinado a agentes de IA para gerar respostas no contexto dos comandos deste modulo.

## Fonte de Verdade

- arquivo_base: `app/modules/playModule/commandConfig.json`
- schema_version: `2.0.0`
- module_enabled: `true`
- generated_at: `2026-03-08T10:59:41.156Z`

## Escopo do Modulo

- module: `playModule`
- source_files:
- playCommand.js
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

### tocar

- aliases: musica, play
- enabled: true
- categoria: midia
- descricao: Baixa/gera audio a partir de link ou busca no YouTube.
- permissao_necessaria: usuario comum
- limite_de_uso: arquivo ate PLAY_MAX_MB (padrao 100 MB)
- local_de_uso:
- privado
- grupo
- metodos_de_uso:
- <prefix>tocar <link>
- <prefix>tocar <termo de busca>
- mensagens_uso (variantes):
- default:
- 🎵 Uso: <prefix>tocar <link do YouTube ou termo de busca>
- subcomandos:
- (nenhum)
- argumentos:
- consulta | tipo: string | obrigatorio | validacao: URL YouTube ou termo de busca | default: null
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
- link ou termo de busca enviado no comando
- metadados de fila/download retornados pelo servico de midia
- informacoes de tamanho do arquivo para validacao de limite
- dependencias_externas:
- serviço YTDLS/Downloader
- ffmpeg
- ffprobe
- efeitos_colaterais:
- baixa mídia temporária
- envia áudio no chat
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
- evento_analytics: whatsapp_command_play
- tags_log: whatsapp, command, playModule, play
- nivel_log: info
- privacidade:
- dados_sensiveis:
- identificador do chat
- identificador do remetente
- conteudo textual do comando
- retencao: conforme políticas de logs, banco de dados e arquivos temporários da aplicação
- base_legal: execução do serviço solicitado e legítimo interesse operacional

### tocarvideo

- aliases: playvid
- enabled: true
- categoria: midia
- descricao: Baixa video a partir de link ou busca no YouTube.
- permissao_necessaria: usuario comum
- limite_de_uso: arquivo ate PLAY_MAX_MB (padrao 100 MB)
- local_de_uso:
- privado
- grupo
- metodos_de_uso:
- <prefix>tocarvideo <link>
- <prefix>tocarvideo <termo de busca>
- mensagens_uso (variantes):
- default:
- 🎬 Uso: <prefix>tocarvideo <link do YouTube ou termo de busca>
- subcomandos:
- (nenhum)
- argumentos:
- consulta | tipo: string | obrigatorio | validacao: URL YouTube ou termo de busca | default: null
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
- comum: max=4, janela_ms=600000, escopo=usuario
- premium: max=15, janela_ms=600000, escopo=usuario
- informacoes_coletadas:
- identificador do chat (remoteJid)
- identificador do remetente (senderJid)
- texto do comando e argumentos
- contexto da mensagem (citacao e mencoes, quando existir)
- link ou termo de busca enviado no comando
- metadados de fila/download retornados pelo servico de midia
- informacoes de tamanho e formato de video para validacao
- dependencias_externas:
- serviço YTDLS/Downloader
- ffmpeg
- ffprobe
- efeitos_colaterais:
- baixa mídia temporária
- envia vídeo no chat
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
- evento_analytics: whatsapp_command_playvid
- tags_log: whatsapp, command, playModule, playvid
- nivel_log: info
- privacidade:
- dados_sensiveis:
- identificador do chat
- identificador do remetente
- conteudo textual do comando
- retencao: conforme políticas de logs, banco de dados e arquivos temporários da aplicação
- base_legal: execução do serviço solicitado e legítimo interesse operacional
