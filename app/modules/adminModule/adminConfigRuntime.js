import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(__dirname, 'commandConfig.json');

const DEFAULT_TEXTS = {
  group_only_command_message: 'Este comando está disponível apenas em conversas de grupo. Execute-o em um grupo para continuar.',
  no_permission_command_message: 'Permissão insuficiente para executar este comando. Solicite suporte a um administrador do grupo.',
  owner_only_command_message: 'Você não possui permissão para executar este comando. Este recurso é exclusivo do administrador principal do bot.',
  usage_header: 'Formato de uso:',
};

const DEFAULT_EVENT_MESSAGES = {
  welcome: '👋 Bem-vindo(a) ao grupo @groupname, @user! 🎉',
  farewell: '😥 Adeus, @user! Sentiremos sua falta.',
  promote: 'O usuário @{{participant}} foi promovido a administrador do grupo. 🎉',
  demote: 'O usuário @{{participant}} não é mais um administrador do grupo. ⬇️',
  captcha_line: '\n🤖 *Verificação humana*\n@{{participant}}, reaja a esta mensagem ou envie qualquer mensagem em até *{{captcha_timeout_min}} minutos* para continuar no grupo.\n\n',
};

const DEFAULT_EVENT_CONFIG = {
  placeholders_suportados: [],
  mensagens_padrao: DEFAULT_EVENT_MESSAGES,
  auto_approve_skip_actions: ['reject', 'rejected', 'cancel', 'canceled', 'approve', 'approved', 'accept', 'accepted', 'remove', 'removed'],
};

let cachedConfig = null;
let cachedMtimeMs = 0;
let cachedRegistry = null;

const normalizeCommandToken = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();

const loadConfigFromDisk = () => {
  const stat = fs.statSync(CONFIG_PATH);
  if (cachedConfig && stat.mtimeMs === cachedMtimeMs) {
    return cachedConfig;
  }

  const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  cachedConfig = parsed;
  cachedMtimeMs = stat.mtimeMs;
  cachedRegistry = null;
  return parsed;
};

export const getAdminModuleConfig = () => {
  try {
    return loadConfigFromDisk();
  } catch {
    return {
      module: 'adminModule',
      commands: [],
      textos: DEFAULT_TEXTS,
      events: DEFAULT_EVENT_CONFIG,
    };
  }
};

const buildRegistry = () => {
  if (cachedRegistry) return cachedRegistry;

  const config = getAdminModuleConfig();
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

export const resolveAdminCommandName = (command) => {
  const normalized = normalizeCommandToken(command);
  if (!normalized) return null;

  const { aliasToCanonical } = buildRegistry();
  return aliasToCanonical.get(normalized) || null;
};

export const isAdminCommandName = (command) => Boolean(resolveAdminCommandName(command));

export const getAdminCommandEntry = (command) => {
  const canonical = resolveAdminCommandName(command);
  if (!canonical) return null;

  const { commandEntryByCanonical } = buildRegistry();
  return commandEntryByCanonical.get(canonical) || null;
};

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

export const getAdminUsageText = (command, { commandPrefix = '/', header, variant } = {}) => {
  const entry = getAdminCommandEntry(command);
  const methods = resolveUsageLines(entry, variant);
  if (!methods.length) return '';

  const prefixHeader = typeof header === 'string' ? header : getAdminTextConfig().usage_header || DEFAULT_TEXTS.usage_header;
  const lines = methods.map((method) => renderUsageMethod(method, commandPrefix));
  return [prefixHeader, ...lines].join('\n');
};

export const getAdminTextConfig = () => {
  const config = getAdminModuleConfig();
  const raw = config?.textos && typeof config.textos === 'object' ? config.textos : {};
  return {
    ...DEFAULT_TEXTS,
    ...raw,
  };
};

export const getAdminEventConfig = () => {
  const config = getAdminModuleConfig();
  const raw = config?.events && typeof config.events === 'object' ? config.events : {};
  const rawMessages = raw?.mensagens_padrao && typeof raw.mensagens_padrao === 'object' ? raw.mensagens_padrao : {};

  return {
    ...DEFAULT_EVENT_CONFIG,
    ...raw,
    mensagens_padrao: {
      ...DEFAULT_EVENT_MESSAGES,
      ...rawMessages,
    },
    auto_approve_skip_actions: Array.isArray(raw.auto_approve_skip_actions) ? raw.auto_approve_skip_actions.map((value) => normalizeCommandToken(value)).filter(Boolean) : DEFAULT_EVENT_CONFIG.auto_approve_skip_actions,
    placeholders_suportados: Array.isArray(raw.placeholders_suportados) ? raw.placeholders_suportados.filter(Boolean) : DEFAULT_EVENT_CONFIG.placeholders_suportados,
  };
};
