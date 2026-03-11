import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModuleAiHelpWrapper } from '../../services/ai/moduleAiHelpWrapperFactory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const stickerPackAiHelpWrapper = createModuleAiHelpWrapper({
  moduleKey: 'sticker_pack',
  moduleLabel: 'comandos de pacote de stickers',
  envPrefix: 'STICKER_PACK_AI_HELP',
  moduleDirPath: __dirname,
  moduleNameFallback: 'stickerPackModule',
});
