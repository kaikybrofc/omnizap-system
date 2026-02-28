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

/**
 * Mapa de timeout por tipo de mídia.
 * @typedef {Object} TimeoutByTypeMap
 * @property {number} [image]
 * @property {number} [video]
 * @property {number} [sticker]
 */

/**
 * Mapa de tamanho máximo (em bytes) por tipo de mídia.
 * @typedef {Object} MaxOutputSizeByTypeMap
 * @property {number} [image]
 * @property {number} [video]
 * @property {number} [sticker]
 */

/**
 * Opções de conversão para geração de sticker em WEBP.
 * @typedef {Object} ConvertToWebpOptions
 * @property {boolean} [stretch=true] - Se `true`, força `512x512` sem preservar proporção.
 * @property {number} [videoMaxDurationSeconds=8] - Duração máxima aplicada ao vídeo (`-t`).
 * @property {number} [videoFps=10] - FPS do vídeo durante a conversão.
 * @property {number} [videoQuality=55] - Qualidade do vídeo em modo lossy (`-q:v`).
 * @property {number} [videoCompressionLevel=6] - Compressão do vídeo (`-compression_level`).
 * @property {number} [maxOutputSizeBytes] - Limite global de tamanho de saída em bytes.
 * @property {MaxOutputSizeByTypeMap} [maxOutputSizeBytesByType] - Limite de saída por tipo.
 * @property {TimeoutByTypeMap} [timeoutMsByType] - Timeout por tipo de mídia em milissegundos.
 * @property {number} [timeoutMs] - Timeout explícito para a execução do `ffmpeg`.
 */

/**
 * Resultado da execução de processo externo.
 * @typedef {Object} ProcessExecutionResult
 * @property {string} stdout
 * @property {string} stderr
 */

/**
 * Limita e normaliza um valor numérico em um intervalo.
 *
 * @param {number|string} value - Valor recebido.
 * @param {number} min - Limite mínimo aceito.
 * @param {number} max - Limite máximo aceito.
 * @param {number} fallback - Valor padrão quando `value` é inválido.
 * @returns {number} Valor normalizado.
 */
function clampNumber(value, min, max, fallback) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(max, Math.max(min, numericValue));
}

/**
 * Resolve o timeout final da execução com prioridade para override explícito.
 *
 * @param {string} mediaType - Tipo da mídia (`image`, `video`, `sticker`).
 * @param {TimeoutByTypeMap} timeoutMsByType - Mapa de timeout por tipo.
 * @param {number} [explicitTimeoutMs] - Timeout explícito para esta execução.
 * @returns {number} Timeout final em milissegundos.
 */
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

/**
 * Resolve o limite máximo de saída considerando override global e por tipo.
 *
 * @param {string} mediaType - Tipo da mídia.
 * @param {number} [explicitMaxOutputSizeBytes] - Limite global em bytes.
 * @param {MaxOutputSizeByTypeMap} maxOutputSizeBytesByType - Limite específico por tipo.
 * @returns {number} Limite final em bytes.
 */
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

/**
 * Mantém apenas os últimos bytes do log para evitar crescimento infinito em memória.
 *
 * @param {string} current - Buffer atual do log.
 * @param {string} chunk - Novo trecho recebido.
 * @returns {string} Buffer atualizado respeitando `LOG_BUFFER_LIMIT`.
 */
function appendBufferedLogs(current, chunk) {
  const next = `${current}${chunk}`;
  if (next.length <= LOG_BUFFER_LIMIT) return next;
  return next.slice(-LOG_BUFFER_LIMIT);
}

/**
 * Envia sinal de término para processo filho de forma segura.
 *
 * @param {import('node:child_process').ChildProcessWithoutNullStreams} child - Processo filho.
 * @param {NodeJS.Signals} signal - Sinal a ser enviado.
 * @returns {boolean} `true` se o sinal foi enviado, `false` em erro.
 */
function safeKill(child, signal) {
  try {
    return child.kill(signal);
  } catch {
    return false;
  }
}

/**
 * Retorna as últimas linhas não vazias de um texto de log.
 *
 * @param {string} text - Conteúdo do log.
 * @param {number} [maxLines=3] - Quantidade máxima de linhas retornadas.
 * @returns {string} Trecho final do log.
 */
function getLogTail(text, maxLines = 3) {
  if (!text) return '';
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return '';
  return lines.slice(-maxLines).join('\n');
}

/**
 * Define se o `stderr` do ffmpeg deve ser registrado em sucesso.
 *
 * @param {string} stderrText - Conteúdo de stderr.
 * @returns {boolean} `true` para logar; `false` para ignorar.
 */
function shouldLogFfmpegStderr(stderrText) {
  const output = stderrText?.trim();
  if (!output) return false;
  if (process.env.DEBUG_FFMPEG === 'true') return true;
  return FFMPEG_WARNING_PATTERN.test(output);
}

/**
 * Executa um comando externo com timeout e coleta parcial de logs.
 *
 * @param {string} command - Binário a executar.
 * @param {string[]} args - Argumentos já separados (sem shell).
 * @param {{ timeoutMs: number }} options - Configuração de execução.
 * @returns {Promise<ProcessExecutionResult>} Saída capturada do processo.
 */
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
        const processError = new Error(`${command} finalizou com código ${code}${signal ? ` (sinal: ${signal})` : ''}.`);
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

/**
 * Valida arquivo gerado na conversão.
 *
 * @param {string} filePath - Caminho do arquivo de saída.
 * @param {number} maxOutputLimit - Limite máximo permitido em bytes.
 * @returns {Promise<void>}
 * @throws {Error} Quando o arquivo é inválido, vazio ou acima do limite.
 */
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
 * Converte mídia para WEBP com parâmetros compatíveis com sticker do WhatsApp.
 *
 * @param {string} inputPath - Caminho do arquivo de mídia de entrada.
 * @param {'image'|'video'|'sticker'} mediaType - Tipo de mídia de entrada.
 * @param {string} userId - Identificador do usuário para isolamento do diretório temporário.
 * @param {string} uniqueId - Identificador único para o sticker.
 * @param {ConvertToWebpOptions} [options={}] - Opções avançadas de conversão.
 * @returns {Promise<string>} Caminho do arquivo webp gerado.
 * @throws {Error} Se a conversão falhar.
 */
export async function convertToWebp(inputPath, mediaType, userId, uniqueId, options = {}) {
  logger.info(`StickerCommand Convertendo mídia para webp. ID: ${uniqueId}, Tipo: ${mediaType}`);
  const sanitizedUserId = String(userId || 'anon').replace(/[^a-zA-Z0-9._-]/g, '_');
  const userStickerDir = path.join(TEMP_DIR, sanitizedUserId);
  const outputPath = path.join(userStickerDir, `sticker_${uniqueId}.webp`);
  const { stretch = true, videoMaxDurationSeconds = DEFAULT_VIDEO_MAX_DURATION_SECONDS, videoFps = DEFAULT_VIDEO_FPS, videoQuality = DEFAULT_VIDEO_QUALITY, videoCompressionLevel = DEFAULT_VIDEO_COMPRESSION_LEVEL, maxOutputSizeBytes, maxOutputSizeBytesByType = DEFAULT_MAX_OUTPUT_SIZE_BYTES_BY_TYPE, timeoutMsByType = DEFAULT_TIMEOUT_MS_BY_TYPE, timeoutMs } = options;
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

    const normalizedDuration = Math.trunc(clampNumber(videoMaxDurationSeconds, 1, 30, DEFAULT_VIDEO_MAX_DURATION_SECONDS));
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
      ffmpegArgs.push('-vsync', '0', '-lossless', '0', '-q:v', String(normalizedQuality), '-compression_level', String(normalizedCompression));
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
