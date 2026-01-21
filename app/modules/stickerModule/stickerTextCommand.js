import { createCanvas, registerFont } from 'canvas';
import fs from 'node:fs/promises';
import path from 'node:path';
import logger from '../../utils/logger/loggerModule.js';

import { v4 as uuidv4 } from 'uuid';

import { convertToWebp } from './convertToWebp.js';
import { addStickerMetadata } from './addStickerMetadata.js';

/**
 * Constantes limitadoras
 */
const MAX_CHARACTERS = 80;
const MAX_LINES = 4;

const TEMP_DIR = path.join(process.cwd(), 'temp', 'stickers');

/**
 * Gera uma imagem PNG (512x512) a partir de um texto.
 *
 * @param {string} text
 * @param {string} outputDir
 * @param {string} fileName (sem extensão)
 * @returns {Promise<string>} Caminho do PNG gerado
 */
export async function generateTextImage(text, outputDir, fileName, color) {
  try {
    const width = 512;
    const height = 512;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = color ? color : 'black';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let fontSize = 56;
    ctx.font = `bold ${fontSize}px Arial`;

    const maxWidth = 460;
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine + word + ' ';
      const metrics = ctx.measureText(testLine);

      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine.trim());
        currentLine = word + ' ';
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) lines.push(currentLine.trim());

    while (lines.length * fontSize > height - 40) {
      fontSize -= 4;
      ctx.font = `bold ${fontSize}px Arial`;
    }

    const startY = height / 2 - (lines.length * fontSize) / 2;

    lines.forEach((line, i) => {
      ctx.fillText(line, width / 2, startY + i * fontSize);
    });

    const buffer = canvas.toBuffer('image/png');
    const outputPath = path.join(outputDir, `${fileName}.png`);

    await fs.writeFile(outputPath, buffer);

    logger.info(`Imagem de texto gerada em: ${outputPath}`);
    return outputPath;
  } catch (error) {
    logger.error(`generateTextImage Erro ao gerar imagem: ${error.message}`);
    throw error;
  }
}

export async function processTextSticker({ sock, messageInfo, remoteJid, senderJid, senderName, text, expirationMessage, extraText = '', color = 'black' }) {
  const stickerText = text.trim();

  if (!stickerText) {
    await sock.sendMessage(remoteJid, { text: '❌ Você precisa informar um texto para virar figurinha.\n\nExemplo:\n/st bom dia seus lindos' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });

    return;
  }

  if (stickerText.length > MAX_CHARACTERS) {
    await sock.sendMessage(remoteJid, { text: '❌ Limite de caracteres excedido!' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });

    return;
  }

  const stickerLines = stickerText.split(/\r?\n/);

  if (stickerLines.length > MAX_LINES) {
    await sock.sendMessage(remoteJid, { text: '❌ Limite de linhas excedido!' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });

    return;
  }

  const uniqueId = uuidv4();
  const userId = senderJid?.split('@')[0];
  const sanitizedUserId = userId.replace(/[^a-zA-Z0-9.-]/g, '_');

  let imagePath = null;
  let webpPath = null;
  let stickerPath = null;

  try {
    const userDir = path.join(TEMP_DIR, sanitizedUserId);
    await fs.mkdir(userDir, { recursive: true });

    imagePath = await generateTextImage(text, userDir, `text_${uniqueId}`, color);

    webpPath = await convertToWebp(imagePath, 'image', sanitizedUserId, uniqueId);

    const { packName, packAuthor } = (() => {
      if (!extraText) {
        return { packName: 'OmniZap Text', packAuthor: senderName };
      }

      const idx = extraText.indexOf('/');
      return idx !== -1
        ? {
            packName: extraText.slice(0, idx).trim(),
            packAuthor: extraText.slice(idx + 1).trim(),
          }
        : { packName: extraText.trim(), packAuthor: senderName };
    })();

    stickerPath = await addStickerMetadata(webpPath, packName, packAuthor, {
      senderName,
      userId,
    });

    const stickerBuffer = await fs.readFile(stickerPath);

    await sock.sendMessage(remoteJid, { sticker: stickerBuffer }, { ephemeralExpiration: expirationMessage });
  } catch (error) {
    logger.error(`processTextSticker Erro: ${error.message}`, { error });
    await sock.sendMessage(remoteJid, {
      text: '*❌ Não foi possível criar o sticker de texto.*',
    });
  } finally {
    const files = [imagePath, webpPath, stickerPath].filter(Boolean);
    for (const file of files) {
      await fs.unlink(file).catch(() => {});
    }
  }
}
