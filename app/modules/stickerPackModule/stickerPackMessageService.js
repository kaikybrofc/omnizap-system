import logger from '../../utils/logger/loggerModule.js';
import { sendAndStore } from '../../services/messagePersistenceService.js';
import { readStickerAssetBuffer } from './stickerStorageService.js';
import { STICKER_PACK_ERROR_CODES, StickerPackError } from './stickerPackErrors.js';

const MAX_PREVIEW_LIST_LINES = Math.max(5, Number(process.env.STICKER_PACK_PREVIEW_LINES) || 20);
const FALLBACK_SEND_LIMIT = Math.max(1, Number(process.env.STICKER_PACK_FALLBACK_SEND_LIMIT) || 30);
const ZIP_FEATURE_ENABLED = process.env.STICKER_PACK_ZIP_ENABLED === 'true';

const normalizeEmojis = (value) => (Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean).slice(0, 8) : []);

const renderItemLabel = (item, index) => {
  const emojiText = item.emojis?.length ? ` ${item.emojis.join(' ')}` : '';
  const accessibility = item.accessibility_label ? ` — ${item.accessibility_label}` : '';
  return `${index}. #${item.position}${emojiText}${accessibility}`;
};

const buildPreviewText = ({ pack, items, sentCount }) => {
  const lines = items.slice(0, MAX_PREVIEW_LIST_LINES).map((item, index) => renderItemLabel(item, index + 1));

  const truncated = items.length > MAX_PREVIEW_LIST_LINES ? `\n... e mais ${items.length - MAX_PREVIEW_LIST_LINES} figurinha(s)` : '';
  const sendNote = sentCount < items.length ? `\n\n⚠️ Enviadas ${sentCount}/${items.length} no fallback.` : '';

  return [
    `📦 *Pack preview*`,
    `Nome: ${pack.name}`,
    `Publisher: ${pack.publisher}`,
    `ID: ${pack.pack_key}`,
    `Figurinhas: ${items.length}`,
    '',
    lines.join('\n') || 'Sem figurinhas para listar.',
  ].join('\n') + truncated + sendNote;
};

async function buildZipPayload({ pack, coverBuffer, stickers }) {
  if (!ZIP_FEATURE_ENABLED) return null;

  try {
    const { zipSync, strToU8 } = await import('fflate');
    const files = {};

    files['tray-icon.webp'] = new Uint8Array(coverBuffer);

    stickers.forEach((sticker, index) => {
      const indexLabel = String(index + 1).padStart(3, '0');
      files[`sticker-${indexLabel}.webp`] = new Uint8Array(sticker.data);
    });

    files['manifest.json'] = strToU8(
      JSON.stringify(
        {
          packId: pack.pack_key,
          name: pack.name,
          publisher: pack.publisher,
          stickerCount: stickers.length,
        },
        null,
        2,
      ),
    );

    const zipped = zipSync(files, { level: 6 });
    return Buffer.from(zipped.buffer, zipped.byteOffset, zipped.byteLength);
  } catch (error) {
    logger.warn('Não foi possível gerar ZIP do sticker pack (feature-flag).', {
      action: 'sticker_pack_zip_failed',
      error: error.message,
      pack_id: pack.id,
    });
    return null;
  }
}

export async function buildStickerPackMessage(packDetails) {
  const pack = packDetails;
  const items = Array.isArray(packDetails?.items) ? packDetails.items : [];

  if (!pack || !items.length) {
    throw new StickerPackError(STICKER_PACK_ERROR_CODES.INVALID_INPUT, 'Pack sem figurinhas para envio.');
  }

  const preparedItems = [];

  for (const item of items) {
    if (!item?.asset) continue;

    try {
      const buffer = await readStickerAssetBuffer(item.asset);
      preparedItems.push({
        ...item,
        data: buffer,
        emojis: normalizeEmojis(item.emojis),
      });
    } catch (error) {
      logger.warn('Sticker ignorado por falha de leitura no storage.', {
        action: 'sticker_pack_item_skipped',
        pack_id: pack.id,
        sticker_id: item.sticker_id,
        error: error.message,
      });
    }
  }

  if (!preparedItems.length) {
    throw new StickerPackError(
      STICKER_PACK_ERROR_CODES.STORAGE_ERROR,
      'Nenhuma figurinha do pack está disponível para envio.',
    );
  }

  const coverItem = preparedItems.find((item) => item.sticker_id === pack.cover_sticker_id) || preparedItems[0];
  const stickers = preparedItems.map((item) => ({
    data: item.data,
    emojis: item.emojis,
    accessibilityLabel: item.accessibility_label || undefined,
  }));

  const payload = {
    cover: {
      data: coverItem.data,
    },
    name: pack.name,
    publisher: pack.publisher,
    description: pack.description || undefined,
    packId: pack.pack_key,
    stickers,
  };

  const zipBuffer = await buildZipPayload({
    pack,
    coverBuffer: coverItem.data,
    stickers,
  });

  return {
    pack,
    items: preparedItems,
    payload,
    zipBuffer,
  };
}

export async function sendStickerPackWithFallback({
  sock,
  jid,
  messageInfo,
  expirationMessage,
  packBuild,
  fallbackLimit = FALLBACK_SEND_LIMIT,
}) {
  const options = {
    quoted: messageInfo,
    ephemeralExpiration: expirationMessage,
  };

  const nativeAttempts = [{ stickerPack: packBuild.payload }];

  if (packBuild.zipBuffer) {
    nativeAttempts.push({
      stickerPack: {
        ...packBuild.payload,
        zip: packBuild.zipBuffer,
      },
    });
  }

  let nativeError = null;

  for (const content of nativeAttempts) {
    try {
      await sendAndStore(sock, jid, content, options);
      return {
        mode: 'native',
        sentCount: packBuild.items.length,
      };
    } catch (error) {
      nativeError = error;
    }
  }

  logger.warn('Envio nativo de sticker pack falhou, ativando fallback.', {
    action: 'sticker_pack_fallback',
    pack_id: packBuild.pack.id,
    owner_jid: packBuild.pack.owner_jid,
    error: nativeError?.message,
  });

  const total = packBuild.items.length;
  const sendCount = Math.min(total, Math.max(1, Number(fallbackLimit) || FALLBACK_SEND_LIMIT));

  await sendAndStore(
    sock,
    jid,
    {
      text: buildPreviewText({
        pack: packBuild.pack,
        items: packBuild.items,
        sentCount: sendCount,
      }),
    },
    options,
  );

  if (packBuild.payload?.cover?.data) {
    await sendAndStore(
      sock,
      jid,
      {
        sticker: packBuild.payload.cover.data,
      },
      options,
    );
  }

  for (let index = 0; index < sendCount; index += 1) {
    const item = packBuild.items[index];
    if (!item?.data) continue;

    await sendAndStore(
      sock,
      jid,
      {
        sticker: item.data,
      },
      options,
    );
  }

  return {
    mode: 'fallback',
    sentCount: sendCount,
    total,
    nativeError: nativeError?.message || null,
  };
}
