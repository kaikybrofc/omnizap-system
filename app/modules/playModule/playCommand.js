import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs/promises';
import path from 'node:path';
import { URL } from 'node:url';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import logger from '../../utils/logger/loggerModule.js';

const adminJid = process.env.USER_ADMIN;
const COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';
const YTDLS_BASE_URL = (process.env.YTDLS_BASE_URL || process.env.YT_DLS_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const DEFAULT_TIMEOUT_MS = 60000;
const MAX_MEDIA_MB = Number.parseInt(process.env.PLAY_MAX_MB || '40', 10);
const MAX_MEDIA_BYTES = Number.isFinite(MAX_MEDIA_MB) ? MAX_MEDIA_MB * 1024 * 1024 : 40 * 1024 * 1024;
const CONVERT_TIMEOUT_MS = 300000;
const TEMP_DIR = path.join(process.cwd(), 'temp', 'play');
const execProm = promisify(exec);

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
        res.on('end', () => {
          const contentType = res.headers['content-type'] || '';
          const disposition = res.headers['content-disposition'] || '';
          const fileNameMatch = /filename="([^"]+)"/i.exec(disposition);
          const fileName = fileNameMatch ? fileNameMatch[1] : '';
          resolve({ buffer: Buffer.concat(chunks), contentType, fileName });
        });
      },
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Timeout ao baixar o arquivo.'));
    });
    req.end();
  });

const ensureTempDir = async () => {
  await fs.mkdir(TEMP_DIR, { recursive: true });
};

const getExtensionFromType = (contentType) => {
  const lower = (contentType || '').toLowerCase();
  if (lower.includes('audio/mpeg') || lower.includes('audio/mp3')) return '.mp3';
  if (lower.includes('audio/mp4') || lower.includes('audio/x-m4a')) return '.m4a';
  if (lower.includes('audio/ogg')) return '.ogg';
  if (lower.includes('audio/aac')) return '.aac';
  if (lower.includes('video/mp4')) return '.mp4';
  if (lower.includes('video/webm')) return '.webm';
  if (lower.includes('video/quicktime')) return '.mov';
  return '.bin';
};

const writeTempFile = async (buffer, ext) => {
  await ensureTempDir();
  const safeExt = ext && ext.startsWith('.') ? ext : '.bin';
  const fileName = `input_${Date.now()}_${Math.random().toString(16).slice(2)}${safeExt}`;
  const filePath = path.join(TEMP_DIR, fileName);
  await fs.writeFile(filePath, buffer);
  return filePath;
};

const readAndValidateOutput = async (filePath) => {
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_MEDIA_BYTES) {
    throw new Error('Arquivo convertido excede o limite de tamanho permitido.');
  }
  return fs.readFile(filePath);
};

const convertToMp3Buffer = async (buffer, contentType, fileName) => {
  const ext = fileName ? path.extname(fileName).toLowerCase() : getExtensionFromType(contentType);
  const inputPath = await writeTempFile(buffer, ext);
  const outputPath = path.join(TEMP_DIR, `audio_${Date.now()}_${Math.random().toString(16).slice(2)}.mp3`);
  try {
    const cmd = `ffmpeg -y -i "${inputPath}" -vn -acodec libmp3lame -b:a 128k -ar 44100 -ac 2 "${outputPath}"`;
    await execProm(cmd, { timeout: CONVERT_TIMEOUT_MS });
    return await readAndValidateOutput(outputPath);
  } catch (error) {
    logger.error('Erro ao converter audio:', error);
    throw new Error('Falha ao converter audio para MP3.');
  } finally {
    await Promise.allSettled([fs.unlink(inputPath), fs.unlink(outputPath)]);
  }
};

const convertToMp4Buffer = async (buffer, contentType, fileName) => {
  const ext = fileName ? path.extname(fileName).toLowerCase() : getExtensionFromType(contentType);
  const inputPath = await writeTempFile(buffer, ext);
  const outputPath = path.join(TEMP_DIR, `video_${Date.now()}_${Math.random().toString(16).slice(2)}.mp4`);
  try {
    const cmd =
      `ffmpeg -y -i "${inputPath}" -vf "scale='min(1280,iw)':-2" -preset veryfast -crf 28 ` +
      `-c:v libx264 -profile:v baseline -level 3.1 -pix_fmt yuv420p -c:a aac -b:a 128k ` +
      `-movflags +faststart "${outputPath}"`;
    await execProm(cmd, { timeout: CONVERT_TIMEOUT_MS });
    return await readAndValidateOutput(outputPath);
  } catch (error) {
    logger.error('Erro ao converter video:', error?.stderr || error);
    throw new Error('Falha ao converter video para MP4.');
  } finally {
    await Promise.allSettled([fs.unlink(inputPath), fs.unlink(outputPath)]);
  }
};

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

const formatVideoInfo = (videoInfo) => {
  if (!videoInfo || typeof videoInfo !== 'object') return null;
  const lines = [];
  if (videoInfo.title) lines.push(`Titulo: ${videoInfo.title}`);
  if (videoInfo.uploader) lines.push(`Canal: ${videoInfo.uploader}`);
  if (videoInfo.channel) lines.push(`Canal: ${videoInfo.channel}`);
  if (videoInfo.views) lines.push(`Views: ${Number(videoInfo.views).toLocaleString('pt-BR')}`);
  if (videoInfo.like_count) lines.push(`Likes: ${Number(videoInfo.like_count).toLocaleString('pt-BR')}`);
  if (videoInfo.duration) lines.push(`Duracao: ${videoInfo.duration}s`);
  if (videoInfo.id) lines.push(`ID: ${videoInfo.id}`);
  return lines.length ? lines.join('\n') : null;
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

    await sock.sendMessage(
      remoteJid,
      { text: 'Aguarde, estamos baixando o audio...' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );

    const link = await resolveYoutubeLink(text);
    const { streamUrl, videoInfo } = await requestDownload(link, 'audio');
    const { buffer: audioBuffer, contentType, fileName } = await downloadBinary(streamUrl);
    const convertedAudio = await convertToMp3Buffer(audioBuffer, contentType, fileName);
    const infoText = formatVideoInfo(videoInfo) || 'Informacoes do audio indisponiveis.';
    const infoMessage = await sock.sendMessage(
      remoteJid,
      { text: infoText },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    const quotedInfo = infoMessage?.message ? infoMessage : messageInfo;

    await sock.sendMessage(
      remoteJid,
      {
        audio: convertedAudio,
        mimetype: 'audio/mpeg',
        ptt: false,
      },
      { quoted: quotedInfo, ephemeralExpiration: expirationMessage },
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

    await sock.sendMessage(
      remoteJid,
      { text: 'Aguarde, estamos baixando o video...' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );

    const link = await resolveYoutubeLink(text);
    const { streamUrl, videoInfo } = await requestDownload(link, 'video');
    const { buffer: videoBuffer, contentType, fileName } = await downloadBinary(streamUrl);
    const convertedVideo = await convertToMp4Buffer(videoBuffer, contentType, fileName);
    const infoText = formatVideoInfo(videoInfo);
    const caption = infoText ? `Video pronto.\n${infoText}` : 'Video pronto.';
    await sock.sendMessage(
      remoteJid,
      {
        video: convertedVideo,
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
