/**
 * Módulo responsável por adicionar metadados EXIF a stickers WebP.
 *
 * @module addStickerMetadata
 */

/**
 * Módulo de manipulação de arquivos com Promises.
 * @const
 */
const fs = require('fs').promises;

/**
 * Módulo para manipulação de caminhos de arquivos.
 * @const
 */
const path = require('path');

/**
 * Módulo utilitário do Node.js.
 * @const
 */
const util = require('util');

/**
 * Executa comandos no shell.
 * @const
 */
const { exec } = require('child_process');

/**
 * Versão promisificada do exec.
 * @const
 */
const execProm = util.promisify(exec);

/**
 * Módulo de logger customizado.
 * @const
 */
const logger = require('../../utils/logger/loggerModule');

/**
 * Diretório temporário para stickers processados.
 * @const {string}
 */
const TEMP_DIR = path.join(process.cwd(), 'temp', 'stickers');

/**
 * Adiciona metadados EXIF a um sticker WebP.
 *
 * @async
 * @function addStickerMetadata
 * @param {string} stickerPath - Caminho do arquivo de sticker WebP original.
 * @param {string} packName - Nome do pacote de stickers.
 * @param {string} packAuthor - Nome do autor do pacote.
 * @returns {Promise<string>} Caminho do novo sticker WebP com metadados, ou o original em caso de erro.
 */
async function addStickerMetadata(stickerPath, packName, packAuthor) {
  logger.info(`[StickerCommand] Adicionando metadados ao sticker. Nome: "${packName}", Autor: "${packAuthor}"`);

  try {
    /**
     * Estrutura dos metadados EXIF para o sticker.
     * @type {Object}
     */
    const exifData = {
      'sticker-pack-id': `com.omnizap.${Date.now()}`,
      'sticker-pack-name': packName,
      'sticker-pack-publisher': packAuthor,
    };

    /**
     * Caminho do arquivo EXIF temporário.
     * @type {string}
     */
    const exifPath = path.join(TEMP_DIR, `exif_${Date.now()}.exif`);

    /**
     * Buffer de atributos EXIF padrão para WebP.
     * @type {Buffer}
     */
    const exifAttr = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);
    /**
     * Buffer do JSON dos metadados.
     * @type {Buffer}
     */
    const jsonBuffer = Buffer.from(JSON.stringify(exifData), 'utf8');
    /**
     * Buffer final EXIF.
     * @type {Buffer}
     */
    const exifBuffer = Buffer.concat([exifAttr, jsonBuffer]);
    exifBuffer.writeUIntLE(jsonBuffer.length, 14, 4);

    await fs.writeFile(exifPath, exifBuffer);

    // Verifica se o webpmux está instalado
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

    /**
     * Caminho do sticker final com metadados.
     * @type {string}
     */
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

/**
 * Exporta a função principal do módulo.
 * @type {{ addStickerMetadata: function(string, string, string): Promise<string> }}
 */
module.exports = { addStickerMetadata };
