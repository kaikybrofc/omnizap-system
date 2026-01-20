import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import logger from '../../utils/logger/loggerModule.js';

const adminJid = process.env.USER_ADMIN;
const COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';
const YTDLS_BASE_URL = (process.env.YTDLS_BASE_URL || process.env.YT_DLS_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const DEFAULT_TIMEOUT_MS = 60000;
const MAX_MEDIA_MB = Number.parseInt(process.env.PLAY_MAX_MB || '100', 10);
const MAX_MEDIA_BYTES = Number.isFinite(MAX_MEDIA_MB) ? MAX_MEDIA_MB * 1024 * 1024 : 100 * 1024 * 1024;
const CONVERT_TIMEOUT_MS = 300000;
const TEMP_DIR = path.join(process.cwd(), 'temp', 'play');
const REQUESTS_DIR = path.join(TEMP_DIR, 'requests');
const CACHE_TTL_MIN = Number.parseInt(process.env.PLAY_CACHE_TTL_MIN || '60', 10);
const CACHE_TTL_MS = Number.isFinite(CACHE_TTL_MIN) ? CACHE_TTL_MIN * 60 * 1000 : 60 * 60 * 1000;
const MAX_DOWNLOADS = Number.parseInt(process.env.PLAY_MAX_DOWNLOADS || '2', 10);
const MAX_FFMPEG = Number.parseInt(process.env.PLAY_MAX_FFMPEG || '1', 10);
const CACHE_DIR = path.join(TEMP_DIR, 'cache');
const inFlightCache = new Map();

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

class Semaphore {
  constructor(limit) {
    this.limit = Math.max(1, Number.isFinite(limit) ? limit : 1);
    this.active = 0;
    this.queue = [];
  }

  run(task) {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        this.active += 1;
        try {
          resolve(await task());
        } catch (error) {
          reject(error);
        } finally {
          this.active -= 1;
          const next = this.queue.shift();
          if (next) next();
        }
      };

      if (this.active < this.limit) {
        execute();
      } else {
        this.queue.push(execute);
      }
    });
  }
}

const downloadSemaphore = new Semaphore(MAX_DOWNLOADS);
const ffmpegSemaphore = new Semaphore(MAX_FFMPEG);

const buildRequestId = () => {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const buildCacheKey = (type, link) => {
  const hash = crypto.createHash('sha1');
  hash.update(`${type}:${link}`);
  return hash.digest('hex');
};

const ensureCacheDir = async () => {
  await fs.mkdir(CACHE_DIR, { recursive: true });
};

const readCache = async (cacheKey, type) => {
  if (!CACHE_TTL_MS || CACHE_TTL_MS <= 0) return null;
  await ensureCacheDir();
  const ext = type === 'audio' ? '.mp3' : '.mp4';
  const mediaPath = path.join(CACHE_DIR, `${cacheKey}${ext}`);
  const metaPath = path.join(CACHE_DIR, `${cacheKey}.json`);
  try {
    const metaRaw = await fs.readFile(metaPath, 'utf-8');
    const meta = JSON.parse(metaRaw);
    if (!meta?.createdAt || Date.now() - meta.createdAt > CACHE_TTL_MS) {
      await Promise.allSettled([fs.rm(mediaPath, { force: true }), fs.rm(metaPath, { force: true })]);
      return null;
    }
    const buffer = await fs.readFile(mediaPath);
    return { buffer, videoInfo: meta.videoInfo || null };
  } catch {
    return null;
  }
};

const writeCache = async (cacheKey, type, buffer, videoInfo) => {
  if (!CACHE_TTL_MS || CACHE_TTL_MS <= 0) return;
  await ensureCacheDir();
  const ext = type === 'audio' ? '.mp3' : '.mp4';
  const mediaPath = path.join(CACHE_DIR, `${cacheKey}${ext}`);
  const metaPath = path.join(CACHE_DIR, `${cacheKey}.json`);
  const meta = { createdAt: Date.now(), videoInfo: videoInfo || null };
  await fs.writeFile(mediaPath, buffer);
  await fs.writeFile(metaPath, JSON.stringify(meta));
};

const runFfmpeg = async (args, timeoutMs = CONVERT_TIMEOUT_MS) =>
  new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      proc.kill('SIGKILL');
      const error = new Error('FFmpeg excedeu o tempo limite.');
      error.stderr = stderr;
      reject(error);
    }, timeoutMs);

    proc.stderr.on('data', (chunk) => {
      if (stderr.length < 8000) {
        stderr += chunk.toString();
      }
    });

    proc.on('error', (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(error);
    });

    proc.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        const error = new Error(`FFmpeg saiu com codigo ${code}.`);
        error.stderr = stderr;
        reject(error);
      }
    });
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

const downloadToFile = (url, destinationPath, maxBytes = MAX_MEDIA_BYTES, timeoutMs = DEFAULT_TIMEOUT_MS) =>
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

        const contentType = res.headers['content-type'] || '';
        const disposition = res.headers['content-disposition'] || '';
        const fileNameMatch = /filename="([^"]+)"/i.exec(disposition);
        const fileName = fileNameMatch ? fileNameMatch[1] : '';
        const fileStream = createWriteStream(destinationPath);
        let total = 0;

        res.on('data', (chunk) => {
          total += chunk.length;
          if (total > maxBytes) {
            req.destroy(new Error('Arquivo excede o limite de tamanho permitido.'));
            return;
          }
        });

        res.pipe(fileStream);

        fileStream.on('finish', () => resolve({ contentType, fileName }));
        fileStream.on('error', reject);
      },
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Timeout ao baixar o arquivo.'));
    });
    req.end();
  });

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

const readAndValidateOutput = async (filePath) => {
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_MEDIA_BYTES) {
    throw new Error('Arquivo convertido excede o limite de tamanho permitido.');
  }
  return fs.readFile(filePath);
};

const convertToMp3Buffer = async (inputPath, requestDir) =>
  ffmpegSemaphore.run(async () => {
    const outputPath = path.join(requestDir || TEMP_DIR, `audio_${Date.now()}_${Math.random().toString(16).slice(2)}.mp3`);
    try {
      const args = ['-y', '-i', inputPath, '-vn', '-acodec', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '2', outputPath];
      await runFfmpeg(args);
      return await readAndValidateOutput(outputPath);
    } catch (error) {
      logger.error('Erro ao converter audio:', error?.stderr || error);
      throw new Error('Falha ao converter audio para MP3.');
    } finally {
      await Promise.allSettled([fs.unlink(inputPath), fs.unlink(outputPath)]);
    }
  });

const convertToMp4Buffer = async (inputPath, requestDir) =>
  ffmpegSemaphore.run(async () => {
    const outputPath = path.join(requestDir || TEMP_DIR, `video_${Date.now()}_${Math.random().toString(16).slice(2)}.mp4`);
    try {
      const args = [
        '-y',
        '-i',
        inputPath,
        '-vf',
        "scale='min(1280,iw)':-2",
        '-preset',
        'veryfast',
        '-crf',
        '28',
        '-c:v',
        'libx264',
        '-profile:v',
        'baseline',
        '-level',
        '3.1',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        outputPath,
      ];
      await runFfmpeg(args);
      return await readAndValidateOutput(outputPath);
    } catch (error) {
      logger.error('Erro ao converter video:', error?.stderr || error);
      throw new Error('Falha ao converter video para MP4.');
    } finally {
      await Promise.allSettled([fs.unlink(inputPath), fs.unlink(outputPath)]);
    }
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

const formatVideoInfo = (videoInfo) => {
  if (!videoInfo || typeof videoInfo !== 'object') return null;
  const lines = [];
  if (videoInfo.title) lines.push(`🎵 Titulo: ${videoInfo.title}`);
  if (videoInfo.channel) lines.push(`👤 Canal: ${videoInfo.channel}`);
  if (videoInfo.views) lines.push(`👁️ Views: ${Number(videoInfo.views).toLocaleString('pt-BR')}`);
  if (videoInfo.like_count) lines.push(`👍 Likes: ${Number(videoInfo.like_count).toLocaleString('pt-BR')}`);
  if (videoInfo.duration) lines.push(`⏱️ Duracao: ${videoInfo.duration}s`);
  if (videoInfo.id) lines.push(`🆔 ID: ${videoInfo.id}`);
  return lines.length ? lines.join('\n') : null;
};

const requestDownload = async (link, type, requestId) => {
  const downloadUrl = `${YTDLS_BASE_URL}/download`;
  const downloadResult = await requestJson('POST', downloadUrl, { link, type, request_id: requestId });
  if (!downloadResult?.sucesso) {
    throw new Error(downloadResult?.mensagem || 'Falha ao baixar a midia.');
  }
  const streamUrl = normalizeStreamUrl(downloadResult.stream_url, YTDLS_BASE_URL);
  if (!streamUrl) {
    throw new Error('URL de streaming nao retornada pela API.');
  }
  return { streamUrl, videoInfo: downloadResult.video_info };
};

const fetchMediaWithCache = async (link, type) => {
  const cacheKey = buildCacheKey(type, link);
  const cached = await readCache(cacheKey, type);
  if (cached) {
    return cached;
  }

  if (inFlightCache.has(cacheKey)) {
    return inFlightCache.get(cacheKey);
  }

  const promise = (async () => {
    const requestId = buildRequestId();
    const requestDir = path.join(REQUESTS_DIR, requestId);
    await fs.mkdir(requestDir, { recursive: true });
    try {
      const { streamUrl, videoInfo } = await requestDownload(link, type, requestId);
      const inputBasePath = path.join(requestDir, 'input');
      const downloadMeta = await downloadSemaphore.run(() => downloadToFile(streamUrl, inputBasePath));
      const guessedExt = downloadMeta.fileName ? path.extname(downloadMeta.fileName) : getExtensionFromType(downloadMeta.contentType);
      const inputPath = guessedExt && guessedExt !== '.bin' ? `${inputBasePath}${guessedExt}` : inputBasePath;
      if (inputPath !== inputBasePath) {
        await fs.rename(inputBasePath, inputPath);
      }
      const converted =
        type === 'audio'
          ? await convertToMp3Buffer(inputPath, requestDir)
          : await convertToMp4Buffer(inputPath, requestDir);
      await writeCache(cacheKey, type, converted, videoInfo);
      return { buffer: converted, videoInfo };
    } finally {
      await fs.rm(requestDir, { recursive: true, force: true });
    }
  })();

  inFlightCache.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    inFlightCache.delete(cacheKey);
  }
};

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

    await sock.sendMessage(
      remoteJid,
      { text: '⏳ Aguarde, estamos preparando o audio...' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );

    const link = await resolveYoutubeLink(text);
    const { buffer: convertedAudio, videoInfo } = await fetchMediaWithCache(link, 'audio');
    const infoText = formatVideoInfo(videoInfo) || '🎵 Informacoes do audio indisponiveis.';
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
        { text: `🎬 Uso: ${COMMAND_PREFIX}playvid <link do YouTube ou termo de busca>` },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      return;
    }

    await sock.sendMessage(
      remoteJid,
      { text: '⏳ Aguarde, estamos preparando o video...' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );

    const link = await resolveYoutubeLink(text);
    const { buffer: convertedVideo, videoInfo } = await fetchMediaWithCache(link, 'video');
    const infoText = formatVideoInfo(videoInfo);
    const caption = infoText ? `🎬 Video pronto!\n${infoText}` : '🎬 Video pronto!';
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
