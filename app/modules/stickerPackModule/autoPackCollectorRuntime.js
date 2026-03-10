import logger from '#logger';
import { createAutoPackCollector } from './autoPackCollectorService.js';
import stickerPackService from './stickerPackServiceRuntime.js';
import { saveStickerAssetFromBuffer } from './stickerStorageService.js';

/**
 * Instância singleton do coletor automático de figurinhas.
 */
const autoPackCollector = createAutoPackCollector({
  logger,
  stickerPackService,
  saveStickerAssetFromBuffer,
});

/**
 * Atalho para adicionar figurinhas ao pack automático do usuário.
 */
export const addStickerToAutoPack = autoPackCollector.addStickerToAutoPack;

export default autoPackCollector;
