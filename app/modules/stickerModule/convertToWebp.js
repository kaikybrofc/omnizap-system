import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import logger from '../../utils/logger/loggerModule.js';

const execProm = promisify(exec);

const TEMP_DIR = path.join(process.cwd(), 'temp', 'stickers');

/**
 * Converte um arquivo de mídia para o formato webp, pronto para sticker.
 *
 * @param {string} inputPath - Caminho do arquivo de mídia de entrada.
 * @param {string} mediaType - Tipo da mídia (image, video, sticker).
 * @param {string} userId - ID do usuário.
 * @param {string} uniqueId - Identificador único para o sticker.
 * @returns {Promise<string>} Caminho do arquivo webp gerado.
 * @throws {Error} Se a conversão falhar.
 */
export async function convertToWebp(inputPath, mediaType, userId, uniqueId) {
  logger.info(`StickerCommand Convertendo mídia para webp. ID: ${uniqueId}, Tipo: ${mediaType}`);
  const sanitizedUserId = userId.replace(/[^a-zA-Z0-9.-]/g, '_');
  const userStickerDir = path.join(TEMP_DIR, sanitizedUserId);
  const outputPath = path.join(userStickerDir, `sticker_${uniqueId}.webp`);

  try {
    await fs.mkdir(userStickerDir, { recursive: true });

    const allowedTypes = ['image', 'video', 'sticker'];
    if (!allowedTypes.includes(mediaType)) {
      logger.error(`Tipo de mídia não suportado para conversão: ${mediaType}`);
      throw new Error(`Tipo de mídia não suportado: ${mediaType}`);
    }

    if (mediaType === 'sticker') {
      await fs.copyFile(inputPath, outputPath);
      return outputPath;
    }
    const filtro = mediaType === 'video' ? 'fps=10,scale=512:512' : 'scale=512:512';
    const ffmpegCommand = `ffmpeg -i "${inputPath}" -vcodec libwebp -lossless 1 -loop 0 -preset default -an -vf "${filtro}" "${outputPath}"`;
    let ffmpegResult;
    try {
      ffmpegResult = await execProm(ffmpegCommand, { timeout: 20000 });
    } catch (ffmpegErr) {
      if (ffmpegErr.killed || ffmpegErr.signal === 'SIGTERM' || ffmpegErr.code === 'ETIMEDOUT') {
        logger.error('FFmpeg finalizado por timeout.');
        throw new Error('Conversão cancelada: tempo limite excedido (timeout).');
      }
      logger.error(`Erro na execução do FFmpeg: ${ffmpegErr.message}`);
      if (ffmpegErr.stderr) {
        logger.error(`FFmpeg stderr: ${ffmpegErr.stderr}`);
      }
      throw new Error(`Falha ao converter mídia para sticker (FFmpeg): ${ffmpegErr.message}`);
    }
    if (ffmpegResult && ffmpegResult.stderr) {
      logger.debug(`FFmpeg stderr: ${ffmpegResult.stderr}`);
    }
    await fs.access(outputPath);
    logger.info(`StickerCommand Conversão bem-sucedida para: ${outputPath}`);
    return outputPath;
  } catch (error) {
    logger.error(`StickerCommand.convertToWebp Erro na conversão: ${error.message}`, {
      error: error.stack,
    });
    throw new Error(`Erro na conversão para webp: ${error.message}`);
  }
}
