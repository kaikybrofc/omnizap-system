import { createCanvas } from 'canvas';
import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import logger from '../../utils/logger/loggerModule.js';

import { v4 as uuidv4 } from 'uuid';

import { convertToWebp } from './convertToWebp.js';
import { addStickerMetadata } from './addStickerMetadata.js';
import { getJidUser } from '../../config/baileysConfig.js';
import { sendAndStore } from '../../services/messagePersistenceService.js';
import { addStickerToAutoPack } from '../stickerPackModule/autoPackCollectorRuntime.js';

/**
 * Constantes limitadoras
 */
const MAX_CHARACTERS = 80;
const MAX_LINES = 4;

const TEMP_DIR = path.join(process.cwd(), 'temp', 'stickers');
const BLINK_FPS = 15;
const BLINK_DURATION_MS = 5000;
const BLINK_FREQ_HZ = 5;
const DEFAULT_COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';
const AUTO_PACK_NOTICE_ENABLED = process.env.STICKER_PACK_AUTO_COLLECT_NOTIFY !== 'false';
const AUTO_PACK_MAX_ITEMS = Math.max(1, Number(process.env.STICKER_PACK_MAX_ITEMS) || 30);
const STICKER_WEB_PATH = normalizeBasePath(process.env.STICKER_WEB_PATH, '/stickers');
const STICKER_WEB_ORIGIN = resolveStickerWebOrigin();

function normalizeBasePath(value, fallback) {
  const raw = String(value || '').trim() || fallback;
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const withoutTrailingSlash =
    withLeadingSlash.length > 1 && withLeadingSlash.endsWith('/')
      ? withLeadingSlash.slice(0, -1)
      : withLeadingSlash;
  return withoutTrailingSlash || fallback;
}

function normalizeOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    if (!parsed.protocol || !parsed.host) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function resolveStickerWebOrigin() {
  const candidates = [
    process.env.STICKER_WEB_ORIGIN,
    process.env.APP_BASE_URL,
    process.env.PUBLIC_BASE_URL,
    process.env.SITE_URL,
    process.env.WEB_URL,
    process.env.BASE_URL,
    process.env.STICKER_DEFAULT_PACK_NAME,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeOrigin(candidate);
    if (normalized) return normalized;
  }

  return 'https://omnizap.shop';
}

function buildPackWebUrl(packKey) {
  const normalizedPackKey = String(packKey || '').trim();
  if (!normalizedPackKey) return null;

  return `${STICKER_WEB_ORIGIN}${STICKER_WEB_PATH}/${encodeURIComponent(normalizedPackKey)}`;
}

function isPackPubliclyVisible(pack) {
  const visibility = String(pack?.visibility || '').trim().toLowerCase();
  const status = String(pack?.status || 'published').trim().toLowerCase();
  const packStatus = String(pack?.pack_status || 'ready').trim().toLowerCase();
  return (visibility === 'public' || visibility === 'unlisted') && status === 'published' && packStatus === 'ready';
}

const execProm = promisify(exec);

const COLOR_ALIASES = {
  branco: 'white',
  white: 'white',
  preto: 'black',
  black: 'black',
  vermelho: 'red',
  red: 'red',
  verde: 'green',
  green: 'green',
  azul: 'blue',
  blue: 'blue',
  amarelo: 'yellow',
  yellow: 'yellow',
  rosa: 'pink',
  pink: 'pink',
  roxo: 'purple',
  purple: 'purple',
  laranja: 'orange',
  orange: 'orange',
};

/**
 * Extrai uma cor no formato "-cor" no final do texto e retorna o texto limpo.
 *
 * @param {string} rawText
 * @param {string} fallbackColor
 * @returns {{ text: string, color: string }}
 */
function parseColorFlag(rawText, fallbackColor) {
  const trimmed = rawText.trim();
  if (!trimmed) return { text: rawText, color: fallbackColor };

  const match = trimmed.match(/(?:^|\s)-([a-zA-Z]+)\s*$/);
  if (!match) return { text: rawText, color: fallbackColor };

  const colorKey = match[1].toLowerCase();
  const mapped = COLOR_ALIASES[colorKey];
  if (!mapped) return { text: rawText, color: fallbackColor };

  const cleanedText = trimmed.slice(0, match.index).trimEnd();
  return { text: cleanedText, color: mapped };
}

function buildAutoPackNoticeText(result, commandPrefix = DEFAULT_COMMAND_PREFIX) {
  if (!result || result.status === 'skipped') {
    return null;
  }

  const pack = result.pack || {};
  const packName = pack.name || 'Minhas Figurinhas';
  const packIdentifier = pack.pack_key || pack.id || '<pack>';
  const packWebUrl = isPackPubliclyVisible(pack) ? buildPackWebUrl(pack.pack_key) : null;
  const profileUrl = `${STICKER_WEB_ORIGIN}${STICKER_WEB_PATH}/profile`;
  const escapedPackName = packName.replace(/"/g, '\\"');
  const packCommandTarget = escapedPackName ? `"${escapedPackName}"` : packIdentifier;
  const itemCount = Array.isArray(pack.items) ? pack.items.length : Number(pack.sticker_count || 0);
  const countLabel = itemCount > 0 ? ` (${itemCount}/${AUTO_PACK_MAX_ITEMS})` : '';

  if (result.status === 'duplicate') {
    const duplicateLines = [
      `ℹ️ Essa figurinha já estava no pack automático *${packName}*.`,
      `Use *${commandPrefix}pack info ${packIdentifier}* para ver o pack ou *${commandPrefix}pack send ${packIdentifier}* para enviar.`,
    ];
    if (packWebUrl) {
      duplicateLines.push(`🌐 Link do pack no site: ${packWebUrl}`);
    } else {
      duplicateLines.push(`🔒 Pack privado/não publicado. Abra no painel: ${profileUrl}`);
    }
    return duplicateLines.join('\n');
  }

  const savedLines = [
    `📦 Figurinha salva automaticamente no pack *${packName}*${countLabel}.\n\n`,
    `Dica: use *${commandPrefix}pack list* para gerenciar seus packs.`,
    `Para enviar agora: *${commandPrefix}pack send ${packCommandTarget}*.`,
  ];
  if (packWebUrl) {
    savedLines.push(`🌐 Abrir no site: ${packWebUrl}`);
  } else {
    savedLines.push(`🔒 Pack privado/não publicado. Gerencie em: ${profileUrl}`);
  }
  return savedLines.join('\n');
}

async function notifyAutoPackCollection({ sock, remoteJid, messageInfo, expirationMessage, result, commandPrefix }) {
  if (!AUTO_PACK_NOTICE_ENABLED) return;

  const noticeText = buildAutoPackNoticeText(result, commandPrefix);
  if (!noticeText) return;

  await sendAndStore(
    sock,
    remoteJid,
    { text: noticeText },
    {
      quoted: messageInfo,
      ephemeralExpiration: expirationMessage,
    },
  );
}

/**
 * Desenha texto centralizado no canvas com quebra de linha e ajuste de fonte.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {string} color
 * @param {{ glow?: boolean }} [options]
 */
function drawTextOnCanvas(ctx, text, color, { glow = false } = {}) {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;

  const maxWidth = 460;

  ctx.fillStyle = color ? color : 'black';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const charCount = text.replace(/\s+/g, '').length;
  let fontSize = 56;
  if (charCount <= 6) {
    fontSize = 96;
  } else if (charCount <= 10) {
    fontSize = 80;
  } else if (charCount <= 16) {
    fontSize = 68;
  }
  ctx.font = `bold ${fontSize}px Arial`;

  const wrapText = () => {
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    const pushLine = () => {
      if (currentLine) lines.push(currentLine.trim());
      currentLine = '';
    };

    for (const word of words) {
      const testLine = currentLine + word + ' ';
      const testWidth = ctx.measureText(testLine).width;

      if (testWidth <= maxWidth) {
        currentLine = testLine;
        continue;
      }

      if (currentLine) {
        pushLine();
      }

      if (ctx.measureText(word).width <= maxWidth) {
        currentLine = word + ' ';
        continue;
      }

      let chunk = '';
      for (const ch of word) {
        const chunkTest = chunk + ch;
        if (ctx.measureText(chunkTest).width > maxWidth && chunk) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk = chunkTest;
        }
      }
      if (chunk) lines.push(chunk);
    }

    pushLine();
    return lines;
  };

  let lines = wrapText();
  while (lines.length * fontSize > height - 40 || lines.some((line) => ctx.measureText(line).width > maxWidth)) {
    fontSize -= 4;
    ctx.font = `bold ${fontSize}px Arial`;
    lines = wrapText();
  }

  const startY = height / 2 - (lines.length * fontSize) / 2;

  lines.forEach((line, i) => {
    if (glow) {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.lineWidth = 3;
      ctx.strokeText(line, width / 2, startY + i * fontSize);
    }
    ctx.fillText(line, width / 2, startY + i * fontSize);
  });
}

/**
 * Gera uma imagem PNG (512x512) a partir de um texto.
 *
 * @param {string} text
 * @param {string} outputDir
 * @param {string} fileName (sem extensão)
 * @returns {Promise<string>} Caminho do PNG gerado
 */
/**
 * Gera uma imagem PNG (512x512) a partir de um texto.
 *
 * @param {string} text
 * @param {string} outputDir
 * @param {string} fileName (sem extensão)
 * @param {string} color
 * @returns {Promise<string>} Caminho do PNG gerado
 */
export async function generateTextImage(text, outputDir, fileName, color) {
  try {
    const width = 512;
    const height = 512;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, width, height);
    drawTextOnCanvas(ctx, text, color);

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

/**
 * Gera um WebP animado com texto piscante.
 *
 * @param {string} text
 * @param {string} outputDir
 * @param {string} fileName (sem extensão)
 * @param {string} [color='white']
 * @returns {Promise<string>} Caminho do WebP gerado
 */
async function generateBlinkingTextWebp(text, outputDir, fileName, color = 'white') {
  const width = 512;
  const height = 512;

  const frameCount = Math.max(6, Math.round((BLINK_DURATION_MS / 1000) * BLINK_FPS));
  const frameBaseName = `${fileName}_frame`;
  const framePaths = [];

  for (let i = 0; i < frameCount; i += 1) {
    const frameIndex = String(i).padStart(3, '0');
    const framePath = path.join(outputDir, `${frameBaseName}_${frameIndex}.png`);
    framePaths.push(framePath);

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);

    const framesPerHalfCycle = Math.max(1, Math.round(BLINK_FPS / (BLINK_FREQ_HZ * 2)));
    const alpha = Math.floor(i / framesPerHalfCycle) % 2 === 0 ? 1 : 0;
    ctx.globalAlpha = alpha;
    drawTextOnCanvas(ctx, text, color, { glow: true });
    ctx.globalAlpha = 1;

    const buffer = canvas.toBuffer('image/png');
    await fs.writeFile(framePath, buffer);
  }

  const outputPath = path.join(outputDir, `${fileName}.webp`);
  const frameDurationMs = Math.max(40, Math.round(1000 / BLINK_FPS));
  const framesArg = framePaths.map((framePath) => `"${framePath}"`).join(' ');
  const img2webpCommand = `img2webp -lossless -loop 0 -d ${frameDurationMs} ${framesArg} -o "${outputPath}"`;

  try {
    const img2webpResult = await execProm(img2webpCommand, { timeout: 20000 });
    if (img2webpResult && img2webpResult.stderr) {
      logger.debug(`img2webp stderr: ${img2webpResult.stderr}`);
    }
    await fs.access(outputPath);
  } catch (error) {
    logger.error(`generateBlinkingTextWebp Erro ao converter frames: ${error.message}`);
    throw error;
  } finally {
    for (const framePath of framePaths) {
      await fs.unlink(framePath).catch(() => {});
    }
  }

  return outputPath;
}

/**
 * Processa texto simples e envia sticker de texto estático.
 *
 * @param {object} params
 * @param {object} params.sock
 * @param {object} params.messageInfo
 * @param {string} params.remoteJid
 * @param {string} params.senderJid
 * @param {string} params.senderName
 * @param {string} params.text
 * @param {number} params.expirationMessage
 * @param {string} [params.extraText]
 * @param {string} [params.color='black']
 * @param {string} [params.commandPrefix='/']
 * @returns {Promise<void>}
 */
export async function processTextSticker({ sock, messageInfo, remoteJid, senderJid, senderName, text, expirationMessage, extraText = '', color = 'black', commandPrefix = DEFAULT_COMMAND_PREFIX }) {
  const stickerText = text.trim();

  if (!stickerText) {
    await sendAndStore(
      sock,
      remoteJid,
      {
        text: '❌ Você precisa informar um texto para criar a figurinha.\n\n' + `Exemplo:\n*${commandPrefix}st bom dia seus lindos*`,
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );

    return;
  }

  if (stickerText.length > MAX_CHARACTERS) {
    await sendAndStore(
      sock,
      remoteJid,
      {
        text: `❌ Texto muito longo: *${stickerText.length}* caracteres.\n` + `Limite atual: *${MAX_CHARACTERS}* caracteres.`,
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );

    return;
  }

  const stickerLines = stickerText.split(/\r?\n/);

  if (stickerLines.length > MAX_LINES) {
    await sendAndStore(
      sock,
      remoteJid,
      {
        text: `❌ Texto com muitas linhas: *${stickerLines.length}*.\n` + `Limite atual: *${MAX_LINES}* linhas.`,
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );

    return;
  }

  const uniqueId = uuidv4();
  const userId = getJidUser(senderJid);
  const sanitizedUserId = (userId || 'anon').replace(/[^a-zA-Z0-9.-]/g, '_');

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

    await sendAndStore(sock, remoteJid, { sticker: stickerBuffer }, { ephemeralExpiration: expirationMessage });

    setImmediate(() => {
      addStickerToAutoPack({
        ownerJid: senderJid,
        senderName,
        stickerBuffer,
      })
        .then((collectResult) =>
          notifyAutoPackCollection({
            sock,
            remoteJid,
            messageInfo,
            expirationMessage,
            result: collectResult,
            commandPrefix,
          }),
        )
        .catch((collectError) => {
          logger.warn(`processTextSticker Falha ao coletar figurinha automática: ${collectError.message}`);
        });
    });
  } catch (error) {
    logger.error(`processTextSticker Erro: ${error.message}`, { error });
    await sendAndStore(
      sock,
      remoteJid,
      {
        text: '*❌ Não foi possível criar a figurinha de texto.*\n\n' + `Tente novamente com outro texto ou use *${commandPrefix}st* com uma frase menor.`,
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  } finally {
    const files = [imagePath, webpPath, stickerPath].filter(Boolean);
    for (const file of files) {
      await fs.unlink(file).catch(() => {});
    }
  }
}

/**
 * Processa texto e envia sticker animado com efeito de pisca-pisca.
 *
 * @param {object} params
 * @param {object} params.sock
 * @param {object} params.messageInfo
 * @param {string} params.remoteJid
 * @param {string} params.senderJid
 * @param {string} params.senderName
 * @param {string} params.text
 * @param {number} params.expirationMessage
 * @param {string} [params.extraText]
 * @param {string} [params.color='white']
 * @param {string} [params.commandPrefix='/']
 * @returns {Promise<void>}
 */
export async function processBlinkingTextSticker({ sock, messageInfo, remoteJid, senderJid, senderName, text, expirationMessage, extraText = '', color = 'white', commandPrefix = DEFAULT_COMMAND_PREFIX }) {
  const parsed = parseColorFlag(text, color);
  const stickerText = parsed.text.trim();
  const resolvedColor = parsed.color;

  if (!stickerText) {
    await sendAndStore(
      sock,
      remoteJid,
      {
        text: '❌ Você precisa informar um texto para criar a figurinha piscante.\n\n' + `Exemplo:\n*${commandPrefix}stb bom dia seus lindos -verde*`,
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );

    return;
  }

  if (stickerText.length > MAX_CHARACTERS) {
    await sendAndStore(
      sock,
      remoteJid,
      {
        text: `❌ Texto muito longo: *${stickerText.length}* caracteres.\n` + `Limite atual: *${MAX_CHARACTERS}* caracteres.`,
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );

    return;
  }

  const stickerLines = stickerText.split(/\r?\n/);

  if (stickerLines.length > MAX_LINES) {
    await sendAndStore(
      sock,
      remoteJid,
      {
        text: `❌ Texto com muitas linhas: *${stickerLines.length}*.\n` + `Limite atual: *${MAX_LINES}* linhas.`,
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );

    return;
  }

  const uniqueId = uuidv4();
  const userId = getJidUser(senderJid);
  const sanitizedUserId = (userId || 'anon').replace(/[^a-zA-Z0-9.-]/g, '_');

  let webpPath = null;
  let stickerPath = null;

  try {
    const userDir = path.join(TEMP_DIR, sanitizedUserId);
    await fs.mkdir(userDir, { recursive: true });

    webpPath = await generateBlinkingTextWebp(stickerText, userDir, `text_blink_${uniqueId}`, resolvedColor);

    const { packName, packAuthor } = (() => {
      if (!extraText) {
        return { packName: 'OmniZap Blink', packAuthor: senderName };
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

    await sendAndStore(sock, remoteJid, { sticker: stickerBuffer }, { ephemeralExpiration: expirationMessage });

    setImmediate(() => {
      addStickerToAutoPack({
        ownerJid: senderJid,
        senderName,
        stickerBuffer,
      })
        .then((collectResult) =>
          notifyAutoPackCollection({
            sock,
            remoteJid,
            messageInfo,
            expirationMessage,
            result: collectResult,
            commandPrefix,
          }),
        )
        .catch((collectError) => {
          logger.warn(`processBlinkingTextSticker Falha ao coletar figurinha automática: ${collectError.message}`);
        });
    });
  } catch (error) {
    logger.error(`processBlinkingTextSticker Erro: ${error.message}`, { error });
    await sendAndStore(
      sock,
      remoteJid,
      {
        text: '*❌ Não foi possível criar a figurinha piscante.*\n\n' + `Tente novamente com outro texto ou use *${commandPrefix}stb* com uma frase menor.`,
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  } finally {
    const files = [webpPath, stickerPath].filter(Boolean);
    for (const file of files) {
      await fs.unlink(file).catch(() => {});
    }
  }
}
