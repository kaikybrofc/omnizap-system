const fs = require('fs').promises;
const path = require('path');
const util = require('util');
const { exec } = require('child_process');
const execProm = util.promisify(exec);
const logger = require('../../utils/logger/loggerModule');

const TEMP_DIR = path.join(process.cwd(), 'temp', 'stickers');

async function ensureDirectories(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

async function addStickerMetadata(stickerPath, packName, packAuthor) {
  logger.info(`addStickerMetadata Adicionando metadados ao sticker. Nome: "${packName}", Autor: "${packAuthor}"`);

  try {
    await ensureDirectories(TEMP_DIR);

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
      logger.warn('addStickerMetadata webpmux não encontrado, tentando instalar...');
      try {
        await execProm('apt-get update && apt install -y webp');
      } catch (installError) {
        logger.error(`addStickerMetadata Falha ao instalar webpmux: ${installError.message}`);
        throw new Error('webpmux não está instalado e não foi possível instalá-lo');
      }
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

module.exports = { addStickerMetadata };
