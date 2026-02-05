import { createCanvas, loadImage } from 'canvas';
import fs from 'node:fs/promises';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';

import logger from '../../utils/logger/loggerModule.js';
import { getJidUser } from '../../config/baileysConfig.js';
import { resolveUserId } from '../../services/lidMapService.js';
import { convertToWebp } from '../stickerModule/convertToWebp.js';
import { addStickerMetadata } from '../stickerModule/addStickerMetadata.js';
import { fetchLatestPushNames } from '../statsModule/rankingCommon.js';
import { sendAndStore } from '../../services/messagePersistenceService.js';

const DEFAULT_COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';
const QUOTE_BUBBLE_COLOR = process.env.QUOTE_BG_COLOR || '#03101d';
const QUOTE_NAME_COLOR = process.env.QUOTE_NAME_COLOR || '#f6af6d';
const QUOTE_TEXT_COLOR = process.env.QUOTE_TEXT_COLOR || '#e8eef6';
const QUOTE_TIMEOUT_MS = Number.parseInt(process.env.QUOTE_TIMEOUT_MS || '10000', 10);
const QUOTE_FONT_FAMILY = process.env.QUOTE_FONT_FAMILY || '"Noto Sans","Segoe UI","Arial","Noto Color Emoji","Apple Color Emoji","Segoe UI Emoji",sans-serif';

const QUOTE_CANVAS_MAX_WIDTH = 920;
const QUOTE_CANVAS_MIN_WIDTH = 520;
const QUOTE_CANVAS_MAX_HEIGHT = 760;
const QUOTE_CANVAS_MIN_HEIGHT = 220;

const QUOTE_BUBBLE_X = 132;
const QUOTE_BUBBLE_Y = 26;
const QUOTE_BUBBLE_RADIUS = 44;
const QUOTE_BUBBLE_RIGHT_MARGIN = 18;
const QUOTE_BUBBLE_BOTTOM_MARGIN = 24;
const QUOTE_BUBBLE_PADDING_X = 34;
const QUOTE_BUBBLE_PADDING_TOP = 24;
const QUOTE_BUBBLE_PADDING_BOTTOM = 28;

const QUOTE_AVATAR_X = 10;
const QUOTE_AVATAR_SIZE = 104;
const QUOTE_AVATAR_BORDER = 2;

const QUOTE_NAME_FONT_MAX = 56;
const QUOTE_NAME_FONT_MIN = 32;
const QUOTE_TEXT_FONT_MAX = 58;
const QUOTE_TEXT_FONT_MIN = 34;
const QUOTE_MAX_LINES = 6;
const QUOTE_NAME_TEXT_GAP = 12;

const TEMP_DIR = path.join(process.cwd(), 'temp', 'quotes');
const GRAPHEME_SEGMENTER = typeof Intl?.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;
const EMOJI_SEGMENT_REGEX = /\p{Extended_Pictographic}/u;

const isValidJid = (jid) => typeof jid === 'string' && jid.includes('@');
const normalizeMentionedJids = (mentionedJids) => (Array.isArray(mentionedJids) ? mentionedJids.filter(Boolean) : []);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const extractTextFromMessage = (message = {}) => {
  const text = message.conversation?.trim() || message.extendedTextMessage?.text;
  if (text) return text;
  if (message.imageMessage?.caption) return message.imageMessage.caption;
  if (message.videoMessage?.caption) return message.videoMessage.caption;
  if (message.documentMessage?.fileName) return message.documentMessage.fileName;
  return '';
};

const getContactNameFromSock = (sock, jid) => {
  const contact = sock?.contacts?.[jid];
  return contact?.notify || contact?.name || contact?.short || null;
};

const resolveDisplayName = async (sock, jid) => {
  if (!jid) return null;
  const fromSock = getContactNameFromSock(sock, jid);
  if (fromSock) return fromSock;
  try {
    const map = await fetchLatestPushNames([jid]);
    return map.get(jid) || null;
  } catch {
    return null;
  }
};

const hashString = (value) => {
  const input = `${value || ''}`;
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
};

const toInitials = (value) => {
  const clean = `${value || ''}`.trim().replace(/\s+/g, ' ');
  if (!clean) return 'O';
  const parts = clean.split(' ').filter(Boolean);
  if (!parts.length) return 'O';
  if (parts.length === 1) {
    return (
      parts[0]
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(0, 2)
        .toUpperCase() || 'O'
    );
  }
  const left = parts[0].replace(/[^a-zA-Z0-9]/g, '').charAt(0);
  const right = parts[parts.length - 1].replace(/[^a-zA-Z0-9]/g, '').charAt(0);
  return `${left}${right}`.toUpperCase() || 'O';
};

const parseLeadingMention = (text) => {
  const trimmed = text?.trim() || '';
  if (!trimmed) return { mention: null, rest: '' };
  const parts = trimmed.split(/\s+/);
  const first = parts[0];
  if (first && first.startsWith('@') && first.length > 1) {
    return { mention: first.slice(1), rest: parts.slice(1).join(' ').trim() };
  }
  return { mention: null, rest: trimmed };
};

const buildJidFromMention = (mention) => {
  if (!mention) return null;
  const digits = mention.replace(/\D/g, '');
  if (!digits) return null;
  return `${digits}@s.whatsapp.net`;
};

const resolveQuotedTarget = (contextInfo = {}) => {
  const participant = contextInfo?.participant || null;
  const participantAlt = contextInfo?.participantAlt || null;
  const quotedKey = contextInfo?.quotedMessageKey || contextInfo?.quotedMessage?.key || contextInfo?.quotedMessage?.contextInfo?.quotedMessageKey || null;
  const keyParticipant = quotedKey?.participant || null;
  const keyParticipantAlt = quotedKey?.participantAlt || null;
  return {
    participant,
    participantAlt,
    keyParticipant,
    keyParticipantAlt,
  };
};

const resolveTargetJids = async ({ primaryJid, altJid }) => {
  const primary = isValidJid(primaryJid) ? primaryJid : null;
  const alt = isValidJid(altJid) ? altJid : null;
  try {
    const resolved = await resolveUserId({ jid: primary, participantAlt: alt, lid: primary });
    return { targetJid: primary || alt || null, resolvedJid: resolved || alt || primary || null };
  } catch (error) {
    logger.warn('quote: falha ao resolver LID', { error: error.message });
    return { targetJid: primary || alt || null, resolvedJid: alt || primary || null };
  }
};

const segmentGraphemes = (text) => {
  const input = `${text || ''}`;
  if (!input) return [];
  if (GRAPHEME_SEGMENTER) {
    return [...GRAPHEME_SEGMENTER.segment(input)].map((chunk) => chunk.segment);
  }
  return Array.from(input);
};

const isEmojiSegment = (segment) => EMOJI_SEGMENT_REGEX.test(segment);

const measureTextVisualWidth = (ctx, text, fontSize) => {
  const graphemes = segmentGraphemes(text);
  const emojiAdvance = Math.round(fontSize * 1.06);
  let width = 0;

  for (const segment of graphemes) {
    if (isEmojiSegment(segment)) {
      width += emojiAdvance;
      continue;
    }
    width += ctx.measureText(segment).width;
  }

  return width;
};

const drawTextWithEmoji = (ctx, text, x, y, fontSize) => {
  const graphemes = segmentGraphemes(text);
  const emojiAdvance = Math.round(fontSize * 1.06);
  let cursorX = x;
  let plainBuffer = '';

  const flushPlain = () => {
    if (!plainBuffer) return;
    ctx.fillText(plainBuffer, cursorX, y);
    cursorX += ctx.measureText(plainBuffer).width;
    plainBuffer = '';
  };

  for (const segment of graphemes) {
    if (isEmojiSegment(segment)) {
      flushPlain();
      ctx.fillText(segment, cursorX, y);
      const measured = ctx.measureText(segment).width;
      cursorX += Math.max(measured, emojiAdvance);
      continue;
    }
    plainBuffer += segment;
  }

  flushPlain();
  return cursorX - x;
};

const wrapTextLines = (ctx, text, maxWidth, fontSize) => {
  const lines = [];
  const paragraphs = `${text || ''}`.split(/\r?\n/);

  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      if (lines.length > 0) lines.push('');
      continue;
    }

    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measureTextVisualWidth(ctx, candidate, fontSize) <= maxWidth) {
        line = candidate;
        continue;
      }

      if (line) {
        lines.push(line);
      }

      if (measureTextVisualWidth(ctx, word, fontSize) <= maxWidth) {
        line = word;
        continue;
      }

      let chunk = '';
      const graphemes = segmentGraphemes(word);
      for (const grapheme of graphemes) {
        const test = `${chunk}${grapheme}`;
        if (measureTextVisualWidth(ctx, test, fontSize) > maxWidth && chunk) {
          lines.push(chunk);
          chunk = grapheme;
        } else {
          chunk = test;
        }
      }
      line = chunk;
    }

    if (line) {
      lines.push(line);
    }
  }

  return lines.length ? lines : [''];
};

const ellipsizeLine = (ctx, line, maxWidth, fontSize) => {
  const safeLine = `${line || ''}`;
  if (!safeLine || measureTextVisualWidth(ctx, safeLine, fontSize) <= maxWidth) {
    return safeLine;
  }

  const ellipsis = '...';
  let trimmed = safeLine;
  while (trimmed.length > 0 && measureTextVisualWidth(ctx, `${trimmed}${ellipsis}`, fontSize) > maxWidth) {
    trimmed = trimmed.slice(0, -1).trimEnd();
  }
  return trimmed ? `${trimmed}${ellipsis}` : ellipsis;
};

const fitAuthorFontSize = (ctx, authorName, maxWidth) => {
  let fontSize = QUOTE_NAME_FONT_MAX;
  while (fontSize > QUOTE_NAME_FONT_MIN) {
    ctx.font = `700 ${fontSize}px ${QUOTE_FONT_FAMILY}`;
    if (measureTextVisualWidth(ctx, authorName, fontSize) <= maxWidth) break;
    fontSize -= 2;
  }
  return fontSize;
};

const fitQuoteLines = (ctx, quoteText, maxWidth) => {
  let fontSize = QUOTE_TEXT_FONT_MAX;
  let lines = [''];

  while (fontSize > QUOTE_TEXT_FONT_MIN) {
    ctx.font = `500 ${fontSize}px ${QUOTE_FONT_FAMILY}`;
    lines = wrapTextLines(ctx, quoteText, maxWidth, fontSize);
    if (lines.length <= QUOTE_MAX_LINES) {
      return { fontSize, lines };
    }
    fontSize -= 2;
  }

  ctx.font = `500 ${QUOTE_TEXT_FONT_MIN}px ${QUOTE_FONT_FAMILY}`;
  lines = wrapTextLines(ctx, quoteText, maxWidth, QUOTE_TEXT_FONT_MIN);
  if (lines.length > QUOTE_MAX_LINES) {
    lines = lines.slice(0, QUOTE_MAX_LINES);
    lines[QUOTE_MAX_LINES - 1] = ellipsizeLine(ctx, lines[QUOTE_MAX_LINES - 1], maxWidth, QUOTE_TEXT_FONT_MIN);
  }

  return { fontSize: QUOTE_TEXT_FONT_MIN, lines };
};

const buildFallbackAvatarBuffer = (seed) => {
  const size = 256;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const safeSeed = `${seed || 'OmniZap'}`.trim() || 'OmniZap';

  ctx.clearRect(0, 0, size, size);

  const hue = hashString(safeSeed) % 360;
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, `hsl(${hue}, 74%, 58%)`);
  gradient.addColorStop(1, `hsl(${(hue + 30) % 360}, 72%, 44%)`);

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = `700 96px ${QUOTE_FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(toInitials(safeSeed), size / 2, size / 2 + 6);

  return canvas.toBuffer('image/png');
};

const fetchImageBuffer = async (url, timeoutMs = QUOTE_TIMEOUT_MS) => {
  const controller = new globalThis.AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await globalThis.fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const data = await response.arrayBuffer();
    return Buffer.from(data);
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutHandle);
  }
};

const resolveAvatarBuffer = async (sock, jid, fallbackSeed) => {
  const fallbackBuffer = buildFallbackAvatarBuffer(fallbackSeed);
  if (!jid) return fallbackBuffer;

  try {
    const url = await sock.profilePictureUrl(jid, 'image');
    if (!url) return fallbackBuffer;

    const avatarBuffer = await fetchImageBuffer(url);
    if (!avatarBuffer || avatarBuffer.length === 0) return fallbackBuffer;
    return avatarBuffer;
  } catch {
    return fallbackBuffer;
  }
};

const isNearWhite = (r, g, b, a) => a > 0 && r >= 242 && g >= 242 && b >= 242;

const clearNearWhiteEdges = (ctx, size) => {
  const imageData = ctx.getImageData(0, 0, size, size);
  const { data } = imageData;
  const visited = new Uint8Array(size * size);
  const queue = new Uint32Array(size * size);
  let head = 0;
  let tail = 0;

  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const pixelIndex = y * size + x;
    if (visited[pixelIndex]) return;

    const dataIndex = pixelIndex * 4;
    if (!isNearWhite(data[dataIndex], data[dataIndex + 1], data[dataIndex + 2], data[dataIndex + 3])) {
      return;
    }

    visited[pixelIndex] = 1;
    queue[tail] = pixelIndex;
    tail += 1;
  };

  for (let x = 0; x < size; x += 1) {
    push(x, 0);
    push(x, size - 1);
  }
  for (let y = 1; y < size - 1; y += 1) {
    push(0, y);
    push(size - 1, y);
  }

  while (head < tail) {
    const pixelIndex = queue[head];
    head += 1;

    const dataIndex = pixelIndex * 4;
    data[dataIndex + 3] = 0;

    const x = pixelIndex % size;
    const y = Math.floor(pixelIndex / size);

    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }

  ctx.putImageData(imageData, 0, 0);
};

const buildAvatarCanvas = async (avatarBuffer, fallbackSeed) => {
  const canvas = createCanvas(QUOTE_AVATAR_SIZE, QUOTE_AVATAR_SIZE);
  const ctx = canvas.getContext('2d');

  let sourceImage = null;
  try {
    sourceImage = await loadImage(avatarBuffer);
  } catch {
    sourceImage = await loadImage(buildFallbackAvatarBuffer(fallbackSeed));
  }

  ctx.clearRect(0, 0, QUOTE_AVATAR_SIZE, QUOTE_AVATAR_SIZE);
  ctx.drawImage(sourceImage, 0, 0, QUOTE_AVATAR_SIZE, QUOTE_AVATAR_SIZE);
  clearNearWhiteEdges(ctx, QUOTE_AVATAR_SIZE);

  return canvas;
};

const drawRoundedRect = (ctx, x, y, width, height, radius) => {
  const safeRadius = Math.min(radius, width / 2, height / 2);

  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
};

const renderQuoteImage = async ({ authorName, quoteText, avatarBuffer }) => {
  const safeAuthorName = `${authorName || ''}`.trim() || 'user';
  const safeQuoteText = `${quoteText || ''}`.trim() || '...';

  const measureCanvas = createCanvas(QUOTE_CANVAS_MAX_WIDTH, 320);
  const measureCtx = measureCanvas.getContext('2d');

  const maxInnerWidth = QUOTE_CANVAS_MAX_WIDTH - QUOTE_BUBBLE_X - QUOTE_BUBBLE_RIGHT_MARGIN - QUOTE_BUBBLE_PADDING_X * 2;

  const nameFontSize = fitAuthorFontSize(measureCtx, safeAuthorName, maxInnerWidth);
  const quoteFit = fitQuoteLines(measureCtx, safeQuoteText, maxInnerWidth);

  measureCtx.font = `700 ${nameFontSize}px ${QUOTE_FONT_FAMILY}`;
  const measuredNameWidth = measureTextVisualWidth(measureCtx, safeAuthorName, nameFontSize);

  measureCtx.font = `500 ${quoteFit.fontSize}px ${QUOTE_FONT_FAMILY}`;
  const measuredTextWidth = Math.max(...quoteFit.lines.map((line) => measureTextVisualWidth(measureCtx, line, quoteFit.fontSize)));

  const innerContentWidth = clamp(Math.ceil(Math.max(measuredNameWidth, measuredTextWidth)), 180, maxInnerWidth);
  const bubbleWidth = innerContentWidth + QUOTE_BUBBLE_PADDING_X * 2;

  const nameLineHeight = Math.round(nameFontSize * 1.08);
  const textLineHeight = Math.round(quoteFit.fontSize * 1.22);

  const bubbleHeight = QUOTE_BUBBLE_PADDING_TOP + nameLineHeight + QUOTE_NAME_TEXT_GAP + quoteFit.lines.length * textLineHeight + QUOTE_BUBBLE_PADDING_BOTTOM;

  const canvasWidth = clamp(Math.ceil(QUOTE_BUBBLE_X + bubbleWidth + QUOTE_BUBBLE_RIGHT_MARGIN), QUOTE_CANVAS_MIN_WIDTH, QUOTE_CANVAS_MAX_WIDTH);
  const canvasHeight = clamp(Math.ceil(QUOTE_BUBBLE_Y + bubbleHeight + QUOTE_BUBBLE_BOTTOM_MARGIN), QUOTE_CANVAS_MIN_HEIGHT, QUOTE_CANVAS_MAX_HEIGHT);

  const canvas = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  drawRoundedRect(ctx, QUOTE_BUBBLE_X, QUOTE_BUBBLE_Y, bubbleWidth, bubbleHeight, QUOTE_BUBBLE_RADIUS);
  ctx.fillStyle = QUOTE_BUBBLE_COLOR;
  ctx.fill();

  const avatarY = Math.round(QUOTE_BUBBLE_Y + (bubbleHeight - QUOTE_AVATAR_SIZE) / 2);
  const avatarRadius = QUOTE_AVATAR_SIZE / 2;
  const avatarCenterX = QUOTE_AVATAR_X + avatarRadius;
  const avatarCenterY = avatarY + avatarRadius;
  const avatarCanvas = await buildAvatarCanvas(avatarBuffer, safeAuthorName);

  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarCenterX, avatarCenterY, avatarRadius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(avatarCanvas, QUOTE_AVATAR_X, avatarY, QUOTE_AVATAR_SIZE, QUOTE_AVATAR_SIZE);
  ctx.restore();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.30)';
  ctx.lineWidth = QUOTE_AVATAR_BORDER;
  ctx.beginPath();
  ctx.arc(avatarCenterX, avatarCenterY, avatarRadius - QUOTE_AVATAR_BORDER / 2, 0, Math.PI * 2);
  ctx.stroke();

  const textX = QUOTE_BUBBLE_X + QUOTE_BUBBLE_PADDING_X;
  let cursorY = QUOTE_BUBBLE_Y + QUOTE_BUBBLE_PADDING_TOP;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = QUOTE_NAME_COLOR;
  ctx.font = `700 ${nameFontSize}px ${QUOTE_FONT_FAMILY}`;
  drawTextWithEmoji(ctx, safeAuthorName, textX, cursorY, nameFontSize);

  cursorY += nameLineHeight + QUOTE_NAME_TEXT_GAP;
  ctx.fillStyle = QUOTE_TEXT_COLOR;
  ctx.font = `500 ${quoteFit.fontSize}px ${QUOTE_FONT_FAMILY}`;

  for (const line of quoteFit.lines) {
    drawTextWithEmoji(ctx, line, textX, cursorY, quoteFit.fontSize);
    cursorY += textLineHeight;
  }

  return canvas.toBuffer('image/png');
};

const writeTempFile = async (buffer, extension) => {
  await fs.mkdir(TEMP_DIR, { recursive: true });
  const filename = `quote_${uuidv4()}.${extension}`;
  const filePath = path.join(TEMP_DIR, filename);
  await fs.writeFile(filePath, buffer);
  return filePath;
};

const sendUsage = async (sock, remoteJid, messageInfo, expirationMessage, commandPrefix = DEFAULT_COMMAND_PREFIX) => {
  await sendAndStore(
    sock,
    remoteJid,
    {
      text: ['🖼️ *Quote*', '', 'Use assim:', `*${commandPrefix}quote* sua mensagem`, '', 'Ou responda uma mensagem com:', `*${commandPrefix}quote*`].join('\n'),
    },
    { quoted: messageInfo, ephemeralExpiration: expirationMessage },
  );
};

export async function handleQuoteCommand({ sock, remoteJid, messageInfo, expirationMessage, senderJid, senderName, text, commandPrefix = DEFAULT_COMMAND_PREFIX }) {
  const contextInfo = messageInfo.message?.extendedTextMessage?.contextInfo;
  const quotedMessage = contextInfo?.quotedMessage;
  const hasQuoted = Boolean(quotedMessage || contextInfo?.stanzaId);
  const mentionedJids = normalizeMentionedJids(contextInfo?.mentionedJid);

  let targetJid = null;
  let targetAltJid = null;
  let quoteText = '';

  if (hasQuoted) {
    const quotedInfo = resolveQuotedTarget(contextInfo);
    targetJid = quotedInfo.participant || quotedInfo.keyParticipant || null;
    targetAltJid = quotedInfo.participantAlt || quotedInfo.keyParticipantAlt || null;
    quoteText = extractTextFromMessage(quotedMessage);
    if (!targetJid && targetAltJid) {
      targetJid = targetAltJid;
    }
  } else {
    const { mention, rest } = parseLeadingMention(text);
    const mentionFromContext = mentionedJids[0] || null;
    const mentionFromText = buildJidFromMention(mention);
    const mentionTarget = mentionFromContext || mentionFromText;
    if (mentionTarget) {
      targetJid = mentionTarget;
      quoteText = rest;
    } else {
      targetJid = senderJid;
      quoteText = text?.trim();
    }
  }

  if (!targetJid) {
    targetJid = senderJid;
  }
  if (!quoteText) {
    await sendUsage(sock, remoteJid, messageInfo, expirationMessage, commandPrefix);
    return;
  }

  const { targetJid: finalTargetJid, resolvedJid } = await resolveTargetJids({
    primaryJid: targetJid,
    altJid: targetAltJid,
  });
  const jidForProfile = resolvedJid || finalTargetJid || targetJid;

  const resolvedName = await resolveDisplayName(sock, jidForProfile);
  const fallbackName = `@${getJidUser(jidForProfile || targetJid) || 'user'}`;
  const senderNameFallback = jidForProfile === senderJid ? senderName : null;
  const authorName = resolvedName || senderNameFallback || fallbackName;

  try {
    const avatarBuffer = await resolveAvatarBuffer(sock, jidForProfile, authorName);
    const imageBuffer = await renderQuoteImage({ authorName, quoteText, avatarBuffer });

    const pngPath = await writeTempFile(imageBuffer, 'png');
    const userId = getJidUser(senderJid) || senderJid || 'unknown';
    let stickerPath;

    try {
      const webpPath = await convertToWebp(pngPath, 'image', userId, uuidv4(), { stretch: false });
      stickerPath = await addStickerMetadata(webpPath, 'OmniZap Quotes', senderName || 'OmniZap', {
        senderName,
        userId: senderJid,
      });
    } catch {
      stickerPath = null;
    }

    if (stickerPath) {
      const stickerBuffer = await fs.readFile(stickerPath);
      await sendAndStore(sock, remoteJid, { sticker: stickerBuffer }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      return;
    }

    await sendAndStore(sock, remoteJid, { image: imageBuffer, caption: '🖼️ Quote' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
  } catch (error) {
    logger.error('handleQuoteCommand: erro ao gerar quote.', error);
    await sendAndStore(sock, remoteJid, { text: '❌ Não foi possível gerar o quote agora. Tente novamente.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
  }
}
