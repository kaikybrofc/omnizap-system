import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import { v4 as uuidv4 } from 'uuid';

import logger from '../../utils/logger/loggerModule.js';
import { downloadMediaMessage } from '../../config/baileysConfig.js';
import { getJidUser } from '../../config/baileysConfig.js';

const execProm = promisify(exec);
const TEMP_DIR = path.join(process.cwd(), 'temp', 'sticker-convert');
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

const resolveEvenDimensions = (width, height) => {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 512;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 512;
  const evenWidth = safeWidth % 2 === 0 ? safeWidth : safeWidth - 1;
  const evenHeight = safeHeight % 2 === 0 ? safeHeight : safeHeight - 1;
  return {
    width: evenWidth || 512,
    height: evenHeight || 512,
  };
};

const getMediaDimensions = async (inputPath) => {
  try {
    const { stdout } = await execProm(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "${inputPath}"`,
      { timeout: 10000 },
    );
    const [rawWidth, rawHeight] = String(stdout || '')
      .trim()
      .split('x')
      .map(Number);
    return resolveEvenDimensions(rawWidth, rawHeight);
  } catch (error) {
    return resolveEvenDimensions(512, 512);
  }
};

const resolveStickerMessage = (messageInfo) => {
  const message = messageInfo?.message;
  const directSticker = message?.stickerMessage;
  if (directSticker) return { sticker: directSticker, isQuoted: false };

  const quotedSticker = message?.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage;
  if (quotedSticker) return { sticker: quotedSticker, isQuoted: true };

  return null;
};

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const pickConverterClass = (moduleRef) =>
  moduleRef?.default || moduleRef?.Converter || moduleRef?.WebpConv || moduleRef?.webpconv || null;

export async function handleStickerConvertCommand({
  sock,
  remoteJid,
  messageInfo,
  expirationMessage,
  senderJid,
}) {
  const resolved = resolveStickerMessage(messageInfo);
  if (!resolved) {
    await sock.sendMessage(
      remoteJid,
      {
        text: '❌ Envie ou responda a uma figurinha para converter.\n\nDica: use o comando respondendo a um sticker.',
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }

  const { sticker } = resolved;
  const fileLength = sticker?.fileLength || 0;
  if (fileLength > MAX_FILE_SIZE) {
    const sizeMb = (fileLength / (1024 * 1024)).toFixed(2);
    await sock.sendMessage(
      remoteJid,
      { text: `❌ Figurinha muito grande (${sizeMb} MB). Envie uma menor.` },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }

  const uniqueId = uuidv4();
  const userId = getJidUser(senderJid) || senderJid || 'anon';
  const sanitizedUserId = String(userId).replace(/[^a-zA-Z0-9.-]/g, '_');
  const userDir = path.join(TEMP_DIR, sanitizedUserId);

  let downloadedPath = null;
  let webpPath = null;
  let convertedPath = null;
  let mp4Path = null;

  try {
    await ensureDir(userDir);

    downloadedPath = await downloadMediaMessage(sticker, 'sticker', userDir);
    if (!downloadedPath) {
      await sock.sendMessage(
        remoteJid,
        { text: '❌ Não foi possível baixar a figurinha. Tente novamente.' },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      return;
    }

    webpPath = path.join(userDir, `sticker_${uniqueId}.webp`);
    await fs.rename(downloadedPath, webpPath);
    downloadedPath = null;

    const webpConvModule = await import('webp-conv');
    const ConverterClass = pickConverterClass(webpConvModule);
    if (!ConverterClass) {
      throw new Error('webp-conv: classe de conversor não encontrada.');
    }

    const converter = new ConverterClass();
    convertedPath = await converter.convertJobs({ input: webpPath });

    if (convertedPath.endsWith('.png')) {
      const imageBuffer = await fs.readFile(convertedPath);
      await sock.sendMessage(
        remoteJid,
        { image: imageBuffer, caption: '🖼️ Figurinha convertida em imagem.' },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      return;
    }

    if (!convertedPath.endsWith('.gif')) {
      throw new Error(`Saída inesperada na conversão: ${convertedPath}`);
    }

    const { width, height } = await getMediaDimensions(convertedPath);
    mp4Path = path.join(userDir, `sticker_${uniqueId}.mp4`);
    const ffmpegCommand = `ffmpeg -y -i "${convertedPath}" -filter_complex "[0:v]scale=${width}:${height}:flags=lanczos,format=rgba[fg];color=black:s=${width}x${height}[bg];[bg][fg]overlay=format=auto,format=yuv420p" -movflags +faststart -pix_fmt yuv420p "${mp4Path}"`;
    await execProm(ffmpegCommand, { timeout: 20000 });

    const videoBuffer = await fs.readFile(mp4Path);
    await sock.sendMessage(
      remoteJid,
      { video: videoBuffer, mimetype: 'video/mp4', caption: '🎞️ Figurinha convertida em vídeo.' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  } catch (error) {
    logger.error(`handleStickerConvertCommand: erro ao converter figurinha: ${error.message}`, {
      error: error.stack,
    });
    await sock.sendMessage(
      remoteJid,
      { text: '❌ Não foi possível converter a figurinha agora. Tente novamente.' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  } finally {
    const cleanupFiles = [downloadedPath, webpPath, convertedPath, mp4Path].filter(Boolean);
    for (const file of cleanupFiles) {
      await fs
        .unlink(file)
        .catch((err) =>
          logger.warn(`handleStickerConvertCommand: falha ao limpar ${file}: ${err.message}`),
        );
    }
  }
}
