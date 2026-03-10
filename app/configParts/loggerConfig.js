import pino from 'pino';
import { criarInstanciaLogger } from '@kaikybrofc/logger-module';
import baseLogger from '#logger';

const DEFAULT_BAILEYS_LABEL = 'baileys';
const DEFAULT_BAILEYS_LOGGER_MODE = 'child';
const BAILEYS_LOGGER_MODES = new Set(['child', 'instance']);
const DEFAULT_BAILEYS_SOCKET_LOGGER_MODE = 'silent';
const BAILEYS_SOCKET_LOGGER_MODES = new Set(['silent', 'pino', 'bridge']);
const DEFAULT_PINO_LEVEL = 'info';
const DEFAULT_PINO_SILENT_LEVEL = 'silent';
const PINO_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']);
const PINO_LEVEL_PRIORITY = Object.freeze({
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: Number.POSITIVE_INFINITY,
});
const BAILEYS_TO_WINSTON_LEVEL = Object.freeze({
  trace: 'debug',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
});
const BAILEYS_LOG_METHOD_PRIORITY = Object.freeze({
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
});

const parseEnvBool = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

const parseJsonObject = (value, fallback = {}, context = 'JSON') => {
  if (value === undefined || value === null || String(value).trim() === '') {
    return { ...fallback };
  }

  try {
    const parsed = JSON.parse(String(value));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return { ...fallback };
  } catch (error) {
    baseLogger.warn(`Valor inválido em ${context}. Usando fallback.`, {
      errorMessage: error?.message,
    });
    return { ...fallback };
  }
};

const parseTransportDefinitions = (value) => {
  if (value === undefined || value === null || String(value).trim() === '') {
    return undefined;
  }

  try {
    const parsed = JSON.parse(String(value));
    if (!Array.isArray(parsed)) return undefined;

    const validDefinitions = parsed.filter((entry) => entry && typeof entry === 'object' && typeof entry.type === 'string' && entry.options && typeof entry.options === 'object');
    return validDefinitions.length > 0 ? validDefinitions : undefined;
  } catch (error) {
    baseLogger.warn('Valor inválido em BAILEYS_LOGGER_TRANSPORT_DEFINITIONS_JSON. Ignorando customização de transportes.', {
      errorMessage: error?.message,
    });
    return undefined;
  }
};

const normalizeLoggerMode = (value, fallback = DEFAULT_BAILEYS_LOGGER_MODE) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return BAILEYS_LOGGER_MODES.has(normalized) ? normalized : fallback;
};

const normalizeSocketLoggerMode = (value, fallback = DEFAULT_BAILEYS_SOCKET_LOGGER_MODE) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return BAILEYS_SOCKET_LOGGER_MODES.has(normalized) ? normalized : fallback;
};

const normalizeLabel = (value, fallback = DEFAULT_BAILEYS_LABEL) => {
  const normalized = String(value || '')
    .trim()
    .replace(/\s+/g, '_');
  return normalized || fallback;
};

const normalizePinoLevel = (value, fallback = DEFAULT_PINO_LEVEL) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return PINO_LEVELS.has(normalized) ? normalized : fallback;
};

const mapWinstonLevelToPinoLevel = (value) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();

  if (['fatal', 'emerg', 'alert', 'crit'].includes(normalized)) return 'fatal';
  if (normalized === 'error') return 'error';
  if (['warn', 'notice'].includes(normalized)) return 'warn';
  if (['info', 'success', 'http'].includes(normalized)) return 'info';
  if (['debug', 'verbose'].includes(normalized)) return 'debug';
  if (normalized === 'silly') return 'trace';

  return DEFAULT_PINO_LEVEL;
};

const shouldEmitByPinoLevel = (level, method) => {
  const normalizedLevel = normalizePinoLevel(level, DEFAULT_PINO_LEVEL);
  const threshold = PINO_LEVEL_PRIORITY[normalizedLevel] ?? PINO_LEVEL_PRIORITY[DEFAULT_PINO_LEVEL];
  const methodPriority = BAILEYS_LOG_METHOD_PRIORITY[method] ?? BAILEYS_LOG_METHOD_PRIORITY.info;
  return methodPriority >= threshold;
};

const resolveBaseServiceName = () => {
  const raw = String(process.env.name || process.env.ECOSYSTEM_NAME || '').trim();
  return raw || 'sistema';
};

const createLoggerChild = (logger, defaultMeta) => {
  if (logger && typeof logger.child === 'function') {
    return logger.child(defaultMeta);
  }
  return logger || baseLogger;
};

const resolveBaileysLoggerConfig = (overrides = {}) => {
  const mode = normalizeLoggerMode(overrides.mode ?? process.env.BAILEYS_LOGGER_MODE, DEFAULT_BAILEYS_LOGGER_MODE);
  const level = String(overrides.level ?? process.env.BAILEYS_LOGGER_LEVEL ?? '').trim() || undefined;
  const label = normalizeLabel(overrides.label ?? process.env.BAILEYS_LOGGER_LABEL, DEFAULT_BAILEYS_LABEL);
  const service = String(overrides.service ?? process.env.BAILEYS_LOGGER_SERVICE ?? '').trim() || `${resolveBaseServiceName()}-baileys`;
  const enableCustomMeta = parseEnvBool(process.env.BAILEYS_LOGGER_ENABLE_META_JSON, true);
  const envMeta = enableCustomMeta ? parseJsonObject(process.env.BAILEYS_LOGGER_META_JSON, {}, 'BAILEYS_LOGGER_META_JSON') : {};
  const overrideMeta = overrides.defaultMeta && typeof overrides.defaultMeta === 'object' ? overrides.defaultMeta : {};
  const defaultMeta = {
    ...envMeta,
    ...overrideMeta,
    label,
    service,
  };

  const transportDefinitions = overrides.transportDefinitions || parseTransportDefinitions(process.env.BAILEYS_LOGGER_TRANSPORT_DEFINITIONS_JSON);
  const transports = Array.isArray(overrides.transports) ? overrides.transports : undefined;
  const format = overrides.format;

  return {
    mode,
    level,
    label,
    service,
    defaultMeta,
    transportDefinitions,
    transports,
    format,
  };
};

const resolveBaileysSocketLoggerConfig = (overrides = {}) => {
  const mode = normalizeSocketLoggerMode(overrides.mode ?? process.env.BAILEYS_SOCKET_LOGGER_MODE, DEFAULT_BAILEYS_SOCKET_LOGGER_MODE);
  const fallbackLevel = mode === 'silent' ? DEFAULT_PINO_SILENT_LEVEL : DEFAULT_PINO_LEVEL;
  const level = normalizePinoLevel(overrides.level ?? process.env.BAILEYS_SOCKET_LOGGER_LEVEL, fallbackLevel);
  const enableCustomMeta = parseEnvBool(process.env.BAILEYS_SOCKET_LOGGER_ENABLE_META_JSON, true);
  const envBase = enableCustomMeta ? parseJsonObject(process.env.BAILEYS_SOCKET_LOGGER_META_JSON, {}, 'BAILEYS_SOCKET_LOGGER_META_JSON') : {};
  const overrideBase = overrides.base && typeof overrides.base === 'object' ? overrides.base : {};
  const base = {
    ...envBase,
    ...overrideBase,
  };
  const envOptions = parseJsonObject(process.env.BAILEYS_SOCKET_LOGGER_OPTIONS_JSON, {}, 'BAILEYS_SOCKET_LOGGER_OPTIONS_JSON');
  const overrideOptions = overrides.options && typeof overrides.options === 'object' ? overrides.options : {};
  const options = {
    ...envOptions,
    ...overrideOptions,
  };

  return {
    mode,
    level,
    base,
    options,
  };
};

const createConfiguredBaileysLogger = (overrides = {}) => {
  const config = resolveBaileysLoggerConfig(overrides);

  if (config.mode === 'instance') {
    return criarInstanciaLogger({
      level: config.level,
      defaultMeta: config.defaultMeta,
      transportDefinitions: config.transportDefinitions,
      transports: config.transports,
      format: config.format,
    });
  }

  const childLogger = createLoggerChild(baseLogger, config.defaultMeta);
  if (config.level && typeof childLogger === 'object' && childLogger) {
    childLogger.level = config.level;
  }
  return childLogger;
};

const serializeError = (error) => ({
  errorName: error?.name || 'Error',
  errorMessage: error?.message || String(error),
  errorStack: error?.stack,
});

const resolveLogEntry = (obj, msg) => {
  const providedMessage = typeof msg === 'string' ? msg.trim() : '';
  let message = providedMessage;
  let metadata;

  if (obj instanceof Error) {
    metadata = serializeError(obj);
    if (!message) message = obj.message || 'erro_em_logger_baileys';
  } else if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    metadata = { ...obj };
    if (!message && typeof obj.msg === 'string') {
      message = obj.msg.trim();
    }
    if (!message && typeof obj.message === 'string') {
      message = obj.message.trim();
    }
  } else if (obj !== undefined && obj !== null) {
    if (!message && typeof obj === 'string') {
      message = obj.trim();
    } else {
      metadata = { value: obj };
    }
  }

  if (!message) {
    message = 'baileys_socket_event';
  }

  return {
    message,
    metadata: metadata && Object.keys(metadata).length > 0 ? metadata : undefined,
  };
};

const writeBridgeLog = (targetLogger, method, obj, msg) => {
  const methodName = BAILEYS_TO_WINSTON_LEVEL[method] || 'info';
  const { message, metadata } = resolveLogEntry(obj, msg);
  const targetMethod = typeof targetLogger?.[methodName] === 'function' ? targetLogger[methodName].bind(targetLogger) : null;

  if (targetMethod) {
    if (metadata) {
      targetMethod(message, metadata);
    } else {
      targetMethod(message);
    }
    return;
  }

  if (typeof targetLogger?.log === 'function') {
    if (metadata) {
      targetLogger.log(methodName, message, metadata);
    } else {
      targetLogger.log(methodName, message);
    }
  }
};

const createBaileysSocketBridgeLogger = (rootLogger, level) => {
  const sharedState = {
    level: normalizePinoLevel(level, mapWinstonLevelToPinoLevel(rootLogger?.level)),
  };

  const createAdapter = (targetLogger) => ({
    get level() {
      return sharedState.level;
    },
    set level(nextLevel) {
      sharedState.level = normalizePinoLevel(nextLevel, sharedState.level);
    },
    child(bindings = {}) {
      const normalizedBindings = bindings && typeof bindings === 'object' ? bindings : {};
      const childLogger = createLoggerChild(targetLogger, normalizedBindings);
      return createAdapter(childLogger);
    },
    trace(obj, msg) {
      if (!shouldEmitByPinoLevel(sharedState.level, 'trace')) return;
      writeBridgeLog(targetLogger, 'trace', obj, msg);
    },
    debug(obj, msg) {
      if (!shouldEmitByPinoLevel(sharedState.level, 'debug')) return;
      writeBridgeLog(targetLogger, 'debug', obj, msg);
    },
    info(obj, msg) {
      if (!shouldEmitByPinoLevel(sharedState.level, 'info')) return;
      writeBridgeLog(targetLogger, 'info', obj, msg);
    },
    warn(obj, msg) {
      if (!shouldEmitByPinoLevel(sharedState.level, 'warn')) return;
      writeBridgeLog(targetLogger, 'warn', obj, msg);
    },
    error(obj, msg) {
      if (!shouldEmitByPinoLevel(sharedState.level, 'error')) return;
      writeBridgeLog(targetLogger, 'error', obj, msg);
    },
  });

  return createAdapter(rootLogger || baseLogger);
};

let cachedBaileysRootLogger = null;
let cachedBaileysSocketLogger = null;

const getDefaultBaileysRootLogger = () => {
  if (!cachedBaileysRootLogger) {
    cachedBaileysRootLogger = createConfiguredBaileysLogger();
  }
  return cachedBaileysRootLogger;
};

const createConfiguredBaileysSocketLogger = (overrides = {}) => {
  const config = resolveBaileysSocketLoggerConfig(overrides);
  const mergedBase = {
    ...(config.options?.base && typeof config.options.base === 'object' ? config.options.base : {}),
    ...config.base,
  };

  if (config.mode === 'bridge') {
    const bridgeLogger = createBaileysScopedLogger('socket', mergedBase);
    return createBaileysSocketBridgeLogger(bridgeLogger, config.level);
  }

  const level = config.mode === 'silent' ? DEFAULT_PINO_SILENT_LEVEL : config.level;
  const pinoOptions = {
    ...config.options,
    level,
  };
  if (Object.keys(mergedBase).length > 0) {
    pinoOptions.base = mergedBase;
  }
  return pino(pinoOptions);
};

export const createBaileysLogger = (overrides = {}) => {
  if (!overrides || Object.keys(overrides).length === 0) {
    return getDefaultBaileysRootLogger();
  }
  return createConfiguredBaileysLogger(overrides);
};

export const createBaileysScopedLogger = (scope, metadata = {}) => {
  const rootLogger = getDefaultBaileysRootLogger();
  const rootLabel = resolveBaileysLoggerConfig().label;
  const normalizedScope = normalizeLabel(scope, '');
  const scopedLabel = normalizedScope ? `${rootLabel}.${normalizedScope}` : rootLabel;
  const scopedMeta = {
    ...metadata,
    label: scopedLabel,
  };
  return createLoggerChild(rootLogger, scopedMeta);
};

export const createBaileysSocketLogger = (overrides = {}) => {
  if (!overrides || Object.keys(overrides).length === 0) {
    if (!cachedBaileysSocketLogger) {
      cachedBaileysSocketLogger = createConfiguredBaileysSocketLogger();
    }
    return cachedBaileysSocketLogger;
  }
  return createConfiguredBaileysSocketLogger(overrides);
};

export const baileysLogger = createBaileysScopedLogger('');
export const baileysConnectionLogger = createBaileysScopedLogger('connection');
export const baileysConfigLogger = createBaileysScopedLogger('config');
export const baileysAuthLogger = createBaileysScopedLogger('auth');
export const baileysGroupsLogger = createBaileysScopedLogger('groups');
export const baileysSocketLogger = createBaileysSocketLogger();
