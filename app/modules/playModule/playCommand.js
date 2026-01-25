import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import crypto from 'node:crypto';
import logger from '../../utils/logger/loggerModule.js';

const adminJid = process.env.USER_ADMIN;
const COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';
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
const QUEUE_STATUS_TIMEOUT_MS = Number.parseInt(
  process.env.PLAY_QUEUE_STATUS_TIMEOUT_MS || '8000',
  10,
);

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

    const req = httpModule.request(
      urlObj,
      {
        method,
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(
              new Error(`Falha na API yt-dls (HTTP ${res.statusCode}): ${raw || 'sem resposta'}`),
            );
            return;
          }
          try {
            resolve(raw ? JSON.parse(raw) : {});
          } catch (error) {
            reject(new Error('Resposta invalida da API yt-dls.'));
          }
        });
      },
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Timeout ao comunicar com a API yt-dls.'));
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
    throw new Error('Voce precisa informar um link ou termo de busca.');
  }

  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  const searchUrl = `${YTDLS_BASE_URL}/search?q=${encodeURIComponent(normalized)}`;
  const searchResult = await requestJson('GET', searchUrl);
  if (!searchResult?.sucesso) {
    throw new Error(searchResult?.mensagem || 'Nao foi possivel buscar o video.');
  }
  if (!searchResult?.resultado?.url) {
    throw new Error('Nenhum resultado encontrado para a busca.');
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
  if (videoInfo.title) lines.push(`🎵 Titulo: ${videoInfo.title}`);
  if (videoInfo.channel) lines.push(`👤 Canal: ${videoInfo.channel}`);
  if (videoInfo.views) lines.push(`👁️ Views: ${Number(videoInfo.views).toLocaleString('pt-BR')}`);
  if (videoInfo.like_count)
    lines.push(`👍 Likes: ${Number(videoInfo.like_count).toLocaleString('pt-BR')}`);
  if (videoInfo.duration) lines.push(`⏱️ Duracao: ${videoInfo.duration}s`);
  if (videoInfo.id) lines.push(`🆔 ID: ${videoInfo.id}`);
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

  const downloadsAhead = Number.isFinite(fila.downloads_a_frente) ? fila.downloads_a_frente : null;

  const position = Number.isFinite(fila.posicao_na_fila) ? fila.posicao_na_fila : null;

  const totalQueued = Number.isFinite(fila.enfileirados) ? fila.enfileirados : null;

  if (downloadsAhead === null && position === null && totalQueued === null) {
    return null;
  }

  const lines = [];

  if (position !== null) {
    lines.push(`\n📍 Você está na *posição ${position}*`);
  }

  if (downloadsAhead !== null) {
    lines.push(`\n🚀 Existem *${downloadsAhead} download(s)* à sua frente`);
  }

  if (totalQueued !== null) {
    lines.push(`📦 Total na fila: *${totalQueued}*\n`);
  }

  return lines.join('\n');
};

/**
 * Faz o download direto na API yt-dls e retorna o buffer.
 * @param {string} link
 * @param {'audio'|'video'} type
 * @param {string} requestId
 * @returns {Promise<{buffer: Buffer, contentType: string}>}
 */
const requestDownloadBuffer = (link, type, requestId) =>
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

    const req = httpModule.request(
      urlObj,
      {
        method: 'POST',
        headers,
        timeout: DOWNLOAD_API_TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode || 0;
        const contentType = res.headers['content-type'] || '';
        const contentLength = Number(res.headers['content-length']);

        if (Number.isFinite(contentLength) && contentLength > MAX_MEDIA_BYTES) {
          req.destroy(new Error('Arquivo excede o limite de tamanho permitido.'));
          res.resume();
          return;
        }

        if (status < 200 || status >= 300) {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf-8');
            try {
              const parsed = raw ? JSON.parse(raw) : null;
              reject(new Error(parsed?.mensagem || `Falha na API yt-dls (HTTP ${status}).`));
            } catch {
              reject(new Error(`Falha na API yt-dls (HTTP ${status}).`));
            }
          });
          return;
        }

        const chunks = [];
        let total = 0;
        res.on('data', (chunk) => {
          total += chunk.length;
          if (total > MAX_MEDIA_BYTES) {
            req.destroy(new Error('Arquivo excede o limite de tamanho permitido.'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          resolve({
            buffer: Buffer.concat(chunks),
            contentType: contentType || (type === 'audio' ? 'audio/mpeg' : 'video/mp4'),
          });
        });
      },
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Timeout ao comunicar com a API yt-dls.'));
    });

    req.write(payload);
    req.end();
  });

/**
 * Notifica o usuario e o admin sobre falhas do comando.
 * @param {object} sock
 * @param {string} remoteJid
 * @param {object} messageInfo
 * @param {number} expirationMessage
 * @param {Error} error
 * @returns {Promise<void>}
 */
const notifyFailure = async (sock, remoteJid, messageInfo, expirationMessage, error) => {
  const errorMessage = error?.message || 'Erro inesperado ao processar sua solicitacao.';
  await sock.sendMessage(
    remoteJid,
    { text: `❌ Erro: ${errorMessage}` },
    { quoted: messageInfo, ephemeralExpiration: expirationMessage },
  );

  if (adminJid) {
    await sock.sendMessage(adminJid, {
      text: `Erro no modulo play.\nChat: ${remoteJid}\nErro: ${errorMessage}`,
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
export const handlePlayCommand = async (sock, remoteJid, messageInfo, expirationMessage, text) => {
  try {
    if (!text?.trim()) {
      await sock.sendMessage(
        remoteJid,
        { text: `🎵 Uso: ${COMMAND_PREFIX}play <link do YouTube ou termo de busca>` },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      return;
    }

    const link = await resolveYoutubeLink(text);
    const requestId = buildRequestId();
    const downloadPromise = requestDownloadBuffer(link, 'audio', requestId);
    const queueStatus = await fetchQueueStatus(requestId);
    const queueText = buildQueueStatusText(queueStatus);
    const waitText = queueText
      ? `⏳ Aguarde, estamos preparando o audio... ${queueText}`
      : '⏳ Aguarde, estamos preparando o audio...';
    await sock.sendMessage(
      remoteJid,
      { text: waitText },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );

    const [downloadResult, videoInfo] = await Promise.all([
      downloadPromise,
      fetchVideoInfo(text, link),
    ]);
    const { buffer: convertedAudio, contentType } = downloadResult;
    const infoText = formatVideoInfo(videoInfo);
    if (infoText) {
      await sock.sendMessage(
        remoteJid,
        { text: infoText },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
    }

    await sock.sendMessage(
      remoteJid,
      {
        audio: convertedAudio,
        mimetype: contentType || 'audio/mpeg',
        ptt: false,
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  } catch (error) {
    logger.error('Erro ao processar comando /play:', error);
    await notifyFailure(sock, remoteJid, messageInfo, expirationMessage, error);
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
) => {
  try {
    if (!text?.trim()) {
      await sock.sendMessage(
        remoteJid,
        { text: `🎬 Uso: ${COMMAND_PREFIX}playvid <link do YouTube ou termo de busca>` },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      return;
    }

    const link = await resolveYoutubeLink(text);
    const requestId = buildRequestId();
    const downloadPromise = requestDownloadBuffer(link, 'video', requestId);
    const queueStatus = await fetchQueueStatus(requestId);
    const queueText = buildQueueStatusText(queueStatus);
    const waitText = queueText
      ? `⏳ Aguarde, estamos preparando o video... ${queueText}`
      : '⏳ Aguarde, estamos preparando o video...';
    await sock.sendMessage(
      remoteJid,
      { text: waitText },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );

    const [downloadResult, videoInfo] = await Promise.all([
      downloadPromise,
      fetchVideoInfo(text, link),
    ]);
    const { buffer: convertedVideo, contentType } = downloadResult;
    const infoText = formatVideoInfo(videoInfo);
    const caption = infoText ? `🎬 Video pronto!\n${infoText}` : '🎬 Video pronto!';

    await sock.sendMessage(
      remoteJid,
      {
        video: convertedVideo,
        mimetype: contentType || 'video/mp4',
        caption,
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  } catch (error) {
    logger.error('Erro ao processar comando /playvid:', error);
    await notifyFailure(sock, remoteJid, messageInfo, expirationMessage, error);
  }
};
