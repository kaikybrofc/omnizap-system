import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createModuleCommandConfigRuntime } from '../../services/ai/moduleCommandConfigRuntimeService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(__dirname, 'commandConfig.json');

const DEFAULT_TEXTS = {
  usage_header: '',
};

const runtime = createModuleCommandConfigRuntime({
  configPath: CONFIG_PATH,
  fallbackConfig: {
    module: 'userModule',
    commands: [],
    textos: DEFAULT_TEXTS,
  },
});

const renderUsageMethod = (method, commandPrefix) => String(method || '').replaceAll('<prefix>', String(commandPrefix || '/'));

const resolveUsageLines = (entry, variant) => {
  if (!entry || typeof entry !== 'object') return [];

  const usageMessages = entry?.mensagens_uso && typeof entry.mensagens_uso === 'object' ? entry.mensagens_uso : null;

  if (usageMessages) {
    const variantKey = typeof variant === 'string' ? variant.trim() : '';
    const picked = (variantKey && usageMessages[variantKey]) || usageMessages.default || null;
    if (Array.isArray(picked)) {
      return picked.filter(Boolean).map((value) => String(value));
    }
    if (typeof picked === 'string' && picked.trim()) {
      return [picked.trim()];
    }
  }

  const methods = Array.isArray(entry?.metodos_de_uso) ? entry.metodos_de_uso : [];
  return methods.filter(Boolean).map((value) => String(value));
};

export const getUserModuleConfig = () => runtime.getModuleConfig();

export const resolveUserCommandName = (command) => runtime.resolveCommandName(command);
export const getUserCommandEntry = (command) => runtime.getCommandEntry(command);
export const listEnabledUserCommands = () => runtime.listEnabledCommands();

export const getUserTextConfig = () => {
  const config = getUserModuleConfig();
  const raw = config?.textos && typeof config.textos === 'object' ? config.textos : {};
  return {
    ...DEFAULT_TEXTS,
    ...raw,
  };
};

export const getUserUsageText = (command, { commandPrefix = '/', header, variant } = {}) => {
  const entry = getUserCommandEntry(command);
  const methods = resolveUsageLines(entry, variant);
  if (!methods.length) return '';

  const prefixHeader = typeof header === 'string' ? header : getUserTextConfig().usage_header || DEFAULT_TEXTS.usage_header;
  const lines = methods.map((method) => renderUsageMethod(method, commandPrefix));
  return prefixHeader ? [prefixHeader, ...lines].join('\n') : lines.join('\n');
};
