import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import logger from '../../utils/logger/loggerModule.js';

const adminJid = process.env.USER_ADMIN;
const COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';
const YTDLS_BASE_URL = (process.env.YTDLS_BASE_URL || process.env.YT_DLS_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const DEFAULT_TIMEOUT_MS = 60000;
const MAX_MEDIA_MB = Number.parseInt(process.env.PLAY_MAX_MB || '40', 10);
const MAX_MEDIA_BYTES = Number.isFinite(MAX_MEDIA_MB) ? MAX_MEDIA_MB * 1024 * 1024 : 40 * 1024 * 1024;

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
            reject(new Error(`Falha na API yt-dls (HTTP ${res.statusCode}): ${raw || 'sem resposta'}`));
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

const normalizeStreamUrl = (streamUrl, baseUrl) => {
  if (!streamUrl) return null;
  if (!baseUrl) return streamUrl;
  try {
    const original = new URL(streamUrl, baseUrl);
    const base = new URL(baseUrl);
    original.protocol = base.protocol;
    original.host = base.host;
    return original.toString();
  } catch {
    return streamUrl;
  }
};

const downloadBinary = (url, maxBytes = MAX_MEDIA_BYTES, timeoutMs = DEFAULT_TIMEOUT_MS) =>
  new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const httpModule = urlObj.protocol === 'https:' ? https : http;
    const req = httpModule.request(
      urlObj,
      { method: 'GET', timeout: timeoutMs },
      (res) => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Falha ao baixar o arquivo (HTTP ${res.statusCode}).`));
          res.resume();
          return;
        }

        const contentLength = Number(res.headers['content-length']);
        if (Number.isFinite(contentLength) && contentLength > maxBytes) {
          reject(new Error('Arquivo excede o limite de tamanho permitido.'));
          res.resume();
          return;
        }

        const chunks = [];
        let total = 0;
        res.on('data', (chunk) => {
          total += chunk.length;
          if (total > maxBytes) {
            reject(new Error('Arquivo excede o limite de tamanho permitido.'));
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve(Buffer.concat(chunks)));
      },
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Timeout ao baixar o arquivo.'));
    });
    req.end();
  });

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

const requestDownload = async (link, type) => {
  const downloadUrl = `${YTDLS_BASE_URL}/download`;
  const downloadResult = await requestJson('POST', downloadUrl, { link, type });
  if (!downloadResult?.sucesso) {
    throw new Error(downloadResult?.mensagem || 'Falha ao baixar a midia.');
  }
  const streamUrl = normalizeStreamUrl(downloadResult.stream_url, YTDLS_BASE_URL);
  if (!streamUrl) {
    throw new Error('URL de streaming nao retornada pela API.');
  }
  return { streamUrl, videoInfo: downloadResult.video_info };
};

const notifyFailure = async (sock, remoteJid, messageInfo, expirationMessage, error) => {
  const errorMessage = error?.message || 'Erro inesperado ao processar sua solicitacao.';
  await sock.sendMessage(
    remoteJid,
    { text: `❌ ${errorMessage}` },
    { quoted: messageInfo, ephemeralExpiration: expirationMessage },
  );

  if (adminJid) {
    await sock.sendMessage(adminJid, {
      text: `Erro no modulo play.\nChat: ${remoteJid}\nErro: ${errorMessage}`,
    });
  }
};

export const handlePlayCommand = async (sock, remoteJid, messageInfo, expirationMessage, text) => {
  try {
    if (!text?.trim()) {
      await sock.sendMessage(
        remoteJid,
        { text: `Uso: ${COMMAND_PREFIX}play <link do YouTube ou termo de busca>` },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      return;
    }

    const link = await resolveYoutubeLink(text);
    const { streamUrl, videoInfo } = await requestDownload(link, 'audio');
    const audioBuffer = await downloadBinary(streamUrl);
    const title = videoInfo?.title ? `Audio: ${videoInfo.title}` : null;
    if (title) {
      await sock.sendMessage(
        remoteJid,
        { text: title },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
    }

    await sock.sendMessage(
      remoteJid,
      {
        audio: audioBuffer,
        mimetype: 'audio/mpeg',
        ptt: false,
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );

  } catch (error) {
    logger.error('Erro ao processar comando /play:', error);
    await notifyFailure(sock, remoteJid, messageInfo, expirationMessage, error);
  }
};

export const handlePlayVidCommand = async (sock, remoteJid, messageInfo, expirationMessage, text) => {
  try {
    if (!text?.trim()) {
      await sock.sendMessage(
        remoteJid,
        { text: `Uso: ${COMMAND_PREFIX}playvid <link do YouTube ou termo de busca>` },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      return;
    }

    const link = await resolveYoutubeLink(text);
    const { streamUrl, videoInfo } = await requestDownload(link, 'video');
    const videoBuffer = await downloadBinary(streamUrl);
    const caption = videoInfo?.title ? `Video: ${videoInfo.title}` : 'Video pronto.';

    await sock.sendMessage(
      remoteJid,
      {
        video: videoBuffer,
        mimetype: 'video/mp4',
        caption,
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );

  } catch (error) {
    logger.error('Erro ao processar comando /playvid:', error);
    await notifyFailure(sock, remoteJid, messageInfo, expirationMessage, error);
  }
};
