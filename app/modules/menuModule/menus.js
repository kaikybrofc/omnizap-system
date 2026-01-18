const https = require('https');

const logger = require('../../utils/logger/loggerModule');

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

async function handleMenuCommand(sock, remoteJid, messageInfo, expirationMessage, senderName, commandPrefix) {
  const imageUrl = process.env.IMAGE_MENU;
  if (!imageUrl) {
    logger.error('IMAGE_MENU environment variable not set.');
    await sock.sendMessage(remoteJid, { text: 'Ocorreu um erro ao carregar o menu.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
    return;
  }

  const stickerCaption = `Olá ${senderName}! 👋

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

module.exports = {
  handleMenuCommand,
};
