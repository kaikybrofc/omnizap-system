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

🛡️ *Administração*  
➡️ *${commandPrefix}menuadm*  

━━━━━━━━━━━━━━━  
📌 *Status do Bot*  
━━━━━━━━━━━━━━━  
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

export const buildAiMenu = (commandPrefix) => `
🤖 *IA*  

━━━━━━━━━━━━━━━  
➡️ *${commandPrefix}cat* <mensagem ou pergunta>  
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

export const MENU_ADM_TEXT = `
🛡️ *Menu de Administração*

*Membros*

➕ */add @user1 @user2...* - Adiciona participantes.
➖ */ban @user1 @user2...* - Remove participantes.
⬆️ */up @user1 @user2...* - Promove administradores.
⬇️ */down @user1 @user2...* - Remove administradores.

*Grupo*

📝 */setsubject <novo_assunto>* - Altera o nome do grupo.
ℹ️ */setdesc <nova_descrição>* - Altera a descrição do grupo.
🔧 */setgroup <announcement|not_announcement|locked|unlocked>* - Ajusta permissões do grupo.
🚪 */leave* - O bot sai do grupo.
🔗 */invite* - Exibe o código de convite.
♻️ */revoke* - Revoga o código de convite.

*Solicitações*

📥 */requests* - Lista solicitações de entrada.
✅ */updaterequests <approve|reject> @user1 @user2...* - Aprova ou rejeita solicitações.

*Gerais*

➕ */newgroup <título> <participante1> <participante2>...* - Cria um novo grupo.
➡️ */join <código_de_convite>* - Entra via convite.
🔍 */info [id_do_grupo]* - Mostra informações do grupo.
📬 */infofrominvite <código_de_convite>* - Mostra informações pelo convite.
📄 */metadata [id_do_grupo]* - Exibe metadados do grupo.
🌐 */groups* - Lista grupos do bot.

*Outros*

⏳ */temp <duração_em_segundos>* - Mensagens efêmeras.
🔒 */addmode <all_member_add|admin_add>* - Define quem pode adicionar membros.
👋 */welcome <on|off|set> [mensagem ou mídia]* - Boas-vindas.
👋 */farewell <on|off|set> [mensagem ou caminho da mídia]* - Mensagem de saída.
⭐ */premium <add|remove|list> @user1 @user2...* - Gerencia acesso premium da IA.
`;
