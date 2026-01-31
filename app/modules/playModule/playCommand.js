import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import logger from '../../utils/logger/loggerModule.js';

const adminJid = process.env.USER_ADMIN;
const DEFAULT_COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';
const YTDLS_BASE_URL = (
  process.env.YTDLS_BASE_URL ||
  process.env.YT_DLS_BASE_URL ||
  'http://127.0.0.1:3000'
).replace(/\/$/, '');
const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.PLAY_API_TIMEOUT_MS || '900000', 10);
const DOWNLOAD_API_TIMEOUT_MS = Number.parseInt(
  process.env.PLAY_API_DOWNLOAD_TIMEOUT_MS || '1800000',
  10,
);
const MAX_MEDIA_MB = Number.parseInt(process.env.PLAY_MAX_MB || '100', 10);
const MAX_MEDIA_BYTES = Number.isFinite(MAX_MEDIA_MB)
  ? MAX_MEDIA_MB * 1024 * 1024
  : 100 * 1024 * 1024;
const MAX_MEDIA_MB_LABEL = Number.isFinite(MAX_MEDIA_MB) ? MAX_MEDIA_MB : 100;
const QUEUE_STATUS_TIMEOUT_MS = Number.parseInt(
  process.env.PLAY_QUEUE_STATUS_TIMEOUT_MS || '8000',
  10,
);
const QUICK_QUEUE_LOOKUP_MS = 1500;
const THUMBNAIL_TIMEOUT_MS = 15000;
const MAX_THUMB_BYTES = 5 * 1024 * 1024;

const ERROR_CODES = {
  INVALID_INPUT: 'EINVALID_INPUT',
  API: 'EAPI',
  TIMEOUT: 'ETIMEOUT',
  TOO_BIG: 'ETOOBIG',
  NOT_FOUND: 'ENOTFOUND',
};

const KNOWN_ERROR_CODES = new Set(Object.values(ERROR_CODES));

const TYPE_CONFIG = {
  audio: {
    waitText: '⏳ Aguarde, estamos preparando o áudio...',
    readyTitle: '🎵 Áudio pronto!',
    mimeFallback: 'audio/mpeg',
  },
  video: {
    waitText: '⏳ Aguarde, estamos preparando o vídeo...',
    readyTitle: '🎬 Vídeo pronto!',
    mimeFallback: 'video/mp4',
  },
};

const createError = (code, message, meta) => {
  const error = new Error(message);
  error.code = code;
  if (meta) error.meta = meta;
  return error;
};

const isAbortError = (error) =>
  error?.name === 'AbortError' || error?.code === 'ABORT_ERR' || error?.code === 'ECONNABORTED';

const normalizeRequestError = (error, { timeoutMessage, fallbackMessage, fallbackCode }) => {
  if (KNOWN_ERROR_CODES.has(error?.code) && error?.message) return error;
  if (isAbortError(error)) {
    return createError(ERROR_CODES.TIMEOUT, timeoutMessage);
  }
  return createError(fallbackCode || ERROR_CODES.API, fallbackMessage, {
    cause: error?.message || 'unknown',
  });
};

const createAbortSignal = (timeoutMs) => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { signal: undefined, cleanup: () => {} };
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeoutId),
  };
};

const delay = (ms) => new Promise((resolve) => setTimeout(() => resolve(null), ms));

const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const safeUnlink = async (filePath) => {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch {}
};

const formatNumber = (value) => {
  const number = toNumberOrNull(value);
  if (number === null) return null;
  return number.toLocaleString('pt-BR');
};

const formatDuration = (value) => {
  if (value === null || value === undefined) return null;
  const number = toNumberOrNull(value);
  if (number !== null) {
    const totalSeconds = Math.max(0, Math.floor(number));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
};

const pickFirstString = (source, keys) => {
  if (!source || typeof source !== 'object') return null;
  for (const key of keys) {
    const raw = source[key];
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  }
  return null;
};

const ensureHttpUrl = (value) => {
  if (!value || typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
  } catch {}
  return null;
};

const getThumbnailUrl = (videoInfo) => {
  if (!videoInfo || typeof videoInfo !== 'object') return null;
  const direct = pickFirstString(videoInfo, [
    'thumbnail',
    'thumb',
    'thumbnail_url',
    'thumbnailUrl',
    'thumb_url',
    'image',
    'cover',
    'artwork',
  ]);
  const directUrl = ensureHttpUrl(direct);
  if (directUrl) return directUrl;

  const objectThumb = videoInfo.thumbnail;
  if (objectThumb && typeof objectThumb === 'object') {
    const objectUrl = ensureHttpUrl(objectThumb.url || objectThumb.src);
    if (objectUrl) return objectUrl;
  }

  if (Array.isArray(videoInfo.thumbnails)) {
    const item = videoInfo.thumbnails.find((thumb) => ensureHttpUrl(thumb?.url));
    if (item?.url) return item.url;
  }

  return null;
};

const buildTempFilePath = (requestId, type) => {
  const safeId = String(requestId || 'req')
    .replace(/[^a-z0-9-_]+/gi, '')
    .slice(0, 48);
  const ext = type === 'audio' ? 'mp3' : 'mp4';
  return path.join(os.tmpdir(), `play-${safeId}-${Date.now()}.${ext}`);
};

/**
 * Faz requisicao HTTP e retorna JSON parseado.
 * @param {string} method
 * @param {string} url
 * @param {object|null} body
 * @param {number} [timeoutMs]
 * @returns {Promise<object>}
 */
const requestJson = (method, url, body, timeoutMs = DEFAULT_TIMEOUT_MS) =>
  new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const payload = body ? JSON.stringify(body) : null;
    const httpModule = urlObj.protocol === 'https:' ? https : http;
    const headers = { Accept: 'application/json' };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const { signal, cleanup } = createAbortSignal(timeoutMs);
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const req = httpModule.request(
      urlObj,
      {
        method,
        headers,
        signal,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('error', (error) => {
          finish(() =>
            reject(
              normalizeRequestError(error, {
                timeoutMessage: 'Timeout ao comunicar com a API yt-dls.',
                fallbackMessage: 'Falha ao receber dados da API yt-dls.',
              }),
            ),
          );
        });
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8').trim();
          const status = res.statusCode || 0;
          if (status < 200 || status >= 300) {
            let message = 'Falha na API yt-dls.';
            let payloadData = null;
            if (raw) {
              try {
                payloadData = JSON.parse(raw);
                if (payloadData?.mensagem) message = payloadData.mensagem;
              } catch {}
            }
            finish(() =>
              reject(
                createError(ERROR_CODES.API, message, {
                  status,
                  body: raw,
                }),
              ),
            );
            return;
          }

          if (!raw) {
            finish(() => resolve({}));
            return;
          }
          try {
            const parsed = JSON.parse(raw);
            finish(() => resolve(parsed));
          } catch {
            finish(() =>
              reject(
                createError(ERROR_CODES.API, 'Resposta inválida da API yt-dls.', {
                  status,
                  body: raw,
                }),
              ),
            );
          }
        });
      },
    );

    req.on('error', (error) => {
      finish(() =>
        reject(
          normalizeRequestError(error, {
            timeoutMessage: 'Timeout ao comunicar com a API yt-dls.',
            fallbackMessage: 'Falha ao comunicar com a API yt-dls.',
          }),
        ),
      );
    });

    if (payload) {
      req.write(payload);
    }
    req.end();
  });

/**
 * Gera um identificador unico para requests.
 * @returns {string}
 */
const buildRequestId = () => {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

/**
 * Resolve um termo de busca para URL do YouTube.
 * @param {string} query
 * @returns {Promise<string>}
 */
const resolveYoutubeLink = async (query) => {
  const normalized = query ? query.trim() : '';
  if (!normalized) {
    throw createError(
      ERROR_CODES.INVALID_INPUT,
      'Você precisa informar um link do YouTube ou termo de busca.',
    );
  }

  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  const searchUrl = `${YTDLS_BASE_URL}/search?q=${encodeURIComponent(normalized)}`;
  const searchResult = await requestJson('GET', searchUrl);
  if (!searchResult?.sucesso) {
    throw createError(
      ERROR_CODES.API,
      searchResult?.mensagem || 'Não foi possível buscar o vídeo agora.',
    );
  }
  if (!searchResult?.resultado?.url) {
    throw createError(ERROR_CODES.NOT_FOUND, 'Nenhum resultado encontrado para a busca.');
  }
  return searchResult.resultado.url;
};

/**
 * Busca metadados basicos do video pela API de busca.
 * @param {string} query
 * @param {string} fallback
 * @returns {Promise<object|null>}
 */
const fetchVideoInfo = async (query, fallback) => {
  const tryQuery = async (value) => {
    if (!value) return null;
    const searchUrl = `${YTDLS_BASE_URL}/search?q=${encodeURIComponent(value)}`;
    const result = await requestJson('GET', searchUrl);
    if (!result?.sucesso || !result?.resultado) return null;
    return result.resultado;
  };

  try {
    const first = await tryQuery(query);
    if (first) return first;
  } catch {}

  try {
    return await tryQuery(fallback);
  } catch {
    return null;
  }
};

/**
 * Formata informacoes do video para exibir ao usuario.
 * @param {object|null} videoInfo
 * @returns {string|null}
 */
const formatVideoInfo = (videoInfo) => {
  if (!videoInfo || typeof videoInfo !== 'object') return null;
  const lines = [];
  const title = pickFirstString(videoInfo, ['title', 'titulo', 'name']);
  if (title) lines.push(`*Título:* ${title}`);
  const channel = pickFirstString(videoInfo, ['channel', 'uploader', 'uploader_name', 'author']);
  if (channel) lines.push(`*Canal:* ${channel}`);
  const duration = formatDuration(videoInfo.duration);
  if (duration) lines.push(`*Duração:* ${duration}`);
  const views = formatNumber(videoInfo.views);
  if (views !== null) lines.push(`*Views:* ${views}`);
  const likes = formatNumber(videoInfo.like_count);
  if (likes !== null) lines.push(`*Likes:* ${likes}`);
  const id = pickFirstString(videoInfo, ['id', 'videoId', 'video_id']);
  if (id) lines.push(`*ID:* ${id}`);
  return lines.length ? lines.join('\n') : null;
};

/**
 * Busca status da fila para um requestId.
 * @param {string} requestId
 * @returns {Promise<object|null>}
 */
const fetchQueueStatus = async (requestId) => {
  if (!requestId) return null;
  const queueUrl = `${YTDLS_BASE_URL}/download/queue-status/${encodeURIComponent(requestId)}`;
  try {
    const result = await requestJson('GET', queueUrl, null, QUEUE_STATUS_TIMEOUT_MS);
    if (!result?.sucesso || !result?.fila) return null;
    return result;
  } catch {
    return null;
  }
};

/**
 * Monta uma mensagem amigável com o status atual da fila de processamento.
 * Essa informação ajuda o usuário a entender quanto tempo pode levar
 * até que o download dele seja iniciado.
 *
 * @param {object|null} status - Objeto retornado pelo serviço com informações da fila
 * @returns {string|null} Texto formatado para exibição ou null se não houver dados úteis
 */
const buildQueueStatusText = (status) => {
  if (!status?.fila) return null;

  const fila = status.fila;
  const downloadsAhead = toNumberOrNull(fila.downloads_a_frente);
  const position = toNumberOrNull(fila.posicao_na_fila);
  const totalQueued = toNumberOrNull(fila.enfileirados);

  if (downloadsAhead === null && position === null && totalQueued === null) {
    return null;
  }

  const lines = [];
  if (position !== null) lines.push(`📍 Você está na *posição ${position}*`);
  if (downloadsAhead !== null)
    lines.push(`🚀 Existem *${downloadsAhead} download(s)* à sua frente`);
  if (totalQueued !== null) lines.push(`📦 Total na fila: *${totalQueued}*`);

  return lines.join('\n');
};

/**
 * Faz o download direto na API yt-dls e salva em arquivo temporario.
 * @param {string} link
 * @param {'audio'|'video'} type
 * @param {string} requestId
 * @returns {Promise<{filePath: string, contentType: string, bytes: number}>}
 */
const requestDownloadToFile = (link, type, requestId) =>
  new Promise((resolve, reject) => {
    const downloadUrl = `${YTDLS_BASE_URL}/download`;
    const urlObj = new URL(downloadUrl);
    const payload = JSON.stringify({ link, type, request_id: requestId });
    const httpModule = urlObj.protocol === 'https:' ? https : http;
    const headers = {
      Accept: '*/*',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    };

    const { signal, cleanup } = createAbortSignal(DOWNLOAD_API_TIMEOUT_MS);
    let settled = false;
    const filePath = buildTempFilePath(requestId, type);
    let writeStream = null;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const rejectWithCleanup = (error) =>
      finish(() => {
        if (writeStream) writeStream.destroy();
        void safeUnlink(filePath);
        reject(error);
      });

    const req = httpModule.request(
      urlObj,
      {
        method: 'POST',
        headers,
        signal,
      },
      (res) => {
        const status = res.statusCode || 0;
        const contentType = res.headers['content-type'] || '';
        const contentLength = Number(res.headers['content-length']);

        if (Number.isFinite(contentLength) && contentLength > MAX_MEDIA_BYTES) {
          res.resume();
          rejectWithCleanup(
            createError(
              ERROR_CODES.TOO_BIG,
              `O arquivo excede o limite permitido de ${MAX_MEDIA_MB_LABEL} MB.`,
            ),
          );
          return;
        }

        if (status < 200 || status >= 300) {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf-8').trim();
            let message = `Falha na API yt-dls (HTTP ${status}).`;
            try {
              const parsed = raw ? JSON.parse(raw) : null;
              if (parsed?.mensagem) message = parsed.mensagem;
            } catch {}
            rejectWithCleanup(
              createError(ERROR_CODES.API, message, {
                status,
                body: raw,
              }),
            );
          });
          return;
        }

        let total = 0;
        writeStream = fs.createWriteStream(filePath);
        writeStream.on('error', (error) => {
          res.destroy();
          rejectWithCleanup(
            normalizeRequestError(error, {
              timeoutMessage: 'Timeout ao salvar o arquivo.',
              fallbackMessage: 'Falha ao salvar o arquivo no disco.',
            }),
          );
        });

        res.on('data', (chunk) => {
          total += chunk.length;
          if (total > MAX_MEDIA_BYTES) {
            res.destroy();
            writeStream.destroy();
            rejectWithCleanup(
              createError(
                ERROR_CODES.TOO_BIG,
                `O arquivo excede o limite permitido de ${MAX_MEDIA_MB_LABEL} MB.`,
              ),
            );
            return;
          }
          if (!writeStream.write(chunk)) {
            res.pause();
            writeStream.once('drain', () => res.resume());
          }
        });
        res.on('error', (error) => {
          rejectWithCleanup(
            normalizeRequestError(error, {
              timeoutMessage: 'Timeout ao baixar o arquivo.',
              fallbackMessage: 'Falha ao receber o arquivo da API yt-dls.',
            }),
          );
        });
        res.on('end', () => {
          if (!writeStream) {
            finish(() =>
              resolve({
                filePath,
                contentType: contentType || (type === 'audio' ? 'audio/mpeg' : 'video/mp4'),
                bytes: total,
              }),
            );
            return;
          }
          writeStream.end(() => {
            finish(() =>
              resolve({
                filePath,
                contentType: contentType || (type === 'audio' ? 'audio/mpeg' : 'video/mp4'),
                bytes: total,
              }),
            );
          });
        });
      },
    );

    req.on('error', (error) => {
      rejectWithCleanup(
        normalizeRequestError(error, {
          timeoutMessage: 'Timeout ao baixar o arquivo.',
          fallbackMessage: 'Falha ao comunicar com a API yt-dls.',
        }),
      );
    });

    req.write(payload);
    req.end();
  });

const fetchBuffer = (url, timeoutMs = THUMBNAIL_TIMEOUT_MS, maxBytes = MAX_THUMB_BYTES, redirect = 0) =>
  new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const httpModule = urlObj.protocol === 'https:' ? https : http;
    const { signal, cleanup } = createAbortSignal(timeoutMs);
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const req = httpModule.request(
      urlObj,
      {
        method: 'GET',
        headers: { Accept: 'image/*' },
        signal,
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location && redirect < 2) {
          const nextUrl = new URL(res.headers.location, urlObj);
          res.resume();
          finish(() =>
            resolve(fetchBuffer(nextUrl.toString(), timeoutMs, maxBytes, redirect + 1)),
          );
          return;
        }

        if (status < 200 || status >= 300) {
          res.resume();
          finish(() =>
            reject(
              createError(ERROR_CODES.API, 'Falha ao baixar a thumbnail.', {
                status,
              }),
            ),
          );
          return;
        }

        const contentLength = Number(res.headers['content-length']);
        if (Number.isFinite(contentLength) && contentLength > maxBytes) {
          res.resume();
          finish(() =>
            reject(createError(ERROR_CODES.TOO_BIG, 'Thumbnail excede o limite permitido.')),
          );
          return;
        }

        const chunks = [];
        let total = 0;
        res.on('data', (chunk) => {
          total += chunk.length;
          if (total > maxBytes) {
            res.destroy();
            finish(() =>
              reject(createError(ERROR_CODES.TOO_BIG, 'Thumbnail excede o limite permitido.')),
            );
            return;
          }
          chunks.push(chunk);
        });
        res.on('error', (error) => {
          finish(() =>
            reject(
              normalizeRequestError(error, {
                timeoutMessage: 'Timeout ao baixar a thumbnail.',
                fallbackMessage: 'Falha ao baixar a thumbnail.',
              }),
            ),
          );
        });
        res.on('end', () => finish(() => resolve(Buffer.concat(chunks))));
      },
    );

    req.on('error', (error) => {
      finish(() =>
        reject(
          normalizeRequestError(error, {
            timeoutMessage: 'Timeout ao baixar a thumbnail.',
            fallbackMessage: 'Falha ao baixar a thumbnail.',
          }),
        ),
      );
    });

    req.end();
  });

const buildReadyCaption = (type, infoText) => {
  const config = TYPE_CONFIG[type];
  if (!config) return infoText || '';
  if (!infoText) return config.readyTitle;
  return `${config.readyTitle}\n${infoText}`;
};

const getUserErrorMessage = (error) => {
  if (!error) return 'Erro inesperado ao processar sua solicitação.';
  if (KNOWN_ERROR_CODES.has(error?.code) && error?.message) return error.message;
  return 'Erro inesperado ao processar sua solicitação.';
};

/**
 * Notifica o usuario e o admin sobre falhas do comando.
 * @param {object} sock
 * @param {string} remoteJid
 * @param {object} messageInfo
 * @param {number} expirationMessage
 * @param {Error} error
 * @param {object} context
 * @returns {Promise<void>}
 */
const notifyFailure = async (sock, remoteJid, messageInfo, expirationMessage, error, context) => {
  const errorMessage = getUserErrorMessage(error);
  await sock.sendMessage(
    remoteJid,
    { text: `❌ Erro: ${errorMessage}` },
    { quoted: messageInfo, ephemeralExpiration: expirationMessage },
  );

  if (adminJid) {
    await sock.sendMessage(adminJid, {
      text: `Erro no módulo play.\nChat: ${remoteJid}\nRequest: ${
        context?.requestId || 'n/a'
      }\nTipo: ${context?.type || 'n/a'}\nErro: ${errorMessage}\nCode: ${
        error?.code || 'n/a'
      }`,
    });
  }
};

const handlePlayGeneric = async ({
  sock,
  remoteJid,
  messageInfo,
  expirationMessage,
  text,
  type,
}) => {
  const startTime = Date.now();
  const requestId = buildRequestId();
  const config = TYPE_CONFIG[type];
  if (!config) {
    throw createError(ERROR_CODES.INVALID_INPUT, 'Tipo de mídia inválido.');
  }

  logger.info('Play request iniciado.', {
    requestId,
    remoteJid,
    type,
    elapsedMs: 0,
  });

  try {
    const link = await resolveYoutubeLink(text);
    const downloadPromise = requestDownloadToFile(link, type, requestId);
    const videoInfoPromise = fetchVideoInfo(text, link);
    const queueStatusPromise = fetchQueueStatus(requestId);
    const queueStatus = await Promise.race([queueStatusPromise, delay(QUICK_QUEUE_LOOKUP_MS)]);
    const queueText = buildQueueStatusText(queueStatus);
    const waitText = queueText ? `${config.waitText}\n${queueText}` : config.waitText;

    await sock.sendMessage(
      remoteJid,
      { text: waitText },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );

    if (queueStatus?.fila) {
      logger.info('Play fila consultada.', {
        requestId,
        remoteJid,
        type,
        elapsedMs: Date.now() - startTime,
        queue: queueStatus.fila,
      });
    }

    const [downloadResult, videoInfo] = await Promise.all([downloadPromise, videoInfoPromise]);
    const { filePath, contentType, bytes } = downloadResult;

    logger.info('Play download concluído.', {
      requestId,
      remoteJid,
      type,
      elapsedMs: Date.now() - startTime,
      bytes: bytes || 0,
    });

    try {
      if (type === 'audio') {
        const infoText = formatVideoInfo(videoInfo);
        const caption = buildReadyCaption(type, infoText);
        const thumbUrl = getThumbnailUrl(videoInfo);
        let thumbBuffer = null;

        if (thumbUrl) {
          try {
            thumbBuffer = await fetchBuffer(thumbUrl);
          } catch (error) {
            logger.warn('Falha ao baixar thumbnail.', {
              requestId,
              remoteJid,
              type,
              elapsedMs: Date.now() - startTime,
              error: error?.message,
              code: error?.code,
            });
          }
        }

        if (thumbBuffer) {
          await sock.sendMessage(
            remoteJid,
            { image: thumbBuffer, caption },
            { quoted: messageInfo, ephemeralExpiration: expirationMessage },
          );
        }

        await sock.sendMessage(
          remoteJid,
          {
            audio: { url: filePath },
            mimetype: contentType || config.mimeFallback,
            ptt: false,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );

        logger.info('Play áudio enviado.', {
          requestId,
          remoteJid,
          type,
          elapsedMs: Date.now() - startTime,
        });
        return;
      }

      const infoText = formatVideoInfo(videoInfo);
      const caption = buildReadyCaption(type, infoText);

      await sock.sendMessage(
        remoteJid,
        {
          video: { url: filePath },
          mimetype: contentType || config.mimeFallback,
          caption,
        },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );

      logger.info('Play vídeo enviado.', {
        requestId,
        remoteJid,
        type,
        elapsedMs: Date.now() - startTime,
      });
    } finally {
      await safeUnlink(filePath);
    }
  } catch (error) {
    const normalizedError =
      KNOWN_ERROR_CODES.has(error?.code) && error?.message
        ? error
        : createError(ERROR_CODES.API, 'Erro inesperado ao processar sua solicitação.');
    normalizedError.meta = {
      ...(normalizedError.meta || {}),
      requestId,
      remoteJid,
      type,
    };

    logger.error('Play falhou.', {
      requestId,
      remoteJid,
      type,
      elapsedMs: Date.now() - startTime,
      error: normalizedError.message,
      code: normalizedError.code,
    });

    throw normalizedError;
  }
};

/**
 * Handler do comando play (audio).
 * @param {object} sock
 * @param {string} remoteJid
 * @param {object} messageInfo
 * @param {number} expirationMessage
 * @param {string} text
 * @returns {Promise<void>}
 */
export const handlePlayCommand = async (
  sock,
  remoteJid,
  messageInfo,
  expirationMessage,
  text,
  commandPrefix = DEFAULT_COMMAND_PREFIX,
) => {
  try {
    if (!text?.trim()) {
      await sock.sendMessage(
        remoteJid,
        { text: `🎵 Uso: ${commandPrefix}play <link do YouTube ou termo de busca>` },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      return;
    }

    await handlePlayGeneric({
      sock,
      remoteJid,
      messageInfo,
      expirationMessage,
      text,
      type: 'audio',
    });
  } catch (error) {
    await notifyFailure(sock, remoteJid, messageInfo, expirationMessage, error, {
      type: 'audio',
      requestId: error?.meta?.requestId,
    });
  }
};

/**
 * Handler do comando playvid (video).
 * @param {object} sock
 * @param {string} remoteJid
 * @param {object} messageInfo
 * @param {number} expirationMessage
 * @param {string} text
 * @returns {Promise<void>}
 */
export const handlePlayVidCommand = async (
  sock,
  remoteJid,
  messageInfo,
  expirationMessage,
  text,
  commandPrefix = DEFAULT_COMMAND_PREFIX,
) => {
  try {
    if (!text?.trim()) {
      await sock.sendMessage(
        remoteJid,
        { text: `🎬 Uso: ${commandPrefix}playvid <link do YouTube ou termo de busca>` },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      return;
    }

    await handlePlayGeneric({
      sock,
      remoteJid,
      messageInfo,
      expirationMessage,
      text,
      type: 'video',
    });
  } catch (error) {
    await notifyFailure(sock, remoteJid, messageInfo, expirationMessage, error, {
      type: 'video',
      requestId: error?.meta?.requestId,
    });
  }
};
