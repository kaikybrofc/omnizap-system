/**
 * Adiciona metadados ao sticker
 * @param {string} stickerPath - Caminho do arquivo de sticker
 * @param {string} packName - Nome do pacote
 * @param {string} packAuthor - Autor do pacote
 * @returns {Promise<string>} - Caminho do sticker com metadados
 */
const fs = require('fs').promises;
const path = require('path');
const util = require('util');
const { exec } = require('child_process');
const execProm = util.promisify(exec);
const logger = require('../../utils/logger/loggerModule');

const TEMP_DIR = path.join(process.cwd(), 'temp', 'stickers');

async function addStickerMetadata(stickerPath, packName, packAuthor) {
  logger.info(`[StickerCommand] Adicionando metadados ao sticker. Nome: "${packName}", Autor: "${packAuthor}"`);

  try {
    const exifData = {
      'sticker-pack-id': `com.omnizap.${Date.now()}`,
      'sticker-pack-name': packName,
      'sticker-pack-publisher': packAuthor,
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
      logger.warn('[StickerCommand] webpmux não encontrado, tentando instalar...');
      try {
        await execProm('apt-get update && apt-get install -y webp');
      } catch (installError) {
        logger.error(`[StickerCommand] Falha ao instalar webpmux: ${installError.message}`);
        throw new Error('webpmux não está instalado e não foi possível instalá-lo');
      }
    }

    const outputPath = path.join(TEMP_DIR, `final_${Date.now()}.webp`);
    await execProm(`webpmux -set exif "${exifPath}" "${stickerPath}" -o "${outputPath}"`);

    await fs.unlink(exifPath);

    logger.info(`[StickerCommand] Metadados adicionados com sucesso. Sticker final: ${outputPath}`);
    return outputPath;
  } catch (error) {
    logger.error(`[StickerCommand] Erro ao adicionar metadados: ${error.message}`, {
      label: 'StickerCommand.addStickerMetadata',
      error: error.stack,
    });

    return stickerPath;
  }
}

module.exports = { addStickerMetadata };
