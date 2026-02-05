import { createStickerPackService } from './stickerPackService.js';
import {
  bumpStickerPackVersion,
  createStickerPack,
  ensureUniquePackKey,
  findStickerPackByOwnerAndIdentifier,
  listStickerPacksByOwner,
  softDeleteStickerPack,
  updateStickerPackFields,
} from './stickerPackRepository.js';
import {
  bulkUpdateStickerPackPositions,
  countStickerPackItems,
  createStickerPackItem,
  getMaxStickerPackPosition,
  getStickerPackItemByPosition,
  getStickerPackItemByStickerId,
  listStickerPackItems,
  removeStickerPackItemByStickerId,
  shiftStickerPackPositionsAfter,
} from './stickerPackItemRepository.js';

/**
 * Serviço principal de sticker pack com dependências concretas de runtime.
 */
const stickerPackService = createStickerPackService({
  packRepository: {
    createStickerPack,
    listStickerPacksByOwner,
    findStickerPackByOwnerAndIdentifier,
    updateStickerPackFields,
    softDeleteStickerPack,
    ensureUniquePackKey,
    bumpStickerPackVersion,
  },
  itemRepository: {
    listStickerPackItems,
    countStickerPackItems,
    getMaxStickerPackPosition,
    createStickerPackItem,
    getStickerPackItemByStickerId,
    getStickerPackItemByPosition,
    removeStickerPackItemByStickerId,
    shiftStickerPackPositionsAfter,
    bulkUpdateStickerPackPositions,
  },
});

export default stickerPackService;
