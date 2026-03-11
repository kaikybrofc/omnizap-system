import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModuleAiHelpWrapper } from '../../services/ai/moduleAiHelpWrapperFactory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const quoteAiHelpWrapper = createModuleAiHelpWrapper({
  moduleKey: 'quote',
  moduleLabel: 'comandos de quote',
  envPrefix: 'QUOTE_AI_HELP',
  moduleDirPath: __dirname,
  moduleNameFallback: 'quoteModule',
});
