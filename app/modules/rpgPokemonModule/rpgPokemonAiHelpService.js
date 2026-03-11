import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModuleAiHelpWrapper } from '../../services/ai/moduleAiHelpWrapperFactory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const rpgPokemonAiHelpWrapper = createModuleAiHelpWrapper({
  moduleKey: 'rpg_pokemon',
  moduleLabel: 'comandos de rpg pokemon',
  envPrefix: 'RPG_POKEMON_AI_HELP',
  moduleDirPath: __dirname,
  moduleNameFallback: 'rpgPokemonModule',
});
