import { getWaifuPicsUsageText } from '../waifuPicsModule/waifuPicsCommand.js';

export const buildMenuCaption = (senderName, commandPrefix) => `
Olá, ${senderName}. Seja bem-vindo(a)!

━━━━━━━━━━━━━━━━━━━━
📌 MENU PRINCIPAL
━━━━━━━━━━━━━━━━━━━━

Selecione uma categoria para visualizar os comandos disponíveis:

• Figurinhas  
→ ${commandPrefix}menu figurinhas

• Mídia  
→ ${commandPrefix}menu midia

• Quotes  
→ ${commandPrefix}menu quote

• Inteligência Artificial  
→ ${commandPrefix}menu ia

• Estatísticas  
→ ${commandPrefix}menu stats

• Anime  
→ ${commandPrefix}menu anime

• Administração  
→ ${commandPrefix}menuadm

━━━━━━━━━━━━━━━━━━━━
📊 STATUS DO SISTEMA
━━━━━━━━━━━━━━━━━━━━

→ ${commandPrefix}ping  
Sistema em evolução (beta)

━━━━━━━━━━━━━━━━━━━━
🌐 PROJETO OPEN SOURCE
━━━━━━━━━━━━━━━━━━━━

GitHub:  
https://github.com/kaikybrofc/omnizap-system  

Contato: @kaikybrofc
`;

export const buildStickerMenu = (commandPrefix) => `
━━━━━━━━━━━━━━━━━━━━
🖼️ FIGURINHAS
━━━━━━━━━━━━━━━━━━━━

Imagem ou GIF  
• Responda uma mídia com:  
→ ${commandPrefix}sticker | ${commandPrefix}s  

• Ou envie com legenda usando o mesmo comando.

━━━━━━━━━━━━━━━━━━━━
📝 TEXTO
━━━━━━━━━━━━━━━━━━━━

• Texto padrão (preto):  
→ ${commandPrefix}stickertext | ${commandPrefix}st  

• Texto alternativo (branco):  
→ ${commandPrefix}stickertextwhite | ${commandPrefix}stw  

Exemplo:  
→ ${commandPrefix}stw Bom dia, pessoal

━━━━━━━━━━━━━━━━━━━━
✨ TEXTO PISCANTE
━━━━━━━━━━━━━━━━━━━━

→ ${commandPrefix}stickertextblink | ${commandPrefix}stb  

Exemplo:  
→ ${commandPrefix}stb bom dia -verde

━━━━━━━━━━━━━━━━━━━━
🔁 CONVERSÃO
━━━━━━━━━━━━━━━━━━━━

• Responda uma figurinha com:  
→ ${commandPrefix}toimg  

Resultado:  
– Figurinha estática → imagem  
– Figurinha animada → vídeo

━━━━━━━━━━━━━━━━━━━━
📦 STICKER PACKS
━━━━━━━━━━━━━━━━━━━━

→ ${commandPrefix}pack create "Meu Pack"  
→ ${commandPrefix}pack add <pack>  
→ ${commandPrefix}pack list  
→ ${commandPrefix}pack send <pack>
`;

export const buildMediaMenu = (commandPrefix) => `
━━━━━━━━━━━━━━━━━━━━
🎵 MÍDIA
━━━━━━━━━━━━━━━━━━━━

→ ${commandPrefix}play <link ou termo> (áudio)  
→ ${commandPrefix}playvid <link ou termo> (vídeo)

Exemplo:  
→ ${commandPrefix}play Coldplay Yellow
`;

export const buildQuoteMenu = (commandPrefix) => `
━━━━━━━━━━━━━━━━━━━━
💬 QUOTES
━━━━━━━━━━━━━━━━━━━━

→ ${commandPrefix}quote  
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
Responda ou envie uma imagem com legenda.

→ ${commandPrefix}catimg <prompt>  
Geração ou edição de imagens por IA.

→ ${commandPrefix}catprompt <novo prompt>  
→ ${commandPrefix}catprompt reset
`;

export const buildStatsMenu = (commandPrefix) => `
━━━━━━━━━━━━━━━━━━━━
📊 ESTATÍSTICAS
━━━━━━━━━━━━━━━━━━━━

→ ${commandPrefix}ranking  
Ranking do grupo (top 5)

→ ${commandPrefix}rankingglobal  
Ranking geral do bot

→ ${commandPrefix}social  
Ranking de interações

→ ${commandPrefix}semmsg  
Membros inativos

→ ${commandPrefix}ping  
Status do sistema

→ ${commandPrefix}user perfil <id|telefone>  
Resumo rápido de um usuário
`;

export const buildStickerBlinkCaption = (commandPrefix) => `
━━━━━━━━━━━━━━━━━━━━
✨ FIGURINHAS — TEXTO PISCANTE
━━━━━━━━━━━━━━━━━━━━

→ ${commandPrefix}stickertextblink | ${commandPrefix}stb  

Para definir cor, use “-cor” ao final:  
Exemplo:  
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
→ ${commandPrefix}ban @user  
→ ${commandPrefix}up @user  
→ ${commandPrefix}down @user  

Grupo  
→ ${commandPrefix}setsubject <texto>  
→ ${commandPrefix}setdesc <texto>  
→ ${commandPrefix}setgroup <announcement|not_announcement|locked|unlocked>  
→ ${commandPrefix}invite  
→ ${commandPrefix}revoke  
→ ${commandPrefix}leave  

Solicitações  
→ ${commandPrefix}requests  
→ ${commandPrefix}updaterequests <approve|reject> @user  
→ ${commandPrefix}autorequests <on|off|status>  

Gerais  
→ ${commandPrefix}newgroup <título> <users>  
→ ${commandPrefix}join <convite>  
→ ${commandPrefix}info [grupo]  
→ ${commandPrefix}metadata [grupo]  
→ ${commandPrefix}groups  

Outros  
→ ${commandPrefix}temp <segundos>  
→ ${commandPrefix}addmode <all_member_add|admin_add>  
→ ${commandPrefix}welcome <on|off|set>  
→ ${commandPrefix}farewell <on|off|set>  
→ ${commandPrefix}premium <add|remove|list>  
→ ${commandPrefix}nsfw <on|off|status>  
→ ${commandPrefix}autosticker <on|off|status>  
→ ${commandPrefix}noticias <on|off|status>  
→ ${commandPrefix}prefix <novo|status|reset>  
→ ${commandPrefix}captcha <on|off|status>
`;
