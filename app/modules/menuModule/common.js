import { getWaifuPicsUsageText } from '../waifuPicsModule/waifuPicsCommand.js';

export const buildMenuCaption = (senderName, commandPrefix) => `
Olá, ${senderName}. Seja bem-vindo(a)!

━━━━━━━━━━━━━━━━━━━━
📌 MENU PRINCIPAL
━━━━━━━━━━━━━━━━━━━━

Selecione uma categoria para visualizar os comandos disponíveis:

• 🖼️ Figurinhas  
→ ${commandPrefix}menu figurinhas
💡 Exemplo: ${commandPrefix}menu figurinhas

• 🎵 Mídia  
→ ${commandPrefix}menu midia
💡 Exemplo: ${commandPrefix}menu midia

• 💬 Quotes  
→ ${commandPrefix}menu quote
💡 Exemplo: ${commandPrefix}menu quote

• 🤖 Inteligência Artificial  
→ ${commandPrefix}menu ia
💡 Exemplo: ${commandPrefix}menu ia

• 📊 Estatísticas  
→ ${commandPrefix}menu stats
💡 Exemplo: ${commandPrefix}menu stats

• 🌸 Anime  
→ ${commandPrefix}menu anime
💡 Exemplo: ${commandPrefix}menu anime

• 🛡️ Administração  
→ ${commandPrefix}menuadm
💡 Exemplo: ${commandPrefix}menuadm

━━━━━━━━━━━━━━━━━━━━
📊 STATUS DO SISTEMA
━━━━━━━━━━━━━━━━━━━━

→ ${commandPrefix}ping  
💡 Exemplo: ${commandPrefix}ping
Sistema em evolução (beta)

━━━━━━━━━━━━━━━━━━━━
🌐 PROJETO OPEN SOURCE
━━━━━━━━━━━━━━━━━━━━

GitHub:  
https://github.com/kaikybrofc/omnizap-system  

Contato: @kaikybrofc on instagram
`;

export const buildStickerMenu = (commandPrefix) => `
━━━━━━━━━━━━━━━━━━━━
🖼️ FIGURINHAS
━━━━━━━━━━━━━━━━━━━━

Imagem ou GIF  
• Responda uma mídia com:  
→ ${commandPrefix}sticker | ${commandPrefix}s  
💡 Exemplo: (na legenda da mídia) ${commandPrefix}s

• Ou envie com legenda usando o mesmo comando.

━━━━━━━━━━━━━━━━━━━━
📝 TEXTO
━━━━━━━━━━━━━━━━━━━━

• Texto padrão (preto):  
→ ${commandPrefix}stickertext | ${commandPrefix}st  
💡 Exemplo: ${commandPrefix}st Bom dia, equipe

• Texto alternativo (branco):  
→ ${commandPrefix}stickertextwhite | ${commandPrefix}stw  
💡 Exemplo: ${commandPrefix}stw Bora trabalhar

━━━━━━━━━━━━━━━━━━━━
✨ TEXTO PISCANTE
━━━━━━━━━━━━━━━━━━━━

→ ${commandPrefix}stickertextblink | ${commandPrefix}stb  
💡 Exemplo: ${commandPrefix}stb bom dia -verde

━━━━━━━━━━━━━━━━━━━━
🔁 CONVERSÃO
━━━━━━━━━━━━━━━━━━━━

• Responda uma figurinha com:  
→ ${commandPrefix}toimg  
💡 Exemplo: responda uma figurinha com ${commandPrefix}toimg

Resultado:  
– Figurinha estática → imagem  
– Figurinha animada → vídeo

━━━━━━━━━━━━━━━━━━━━
📦 STICKER PACKS
━━━━━━━━━━━━━━━━━━━━

→ ${commandPrefix}pack create "Meu Pack"  
💡 Exemplo: ${commandPrefix}pack create "Memes da Firma"

→ ${commandPrefix}pack add <pack>  
💡 Exemplo: ${commandPrefix}pack add "Memes da Firma"

→ ${commandPrefix}pack list  
💡 Exemplo: ${commandPrefix}pack list

→ ${commandPrefix}pack send <pack>
💡 Exemplo: ${commandPrefix}pack send "Memes da Firma"
`;

export const buildMediaMenu = (commandPrefix) => `
━━━━━━━━━━━━━━━━━━━━
🎵 MÍDIA
━━━━━━━━━━━━━━━━━━━━

→ ${commandPrefix}play <link ou termo> (áudio)  
💡 Exemplo: ${commandPrefix}play Coldplay Yellow

→ ${commandPrefix}playvid <link ou termo> (vídeo)  
💡 Exemplo: ${commandPrefix}playvid Imagine Dragons Believer
`;

export const buildQuoteMenu = (commandPrefix) => `
━━━━━━━━━━━━━━━━━━━━
💬 QUOTES
━━━━━━━━━━━━━━━━━━━━

→ ${commandPrefix}quote  
💡 Exemplo: responda uma mensagem com ${commandPrefix}quote
Responda uma mensagem ou envie um texto.
`;

export const buildAnimeMenu = (commandPrefix) => `
━━━━━━━━━━━━━━━━━━━━
🌸 ANIME
━━━━━━━━━━━━━━━━━━━━

${getWaifuPicsUsageText(commandPrefix)}
`;

export const buildAiMenu = (commandPrefix) => `
━━━━━━━━━━━━━━━━━━━━
🤖 INTELIGÊNCIA ARTIFICIAL
━━━━━━━━━━━━━━━━━━━━

→ ${commandPrefix}cat <mensagem ou pergunta> [--audio]  
💡 Exemplo: ${commandPrefix}cat Explique buraco negro em 1 minuto
Responda ou envie uma imagem com legenda.

→ ${commandPrefix}catimg <prompt>  
💡 Exemplo: ${commandPrefix}catimg um gato astronauta na lua
Geração ou edição de imagens por IA.

→ ${commandPrefix}catprompt <novo prompt>  
💡 Exemplo: ${commandPrefix}catprompt Responda em português e direto ao ponto

→ ${commandPrefix}catprompt reset
💡 Exemplo: ${commandPrefix}catprompt reset
`;

export const buildStatsMenu = (commandPrefix) => `
━━━━━━━━━━━━━━━━━━━━
📊 ESTATÍSTICAS
━━━━━━━━━━━━━━━━━━━━

→ ${commandPrefix}ranking  
💡 Exemplo: ${commandPrefix}ranking
Ranking do grupo (top 5)

→ ${commandPrefix}rankingglobal  
💡 Exemplo: ${commandPrefix}rankingglobal
Ranking geral do bot

→ ${commandPrefix}social  
💡 Exemplo: ${commandPrefix}social
Ranking de interações

→ ${commandPrefix}semmsg  
💡 Exemplo: ${commandPrefix}semmsg
Membros inativos

→ ${commandPrefix}ping  
💡 Exemplo: ${commandPrefix}ping
Status do sistema

→ ${commandPrefix}user perfil <id|telefone>  
💡 Exemplo: ${commandPrefix}user perfil 5511999999999
Resumo rápido de um usuário
`;

export const buildStickerBlinkCaption = (commandPrefix) => `
━━━━━━━━━━━━━━━━━━━━
✨ FIGURINHAS — TEXTO PISCANTE
━━━━━━━━━━━━━━━━━━━━

→ ${commandPrefix}stickertextblink | ${commandPrefix}stb  
💡 Exemplo: ${commandPrefix}stb foco total -azul

Para definir cor, use “-cor” ao final:  
💡 Exemplo:  
→ ${commandPrefix}stb bom dia -verde

Cores disponíveis:  
-branco, -preto, -vermelho, -verde, -azul, -amarelo, -rosa, -roxo, -laranja
`;

export const buildAdminMenu = (commandPrefix = '/') => `
━━━━━━━━━━━━━━━━━━━━
🛡️ ADMINISTRAÇÃO
━━━━━━━━━━━━━━━━━━━━

Membros  
→ ${commandPrefix}add @user  
💡 Exemplo: ${commandPrefix}add @joao

→ ${commandPrefix}ban @user  
💡 Exemplo: ${commandPrefix}ban @maria

→ ${commandPrefix}up @user  
💡 Exemplo: ${commandPrefix}up @carlos

→ ${commandPrefix}down @user  
💡 Exemplo: ${commandPrefix}down @carlos

Grupo  
→ ${commandPrefix}setsubject <texto>  
💡 Exemplo: ${commandPrefix}setsubject Avisos do Projeto

→ ${commandPrefix}setdesc <texto>  
💡 Exemplo: ${commandPrefix}setdesc Grupo oficial da equipe

→ ${commandPrefix}setgroup <announcement|not_announcement|locked|unlocked>  
💡 Exemplo: ${commandPrefix}setgroup announcement

→ ${commandPrefix}invite  
💡 Exemplo: ${commandPrefix}invite

→ ${commandPrefix}revoke  
💡 Exemplo: ${commandPrefix}revoke

→ ${commandPrefix}leave  
💡 Exemplo: ${commandPrefix}leave

Solicitações  
→ ${commandPrefix}requests  
💡 Exemplo: ${commandPrefix}requests

→ ${commandPrefix}updaterequests <approve|reject> @user  
💡 Exemplo: ${commandPrefix}updaterequests approve @joao

→ ${commandPrefix}autorequests <on|off|status>  
💡 Exemplo: ${commandPrefix}autorequests status

Gerais  
→ ${commandPrefix}newgroup <título> <users>  
💡 Exemplo: ${commandPrefix}newgroup "Time Produto" @ana @carlos

→ ${commandPrefix}join <convite>  
💡 Exemplo: ${commandPrefix}join https://chat.whatsapp.com/ABCDE12345

→ ${commandPrefix}info [grupo]  
💡 Exemplo: ${commandPrefix}info

→ ${commandPrefix}metadata [grupo]  
💡 Exemplo: ${commandPrefix}metadata

→ ${commandPrefix}groups  
💡 Exemplo: ${commandPrefix}groups

Outros  
→ ${commandPrefix}temp <segundos>  
💡 Exemplo: ${commandPrefix}temp 60

→ ${commandPrefix}addmode <all_member_add|admin_add>  
💡 Exemplo: ${commandPrefix}addmode admin_add

→ ${commandPrefix}welcome <on|off|set>  
💡 Exemplo: ${commandPrefix}welcome on

→ ${commandPrefix}farewell <on|off|set>  
💡 Exemplo: ${commandPrefix}farewell on

→ ${commandPrefix}premium <add|remove|list>  
💡 Exemplo: ${commandPrefix}premium list

→ ${commandPrefix}nsfw <on|off|status>  
💡 Exemplo: ${commandPrefix}nsfw status

→ ${commandPrefix}autosticker <on|off|status>  
💡 Exemplo: ${commandPrefix}autosticker on

→ ${commandPrefix}noticias <on|off|status>  
💡 Exemplo: ${commandPrefix}noticias on

→ ${commandPrefix}prefix <novo|status|reset>  
💡 Exemplo: ${commandPrefix}prefix !

→ ${commandPrefix}captcha <on|off|status>
💡 Exemplo: ${commandPrefix}captcha on
`;
