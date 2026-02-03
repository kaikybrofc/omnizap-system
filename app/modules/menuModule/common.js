export const buildMenuCaption = (senderName, commandPrefix) => `
Olá, ${senderName}! 👋  

🧭 *MENU PRINCIPAL*  

Escolha uma categoria para ver os comandos:

━━━━━━━━━━━━━━━  
🖼️ *Figurinhas*  
➡️ *${commandPrefix}menu figurinhas*  

🎵 *Mídia*  
➡️ *${commandPrefix}menu midia*  

🖼️ *Quotes*  
➡️ *${commandPrefix}menu quote*  

🤖 *IA*  
➡️ *${commandPrefix}menu ia*  

📊 *Estatísticas*  
➡️ *${commandPrefix}menu stats*  

🌸 *Waifu.it*  
➡️ *${commandPrefix}menu anime*  

🛡️ *Administração*  
➡️ *${commandPrefix}menuadm*  

━━━━━━━━━━━━━━━  
📌 *Status do Bot*  
━━━━━━━━━━━━━━━  
➡️ *${commandPrefix}ping*  
🚧 Em evolução *(beta)*  

━━━━━━━━━━━━━━━  
🌐 *Open Source*  
━━━━━━━━━━━━━━━  
🔗 GitHub:  
https://github.com/kaikybrofc/omnizap-system  

📩 Contato: *@kaikybrofc*
`;

export const buildStickerMenu = (commandPrefix) => `
🖼️ *Figurinhas*  

━━━━━━━━━━━━━━━  
🖼️ *Imagem / GIF*  
━━━━━━━━━━━━━━━  
▫️ Responda uma imagem ou GIF com:  
➡️ *${commandPrefix}sticker* ou *${commandPrefix}s*  

▫️ Ou envie a imagem/GIF com legenda:  
➡️ *${commandPrefix}sticker* ou *${commandPrefix}s*  

━━━━━━━━━━━━━━━  
📝 *Texto*  
━━━━━━━━━━━━━━━  
▫️ Texto em preto:  
➡️ *${commandPrefix}stickertext* ou *${commandPrefix}st*  

▫️ Texto em branco:  
➡️ *${commandPrefix}stickertextwhite* ou *${commandPrefix}stw*  

📌 *Exemplo:*  
➡️ *${commandPrefix}stw Bom dia povo lindo*  

━━━━━━━━━━━━━━━  
✨ *Texto Piscante*  
━━━━━━━━━━━━━━━  
➡️ *${commandPrefix}stickertextblink* ou *${commandPrefix}stb*  

📌 *Exemplo:*  
➡️ *${commandPrefix}stb bom dia -verde*  

━━━━━━━━━━━━━━━  
🔁 *Converter figurinha*  
━━━━━━━━━━━━━━━  
▫️ Responda uma figurinha com:  
➡️ *${commandPrefix}toimg*  

📌 *Resultado:*  
➡️ Figurinha estática vira imagem  
➡️ Figurinha animada vira vídeo  
`;

export const buildMediaMenu = (commandPrefix) => `
🎵 *Mídia*  

━━━━━━━━━━━━━━━  
➡️ *${commandPrefix}play* <link ou termo> *(áudio)*  
➡️ *${commandPrefix}playvid* <link ou termo> *(vídeo)*  

📌 *Exemplo:*  
➡️ *${commandPrefix}play Coldplay Yellow*  
`;

export const buildQuoteMenu = (commandPrefix) => `
🖼️ *Quotes*  

━━━━━━━━━━━━━━━  
➡️ *${commandPrefix}quote* *(responda uma mensagem ou envie um texto)*  
`;

export const buildAnimeMenu = (commandPrefix) => `
🌸 *Waifu.it*  

━━━━━━━━━━━━━━━  
➡️ *${commandPrefix}waifu* [nome|anime:Nome]  
➡️ *${commandPrefix}husbando* [nome|anime:Nome]  
➡️ *${commandPrefix}animefact*  
➡️ *${commandPrefix}animequote* [character:Nome|anime:Nome]  

━━━━━━━━━━━━━━━  
🖼️ *Waifu.pics*  
━━━━━━━━━━━━━━━  
➡️ *${commandPrefix}wp* <categoria> *(SFW)*  
➡️ *${commandPrefix}wpnsfw* <categoria> *(NSFW)*  
`;

export const buildAiMenu = (commandPrefix) => `
🤖 *IA*  

━━━━━━━━━━━━━━━  
➡️ *${commandPrefix}cat* <mensagem ou pergunta> [--audio]  
↪️ Responda ou envie uma imagem com legenda  
➡️ *${commandPrefix}catprompt* <novo prompt>  
↪️ *${commandPrefix}catprompt reset*  
`;

export const buildStatsMenu = (commandPrefix) => `
📊 *Estatísticas*  

━━━━━━━━━━━━━━━  
➡️ *${commandPrefix}ranking* *(top 5 do grupo)*  
➡️ *${commandPrefix}rankingglobal* *(top 5 do bot)*  
➡️ *${commandPrefix}social* *(ranking de interações)*  
➡️ *${commandPrefix}semmsg* *(membros sem mensagens)*  
➡️ *${commandPrefix}ping* *(status do sistema)*  
`;

export const buildStickerBlinkCaption = (commandPrefix) => `
━━━━━━━━━━━━━━━  
✨ *Figurinhas (Texto Piscante)*  
━━━━━━━━━━━━━━━  
▫️ Texto piscante (pisca-pisca):  
➡️ *${commandPrefix}stickertextblink* ou *${commandPrefix}stb*  

▫️ Cor no final com “-cor”:  
➡️ *${commandPrefix}stb bom dia -verde*  

🎨 *Cores:* -branco, -preto, -vermelho, -verde, -azul, -amarelo, -rosa, -roxo, -laranja  
`;

export const buildAdminMenu = (commandPrefix = '/') => `
🛡️ *Menu de Administração*

*Membros*

➕ *${commandPrefix}add @user1 @user2...* - Adiciona participantes.
➖ *${commandPrefix}ban @user1 @user2...* - Remove participantes.
⬆️ *${commandPrefix}up @user1 @user2...* - Promove administradores.
⬇️ *${commandPrefix}down @user1 @user2...* - Remove administradores.

*Grupo*

📝 *${commandPrefix}setsubject <novo_assunto>* - Altera o nome do grupo.
ℹ️ *${commandPrefix}setdesc <nova_descrição>* - Altera a descrição do grupo.
🔧 *${commandPrefix}setgroup <announcement|not_announcement|locked|unlocked>* - Ajusta permissões do grupo.
🚪 *${commandPrefix}leave* - O bot sai do grupo.
🔗 *${commandPrefix}invite* - Exibe o código de convite.
♻️ *${commandPrefix}revoke* - Revoga o código de convite.

*Solicitações*

📥 *${commandPrefix}requests* - Lista solicitações de entrada.
✅ *${commandPrefix}updaterequests <approve|reject> @user1 @user2...* - Aprova ou rejeita solicitações.

*Gerais*

➕ *${commandPrefix}newgroup <título> <participante1> <participante2>...* - Cria um novo grupo.
➡️ *${commandPrefix}join <código_de_convite>* - Entra via convite.
🔍 *${commandPrefix}info [id_do_grupo]* - Mostra informações do grupo.
📬 *${commandPrefix}infofrominvite <código_de_convite>* - Mostra informações pelo convite.
📄 *${commandPrefix}metadata [id_do_grupo]* - Exibe metadados do grupo.
🌐 *${commandPrefix}groups* - Lista grupos do bot.

*Outros*

⏳ *${commandPrefix}temp <duração_em_segundos>* - Mensagens efêmeras.
🔒 *${commandPrefix}addmode <all_member_add|admin_add>* - Define quem pode adicionar membros.
👋 *${commandPrefix}welcome <on|off|set> [mensagem ou mídia]* - Boas-vindas.
👋 *${commandPrefix}farewell <on|off|set> [mensagem ou caminho da mídia]* - Mensagem de saída.
⭐ *${commandPrefix}premium <add|remove|list> @user1 @user2...* - Gerencia acesso premium da IA.
🔞 *${commandPrefix}nsfw <on|off|status>* - Ativa/desativa NSFW no grupo.
🖼️ *${commandPrefix}autosticker <on|off|status>* - Converte mídia em figurinha automaticamente.
📰 *${commandPrefix}noticias <on|off|status>* - Ativa/desativa envio automático de notícias.
⚙️ *${commandPrefix}prefix <novo_prefixo|status|reset>* - Altera o prefixo do bot no grupo.
`;
