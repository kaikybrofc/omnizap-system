# AiModule Agent Guide

Este arquivo e destinado a agentes de IA para gerar respostas no contexto dos comandos deste modulo.

## Fonte de Verdade
- arquivo_base: `app/modules/aiModule/commandConfig.json`
- schema_version: `2.0.0`
- module_enabled: `true`
- generated_at: `2026-03-08T10:59:41.156Z`

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
### ia
- aliases: cat
- enabled: true
- categoria: ia
- descricao: Perguntas para IA com suporte opcional a resposta em audio.
- permissao_necessaria: usuario comum
- limite_de_uso: texto sujeito a limites da API
- local_de_uso:
- privado
- grupo
- metodos_de_uso:
- <prefix>ia sua pergunta
- <prefix>ia --audio sua pergunta
- mensagens_uso (variantes):
- default:
- *<prefix>ia* [--audio] sua pergunta
- *<prefix>ia* (responda ou envie uma imagem com legenda)
- Opções:
- --audio | --texto
- --detail low | high | auto
- Exemplo:
- *<prefix>ia* Explique como funciona a fotossíntese.
- *<prefix>ia* --audio Resuma a imagem.
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
- mensagens_sistema:
- premium_only: ⭐ *Comando Premium*

Este comando é exclusivo para usuários premium.
Fale com o administrador para liberar o acesso.
- openai_nao_configurada: ⚠️ *OpenAI não configurada*

Defina a variável *OPENAI_API_KEY* no `.env` para usar o comando *cat*.
- imagem_muito_grande: ⚠️ A imagem enviada ultrapassa o limite de {{limite_mb}} MB. Envie uma imagem menor.
- imagem_download_falhou: ⚠️ Não consegui baixar a imagem. Tente reenviar.
- resposta_vazia: ⚠️ Não consegui gerar uma resposta agora. Tente novamente.
- audio_muito_longo: ⚠️ A resposta ficou longa demais para áudio. Enviando em texto.
- audio_falhou: ⚠️ Não consegui gerar o áudio agora. Enviando texto.
- erro_openai: ❌ *Erro ao falar com a IA*
Tente novamente em alguns instantes.
- limites_operacionais:
- (nao informado)
- opcoes:
- parse.audio_flags: --audio, --voz, --voice, --tts, -a
- parse.text_flags: --texto, --text, --txt
- parse.image_detail_aliases.low: low
- parse.image_detail_aliases.high: high
- parse.image_detail_aliases.auto: auto
- parse.image_detail_aliases.baixo: low
- parse.image_detail_aliases.baixa: low
- parse.image_detail_aliases.alto: high
- parse.image_detail_aliases.alta: high
- parse.image_detail_aliases.automatico: auto
- parse.image_detail_aliases.automático: auto
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

### iaimagem
- aliases: catimage, catimg
- enabled: true
- categoria: ia
- descricao: Gera/edita imagem com IA por prompt.
- permissao_necessaria: usuario comum
- limite_de_uso: imagem de entrada ate OPENAI_MAX_IMAGE_MB (padrao 50 MB)
- local_de_uso:
- privado
- grupo
- metodos_de_uso:
- <prefix>iaimagem seu prompt
- <prefix>iaimagem --size 1536x1024 seu prompt
- mensagens_uso (variantes):
- default:
- *<prefix>iaimagem* seu prompt
- *<prefix>iaimagem* (responda uma imagem com legenda para editar)
- Opções:
- --size 1024x1024 | 1024x1536 | 1536x1024 | auto
- --quality low | medium | high | auto
- --format png | jpeg | webp
- --background transparent | opaque | auto
- --compression 0-100
- Exemplo:
- *<prefix>iaimagem* --size 1536x1024 Um gato astronauta em aquarela.
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
- mensagens_sistema:
- premium_only: ⭐ *Comando Premium*

Este comando é exclusivo para usuários premium.
Fale com o administrador para liberar o acesso.
- openai_nao_configurada: ⚠️ *OpenAI não configurada*

Defina a variável *OPENAI_API_KEY* no `.env` para usar o comando *catimg*.
- imagem_muito_grande: ⚠️ A imagem enviada ultrapassa o limite de {{limite_mb}} MB. Envie uma imagem menor.
- imagem_download_falhou: ⚠️ Não consegui baixar a imagem. Tente reenviar.
- opcoes_invalidas: ⚠️ Opções inválidas no comando.
Detalhes: {{detalhes}}

Use *{{prefix}}catimg* sem opções para ver o formato correto.
- resposta_vazia: ⚠️ Não consegui gerar a imagem agora. Tente novamente.
- erro_openai: ❌ *Erro ao falar com a IA*
Tente novamente em alguns instantes.
- limites_operacionais:
- (nao informado)
- opcoes:
- geracao_imagem.size_options: auto, 1024x1024, 1024x1536, 1536x1024
- geracao_imagem.size_aliases.1024: 1024x1024
- geracao_imagem.size_aliases.square: 1024x1024
- geracao_imagem.size_aliases.quadrado: 1024x1024
- geracao_imagem.size_aliases.portrait: 1024x1536
- geracao_imagem.size_aliases.retrato: 1024x1536
- geracao_imagem.size_aliases.landscape: 1536x1024
- geracao_imagem.size_aliases.paisagem: 1536x1024
- geracao_imagem.size_aliases.auto: auto
- geracao_imagem.quality_options: auto, low, medium, high
- geracao_imagem.quality_aliases.baixa: low
- geracao_imagem.quality_aliases.baixo: low
- geracao_imagem.quality_aliases.media: medium
- geracao_imagem.quality_aliases.média: medium
- geracao_imagem.quality_aliases.medio: medium
- geracao_imagem.quality_aliases.médio: medium
- geracao_imagem.quality_aliases.alta: high
- geracao_imagem.quality_aliases.alto: high
- geracao_imagem.quality_aliases.auto: auto
- geracao_imagem.format_options: png, jpeg, webp
- geracao_imagem.format_aliases.jpg: jpeg
- geracao_imagem.format_aliases.jpeg: jpeg
- geracao_imagem.format_aliases.png: png
- geracao_imagem.format_aliases.webp: webp
- geracao_imagem.background_options: auto, transparent, opaque
- geracao_imagem.background_aliases.auto: auto
- geracao_imagem.background_aliases.transparent: transparent
- geracao_imagem.background_aliases.transparente: transparent
- geracao_imagem.background_aliases.opaque: opaque
- geracao_imagem.background_aliases.opaco: opaque
- geracao_imagem.background_aliases.opaca: opaque
- geracao_imagem.flag_aliases.size: --size, --tamanho
- geracao_imagem.flag_aliases.quality: --quality, --qualidade
- geracao_imagem.flag_aliases.format: --format, --formato
- geracao_imagem.flag_aliases.background: --background, --fundo
- geracao_imagem.flag_aliases.compression: --compression, --compressao, --compressão
- geracao_imagem.compression.min: 0
- geracao_imagem.compression.max: 100
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

### pergunteia
- aliases: iaprompt, promptia, catprompt
- enabled: true
- categoria: ia
- descricao: Define ou reseta o prompt personalizado da IA para o usuario.
- permissao_necessaria: usuario comum
- limite_de_uso: 1 prompt por usuario (atualizavel)
- local_de_uso:
- privado
- grupo
- metodos_de_uso:
- <prefix>pergunteia novo prompt
- <prefix>pergunteia reset
- mensagens_uso (variantes):
- default:
- *<prefix>pergunteia* seu novo prompt
- Para voltar ao padrão:
- *<prefix>pergunteia reset*
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
- mensagens_sistema:
- premium_only: ⭐ *Comando Premium*

Este comando é exclusivo para usuários premium.
Fale com o administrador para liberar o acesso.
- prompt_muito_longo: ⚠️ Prompt muito longo. Limite: {{max_chars}} caracteres.
- prompt_reset_sucesso: ✅ Prompt da IA restaurado para o padrão.
- prompt_update_sucesso: ✅ Prompt da IA atualizado para você.
- limites_operacionais:
- prompt_max_chars: 2000
- opcoes:
- (nao informado)
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
