import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';

import logger from '../../utils/logger/loggerModule.js';
import { downloadMediaMessage } from '../../config/baileysConfig.js';
import { getJidUser } from '../../config/baileysConfig.js';
import { sendAndStore } from '../../services/messagePersistenceService.js';

const TEMP_DIR = path.join(process.cwd(), 'temp', 'sticker-convert');
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

const isAnimatedSticker = async (sticker, inputPath) => {
  if (sticker?.isAnimated === true) return true;
  if (sticker?.isAnimated === false) return false;

  const needles = [Buffer.from('ANIM'), Buffer.from('ANMF')];
  const maxNeedle = Math.max(...needles.map((needle) => needle.length));

  return new Promise((resolve) => {
    let resolved = false;
    let tail = Buffer.alloc(0);
    let found = false;

    const finalize = (result) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    const stream = createReadStream(inputPath, { highWaterMark: 64 * 1024 });
    stream.on('data', (chunk) => {
      const buffer = tail.length ? Buffer.concat([tail, chunk]) : chunk;
      if (needles.some((needle) => buffer.includes(needle))) {
        found = true;
        stream.destroy();
        return;
      }
      tail = buffer.slice(-Math.max(0, maxNeedle - 1));
    });
    stream.on('error', () => finalize(false));
    stream.on('end', () => finalize(found));
    stream.on('close', () => finalize(found));
  });
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
    await sendAndStore(sock, 
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
    await sendAndStore(sock, 
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

  try {
    await ensureDir(userDir);

    downloadedPath = await downloadMediaMessage(sticker, 'sticker', userDir);
    if (!downloadedPath) {
      await sendAndStore(sock, 
        remoteJid,
        { text: '❌ Não foi possível baixar a figurinha. Tente novamente.' },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      return;
    }

    webpPath = path.join(userDir, `sticker_${uniqueId}.webp`);
    await fs.rename(downloadedPath, webpPath);
    downloadedPath = null;

    const isAnimated = await isAnimatedSticker(sticker, webpPath);
    if (isAnimated) {
      await sendAndStore(sock, 
        remoteJid,
        {
          document: { stream: createReadStream(webpPath) },
          mimetype: 'image/webp',
          fileName: `sticker_${uniqueId}.webp`,
          caption: '📦 Figurinha animada exportada como arquivo (sem conversão).',
        },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      return;
    }

    const webpConvModule = await import('webp-conv');
    const ConverterClass = pickConverterClass(webpConvModule);
    if (!ConverterClass) {
      throw new Error('webp-conv: classe de conversor não encontrada.');
    }

    const forcedOutput = path.join(userDir, `sticker_${uniqueId}.png`);
    const converter = new ConverterClass();
    convertedPath = await converter.convertJobs({ input: webpPath, output: forcedOutput });

    await sendAndStore(sock, 
      remoteJid,
      {
        image: { stream: createReadStream(convertedPath) },
        caption: '🖼️ Figurinha convertida em imagem.',
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  } catch (error) {
    logger.error(`handleStickerConvertCommand: erro ao converter figurinha: ${error.message}`, {
      error: error.stack,
    });
    await sendAndStore(sock, 
      remoteJid,
      { text: '❌ Não foi possível converter a figurinha agora. Tente novamente.' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  } finally {
    const cleanupFiles = [downloadedPath, webpPath, convertedPath].filter(Boolean);
    for (const file of cleanupFiles) {
      await fs
        .unlink(file)
        .catch((err) =>
          logger.warn(`handleStickerConvertCommand: falha ao limpar ${file}: ${err.message}`),
        );
    }
  }
}
