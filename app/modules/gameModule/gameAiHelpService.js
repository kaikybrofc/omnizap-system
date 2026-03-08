import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModuleAiHelpWrapper } from '../../services/moduleAiHelpWrapperFactory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const gameAiHelpWrapper = createModuleAiHelpWrapper({
  moduleKey: 'game',
  moduleLabel: 'comandos de jogo',
  envPrefix: 'GAME_AI_HELP',
  moduleDirPath: __dirname,
  moduleNameFallback: 'gameModule',
});
