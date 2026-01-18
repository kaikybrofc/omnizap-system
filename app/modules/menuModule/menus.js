const https = require('https');

const logger = require('../../utils/logger/loggerModule');

const MENU_IMAGE_ENV = 'IMAGE_MENU';

const getImageBuffer = (url) => new Promise((resolve, reject) => {
  https
    .get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to get image, status code: ${response.statusCode}`));
        return;
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
    })
    .on('error', (err) => reject(err));
});

const buildMenuCaption = (senderName, commandPrefix) => `Olá ${senderName}! 👋

🌟 *Guia de Comandos do omnizap-system* 🌟

Quer transformar uma imagem ou GIF em figurinha? É bem simples:

1️⃣ *Responder uma mídia*  
Responda a uma imagem ou GIF com:  
➡️ ${commandPrefix}sticker ou ${commandPrefix}s

2️⃣ *Enviar com legenda*  
Envie a imagem ou GIF já com a legenda:  
➡️ ${commandPrefix}sticker ou ${commandPrefix}s

✨ Pronto! Sua figurinha será criada automaticamente.

🚧 *Fase Beta*  
O omnizap-system ainda está em fase de desenvolvimento, então novos comandos estão sendo implementados aos poucos.

🧑‍💻 *Projeto Open Source*  
Acompanhe o desenvolvimento, envie sugestões ou contribua com o projeto no GitHub:  
🔗 https://github.com/kaikybrofc/omnizap-system

❓ Em caso de dúvidas ou sugestões, fale com o dono no Instagram:  
👉 *@kaikybrofc*

Divirta-se! 😄
`;

const MENU_ADM_TEXT = `\n👑 *Menu de Administração de Grupos* 👑\n\n*Comandos para Gerenciamento de Membros:*\n\n👤 */add @user1 @user2...* - Adiciona um ou mais participantes ao grupo.\n👋 */ban @user1 @user2...* - Remove um ou mais participantes ao grupo.\n⬆️ */up @user1 @user2...* - Promove um ou mais participantes a administradores.\n⬇️ */down @user1 @user2...* - Remove o cargo de administrador de um ou mais participantes.\n\n*Comandos para Gerenciamento do Grupo:*\n\n📝 */setsubject <novo_assunto>* - Altera o nome do grupo.\nℹ️ */setdesc <nova_descrição>* - Altera a descrição do grupo.\n⚙️ */setgroup <announcement|not_announcement|locked|unlocked>* - Altera as configurações de envio de mensagens e edição de dados do grupo.\n🚪 */leave* - O bot sai do grupo.\n🔗 */invite* - Mostra o código de convite do grupo.\n🔄 */revoke* - Revoga o código de convite do grupo.\n\n*Comandos para Gerenciamento de Solicitações:*\n\n📋 */requests* - Lista as solicitações de entrada no grupo.\n✅ */updaterequests <approve|reject> @user1 @user2...* - Aprova ou rejeita solicitações de entrada.\n\n*Comandos Gerais:*\n\n➕ */newgroup <título> <participante1> <participante2>...* - Cria um novo grupo.\n➡️ */join <código_de_convite>* - Entra em um grupo usando um código de convite.\n🔍 */info [id_do_grupo]* - Mostra informações de um grupo. Se nenhum ID for fornecido, mostra as informações do grupo atual.\n📬 */infofrominvite <código_de_convite>* - Mostra informações de um grupo pelo código de convite.\n📄 */metadata [id_do_grupo]* - Obtém os metadados de um grupo. Se nenhum ID for fornecido, obtém os do grupo atual.\n🌐 */groups* - Lista todos os grupos em que o bot está.\n\n*Outros Comandos:*\n\n⏳ */temp <duração_em_segundos>* - Ativa ou desativa as mensagens efêmeras no grupo.\n🔒 */addmode <all_member_add|admin_add>* - Altera quem pode adicionar novos membros ao grupo.\n👋 */welcome <on|off|set> [mensagem ou mídia]* - Ativa/desativa ou define a mensagem/mídia de boas-vindas.\n    *   Use */welcome on* para ativar as mensagens de boas-vindas.\n    *   Use */welcome off* para desativar as mensagens de boas-vindas.\n    *   Use */welcome set <sua mensagem>* para definir uma mensagem de texto.\n    *   Para definir uma mídia (imagem/vídeo), envie a mídia com a legenda */welcome set* ou responda a uma mídia existente com */welcome set*.
👋 */farewell <on|off|set> [mensagem ou caminho da mídia]* - Ativa/desativa ou define a mensagem/mídia de saída.\n    `;

async function handleMenuCommand(sock, remoteJid, messageInfo, expirationMessage, senderName, commandPrefix) {
  const imageUrl = process.env[MENU_IMAGE_ENV];
  if (!imageUrl) {
    logger.error('IMAGE_MENU environment variable not set.');
    await sock.sendMessage(remoteJid, { text: 'Ocorreu um erro ao carregar o menu.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
    return;
  }

  const stickerCaption = buildMenuCaption(senderName, commandPrefix);

  try {
    const imageBuffer = await getImageBuffer(imageUrl);
    await sock.sendMessage(
      remoteJid,
      {
        image: imageBuffer,
        caption: stickerCaption,
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  } catch (error) {
    logger.error('Error fetching menu image:', error);
    await sock.sendMessage(remoteJid, { text: 'Ocorreu um erro ao carregar a imagem do menu.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
  }
}

async function handleMenuAdmCommand(sock, remoteJid, messageInfo, expirationMessage) {
  await sock.sendMessage(remoteJid, { text: MENU_ADM_TEXT.trim() }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
}

module.exports = {
  handleMenuCommand,
  handleMenuAdmCommand,
};
