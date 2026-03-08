import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModuleAiHelpWrapper } from '../../services/moduleAiHelpWrapperFactory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const tiktokAiHelpWrapper = createModuleAiHelpWrapper({
  moduleKey: 'tiktok',
  moduleLabel: 'comandos de tiktok',
  envPrefix: 'TIKTOK_AI_HELP',
  moduleDirPath: __dirname,
  moduleNameFallback: 'tiktokModule',
});
