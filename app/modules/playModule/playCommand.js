import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import logger from '../../utils/logger/loggerModule.js';
import { sendAndStore } from '../../services/messagePersistenceService.js';
import { getAdminJid } from '../../config/adminIdentity.js';

const adminJid = getAdminJid();
const DEFAULT_COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';
const YTDLS_BASE_URL = (process.env.YTDLS_BASE_URL || process.env.YT_DLS_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.PLAY_API_TIMEOUT_MS || '900000', 10);
const DOWNLOAD_API_TIMEOUT_MS = Number.parseInt(process.env.PLAY_API_DOWNLOAD_TIMEOUT_MS || '1800000', 10);
const QUEUE_STATUS_TIMEOUT_MS = Number.parseInt(process.env.PLAY_QUEUE_STATUS_TIMEOUT_MS || '8000', 10);

const MAX_MEDIA_MB = Number.parseInt(process.env.PLAY_MAX_MB || '100', 10);
const MAX_MEDIA_BYTES = Number.isFinite(MAX_MEDIA_MB) ? MAX_MEDIA_MB * 1024 * 1024 : 100 * 1024 * 1024;
const MAX_MEDIA_MB_LABEL = Number.isFinite(MAX_MEDIA_MB) ? MAX_MEDIA_MB : 100;

const QUICK_QUEUE_LOOKUP_MS = 1500;
const THUMBNAIL_TIMEOUT_MS = 15000;
const MAX_THUMB_BYTES = 5 * 1024 * 1024;
const VIDEO_PROCESS_TIMEOUT_MS = Number.parseInt(process.env.PLAY_VIDEO_PROCESS_TIMEOUT_MS || '420000', 10);
const VIDEO_FORCE_TRANSCODE = String(process.env.PLAY_VIDEO_FORCE_TRANSCODE || 'true').toLowerCase() !== 'false';
const FFMPEG_BIN = (process.env.FFMPEG_PATH || 'ffmpeg').trim();
const FFPROBE_BIN = (process.env.FFPROBE_PATH || 'ffprobe').trim();
const SEARCH_CACHE_TTL_MS = 60 * 1000;
const MAX_SEARCH_CACHE_ENTRIES = 500;
const MAX_REDIRECTS = 2;
const MAX_ERROR_BODY_BYTES = 64 * 1024;
const MAX_META_BODY_CHARS = 512;

const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504]);
const TRANSIENT_NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN']);

const YTDLS_ENDPOINTS = {
  search: '/search',
  queueStatus: '/download/queue-status',
  download: '/download',
  thumbnail: 'thumbnail',
};

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
    waitText: '⏳ Processando sua mídia...',
    queueWaitText: '⏳ Processando...',
    readyTitle: '🎵 Áudio pronto!',
    mimeFallback: 'audio/mpeg',
  },
  video: {
    waitText: '⏳ Processando sua mídia...',
    queueWaitText: '⏳ Processando...',
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

const withErrorMeta = (error, meta) => {
  if (!error || typeof error !== 'object') return error;
  error.meta = {
    ...(error.meta || {}),
    ...(meta || {}),
  };
  return error;
};

const isAbortError = (error) => error?.name === 'AbortError' || error?.code === 'ABORT_ERR' || error?.code === 'ECONNABORTED';

const normalizeRequestError = (error, { timeoutMessage, fallbackMessage, fallbackCode }) => {
  if (KNOWN_ERROR_CODES.has(error?.code) && error?.message) return error;
  if (isAbortError(error)) {
    return createError(ERROR_CODES.TIMEOUT, timeoutMessage, {
      rawCode: error?.code || error?.name || null,
    });
  }
  return createError(fallbackCode || ERROR_CODES.API, fallbackMessage, {
    cause: error?.message || 'unknown',
    rawCode: error?.code || error?.name || null,
  });
};

const normalizePlayError = (error) => {
  if (KNOWN_ERROR_CODES.has(error?.code) && error?.message) return error;
  if (isAbortError(error)) {
    return createError(ERROR_CODES.TIMEOUT, 'Timeout ao processar sua solicitação.', {
      rawCode: error?.code || error?.name || null,
    });
  }
  return createError(ERROR_CODES.API, 'Erro inesperado ao processar sua solicitação.', {
    cause: error?.message || 'unknown',
    rawCode: error?.code || error?.name || null,
  });
};

const delay = (ms) => new Promise((resolve) => setTimeout(() => resolve(null), ms));

const truncateText = (value, maxChars = MAX_META_BODY_CHARS) => {
  if (typeof value !== 'string') return '';
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}...[truncated]`;
};

const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
    return null;
  } catch {
    return null;
  }
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

const formatVideoInfo = (videoInfo) => {
  if (!videoInfo || typeof videoInfo !== 'object') return null;
  const lines = [];
  const title = pickFirstString(videoInfo, ['title', 'titulo', 'name']);
  if (title) lines.push(`🎧 ${title}`);
  const channel = pickFirstString(videoInfo, ['channel', 'uploader', 'uploader_name', 'author']);
  if (channel) lines.push(`📺 ${channel}`);
  const duration = formatDuration(videoInfo.duration);
  if (duration) lines.push(`⏱ ${duration}`);
  const id = pickFirstString(videoInfo, ['id', 'videoId', 'video_id']);
  if (id) lines.push(`🆔 ${id}`);
  return lines.length ? lines.join('\n') : null;
};

const getThumbnailUrl = (videoInfo) => {
  if (!videoInfo || typeof videoInfo !== 'object') return null;

  const direct = pickFirstString(videoInfo, ['thumbnail', 'thumb', 'thumbnail_url', 'thumbnailUrl', 'thumb_url', 'image', 'cover', 'artwork']);
  const directUrl = ensureHttpUrl(direct);
  if (directUrl) return directUrl;

  const objectThumb = videoInfo.thumbnail;
  if (objectThumb && typeof objectThumb === 'object') {
    const objectUrl = ensureHttpUrl(objectThumb.url || objectThumb.src);
    if (objectUrl) return objectUrl;
  }

  if (Array.isArray(videoInfo.thumbnails)) {
    for (const thumb of videoInfo.thumbnails) {
      const thumbUrl = ensureHttpUrl(thumb?.url || thumb?.src);
      if (thumbUrl) return thumbUrl;
    }
  }

  return null;
};

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
  if (position !== null) lines.push(`📍 Posição na fila: ${position}`);
  if (downloadsAhead !== null) lines.push(`🚀 Downloads à frente: ${downloadsAhead}`);
  if (!lines.length && totalQueued !== null) lines.push(`📦 Itens na fila: ${totalQueued}`);

  return lines.join('\n');
};

const buildReadyCaption = (type, infoText) => {
  const config = TYPE_CONFIG[type];
  if (!config) return infoText || '';
  if (!infoText) return config.readyTitle;
  return `${config.readyTitle}\n──────────────\n${infoText}`;
};

const buildTempFilePath = (requestId, type) => {
  const safeId = String(requestId || 'req')
    .replace(/[^a-z0-9-_]+/gi, '')
    .slice(0, 48);
  const ext = type === 'audio' ? 'mp3' : 'mp4';
  return path.join(os.tmpdir(), `play-${safeId}-${Date.now()}.${ext}`);
};

const safeUnlink = async (filePath) => {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch {
    return;
  }
};

const createAbortSignal = (timeoutMs) => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { signal: undefined, cleanup: () => {} };
  }
  const controller = new globalThis.AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeoutId),
  };
};

const normalizeHeaderValue = (value) => {
  if (Array.isArray(value)) return value[0];
  return value;
};

const getHeaderValue = (headers, key) => {
  if (!headers || typeof headers !== 'object') return undefined;
  const lowerKey = key.toLowerCase();
  const raw = headers[lowerKey] ?? headers[key] ?? headers[key.toUpperCase()];
  return normalizeHeaderValue(raw);
};

const hasHeader = (headers, name) => (headers && typeof headers === 'object' ? Object.keys(headers).some((headerName) => headerName.toLowerCase() === name.toLowerCase()) : false);

const normalizeMimeType = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const mime = value.split(';', 1)[0]?.trim().toLowerCase();
  return mime || null;
};

const resolveMediaMimeType = (type, contentType) => {
  const normalized = normalizeMimeType(contentType);

  if (type === 'audio') {
    return normalized && normalized.startsWith('audio/') ? normalized : TYPE_CONFIG.audio.mimeFallback;
  }

  if (type === 'video') {
    return normalized && normalized.startsWith('video/') ? normalized : TYPE_CONFIG.video.mimeFallback;
  }

  return normalized || 'application/octet-stream';
};

const runBinaryCommand = (command, args, { timeoutMs = VIDEO_PROCESS_TIMEOUT_MS } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    const maxCapturedBytes = MAX_ERROR_BODY_BYTES * 4;

    const appendChunk = (chunks, chunk, bytes) => {
      if (!chunk || bytes >= maxCapturedBytes) return bytes;
      const current = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = Math.max(0, maxCapturedBytes - bytes);
      if (remaining <= 0) return bytes;
      const accepted = current.length <= remaining ? current : current.subarray(0, remaining);
      chunks.push(accepted);
      return bytes + accepted.length;
    };

    child.stdout.on('data', (chunk) => {
      stdoutBytes = appendChunk(stdoutChunks, chunk, stdoutBytes);
    });

    child.stderr.on('data', (chunk) => {
      stderrBytes = appendChunk(stderrChunks, chunk, stderrBytes);
    });

    const timeoutId =
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
          }, timeoutMs)
        : null;
    let settled = false;

    const finalize = (handler) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      handler();
    };

    child.on('error', (error) => {
      finalize(() => reject(error));
    });

    child.on('close', (code, signal) => {
      finalize(() => {
        const stdout = Buffer.concat(stdoutChunks, stdoutBytes).toString('utf-8').trim();
        const stderr = Buffer.concat(stderrChunks, stderrBytes).toString('utf-8').trim();

        if (!timedOut && code === 0) {
          resolve({ stdout, stderr });
          return;
        }

        const error = new Error(stderr || `Falha ao executar ${path.basename(command)}.`);
        error.code = timedOut ? 'ETIMEDOUT' : 'EPROCESS';
        error.exitCode = code;
        error.signal = signal || null;
        error.stderr = stderr;
        error.stdout = stdout;
        reject(error);
      });
    });
  });

const normalizeBinaryError = (error, { timeoutMessage, fallbackMessage, endpoint, requestId, command, outputPath }) => {
  if (KNOWN_ERROR_CODES.has(error?.code) && error?.message) return error;
  if (error?.code === 'ETIMEDOUT') {
    return createError(ERROR_CODES.TIMEOUT, timeoutMessage, {
      endpoint,
      requestId,
      command,
      rawCode: error?.code || null,
    });
  }
  return createError(ERROR_CODES.API, fallbackMessage, {
    endpoint,
    requestId,
    command,
    outputPath: outputPath || null,
    rawCode: error?.code || null,
    exitCode: error?.exitCode ?? null,
    signal: error?.signal || null,
    cause: truncateText(error?.stderr || error?.message || 'unknown'),
  });
};

const probeVideoStreams = async (filePath, requestId, endpoint) => {
  try {
    const result = await runBinaryCommand(FFPROBE_BIN, ['-v', 'error', '-print_format', 'json', '-show_streams', filePath]);
    const parsed = JSON.parse(result.stdout || '{}');
    const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
    const videoStream = streams.find((stream) => stream?.codec_type === 'video') || null;
    const audioStream = streams.find((stream) => stream?.codec_type === 'audio') || null;

    return {
      hasVideo: Boolean(videoStream),
      hasAudio: Boolean(audioStream),
      videoCodec: videoStream?.codec_name || null,
      audioCodec: audioStream?.codec_name || null,
    };
  } catch (error) {
    const normalized = normalizeBinaryError(error, {
      timeoutMessage: 'Timeout ao analisar o vídeo recebido.',
      fallbackMessage: 'Falha ao validar o vídeo recebido.',
      endpoint,
      requestId,
      command: FFPROBE_BIN,
    });
    throw normalized;
  }
};

const transcodeVideoForWhatsapp = async (filePath, requestId, endpoint) => {
  const outputPath = `${filePath}.wa.mp4`;

  try {
    await safeUnlink(outputPath);

    await runBinaryCommand(FFMPEG_BIN, ['-y', '-i', filePath, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2', outputPath], { timeoutMs: VIDEO_PROCESS_TIMEOUT_MS });

    const stats = await fs.promises.stat(outputPath);
    const transcodedBytes = Number(stats?.size || 0);

    if (transcodedBytes <= 0) {
      throw createError(ERROR_CODES.API, 'Falha ao gerar vídeo compatível para envio.', {
        endpoint,
        requestId,
        outputPath,
      });
    }

    if (transcodedBytes > MAX_MEDIA_BYTES) {
      throw createError(ERROR_CODES.TOO_BIG, `O arquivo excede o limite permitido de ${MAX_MEDIA_MB_LABEL} MB.`, {
        endpoint,
        requestId,
        bytes: transcodedBytes,
      });
    }

    await fs.promises.rename(outputPath, filePath);
    return transcodedBytes;
  } catch (error) {
    await safeUnlink(outputPath);
    const normalized = normalizeBinaryError(error, {
      timeoutMessage: 'Timeout ao normalizar o vídeo para envio.',
      fallbackMessage: 'Falha ao converter o vídeo para um formato compatível.',
      endpoint,
      requestId,
      command: FFMPEG_BIN,
      outputPath,
    });
    throw normalized;
  }
};

const resolveHttpModule = (urlObj) => (urlObj.protocol === 'https:' ? https : http);

const shouldFollowRedirect = (status, location, redirectCount, maxRedirects) => status >= 300 && status < 400 && Boolean(location) && redirectCount < maxRedirects;

const preparePayload = (body, headers) => {
  if (body === null || body === undefined) return null;

  if (Buffer.isBuffer(body) || typeof body === 'string') {
    headers['Content-Length'] = Buffer.byteLength(body);
    return body;
  }

  const json = JSON.stringify(body);
  if (!hasHeader(headers, 'Content-Type')) {
    headers['Content-Type'] = 'application/json';
  }
  headers['Content-Length'] = Buffer.byteLength(json);
  return json;
};

const readResponseBuffer = async (stream, { maxBytes = Infinity, tooBigMessage } = {}) => {
  const chunks = [];
  let total = 0;

  for await (const chunk of stream) {
    const current = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += current.length;

    if (Number.isFinite(maxBytes) && total > maxBytes) {
      stream.destroy();
      throw createError(ERROR_CODES.TOO_BIG, tooBigMessage || 'Conteúdo excede o limite permitido.', { bytes: total });
    }

    chunks.push(current);
  }

  return Buffer.concat(chunks, total);
};

const readResponseText = async (stream, maxBytes = MAX_ERROR_BODY_BYTES) => {
  const chunks = [];
  let total = 0;
  let truncated = false;

  for await (const chunk of stream) {
    const current = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

    if (total >= maxBytes) {
      truncated = true;
      continue;
    }

    if (total + current.length > maxBytes) {
      const remaining = Math.max(0, maxBytes - total);
      if (remaining > 0) {
        chunks.push(current.subarray(0, remaining));
        total += remaining;
      }
      truncated = true;
      continue;
    }

    chunks.push(current);
    total += current.length;
  }

  const text = Buffer.concat(chunks, total).toString('utf-8').trim();
  return truncated ? `${text}...[truncated]` : text;
};

const buildApiErrorFromResponse = ({ status, bodyText, defaultMessage, endpoint }) => {
  let message = defaultMessage;

  if (bodyText) {
    try {
      const parsed = JSON.parse(bodyText);
      if (typeof parsed?.mensagem === 'string' && parsed.mensagem.trim()) {
        message = parsed.mensagem.trim();
      }
    } catch {
      void bodyText;
    }
  }

  return createError(ERROR_CODES.API, message, {
    endpoint,
    status,
    body: truncateText(bodyText),
  });
};

const createByteLimitTransform = (maxBytes, tooBigMessage) => {
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        callback(
          createError(ERROR_CODES.TOO_BIG, tooBigMessage, {
            bytes,
          }),
        );
        return;
      }
      callback(null, chunk);
    },
  });

  return {
    stream: limiter,
    getBytes: () => bytes,
  };
};

const httpRequest = ({ method, url, headers = {}, body = null, timeoutMs = DEFAULT_TIMEOUT_MS, maxRedirects = 0, redirectCount = 0, endpoint = 'unknown', timeoutMessage = 'Timeout ao comunicar com a API yt-dls.', fallbackMessage = 'Falha ao comunicar com a API yt-dls.', onResponse }) =>
  new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const requestHeaders = { ...headers };
    const payload = preparePayload(body, requestHeaders);
    const httpModule = resolveHttpModule(urlObj);
    const { signal, cleanup } = createAbortSignal(timeoutMs);

    let settled = false;
    const settle = (fn) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const settleResolve = (value) => settle(() => resolve(value));
    const settleReject = (error) => settle(() => reject(error));

    const req = httpModule.request(
      urlObj,
      {
        method,
        headers: requestHeaders,
        signal,
      },
      (res) => {
        const status = res.statusCode || 0;
        const location = getHeaderValue(res.headers, 'location');
        res.on('error', (error) => {
          const normalized = normalizeRequestError(error, {
            timeoutMessage,
            fallbackMessage,
          });
          settleReject(withErrorMeta(normalized, { endpoint, status }));
        });

        if (shouldFollowRedirect(status, location, redirectCount, maxRedirects)) {
          logger.debug('HTTP redirect.', {
            endpoint,
            status,
            location: String(location),
            redirectCount: redirectCount + 1,
          });
          const nextUrl = new URL(String(location), urlObj).toString();
          res.resume();
          settleResolve(
            httpRequest({
              method,
              url: nextUrl,
              headers,
              body,
              timeoutMs,
              maxRedirects,
              redirectCount: redirectCount + 1,
              endpoint,
              timeoutMessage,
              fallbackMessage,
              onResponse,
            }),
          );
          return;
        }

        Promise.resolve(
          onResponse({
            res,
            status,
            headers: res.headers,
            endpoint,
            finalUrl: urlObj.toString(),
          }),
        )
          .then(settleResolve)
          .catch((error) => {
            const normalized = normalizeRequestError(error, {
              timeoutMessage,
              fallbackMessage,
            });
            settleReject(withErrorMeta(normalized, { endpoint, status }));
          });
      },
    );

    req.on('error', (error) => {
      const normalized = normalizeRequestError(error, {
        timeoutMessage,
        fallbackMessage,
      });
      settleReject(withErrorMeta(normalized, { endpoint }));
    });

    if (payload) req.write(payload);
    req.end();
  });

const requestJson = async ({ method, url, body = null, timeoutMs = DEFAULT_TIMEOUT_MS, endpoint }) =>
  httpRequest({
    method,
    url,
    body,
    timeoutMs,
    endpoint,
    headers: { Accept: 'application/json' },
    timeoutMessage: 'Timeout ao comunicar com a API yt-dls.',
    fallbackMessage: 'Falha ao comunicar com a API yt-dls.',
    onResponse: async ({ res, status, endpoint: currentEndpoint }) => {
      const raw = await readResponseText(res);

      if (status < 200 || status >= 300) {
        throw buildApiErrorFromResponse({
          status,
          bodyText: raw,
          defaultMessage: 'Falha na API yt-dls.',
          endpoint: currentEndpoint,
        });
      }

      if (!raw) return {};

      try {
        return JSON.parse(raw);
      } catch {
        throw createError(ERROR_CODES.API, 'Resposta inválida da API yt-dls.', {
          endpoint: currentEndpoint,
          status,
          body: truncateText(raw),
        });
      }
    },
  });

const requestBuffer = async ({ url, timeoutMs = THUMBNAIL_TIMEOUT_MS, maxBytes = MAX_THUMB_BYTES, endpoint = YTDLS_ENDPOINTS.thumbnail }) =>
  httpRequest({
    method: 'GET',
    url,
    timeoutMs,
    endpoint,
    maxRedirects: MAX_REDIRECTS,
    headers: { Accept: 'image/*' },
    timeoutMessage: 'Timeout ao baixar a thumbnail.',
    fallbackMessage: 'Falha ao baixar a thumbnail.',
    onResponse: async ({ res, status, headers, endpoint: currentEndpoint }) => {
      if (status < 200 || status >= 300) {
        res.resume();
        throw createError(ERROR_CODES.API, 'Falha ao baixar a thumbnail.', {
          endpoint: currentEndpoint,
          status,
        });
      }

      const contentLength = toNumberOrNull(getHeaderValue(headers, 'content-length'));
      if (contentLength !== null && contentLength > maxBytes) {
        res.resume();
        throw createError(ERROR_CODES.TOO_BIG, 'Thumbnail excede o limite permitido.', {
          endpoint: currentEndpoint,
          status,
          bytes: contentLength,
        });
      }

      return readResponseBuffer(res, {
        maxBytes,
        tooBigMessage: 'Thumbnail excede o limite permitido.',
      });
    },
  });

const httpClient = {
  request: httpRequest,
  requestJson,
  requestBuffer,
};

const isTransientError = (error) => {
  if (!error) return false;
  if (error.code === ERROR_CODES.TIMEOUT) return true;

  const status = toNumberOrNull(error?.meta?.status);
  if (status !== null && TRANSIENT_HTTP_STATUSES.has(status)) return true;

  const rawCode = String(error?.meta?.rawCode || error?.code || '').toUpperCase();
  return TRANSIENT_NETWORK_CODES.has(rawCode);
};

const retryAsync = async (operation, { retries = 0, shouldRetry = () => false, onRetry } = {}) => {
  let attempt = 0;

  while (true) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error)) {
        throw error;
      }

      attempt += 1;
      if (typeof onRetry === 'function') {
        onRetry(error, attempt);
      }
      await delay(200 * attempt);
    }
  }
};

const searchCache = new Map();

const pruneSearchCache = () => {
  const now = Date.now();
  for (const [key, entry] of searchCache) {
    if (!entry || entry.expiresAt <= now) {
      searchCache.delete(key);
    }
  }

  if (searchCache.size <= MAX_SEARCH_CACHE_ENTRIES) {
    return;
  }

  const ordered = [...searchCache.entries()].sort((a, b) => (a[1]?.createdAt || 0) - (b[1]?.createdAt || 0));
  const toRemove = searchCache.size - MAX_SEARCH_CACHE_ENTRIES;
  for (let i = 0; i < toRemove; i += 1) {
    searchCache.delete(ordered[i][0]);
  }
};

const getSearchCache = (queryKey) => {
  const entry = searchCache.get(queryKey);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    searchCache.delete(queryKey);
    return null;
  }
  return entry.value;
};

const setSearchCache = (queryKey, value) => {
  const now = Date.now();
  searchCache.set(queryKey, {
    value,
    createdAt: now,
    expiresAt: now + SEARCH_CACHE_TTL_MS,
  });
  pruneSearchCache();
};

const buildYtdlsUrl = (endpoint, queryParams = null) => {
  const url = new URL(`${YTDLS_BASE_URL}${endpoint}`);
  if (queryParams && typeof queryParams === 'object') {
    for (const [key, value] of Object.entries(queryParams)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
};

const fetchSearchResult = async (query) => {
  const normalized = typeof query === 'string' ? query.trim() : '';
  if (!normalized) {
    throw createError(ERROR_CODES.INVALID_INPUT, 'Você precisa informar um link do YouTube ou termo de busca.', { endpoint: YTDLS_ENDPOINTS.search });
  }

  const cacheKey = normalized.toLowerCase();
  const cached = getSearchCache(cacheKey);
  if (cached) {
    return cached;
  }

  const endpoint = YTDLS_ENDPOINTS.search;
  const url = buildYtdlsUrl(endpoint, { q: normalized });

  const result = await retryAsync(
    async () => {
      const payload = await httpClient.requestJson({
        method: 'GET',
        url,
        endpoint,
      });

      if (!payload?.sucesso) {
        throw createError(ERROR_CODES.API, payload?.mensagem || 'Não foi possível buscar o vídeo agora.', { endpoint });
      }

      return payload;
    },
    {
      retries: 1,
      shouldRetry: isTransientError,
      onRetry: (error, attempt) => {
        logger.warn('Play busca: retry acionado.', {
          endpoint,
          attempt,
          code: error?.code,
          status: error?.meta?.status || null,
        });
      },
    },
  );

  setSearchCache(cacheKey, result);
  return result;
};

const resolveYoutubeLink = async (query) => {
  const normalized = query ? query.trim() : '';

  if (!normalized) {
    throw createError(ERROR_CODES.INVALID_INPUT, 'Você precisa informar um link do YouTube ou termo de busca.', { endpoint: YTDLS_ENDPOINTS.search });
  }

  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  const searchResult = await fetchSearchResult(normalized);
  if (!searchResult?.resultado?.url) {
    throw createError(ERROR_CODES.NOT_FOUND, 'Nenhum resultado encontrado para a busca.', {
      endpoint: YTDLS_ENDPOINTS.search,
    });
  }

  return searchResult.resultado.url;
};

const fetchVideoInfo = async (query, fallback) => {
  const tryQuery = async (value) => {
    if (!value) return null;
    try {
      const result = await fetchSearchResult(value);
      if (!result?.sucesso || !result?.resultado) return null;
      return result.resultado;
    } catch {
      return null;
    }
  };

  const first = await tryQuery(query);
  if (first) return first;

  const normalizedQuery = typeof query === 'string' ? query.trim().toLowerCase() : '';
  const normalizedFallback = typeof fallback === 'string' ? fallback.trim().toLowerCase() : '';
  if (normalizedFallback && normalizedFallback !== normalizedQuery) {
    return tryQuery(fallback);
  }

  return null;
};

const fetchQueueStatus = async (requestId) => {
  if (!requestId) return null;

  const endpointBase = YTDLS_ENDPOINTS.queueStatus;
  const endpointFull = `${endpointBase}/${encodeURIComponent(requestId)}`;
  const url = buildYtdlsUrl(endpointFull);

  try {
    const result = await httpClient.requestJson({
      method: 'GET',
      url,
      endpoint: endpointFull,
      timeoutMs: QUEUE_STATUS_TIMEOUT_MS,
    });
    if (!result?.sucesso || !result?.fila) return null;
    return result;
  } catch {
    return null;
  }
};

const requestDownloadToFile = async (link, type, requestId) => {
  const endpoint = YTDLS_ENDPOINTS.download;
  const url = buildYtdlsUrl(endpoint);
  const filePath = buildTempFilePath(requestId, type);
  const fallbackMime = type === 'audio' ? 'audio/mpeg' : 'video/mp4';
  let writeStream = null;

  try {
    return await httpClient.request({
      method: 'POST',
      url,
      endpoint,
      timeoutMs: DOWNLOAD_API_TIMEOUT_MS,
      headers: { Accept: '*/*', 'Content-Type': 'application/json' },
      body: { link, type, request_id: requestId },
      timeoutMessage: 'Timeout ao baixar o arquivo.',
      fallbackMessage: 'Falha ao comunicar com a API yt-dls.',
      onResponse: async ({ res, status, headers, endpoint: currentEndpoint }) => {
        const contentType = getHeaderValue(headers, 'content-type') || '';
        const safeMimeType = resolveMediaMimeType(type, contentType);
        const normalizedContentType = normalizeMimeType(contentType);
        const contentLength = toNumberOrNull(getHeaderValue(headers, 'content-length'));

        if (normalizedContentType && normalizedContentType !== safeMimeType) {
          logger.warn('Play download: content-type incompatível com tipo solicitado.', {
            requestId,
            type,
            endpoint: currentEndpoint,
            originalContentType: normalizedContentType,
            appliedContentType: safeMimeType,
          });
        }

        if (contentLength !== null && contentLength > MAX_MEDIA_BYTES) {
          res.resume();
          throw createError(ERROR_CODES.TOO_BIG, `O arquivo excede o limite permitido de ${MAX_MEDIA_MB_LABEL} MB.`, {
            endpoint: currentEndpoint,
            status,
            bytes: contentLength,
          });
        }

        if (status < 200 || status >= 300) {
          const raw = await readResponseText(res);
          throw buildApiErrorFromResponse({
            status,
            bodyText: raw,
            defaultMessage: `Falha na API yt-dls (HTTP ${status}).`,
            endpoint: currentEndpoint,
          });
        }

        writeStream = fs.createWriteStream(filePath);
        const limiter = createByteLimitTransform(MAX_MEDIA_BYTES, `O arquivo excede o limite permitido de ${MAX_MEDIA_MB_LABEL} MB.`);

        try {
          await pipeline(res, limiter.stream, writeStream);
        } catch (error) {
          throw normalizeRequestError(error, {
            timeoutMessage: 'Timeout ao baixar o arquivo.',
            fallbackMessage: 'Falha ao receber o arquivo da API yt-dls.',
          });
        }

        let finalBytes = limiter.getBytes();
        let finalMimeType = safeMimeType || fallbackMime;
        let finalMediaType = type;

        if (type === 'video') {
          const streamInfo = await probeVideoStreams(filePath, requestId, currentEndpoint);

          if (!streamInfo.hasVideo) {
            if (streamInfo.hasAudio) {
              finalMediaType = 'audio';
              finalMimeType = normalizedContentType === 'video/mp4' ? 'audio/mp4' : resolveMediaMimeType('audio', contentType);

              logger.warn('Play vídeo: fonte retornou somente áudio, fallback ativado.', {
                requestId,
                endpoint: currentEndpoint,
                status,
                bytes: finalBytes,
                audioCodec: streamInfo.audioCodec || null,
              });
            } else {
              throw createError(ERROR_CODES.API, 'Não foi possível enviar como vídeo: a mídia não possui faixa de vídeo nem áudio.', {
                endpoint: currentEndpoint,
                status,
                requestId,
                hasAudio: streamInfo.hasAudio,
                videoCodec: streamInfo.videoCodec,
                audioCodec: streamInfo.audioCodec,
              });
            }
          }

          if (finalMediaType === 'video') {
            if (VIDEO_FORCE_TRANSCODE || streamInfo.videoCodec !== 'h264' || (streamInfo.hasAudio && streamInfo.audioCodec !== 'aac')) {
              finalBytes = await transcodeVideoForWhatsapp(filePath, requestId, currentEndpoint);
              finalMimeType = TYPE_CONFIG.video.mimeFallback;
              logger.info('Play vídeo normalizado para compatibilidade.', {
                requestId,
                endpoint: currentEndpoint,
                originalVideoCodec: streamInfo.videoCodec || null,
                originalAudioCodec: streamInfo.audioCodec || null,
                bytes: finalBytes,
              });
            } else {
              finalMimeType = TYPE_CONFIG.video.mimeFallback;
            }
          }
        }

        return {
          filePath,
          contentType: finalMimeType,
          bytes: finalBytes,
          mediaType: finalMediaType,
        };
      },
    });
  } catch (error) {
    if (writeStream) {
      writeStream.destroy();
    }
    const normalized =
      KNOWN_ERROR_CODES.has(error?.code) && error?.message
        ? error
        : normalizeRequestError(error, {
            timeoutMessage: 'Timeout ao baixar o arquivo.',
            fallbackMessage: 'Falha ao baixar o arquivo.',
          });
    throw withErrorMeta(normalized, { endpoint, filePath });
  }
};

const fetchThumbnailBuffer = async (url) =>
  retryAsync(
    () =>
      httpClient.requestBuffer({
        url,
        timeoutMs: THUMBNAIL_TIMEOUT_MS,
        maxBytes: MAX_THUMB_BYTES,
        endpoint: YTDLS_ENDPOINTS.thumbnail,
      }),
    {
      retries: 1,
      shouldRetry: isTransientError,
      onRetry: (error, attempt) => {
        logger.warn('Play thumbnail: retry acionado.', {
          endpoint: YTDLS_ENDPOINTS.thumbnail,
          attempt,
          code: error?.code,
          status: error?.meta?.status || null,
        });
      },
    },
  );

const ytdlsClient = {
  resolveYoutubeLink,
  fetchVideoInfo,
  fetchQueueStatus,
  requestDownloadToFile,
  fetchThumbnailBuffer,
};

const formatters = {
  formatNumber,
  formatDuration,
  formatVideoInfo,
  getThumbnailUrl,
  buildQueueStatusText,
  buildReadyCaption,
};

const fileUtils = {
  buildTempFilePath,
  safeUnlink,
};

const buildRequestId = () => {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const getUserErrorMessage = (error) => {
  if (!error) return 'Erro inesperado ao processar sua solicitação.';
  if (KNOWN_ERROR_CODES.has(error?.code) && error?.message) return error.message;
  return 'Erro inesperado ao processar sua solicitação.';
};

const notifyFailure = async (sock, remoteJid, messageInfo, expirationMessage, error, context) => {
  const errorMessage = getUserErrorMessage(error);

  await sendAndStore(sock, remoteJid, { text: `❌ Erro: ${errorMessage}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });

  if (adminJid) {
    await sendAndStore(sock, adminJid, {
      text: `Erro no módulo play.\nChat: ${remoteJid}\nRequest: ${context?.requestId || 'n/a'}\nTipo: ${context?.type || 'n/a'}\nEndpoint: ${error?.meta?.endpoint || 'n/a'}\nStatus: ${error?.meta?.status || 'n/a'}\nErro: ${errorMessage}\nCode: ${error?.code || 'n/a'}`,
    });
  }
};

const processPlayRequest = async ({ sock, remoteJid, messageInfo, expirationMessage, text, type }) => {
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

  let filePath = null;

  try {
    const link = await ytdlsClient.resolveYoutubeLink(text);

    const queueStatusPromise = ytdlsClient.fetchQueueStatus(requestId);
    const queueStatus = await Promise.race([queueStatusPromise, delay(QUICK_QUEUE_LOOKUP_MS)]);
    const queueText = formatters.buildQueueStatusText(queueStatus);
    const waitText = queueText ? `${config.queueWaitText || config.waitText}\n${queueText}` : config.waitText;

    await sendAndStore(sock, remoteJid, { text: waitText }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });

    if (queueStatus?.fila) {
      logger.info('Play fila consultada.', {
        requestId,
        remoteJid,
        type,
        endpoint: YTDLS_ENDPOINTS.queueStatus,
        elapsedMs: Date.now() - startTime,
        queue: queueStatus.fila,
      });
    }

    const [downloadResult, videoInfo] = await Promise.all([ytdlsClient.requestDownloadToFile(link, type, requestId), ytdlsClient.fetchVideoInfo(text, link)]);

    filePath = downloadResult.filePath;
    const deliveredType = downloadResult.mediaType || type;
    const deliveredConfig = TYPE_CONFIG[deliveredType] || config;
    const fallbackToAudio = type === 'video' && deliveredType === 'audio';

    logger.info('Play download concluído.', {
      requestId,
      remoteJid,
      type,
      deliveredType,
      fallbackToAudio,
      endpoint: YTDLS_ENDPOINTS.download,
      elapsedMs: Date.now() - startTime,
      bytes: downloadResult.bytes || 0,
    });

    if (fallbackToAudio) {
      await sendAndStore(sock, remoteJid, { text: '⚠️ Este link retornou somente áudio. Enviando no formato de áudio.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
    }

    if (deliveredType === 'audio') {
      const infoText = formatters.formatVideoInfo(videoInfo);
      const caption = formatters.buildReadyCaption(deliveredType, infoText);
      const thumbUrl = formatters.getThumbnailUrl(videoInfo);
      let thumbBuffer = null;
      let previewDelivered = false;

      if (thumbUrl) {
        try {
          thumbBuffer = await ytdlsClient.fetchThumbnailBuffer(thumbUrl);
        } catch (error) {
          logger.warn('Falha ao baixar thumbnail.', {
            requestId,
            remoteJid,
            type: deliveredType,
            requestedType: type,
            endpoint: error?.meta?.endpoint || YTDLS_ENDPOINTS.thumbnail,
            status: error?.meta?.status || null,
            code: error?.code,
            error: truncateText(error?.message || ''),
            elapsedMs: Date.now() - startTime,
          });
        }
      }

      if (thumbBuffer) {
        try {
          await sendAndStore(sock, remoteJid, { image: thumbBuffer, caption }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
          previewDelivered = true;
        } catch (error) {
          logger.warn('Falha ao enviar thumbnail de áudio.', {
            requestId,
            remoteJid,
            type: deliveredType,
            requestedType: type,
            code: error?.code || null,
            error: truncateText(error?.message || ''),
            elapsedMs: Date.now() - startTime,
          });
        }
      }

      if (!previewDelivered && caption) {
        try {
          await sendAndStore(sock, remoteJid, { text: caption }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
          previewDelivered = true;
        } catch (error) {
          logger.warn('Falha ao enviar preview textual do áudio.', {
            requestId,
            remoteJid,
            type: deliveredType,
            requestedType: type,
            code: error?.code || null,
            error: truncateText(error?.message || ''),
            elapsedMs: Date.now() - startTime,
          });
        }
      }

      await sendAndStore(
        sock,
        remoteJid,
        {
          audio: { url: filePath },
          mimetype: downloadResult.contentType || deliveredConfig.mimeFallback,
          ptt: false,
        },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );

      logger.info('Play áudio enviado.', {
        requestId,
        remoteJid,
        type: deliveredType,
        requestedType: type,
        fallbackToAudio,
        bytes: downloadResult.bytes || 0,
        elapsedMs: Date.now() - startTime,
      });

      return;
    }

    const infoText = formatters.formatVideoInfo(videoInfo);
    const caption = formatters.buildReadyCaption(deliveredType, infoText);

    await sendAndStore(
      sock,
      remoteJid,
      {
        video: { url: filePath },
        mimetype: downloadResult.contentType || deliveredConfig.mimeFallback,
        caption,
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );

    logger.info('Play vídeo enviado.', {
      requestId,
      remoteJid,
      type: deliveredType,
      requestedType: type,
      bytes: downloadResult.bytes || 0,
      elapsedMs: Date.now() - startTime,
    });
  } catch (error) {
    if (!filePath && error?.meta?.filePath) {
      filePath = error.meta.filePath;
    }

    const normalizedError = withErrorMeta(normalizePlayError(error), {
      requestId,
      remoteJid,
      type,
    });

    logger.error('Play falhou.', {
      requestId,
      remoteJid,
      type,
      endpoint: normalizedError?.meta?.endpoint || null,
      status: normalizedError?.meta?.status || null,
      elapsedMs: Date.now() - startTime,
      error: truncateText(normalizedError.message || ''),
      code: normalizedError.code,
    });

    throw normalizedError;
  } finally {
    await fileUtils.safeUnlink(filePath);
  }
};

const playService = {
  processPlayRequest,
};

const handleTypedPlayCommand = async ({ sock, remoteJid, messageInfo, expirationMessage, text, commandPrefix, type }) => {
  try {
    if (!text?.trim()) {
      const usageText = type === 'audio' ? `🎵 Uso: ${commandPrefix}play <link do YouTube ou termo de busca>` : `🎬 Uso: ${commandPrefix}playvid <link do YouTube ou termo de busca>`;

      await sendAndStore(sock, remoteJid, { text: usageText }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      return;
    }

    await playService.processPlayRequest({
      sock,
      remoteJid,
      messageInfo,
      expirationMessage,
      text,
      type,
    });
  } catch (error) {
    await notifyFailure(sock, remoteJid, messageInfo, expirationMessage, error, {
      type,
      requestId: error?.meta?.requestId,
    });
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
export const handlePlayCommand = async (sock, remoteJid, messageInfo, expirationMessage, text, commandPrefix = DEFAULT_COMMAND_PREFIX) =>
  handleTypedPlayCommand({
    sock,
    remoteJid,
    messageInfo,
    expirationMessage,
    text,
    commandPrefix,
    type: 'audio',
  });

/**
 * Handler do comando playvid (video).
 * @param {object} sock
 * @param {string} remoteJid
 * @param {object} messageInfo
 * @param {number} expirationMessage
 * @param {string} text
 * @returns {Promise<void>}
 */
export const handlePlayVidCommand = async (sock, remoteJid, messageInfo, expirationMessage, text, commandPrefix = DEFAULT_COMMAND_PREFIX) =>
  handleTypedPlayCommand({
    sock,
    remoteJid,
    messageInfo,
    expirationMessage,
    text,
    commandPrefix,
    type: 'video',
  });
