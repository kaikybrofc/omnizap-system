import fs from 'node:fs';
import path from 'node:path';

const MODULES_DIR = path.resolve(process.cwd(), 'app/modules');

const normalizeToken = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();

const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const discoverModuleConfigFiles = () => {
  let moduleEntries = [];
  try {
    moduleEntries = fs.readdirSync(MODULES_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  return moduleEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const moduleDir = entry.name;
      return {
        moduleDir,
        modulePath: path.join(MODULES_DIR, moduleDir),
        configPath: path.join(MODULES_DIR, moduleDir, 'commandConfig.json'),
      };
    })
    .filter((entry) => fs.existsSync(entry.configPath))
    .sort((a, b) => a.moduleDir.localeCompare(b.moduleDir));
};

const isObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));

const ensureBooleanField = (target, field, errors, context) => {
  if (typeof target?.[field] !== 'boolean') {
    errors.push(`${context}: campo booleano obrigatorio ausente/invalido '${field}'`);
  }
};

const ensureArrayField = (target, field, errors, context) => {
  if (!Array.isArray(target?.[field])) {
    errors.push(`${context}: campo array obrigatorio ausente/invalido '${field}'`);
  }
};

const ensureStringField = (target, field, errors, context, { allowEmpty = false } = {}) => {
  const value = target?.[field];
  if (typeof value !== 'string') {
    errors.push(`${context}: campo string obrigatorio ausente/invalido '${field}'`);
    return;
  }
  if (!allowEmpty && !value.trim()) {
    errors.push(`${context}: campo string vazio '${field}'`);
  }
};

const validateLegacyPreConditions = (preCondicoes, errors, context) => {
  if (!isObject(preCondicoes)) {
    errors.push(`${context}: pre_condicoes ausente/invalido`);
    return;
  }
  const requiredBooleans = ['requer_grupo', 'requer_admin', 'requer_admin_principal', 'requer_google_login', 'requer_nsfw', 'requer_midia', 'requer_mensagem_respondida'];
  for (const field of requiredBooleans) {
    ensureBooleanField(preCondicoes, field, errors, `${context}.pre_condicoes`);
  }
};

const validateLegacyCommandShape = (command, { moduleDir }) => {
  const errors = [];
  const context = `${moduleDir}.${String(command?.name || 'command')}`;

  if (!isObject(command)) {
    errors.push(`${context}: entrada de comando invalida`);
    return errors;
  }

  ensureStringField(command, 'name', errors, context);
  ensureArrayField(command, 'aliases', errors, context);
  ensureArrayField(command, 'metodos_de_uso', errors, context);
  ensureArrayField(command, 'argumentos', errors, context);
  ensureStringField(command, 'categoria', errors, context);
  ensureBooleanField(command, 'enabled', errors, context);
  validateLegacyPreConditions(command.pre_condicoes, errors, context);

  return errors;
};

const validateV2RequirementsShape = (requirements, errors, context) => {
  if (!isObject(requirements)) {
    errors.push(`${context}: requirements ausente/invalido`);
    return;
  }
  const requiredBooleans = ['require_group', 'require_group_admin', 'require_bot_owner', 'require_google_login', 'require_nsfw_enabled', 'require_media', 'require_reply_message'];
  for (const field of requiredBooleans) {
    ensureBooleanField(requirements, field, errors, `${context}.requirements`);
  }
};

const validateV2HandlerShape = (handler, errors, context) => {
  if (!isObject(handler)) {
    errors.push(`${context}: handler ausente/invalido`);
    return;
  }
  ensureStringField(handler, 'file', errors, `${context}.handler`);
  ensureStringField(handler, 'method', errors, `${context}.handler`);
};

const validateV2CommandShape = (command, { moduleDir, moduleKey }) => {
  const errors = [];
  const context = `${moduleDir}.${String(command?.name || 'command')}`;

  const requiredStringFields = ['id', 'description', 'permission', 'version', 'stability', 'risk_level'];
  for (const field of requiredStringFields) {
    ensureStringField(command, field, errors, context);
  }

  ensureArrayField(command, 'usage', errors, context);
  ensureArrayField(command, 'contexts', errors, context);
  ensureArrayField(command, 'collected_data', errors, context);
  ensureArrayField(command, 'arguments', errors, context);
  ensureArrayField(command, 'dependencies', errors, context);
  ensureArrayField(command, 'side_effects', errors, context);

  ensureBooleanField(command, 'deprecated', errors, context);

  if (!isObject(command.docs)) {
    errors.push(`${context}: docs ausente/invalido`);
  }
  if (!isObject(command.behavior)) {
    errors.push(`${context}: behavior ausente/invalido`);
  }
  if (!isObject(command.limits)) {
    errors.push(`${context}: limits ausente/invalido`);
  }
  if (!isObject(command.observability)) {
    errors.push(`${context}: observability ausente/invalido`);
  }
  if (!isObject(command.privacy)) {
    errors.push(`${context}: privacy ausente/invalido`);
  }
  if (!isObject(command.discovery)) {
    errors.push(`${context}: discovery ausente/invalido`);
  }
  if (!isObject(command.access)) {
    errors.push(`${context}: access ausente/invalido`);
  }
  if (!isObject(command.plan_limits)) {
    errors.push(`${context}: plan_limits ausente/invalido`);
  }

  validateV2RequirementsShape(command.requirements, errors, context);
  validateV2HandlerShape(command.handler, errors, context);

  const expectedPrefix = `${moduleKey}.`;
  if (typeof command.id === 'string' && command.id.trim() && !command.id.startsWith(expectedPrefix)) {
    errors.push(`${context}: id fora do prefixo esperado '${expectedPrefix}' (recebido: ${command.id})`);
  }

  return errors;
};

const validateModuleRootShape = (moduleEntry) => {
  const errors = [];
  const config = moduleEntry.config;
  const context = moduleEntry.moduleDir;

  if (!isObject(config)) {
    errors.push(`${context}: commandConfig raiz invalido`);
    return errors;
  }

  ensureStringField(config, 'schema_version', errors, context);
  ensureStringField(config, 'module', errors, context);
  ensureBooleanField(config, 'enabled', errors, context);
  ensureArrayField(config, 'source_files', errors, context);
  ensureArrayField(config, 'commands', errors, context);

  const major = Number.parseInt(String(config?.schema_version || '').split('.')[0], 10);
  if (Number.isFinite(major) && major >= 2 && !isObject(config.defaults)) {
    errors.push(`${context}: defaults obrigatorio para schema_version >= 2`);
  }

  return errors;
};

const validateStructuralShapes = ({ modules }) => {
  const errors = [];
  let validatedModules = 0;
  let validatedCommands = 0;

  for (const moduleEntry of modules) {
    const rootErrors = validateModuleRootShape(moduleEntry);
    errors.push(...rootErrors);

    const config = moduleEntry.config;
    const commands = Array.isArray(config?.commands) ? config.commands : [];
    const major = Number.parseInt(String(config?.schema_version || '').split('.')[0], 10);
    const moduleKey =
      String(config?.module || moduleEntry.moduleDir)
        .replace(/module$/i, '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '') || 'module';

    for (const command of commands) {
      errors.push(...validateLegacyCommandShape(command, moduleEntry));
      if (Number.isFinite(major) && major >= 2) {
        errors.push(...validateV2CommandShape(command, { moduleDir: moduleEntry.moduleDir, moduleKey }));
      }
    }

    validatedModules += 1;
    validatedCommands += commands.length;
  }

  return { errors, validatedModules, validatedCommands };
};

const buildCommandRef = ({ moduleName, commandName }) => `${String(moduleName || '').trim() || 'module'}.${String(commandName || '').trim() || 'command'}`;

const methodExistsInSource = (source, methodName) => {
  const escaped = escapeRegExp(methodName);
  const patterns = [new RegExp(`export\\s+(?:async\\s+)?function\\s+${escaped}\\b`), new RegExp(`export\\s+const\\s+${escaped}\\b`), new RegExp(`export\\s+\\{[^}]*\\b${escaped}\\b[^}]*\\}`, 's'), new RegExp(`\\bfunction\\s+${escaped}\\b`), new RegExp(`\\b${escaped}\\s*:\\s*(?:async\\s*)?\\(`), new RegExp(`^\\s*(?:async\\s+)?${escaped}\\s*\\(`, 'm')];
  return patterns.some((regex) => regex.test(source));
};

const validateHandlerReferences = ({ modules }) => {
  const errors = [];
  const sourceCache = new Map();

  for (const moduleEntry of modules) {
    const major = Number.parseInt(String(moduleEntry.config?.schema_version || '').split('.')[0], 10);
    const requireHandler = Number.isFinite(major) && major >= 2;
    const commands = Array.isArray(moduleEntry.config?.commands) ? moduleEntry.config.commands : [];
    const moduleName = moduleEntry.config?.module || moduleEntry.moduleDir;

    for (const command of commands) {
      if (!command || command.enabled === false) continue;
      const commandName = String(command.name || '').trim();
      const commandRef = buildCommandRef({ moduleName, commandName });
      const handler = command.handler;

      if (!handler || typeof handler !== 'object') {
        if (requireHandler) {
          errors.push(`${commandRef}: handler ausente para schema v2`);
        }
        continue;
      }

      const file = String(handler.file || '').trim();
      const method = String(handler.method || '').trim();

      if (!file || !method) {
        errors.push(`${commandRef}: handler.file e handler.method sao obrigatorios`);
        continue;
      }

      const absoluteHandlerPath = path.resolve(moduleEntry.modulePath, file);
      const modulePathWithSep = moduleEntry.modulePath.endsWith(path.sep) ? moduleEntry.modulePath : `${moduleEntry.modulePath}${path.sep}`;

      if (absoluteHandlerPath !== moduleEntry.modulePath && !absoluteHandlerPath.startsWith(modulePathWithSep)) {
        errors.push(`${commandRef}: handler.file aponta para fora do modulo (${file})`);
        continue;
      }

      if (!fs.existsSync(absoluteHandlerPath)) {
        errors.push(`${commandRef}: handler.file nao encontrado (${file})`);
        continue;
      }

      let source = sourceCache.get(absoluteHandlerPath);
      if (!source) {
        source = fs.readFileSync(absoluteHandlerPath, 'utf8');
        sourceCache.set(absoluteHandlerPath, source);
      }

      if (!methodExistsInSource(source, method)) {
        errors.push(`${commandRef}: handler.method nao encontrado em ${file} (${method})`);
      }
    }
  }

  return errors;
};

const validateGlobalCollisions = ({ modules }) => {
  const errors = [];
  const tokenMap = new Map();
  const idMap = new Map();

  const upsertMapValue = (map, key, value) => {
    const normalizedKey = normalizeToken(key);
    if (!normalizedKey) return;
    if (!map.has(normalizedKey)) {
      map.set(normalizedKey, []);
    }
    map.get(normalizedKey).push(value);
  };

  for (const moduleEntry of modules) {
    const moduleName = moduleEntry.config?.module || moduleEntry.moduleDir;
    const commands = Array.isArray(moduleEntry.config?.commands) ? moduleEntry.config.commands : [];

    for (const command of commands) {
      if (!command || command.enabled === false) continue;

      const commandName = String(command.name || '').trim();
      if (!commandName) continue;
      const commandRef = buildCommandRef({ moduleName, commandName });
      const aliases = Array.isArray(command.aliases) ? command.aliases : [];

      upsertMapValue(tokenMap, commandName, {
        commandRef,
        moduleName,
        commandName,
        source: 'name',
        token: commandName,
      });

      for (const alias of aliases) {
        const aliasToken = String(alias || '').trim();
        if (!aliasToken) continue;
        upsertMapValue(tokenMap, aliasToken, {
          commandRef,
          moduleName,
          commandName,
          source: 'alias',
          token: aliasToken,
        });
      }

      if (command.id) {
        upsertMapValue(idMap, String(command.id), {
          commandRef,
          moduleName,
          commandName,
          id: String(command.id),
        });
      }
    }
  }

  for (const [token, entries] of tokenMap.entries()) {
    const distinctCommands = new Map(entries.map((entry) => [entry.commandRef, entry]));
    if (distinctCommands.size <= 1) continue;
    const entryList = [...distinctCommands.values()].map((entry) => `${entry.commandRef} (${entry.source}:${entry.token})`).join(' | ');
    errors.push(`colisao de comando/alias '${token}': ${entryList}`);
  }

  for (const [id, entries] of idMap.entries()) {
    const distinctCommands = new Map(entries.map((entry) => [entry.commandRef, entry]));
    if (distinctCommands.size <= 1) continue;
    const entryList = [...distinctCommands.values()].map((entry) => entry.commandRef).join(' | ');
    errors.push(`colisao de id '${id}': ${entryList}`);
  }

  return errors;
};

export const validateAllCommandConfigs = () => {
  const modules = [];
  const errors = [];
  const warnings = [];

  const configFiles = discoverModuleConfigFiles();
  for (const entry of configFiles) {
    try {
      const config = readJson(entry.configPath);
      modules.push({
        ...entry,
        config,
      });
    } catch (error) {
      errors.push(`${entry.moduleDir}: falha ao ler/parsear commandConfig.json (${error?.message})`);
    }
  }

  if (!modules.length) {
    return {
      ok: false,
      errors: [...errors, 'nenhum commandConfig.json encontrado em app/modules'],
      warnings,
      modulesValidated: 0,
      commandsValidated: 0,
    };
  }

  const structuralResult = validateStructuralShapes({ modules });
  errors.push(...structuralResult.errors);

  const collisionErrors = validateGlobalCollisions({ modules });
  errors.push(...collisionErrors);

  const handlerErrors = validateHandlerReferences({ modules });
  errors.push(...handlerErrors);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    modulesValidated: structuralResult.validatedModules,
    commandsValidated: structuralResult.validatedCommands,
  };
};

export const formatCommandConfigValidationReport = (report, { maxErrors = 40 } = {}) => {
  if (!report || typeof report !== 'object') return 'Relatorio de validacao indisponivel.';

  const lines = [];
  lines.push(`modules_validated=${report.modulesValidated ?? 0} commands_validated=${report.commandsValidated ?? 0}`);

  const warnings = Array.isArray(report.warnings) ? report.warnings : [];
  const errors = Array.isArray(report.errors) ? report.errors : [];

  if (warnings.length) {
    lines.push(`warnings=${warnings.length}`);
    for (const warning of warnings.slice(0, maxErrors)) {
      lines.push(`WARN: ${warning}`);
    }
    if (warnings.length > maxErrors) {
      lines.push(`WARN: ... ${warnings.length - maxErrors} warnings adicionais omitidos`);
    }
  }

  if (errors.length) {
    lines.push(`errors=${errors.length}`);
    for (const error of errors.slice(0, maxErrors)) {
      lines.push(`ERROR: ${error}`);
    }
    if (errors.length > maxErrors) {
      lines.push(`ERROR: ... ${errors.length - maxErrors} erros adicionais omitidos`);
    }
  } else {
    lines.push('errors=0');
  }

  return lines.join('\n');
};
