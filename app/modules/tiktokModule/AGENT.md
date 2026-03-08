# TiktokModule Agent Guide

Este arquivo e destinado a agentes de IA para gerar respostas no contexto dos comandos deste modulo.

## Fonte de Verdade
- arquivo_base: `app/modules/tiktokModule/commandConfig.json`
- schema_version: `2.0.0`
- module_enabled: `true`
- generated_at: `2026-03-08T10:59:41.156Z`

## Escopo do Modulo
- module: `tiktokModule`
- source_files:
- tiktokCommand.js
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
### baixartiktok
- aliases: tt, tiktok
- enabled: true
- categoria: midia
- descricao: Baixa midia do TikTok sem marca d'agua.
- permissao_necessaria: usuario comum
- limite_de_uso: ate 5 URLs por comando e ate 80 MB por arquivo (padrao)
- local_de_uso:
- privado
- grupo
- metodos_de_uso:
- <prefix>baixartiktok <url>
- <prefix>tt <url1> <url2>
- mensagens_uso (variantes):
- default:
- 🎬 *Baixartiktok Downloader*
- Uso: *<prefix>baixartiktok <link1> [link2 ...]*
- Exemplo: *<prefix>baixartiktok https://www.baixartiktok.com/@usuario/video/123*
- subcomandos:
- (nenhum)
- argumentos:
- urls | tipo: array<string> | obrigatorio | validacao: 1 a 5 URLs do TikTok | default: []
- pre_condicoes:
- requer_grupo: nao
- requer_admin: nao
- requer_admin_principal: nao
- requer_google_login: sim
- requer_nsfw: nao
- requer_midia: nao
- requer_mensagem_respondida: nao
- rate_limit:
- max: 5
- janela_ms: null
- escopo: por_execucao
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
- URLs do TikTok extraidas do texto
- metadados do post (autor, descricao, estatisticas)
- tamanho dos arquivos para enforce de limite
- dependencias_externas:
- serviço extractor de TikTok
- efeitos_colaterais:
- baixa mídia temporária
- envia vídeo/imagens no chat
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
- evento_analytics: whatsapp_command_tiktok
- tags_log: whatsapp, command, tiktokModule, tiktok
- nivel_log: info
- privacidade:
- dados_sensiveis:
- identificador do chat
- identificador do remetente
- conteudo textual do comando
- retencao: conforme políticas de logs, banco de dados e arquivos temporários da aplicação
- base_legal: execução do serviço solicitado e legítimo interesse operacional
