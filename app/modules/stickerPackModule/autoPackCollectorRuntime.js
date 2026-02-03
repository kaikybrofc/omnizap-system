import logger from '../../utils/logger/loggerModule.js';
import { createAutoPackCollector } from './autoPackCollectorService.js';
import stickerPackService from './stickerPackServiceRuntime.js';
import { saveStickerAssetFromBuffer } from './stickerStorageService.js';

const autoPackCollector = createAutoPackCollector({
  logger,
  stickerPackService,
  saveStickerAssetFromBuffer,
});

export const addStickerToAutoPack = autoPackCollector.addStickerToAutoPack;

export default autoPackCollector;
