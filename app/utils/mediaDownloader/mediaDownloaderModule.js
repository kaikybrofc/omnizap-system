const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const logger = require('../logger/loggerModule');
const fs = require('fs');
const path = require('path');

/**
 * Downloads media from a Baileys message.
 * @param {import('@whiskeysockets/baileys').WAProto.IMessage} message - The message object containing the media.
 * @param {string} type - The type of media (e.g., 'image', 'video', 'audio', 'document').
 * @param {string} outputPath - The directory where the media should be saved.
 * @returns {Promise<string|null>} The path to the downloaded file, or null if download fails.
 */
const downloadMediaMessage = async (message, type, outputPath) => {
  try {
    let buffer = Buffer.from([]);
    const stream = await downloadContentFromMessage(message, type);

    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }

    const fileId = message.key?.id || Date.now();
    const fileName = `${Date.now()}-${fileId}.${type === 'image' ? 'jpeg' : type === 'video' ? 'mp4' : type === 'audio' ? 'mp3' : 'bin'}`;
    const filePath = path.join(outputPath, fileName);

    fs.writeFileSync(filePath, buffer);
    logger.info(`Media downloaded successfully to ${filePath}`);
    return filePath;
  } catch (error) {
    logger.error(`Error downloading media: ${error.message}`, error);
    return null;
  }
};

module.exports = {
  downloadMediaMessage,
};
