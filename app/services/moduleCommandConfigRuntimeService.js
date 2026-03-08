import fs from 'node:fs';

const normalizeCommandToken = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();

export const createModuleCommandConfigRuntime = ({ configPath, fallbackConfig = {} } = {}) => {
  const normalizedPath = String(configPath || '').trim();
  if (!normalizedPath) {
    throw new Error('createModuleCommandConfigRuntime: configPath e obrigatorio');
  }

  const safeFallback = {
    module: 'module',
    commands: [],
    ...(fallbackConfig || {}),
  };

  let cachedConfig = null;
  let cachedMtimeMs = 0;
  let cachedRegistry = null;

  const loadConfigFromDisk = () => {
    const stat = fs.statSync(normalizedPath);
    if (cachedConfig && stat.mtimeMs === cachedMtimeMs) {
      return cachedConfig;
    }

    const parsed = JSON.parse(fs.readFileSync(normalizedPath, 'utf8'));
    cachedConfig = parsed;
    cachedMtimeMs = stat.mtimeMs;
    cachedRegistry = null;
    return parsed;
  };

  const getModuleConfig = () => {
    try {
      return loadConfigFromDisk();
    } catch {
      return safeFallback;
    }
  };

  const buildRegistry = () => {
    if (cachedRegistry) return cachedRegistry;

    const config = getModuleConfig();
    const entries = Array.isArray(config?.commands) ? config.commands : [];
    const aliasToCanonical = new Map();
    const commandEntryByCanonical = new Map();

    for (const entry of entries) {
      if (!entry || entry.enabled === false) continue;

      const canonical = normalizeCommandToken(entry.name);
      if (!canonical) continue;

      commandEntryByCanonical.set(canonical, entry);
      aliasToCanonical.set(canonical, canonical);

      const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
      for (const alias of aliases) {
        const normalizedAlias = normalizeCommandToken(alias);
        if (!normalizedAlias) continue;
        aliasToCanonical.set(normalizedAlias, canonical);
      }
    }

    cachedRegistry = {
      aliasToCanonical,
      commandEntryByCanonical,
    };

    return cachedRegistry;
  };

  const resolveCommandName = (command) => {
    const normalized = normalizeCommandToken(command);
    if (!normalized) return null;

    const { aliasToCanonical } = buildRegistry();
    return aliasToCanonical.get(normalized) || null;
  };

  const getCommandEntry = (command) => {
    const canonical = resolveCommandName(command);
    if (!canonical) return null;

    const { commandEntryByCanonical } = buildRegistry();
    return commandEntryByCanonical.get(canonical) || null;
  };

  const listEnabledCommands = () => {
    const { commandEntryByCanonical } = buildRegistry();
    return [...commandEntryByCanonical.values()];
  };

  const isCommandName = (command) => Boolean(resolveCommandName(command));

  return {
    getModuleConfig,
    resolveCommandName,
    getCommandEntry,
    listEnabledCommands,
    isCommandName,
  };
};
