import { STICKER_PACK_ERROR_CODES, StickerPackError } from './stickerPackErrors.js';
import { sanitizeText, toVisibility } from './stickerPackUtils.js';

/**
 * Serviço responsável por direcionar figurinhas recém-criadas para packs automáticos.
 */
const DEFAULT_AUTO_PACK_NAME = process.env.STICKER_PACK_AUTO_PACK_NAME || 'pack';
const DEFAULT_AUTO_PACK_VISIBILITY = toVisibility(process.env.STICKER_PACK_AUTO_PACK_VISIBILITY || 'private', 'private');
const AUTO_COLLECT_ENABLED = process.env.STICKER_PACK_AUTO_COLLECT_ENABLED !== 'false';
const AUTO_PACK_NAME_MAX_LENGTH = 120;

/**
 * Escapa texto para uso seguro em RegExp.
 *
 * @param {unknown} value Valor de entrada.
 * @returns {string} Valor escapado.
 */
const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Remove acentos para facilitar normalização de nomes.
 *
 * @param {unknown} value Valor de entrada.
 * @returns {string} Texto sem diacríticos.
 */
const removeDiacritics = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Gera nome de pack automático válido no padrão aceito.
 *
 * @param {unknown} value Nome base.
 * @param {{ fallback?: string, maxLength?: number }} [options] Configurações de fallback/tamanho.
 * @returns {string} Nome normalizado.
 */
const normalizeAutoPackName = (value, { fallback = 'pack', maxLength = AUTO_PACK_NAME_MAX_LENGTH } = {}) => {
  const sanitized = sanitizeText(value, maxLength, { allowEmpty: true }) || '';
  const normalized = removeDiacritics(sanitized)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, maxLength);

  return normalized || fallback;
};

/**
 * Monta candidato incremental para nome de pack automático.
 *
 * @param {string} base Base do nome.
 * @param {number} index Índice incremental.
 * @returns {string} Nome candidato.
 */
const buildAutoPackCandidate = (base, index) => {
  const suffix = String(index);
  const maxBaseLength = Math.max(1, AUTO_PACK_NAME_MAX_LENGTH - suffix.length);
  const trimmedBase = normalizeAutoPackName(base, { fallback: 'pack', maxLength: maxBaseLength });
  return `${trimmedBase}${suffix}`;
};

/**
 * Define o próximo nome disponível para auto packs.
 *
 * @param {Array<{name?: string}>} packs Packs já existentes.
 * @returns {string} Nome único sugerido.
 */
const makeAutoPackName = (packs) => {
  const base = normalizeAutoPackName(DEFAULT_AUTO_PACK_NAME, { fallback: 'pack', maxLength: AUTO_PACK_NAME_MAX_LENGTH });
  const normalizedBase = base.toLowerCase();
  const existingNames = packs
    .map((pack) => normalizeAutoPackName(pack?.name, { fallback: '', maxLength: AUTO_PACK_NAME_MAX_LENGTH }))
    .filter(Boolean)
    .map((name) => name.toLowerCase());
  const existingSet = new Set(existingNames);
  const usedIndexes = new Set();
  const matcher = new RegExp(`^${escapeRegex(normalizedBase)}(\\d+)?$`, 'i');

  for (const name of existingNames) {
    const match = name.match(matcher);
    if (!match) continue;

    if (!match[1]) {
      usedIndexes.add(1);
      continue;
    }

    const parsedIndex = Number(match[1]);
    if (Number.isInteger(parsedIndex) && parsedIndex > 0) {
      usedIndexes.add(parsedIndex);
    }
  }

  let index = 1;
  while (index < 10_000) {
    const candidate = buildAutoPackCandidate(base, index);
    if (!usedIndexes.has(index) && !existingSet.has(candidate.toLowerCase())) {
      return candidate;
    }
    index += 1;
  }

  const fallbackIndex = Math.max(1, packs.length + 1);
  return buildAutoPackCandidate(base, fallbackIndex);
};

/**
 * Cria coletor automático de figurinhas para packs.
 *
 * @param {{
 *   enabled?: boolean,
 *   logger?: { info?: Function, warn?: Function, error?: Function, debug?: Function },
 *   stickerPackService?: object,
 *   saveStickerAssetFromBuffer?: Function,
 * }} [options] Dependências/configurações de runtime.
 * @returns {{ addStickerToAutoPack: Function }} API do coletor.
 */
export function createAutoPackCollector(options = {}) {
  const deps = {
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    stickerPackService: null,
    saveStickerAssetFromBuffer: null,
    ...options,
  };

  const isEnabled = options.enabled ?? AUTO_COLLECT_ENABLED;

  if (isEnabled) {
    if (!deps.stickerPackService || typeof deps.stickerPackService.listPacks !== 'function') {
      throw new Error('createAutoPackCollector: stickerPackService inválido.');
    }

    if (typeof deps.saveStickerAssetFromBuffer !== 'function') {
      throw new Error('createAutoPackCollector: saveStickerAssetFromBuffer é obrigatório.');
    }
  }

  const ensureTargetPack = async ({ ownerJid, senderName }) => {
    const packs = await deps.stickerPackService.listPacks({ ownerJid, limit: 30 });
    if (packs.length > 0) {
      return {
        pack: packs[0],
        packs,
      };
    }

    const created = await deps.stickerPackService.createPack({
      ownerJid,
      name: makeAutoPackName([]),
      publisher: sanitizeText(senderName, 120, { allowEmpty: true }) || 'OmniZap',
      description: 'Coleção automática de figurinhas criadas pelo usuário.',
      visibility: DEFAULT_AUTO_PACK_VISIBILITY,
    });

    return {
      pack: created,
      packs: [created],
    };
  };

  const addStickerToAutoPack = async ({ ownerJid, senderName, stickerBuffer }) => {
    if (!isEnabled) {
      return { status: 'skipped', reason: 'disabled' };
    }

    if (!Buffer.isBuffer(stickerBuffer) || !stickerBuffer.length) {
      return { status: 'skipped', reason: 'invalid_buffer' };
    }

    const asset = await deps.saveStickerAssetFromBuffer({
      ownerJid,
      buffer: stickerBuffer,
      mimetype: 'image/webp',
    });

    const { pack: targetPack, packs } = await ensureTargetPack({ ownerJid, senderName });

    try {
      const updated = await deps.stickerPackService.addStickerToPack({
        ownerJid,
        identifier: targetPack.id,
        asset,
      });

      deps.logger.info('Figurinha adicionada automaticamente ao pack.', {
        action: 'sticker_pack_auto_collect',
        owner_jid: ownerJid,
        pack_id: updated.id,
        sticker_id: asset.id,
      });

      return {
        status: 'added',
        pack: updated,
        asset,
      };
    } catch (error) {
      if (error instanceof StickerPackError && error.code === STICKER_PACK_ERROR_CODES.DUPLICATE_STICKER) {
        return {
          status: 'duplicate',
          pack: targetPack,
          asset,
        };
      }

      if (error instanceof StickerPackError && error.code === STICKER_PACK_ERROR_CODES.PACK_LIMIT_REACHED) {
        const created = await deps.stickerPackService.createPack({
          ownerJid,
          name: makeAutoPackName(packs),
          publisher: sanitizeText(senderName, 120, { allowEmpty: true }) || targetPack.publisher || 'OmniZap',
          description: 'Coleção automática de figurinhas criadas pelo usuário.',
          visibility: targetPack.visibility || DEFAULT_AUTO_PACK_VISIBILITY,
        });

        const updated = await deps.stickerPackService.addStickerToPack({
          ownerJid,
          identifier: created.id,
          asset,
        });

        deps.logger.info('Figurinha adicionada ao novo pack automático após limite.', {
          action: 'sticker_pack_auto_collect_rollover',
          owner_jid: ownerJid,
          pack_id: updated.id,
          sticker_id: asset.id,
        });

        return {
          status: 'added',
          pack: updated,
          asset,
        };
      }

      throw error;
    }
  };

  return {
    addStickerToAutoPack,
  };
}
