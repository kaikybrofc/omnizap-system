import logger from '../../utils/logger/loggerModule.js';
import { sendAndStore } from '../../services/messagePersistenceService.js';
import { readStickerAssetBuffer } from './stickerStorageService.js';
import { STICKER_PACK_ERROR_CODES, StickerPackError } from './stickerPackErrors.js';

/**
 * Serviço de montagem/envio de mensagens para packs de figurinha.
 */
const MAX_PREVIEW_LIST_LINES = Math.max(5, Number(process.env.STICKER_PACK_PREVIEW_LINES) || 20);
const FALLBACK_SEND_LIMIT = Math.max(1, Number(process.env.STICKER_PACK_FALLBACK_SEND_LIMIT) || 30);
const ZIP_FEATURE_ENABLED = process.env.STICKER_PACK_ZIP_ENABLED === 'true';
const PACK_VISUAL_DIVIDER = '━━━━━━━━━━━━━━━━━━━';

/**
 * Normaliza lista de emojis de um item.
 *
 * @param {unknown} value Valor de origem.
 * @returns {string[]} Emojis válidos.
 */
const normalizeEmojis = (value) =>
  Array.isArray(value)
    ? value
        .map((item) => String(item))
        .filter(Boolean)
        .slice(0, 8)
    : [];

/**
 * Renderiza linha textual de um item para o preview fallback.
 *
 * @param {object} item Item do pack.
 * @param {number} index Índice exibido.
 * @returns {string} Linha renderizada.
 */
const renderItemLabel = (item, index) => {
  const emojiText = item.emojis?.length ? ` ${item.emojis.join(' ')}` : '';
  const accessibility = item.accessibility_label ? ` — ${item.accessibility_label}` : '';
  return `${index}. #${item.position}${emojiText}${accessibility}`;
};

/**
 * Monta texto de preview para modo de envio compatível.
 *
 * @param {{ pack: object, items: object[], sentCount: number }} params Dados para composição.
 * @returns {string} Mensagem textual pronta para envio.
 */
const buildPreviewText = ({ pack, items, sentCount }) => {
  const lines = items.slice(0, MAX_PREVIEW_LIST_LINES).map((item, index) => renderItemLabel(item, index + 1));
  const previewLines = [...lines];
  if (items.length > MAX_PREVIEW_LIST_LINES) {
    previewLines.push(`... e mais ${items.length - MAX_PREVIEW_LIST_LINES} figurinha(s).`);
  }

  const compatibilityNote = sentCount < items.length ? `⚠️ Por compatibilidade, enviei ${sentCount}/${items.length} figurinha(s) neste fallback.` : `✅ Envio completo no fallback: ${sentCount}/${items.length} figurinha(s).`;

  return ['📦 *GERENCIADOR DE PACKS DE FIGURINHAS*', '', '📤 *ENVIO EM MODO DE COMPATIBILIDADE*', 'Seu cliente não aceitou o pack nativo, então enviei preview + figurinhas individuais.', '', PACK_VISUAL_DIVIDER, '📌 *RESUMO DO PACK*', '', `📛 Nome: *${pack.name}*`, `👤 Publisher: *${pack.publisher}*`, `🆔 ID: \`${pack.pack_key}\``, `🧩 Figurinhas disponíveis: *${items.length}*`, '', PACK_VISUAL_DIVIDER, '🖼 *PRÉVIA DAS FIGURINHAS*', '', previewLines.join('\n') || 'Nenhuma figurinha disponível para listar.', '', PACK_VISUAL_DIVIDER, compatibilityNote].join('\n');
};

/**
 * Gera ZIP opcional (feature flag) com conteúdo do pack.
 *
 * @param {{ pack: object, coverBuffer: Buffer, stickers: Array<{ data: Buffer }> }} params Dados do pacote.
 * @returns {Promise<Buffer|null>} ZIP gerado ou `null`.
 */
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

/**
 * Monta payload nativo do pack com buffers já carregados.
 *
 * @param {object} packDetails Pack completo com `items`.
 * @returns {Promise<{ pack: object, items: object[], payload: object, zipBuffer: Buffer|null }>} Dados prontos para envio.
 */
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
    throw new StickerPackError(STICKER_PACK_ERROR_CODES.STORAGE_ERROR, 'Nenhuma figurinha do pack está disponível para envio.');
  }

  const coverItem = preparedItems.find((item) => item.sticker_id === pack.cover_sticker_id) || preparedItems[0];
  const stickers = preparedItems.map((item) => ({
    data: item.data,
    emojis: item.emojis,
    accessibilityLabel: item.accessibility_label || undefined,
  }));

  const payload = {
    // Baileys feat-add-stickerpack-support espera cover como media direto (Buffer/stream/url).
    cover: coverItem.data,
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

/**
 * Tenta enviar pack no modo nativo e cai para fallback quando necessário.
 *
 * @param {{
 *   sock: object,
 *   jid: string,
 *   messageInfo: object,
 *   expirationMessage: number|undefined,
 *   packBuild: { pack: object, items: object[], payload: object },
 *   fallbackLimit?: number,
 * }} params Contexto de envio.
 * @returns {Promise<{ mode: 'native'|'fallback', sentCount: number, total?: number, nativeError?: string|null }>}
 */
export async function sendStickerPackWithFallback({ sock, jid, messageInfo, expirationMessage, packBuild, fallbackLimit = FALLBACK_SEND_LIMIT }) {
  const options = {
    quoted: messageInfo,
    ephemeralExpiration: expirationMessage,
  };

  let nativeError = null;
  try {
    // Modo pack nativo.
    await sendAndStore(
      sock,
      jid,
      {
        stickerPack: packBuild.payload,
      },
      options,
    );

    return {
      mode: 'native',
      sentCount: packBuild.items.length,
    };
  } catch (error) {
    nativeError = error;
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

  if (packBuild.payload?.cover) {
    await sendAndStore(
      sock,
      jid,
      {
        sticker: packBuild.payload.cover,
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
