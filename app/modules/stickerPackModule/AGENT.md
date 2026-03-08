# StickerPackModule Agent Guide

Este arquivo e destinado a agentes de IA para gerar respostas no contexto dos comandos deste modulo.

## Fonte de Verdade

- arquivo_base: `app/modules/stickerPackModule/commandConfig.json`
- schema_version: `1.1.0`
- module_enabled: `true`
- generated_at: `2026-03-08T00:30:28.504Z`

## Escopo do Modulo

- module: `stickerPackModule`
- source_files:
- stickerPackCommandHandlers.js
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

### pack

- aliases: packs
- enabled: true
- categoria: figurinhas
- descricao: Gerencia packs de figurinhas (criar, listar, adicionar, enviar).
- permissao_necessaria: usuario comum
- limite_de_uso: rate limit por janela e limite de itens por pack
- local_de_uso:
- privado
- grupo
- metodos_de_uso:
- <prefix>pack help
- <prefix>pack create meupack
- <prefix>pack list
- <prefix>pack add <pack>
- <prefix>pack send <pack>
- subcomandos:
- help
- create
- list
- info
- add
- setcover
- setdesc
- setpublisher
- send
- rename
- remove
- delete
- reorder
- argumentos:
- subcomando | tipo: string | obrigatorio | validacao: ação de gerenciamento de pack | default: null
- parametros | tipo: array<string> | opcional | validacao: dependente do subcomando | default: []
- pre_condicoes:
- requer_grupo: nao
- requer_admin: nao
- requer_admin_principal: nao
- requer_google_login: sim
- requer_nsfw: nao
- requer_midia: nao
- requer_mensagem_respondida: nao
- rate_limit:
- max: 20
- janela_ms: 60000
- escopo: usuario
- informacoes_coletadas:
- identificador do chat (remoteJid)
- identificador do remetente (senderJid)
- texto do comando e argumentos
- contexto da mensagem (citacao e mencoes, quando existir)
- subcomando e argumentos do pack
- figurinha da mensagem atual/citada (para add/setcover)
- estado de rate limit por usuario
- dados de packs do usuario no armazenamento interno
- dependencias_externas:
- banco de dados de packs
- armazenamento de assets de figurinha
- efeitos_colaterais:
- cria/atualiza packs no banco
- pode armazenar/remover assets de figurinha
- respostas_padrao:
- sucesso: Comando executado com sucesso.
- erro_uso: Formato de uso inválido. Consulte metodos_de_uso.
- erro_permissao: Permissão insuficiente para executar este comando.
- observabilidade:
- evento_analytics: whatsapp_command_pack
- tags_log: whatsapp, command, stickerPackModule, pack
- nivel_log: info
- privacidade:
- dados_sensiveis:
- identificador do remetente
- conteúdo de figurinhas adicionadas ao pack
- metadados de packs do usuário
- retencao: conforme políticas de logs, banco de dados e arquivos temporários da aplicação
- base_legal: execução do serviço solicitado e legítimo interesse operacional
