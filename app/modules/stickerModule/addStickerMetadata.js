import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import logger from '../../utils/logger/loggerModule.js';
import { getJidUser } from '../../config/baileysConfig.js';

const execProm = promisify(exec);

const TEMP_DIR = path.join(process.cwd(), 'temp', 'stickers');

async function ensureDirectories(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

/**
 * Adiciona metadados ao sticker, realizando replaces especiais em packName e packAuthor.
 * @param {string} stickerPath Caminho do sticker
 * @param {string} packName Nome do pack (pode conter #nome, #data, #hora, #id)
 * @param {string} packAuthor Autor do pack (pode conter #nome, #data, #hora, #id)
 * @param {object} [replaceContext] Contexto para replaces: { senderName, userId }
 * @returns {Promise<string>} Caminho do sticker final
 */
export async function addStickerMetadata(stickerPath, packName, packAuthor, replaceContext = {}) {
  const { senderName = '', userId = '' } = replaceContext;
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, '0');
  const dataAtual = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
  const horaAtual = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  function doReplaces(str) {
    const sanitizedUserId = getJidUser(userId) || userId;
    return str.replace(/#nome/gi, senderName).replace(/#data/gi, dataAtual).replace(/#hora/gi, horaAtual).replace(/#id/gi, sanitizedUserId);
  }

  const finalPackName = doReplaces(packName);
  const finalPackAuthor = doReplaces(packAuthor);

  logger.info(`addStickerMetadata Adicionando metadados ao sticker. Nome: "${finalPackName}", Autor: "${finalPackAuthor}"`);

  try {
    await ensureDirectories(TEMP_DIR);

    const exifData = {
      'sticker-pack-id': `com.omnizap.${Date.now()}`,
      'sticker-pack-name': finalPackName,
      'sticker-pack-publisher': finalPackAuthor,
    };

    const exifPath = path.join(TEMP_DIR, `exif_${Date.now()}.exif`);
    const exifAttr = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);
    const jsonBuffer = Buffer.from(JSON.stringify(exifData), 'utf8');
    const exifBuffer = Buffer.concat([exifAttr, jsonBuffer]);
    exifBuffer.writeUIntLE(jsonBuffer.length, 14, 4);

    await fs.writeFile(exifPath, exifBuffer);

    try {
      await execProm('which webpmux');
    } catch (error) {
      logger.error('addStickerMetadata webpmux não encontrado. Instale o pacote "webp" manualmente.');
      throw new Error('webpmux não está instalado. Processo encerrado.');
    }

    const outputPath = path.join(TEMP_DIR, `final_${Date.now()}.webp`);
    await execProm(`webpmux -set exif "${exifPath}" "${stickerPath}" -o "${outputPath}"`);

    await fs.unlink(exifPath);

    logger.info(`addStickerMetadata Metadados adicionados com sucesso. Sticker final: ${outputPath}`);
    return outputPath;
  } catch (error) {
    logger.error(`addStickerMetadata Erro ao adicionar metadados: ${error.message}`, {
      label: 'addStickerMetadata',
      error: error.stack,
    });
    return stickerPath;
  }
}
