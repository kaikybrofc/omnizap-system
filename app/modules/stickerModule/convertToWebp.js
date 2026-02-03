import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import logger from '../../utils/logger/loggerModule.js';

const TEMP_DIR = path.join(process.cwd(), 'temp', 'stickers');
const MB = 1024 * 1024;
const DEFAULT_MAX_OUTPUT_SIZE_BYTES_BY_TYPE = Object.freeze({
  image: 1 * MB,
  video: 2 * MB,
  sticker: 2 * MB,
});
const DEFAULT_VIDEO_MAX_DURATION_SECONDS = 8;
const DEFAULT_VIDEO_FPS = 10;
const DEFAULT_VIDEO_QUALITY = 55;
const DEFAULT_VIDEO_COMPRESSION_LEVEL = 6;
const DEFAULT_TIMEOUT_MS_BY_TYPE = Object.freeze({
  image: 15000,
  sticker: 8000,
  video: 30000,
});
const LOG_BUFFER_LIMIT = 16 * 1024;
const FFMPEG_WARNING_PATTERN = /\b(warn(?:ing)?|error|failed|invalid|deprecated)\b/i;

function clampNumber(value, min, max, fallback) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(max, Math.max(min, numericValue));
}

function resolveTimeoutMs(mediaType, timeoutMsByType, explicitTimeoutMs) {
  const directTimeout = Number(explicitTimeoutMs);
  if (Number.isFinite(directTimeout) && directTimeout > 0) {
    return Math.trunc(directTimeout);
  }

  const typedTimeout = Number(timeoutMsByType?.[mediaType]);
  if (Number.isFinite(typedTimeout) && typedTimeout > 0) {
    return Math.trunc(typedTimeout);
  }

  return DEFAULT_TIMEOUT_MS_BY_TYPE[mediaType] || 20000;
}

function resolveMaxOutputLimit(mediaType, explicitMaxOutputSizeBytes, maxOutputSizeBytesByType) {
  const directLimit = Number(explicitMaxOutputSizeBytes);
  if (Number.isFinite(directLimit) && directLimit > 0) {
    return Math.trunc(clampNumber(directLimit, 1, 20 * MB, DEFAULT_MAX_OUTPUT_SIZE_BYTES_BY_TYPE.image));
  }

  const typedLimit = Number(maxOutputSizeBytesByType?.[mediaType]);
  if (Number.isFinite(typedLimit) && typedLimit > 0) {
    return Math.trunc(clampNumber(typedLimit, 1, 20 * MB, DEFAULT_MAX_OUTPUT_SIZE_BYTES_BY_TYPE.image));
  }

  const fallbackLimit = DEFAULT_MAX_OUTPUT_SIZE_BYTES_BY_TYPE[mediaType] || DEFAULT_MAX_OUTPUT_SIZE_BYTES_BY_TYPE.image;
  return Math.trunc(clampNumber(fallbackLimit, 1, 20 * MB, DEFAULT_MAX_OUTPUT_SIZE_BYTES_BY_TYPE.image));
}

function appendBufferedLogs(current, chunk) {
  const next = `${current}${chunk}`;
  if (next.length <= LOG_BUFFER_LIMIT) return next;
  return next.slice(-LOG_BUFFER_LIMIT);
}

function safeKill(child, signal) {
  try {
    return child.kill(signal);
  } catch {
    return false;
  }
}

function getLogTail(text, maxLines = 3) {
  if (!text) return '';
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return '';
  return lines.slice(-maxLines).join('\n');
}

function shouldLogFfmpegStderr(stderrText) {
  const output = stderrText?.trim();
  if (!output) return false;
  if (process.env.DEBUG_FFMPEG === 'true') return true;
  return FFMPEG_WARNING_PATTERN.test(output);
}

function runProcess(command, args, { timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let didTimeout = false;

    const timeoutRef = setTimeout(() => {
      didTimeout = true;
      safeKill(child, 'SIGTERM');
      setTimeout(() => safeKill(child, 'SIGKILL'), 1500);
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout = appendBufferedLogs(stdout, chunk.toString());
    });

    child.stderr.on('data', (chunk) => {
      stderr = appendBufferedLogs(stderr, chunk.toString());
    });

    child.on('error', (error) => {
      clearTimeout(timeoutRef);
      reject(error);
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeoutRef);

      if (didTimeout) {
        const timeoutError = new Error(`Processo excedeu o timeout de ${timeoutMs}ms.`);
        timeoutError.code = 'ETIMEDOUT';
        timeoutError.signal = signal;
        timeoutError.stderr = stderr;
        reject(timeoutError);
        return;
      }

      if (code !== 0) {
        const processError = new Error(
          `${command} finalizou com código ${code}${signal ? ` (sinal: ${signal})` : ''}.`,
        );
        processError.code = code;
        processError.signal = signal;
        processError.stderr = stderr;
        processError.stdout = stdout;
        reject(processError);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

async function validateGeneratedFile(filePath, maxOutputLimit) {
  const outputStats = await fs.stat(filePath);
  if (!outputStats.isFile() || outputStats.size <= 0) {
    throw new Error('Arquivo WEBP inválido ou vazio após a conversão.');
  }

  if (outputStats.size > maxOutputLimit) {
    const outputSizeMb = (outputStats.size / (1024 * 1024)).toFixed(2);
    const maxSizeMb = (maxOutputLimit / (1024 * 1024)).toFixed(2);
    throw new Error(`Arquivo gerado excedeu o limite (${outputSizeMb} MB > ${maxSizeMb} MB).`);
  }
}

/**
 * Converte um arquivo de mídia para o formato webp, pronto para sticker.
 *
 * @param {string} inputPath - Caminho do arquivo de mídia de entrada.
 * @param {string} mediaType - Tipo da mídia (image, video, sticker).
 * @param {string} userId - ID do usuário.
 * @param {string} uniqueId - Identificador único para o sticker.
 * @param {object} [options] - Opcoes de conversao.
 * @param {boolean} [options.stretch=true] - Se true, estica para 512x512 sem preservar aspecto.
 * @param {number} [options.videoMaxDurationSeconds=8] - Limite de duração do vídeo em segundos.
 * @param {number} [options.videoFps=10] - FPS aplicado na conversão de vídeo.
 * @param {number} [options.videoQuality=55] - Qualidade de saída (0-100) para vídeo.
 * @param {number} [options.videoCompressionLevel=6] - Nível de compressão (0-6) para vídeo.
 * @param {number} [options.maxOutputSizeBytes] - Limite global de tamanho do arquivo gerado.
 * @param {Record<string, number>} [options.maxOutputSizeBytesByType] - Limite por tipo da mídia.
 * @param {Record<string, number>} [options.timeoutMsByType] - Timeouts por tipo de mídia.
 * @param {number} [options.timeoutMs] - Timeout explícito para a execução do ffmpeg.
 * @returns {Promise<string>} Caminho do arquivo webp gerado.
 * @throws {Error} Se a conversão falhar.
 */
export async function convertToWebp(inputPath, mediaType, userId, uniqueId, options = {}) {
  logger.info(`StickerCommand Convertendo mídia para webp. ID: ${uniqueId}, Tipo: ${mediaType}`);
  const sanitizedUserId = String(userId || 'anon').replace(/[^a-zA-Z0-9._-]/g, '_');
  const userStickerDir = path.join(TEMP_DIR, sanitizedUserId);
  const outputPath = path.join(userStickerDir, `sticker_${uniqueId}.webp`);
  const {
    stretch = true,
    videoMaxDurationSeconds = DEFAULT_VIDEO_MAX_DURATION_SECONDS,
    videoFps = DEFAULT_VIDEO_FPS,
    videoQuality = DEFAULT_VIDEO_QUALITY,
    videoCompressionLevel = DEFAULT_VIDEO_COMPRESSION_LEVEL,
    maxOutputSizeBytes,
    maxOutputSizeBytesByType = DEFAULT_MAX_OUTPUT_SIZE_BYTES_BY_TYPE,
    timeoutMsByType = DEFAULT_TIMEOUT_MS_BY_TYPE,
    timeoutMs,
  } = options;
  const maxOutputLimit = resolveMaxOutputLimit(mediaType, maxOutputSizeBytes, maxOutputSizeBytesByType);

  try {
    await fs.mkdir(userStickerDir, { recursive: true });
    const inputStats = await fs.stat(inputPath);
    if (!inputStats.isFile() || inputStats.size <= 0) {
      throw new Error('Arquivo de entrada inválido para conversão.');
    }

    const allowedTypes = ['image', 'video', 'sticker'];
    if (!allowedTypes.includes(mediaType)) {
      logger.error(`Tipo de mídia não suportado para conversão: ${mediaType}`);
      throw new Error(`Tipo de mídia não suportado: ${mediaType}`);
    }

    if (mediaType === 'sticker') {
      await fs.copyFile(inputPath, outputPath);
      await validateGeneratedFile(outputPath, maxOutputLimit);
      return outputPath;
    }

    const normalizedDuration = Math.trunc(
      clampNumber(videoMaxDurationSeconds, 1, 30, DEFAULT_VIDEO_MAX_DURATION_SECONDS),
    );
    const normalizedFps = Math.trunc(clampNumber(videoFps, 1, 30, DEFAULT_VIDEO_FPS));
    const normalizedQuality = Math.trunc(clampNumber(videoQuality, 0, 100, DEFAULT_VIDEO_QUALITY));
    const normalizedCompression = Math.trunc(clampNumber(videoCompressionLevel, 0, 6, DEFAULT_VIDEO_COMPRESSION_LEVEL));

    const stretchFilter = 'scale=512:512';
    const scaleFilter = 'scale=512:512:force_original_aspect_ratio=decrease';
    const padFilter = 'pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000';
    const imageFilter = stretch ? stretchFilter : `${scaleFilter},${padFilter}`;

    const filterChain = mediaType === 'video' ? `fps=${normalizedFps},${imageFilter}` : imageFilter;
    const ffmpegArgs = ['-y', '-i', inputPath];

    if (mediaType === 'video') {
      ffmpegArgs.push('-t', String(normalizedDuration));
    }

    ffmpegArgs.push('-vcodec', 'libwebp', '-loop', '0', '-preset', 'default', '-an');

    if (mediaType === 'video') {
      ffmpegArgs.push(
        '-vsync',
        '0',
        '-lossless',
        '0',
        '-q:v',
        String(normalizedQuality),
        '-compression_level',
        String(normalizedCompression),
      );
    } else {
      ffmpegArgs.push('-lossless', '1');
    }

    ffmpegArgs.push('-vf', filterChain, outputPath);

    const resolvedTimeoutMs = resolveTimeoutMs(mediaType, timeoutMsByType, timeoutMs);
    let ffmpegResult;
    try {
      ffmpegResult = await runProcess('ffmpeg', ffmpegArgs, { timeoutMs: resolvedTimeoutMs });
    } catch (ffmpegErr) {
      if (ffmpegErr.code === 'ETIMEDOUT') {
        logger.error('FFmpeg finalizado por timeout.');
        throw new Error('Conversão cancelada: tempo limite excedido (timeout).');
      }
      if (ffmpegErr.code === 'ENOENT') {
        logger.error('FFmpeg não encontrado no PATH do ambiente.');
        throw new Error('FFmpeg não está instalado ou não está disponível no PATH do servidor.');
      }

      logger.error(`Erro na execução do FFmpeg: ${ffmpegErr.message}`);
      if (ffmpegErr.stderr) {
        logger.error(`FFmpeg stderr: ${ffmpegErr.stderr}`);
      }
      throw new Error(`Falha ao converter mídia para sticker (FFmpeg): ${ffmpegErr.message}`);
    }

    if (ffmpegResult?.stderr && shouldLogFfmpegStderr(ffmpegResult.stderr)) {
      const stderrTail = getLogTail(ffmpegResult.stderr, 3);
      if (process.env.DEBUG_FFMPEG === 'true') {
        logger.debug(`FFmpeg stderr: ${stderrTail}`);
      } else {
        logger.warn(`FFmpeg stderr (resumo): ${stderrTail}`);
      }
    }

    await validateGeneratedFile(outputPath, maxOutputLimit);

    logger.info(`StickerCommand Conversão bem-sucedida para: ${outputPath}`);
    return outputPath;
  } catch (error) {
    logger.error(`StickerCommand.convertToWebp Erro na conversão: ${error.message}`, {
      error: error.stack,
    });
    throw new Error(`Erro na conversão para webp: ${error.message}`);
  }
}
