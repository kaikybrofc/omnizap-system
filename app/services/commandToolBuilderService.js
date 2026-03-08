const normalizeText = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();

const sanitizeToken = (value, fallback = 'arg') => {
  const normalized = normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || fallback;
};

const parseArrayType = (rawType) => {
  const match = /^array\s*<\s*([a-z0-9_]+)\s*>$/i.exec(String(rawType || '').trim());
  if (!match) return null;
  return (
    String(match[1] || '')
      .trim()
      .toLowerCase() || 'string'
  );
};

const mapArgumentTypeToJsonSchema = (rawType) => {
  const normalized = normalizeText(rawType);
  const arrayItemType = parseArrayType(normalized);
  if (arrayItemType) {
    return {
      type: 'array',
      items: mapArgumentTypeToJsonSchema(arrayItemType),
    };
  }

  if (normalized === 'integer' || normalized === 'int') return { type: 'integer' };
  if (normalized === 'number' || normalized === 'float' || normalized === 'double') {
    return { type: 'number' };
  }
  if (normalized === 'boolean' || normalized === 'bool') return { type: 'boolean' };
  if (normalized === 'object' || normalized === 'json') {
    return {
      type: 'object',
      additionalProperties: true,
    };
  }

  return { type: 'string' };
};

const buildArgumentDescription = (argument) => {
  const parts = [];
  const validation = String(argument?.validacao || '').trim();
  const defaultValue = argument?.default;

  if (validation) parts.push(`Validacao: ${validation}.`);
  if (defaultValue !== undefined && defaultValue !== null && String(defaultValue).trim()) {
    parts.push(`Padrao: ${String(defaultValue).trim()}.`);
  }

  return parts.join(' ').trim() || 'Argumento do comando.';
};

const buildArgumentSpecs = (commandEntry = {}) => {
  const sourceArgs = Array.isArray(commandEntry.argumentos) ? commandEntry.argumentos : [];
  const usedKeys = new Set();

  return sourceArgs
    .map((argument, index) => {
      if (!argument || typeof argument !== 'object') return null;

      const originalName = String(argument.nome || '').trim();
      const fallbackName = `arg_${index + 1}`;
      const baseKey = sanitizeToken(originalName || fallbackName, fallbackName);
      let key = baseKey;
      let suffix = 2;
      while (usedKeys.has(key)) {
        key = `${baseKey}_${suffix}`;
        suffix += 1;
      }
      usedKeys.add(key);

      const typeSchema = mapArgumentTypeToJsonSchema(argument.tipo);
      const isRequired = argument.obrigatorio === true;

      return {
        key,
        originalName: originalName || key,
        type: typeSchema.type,
        rawType: String(argument.tipo || '').trim() || 'string',
        schema: {
          ...typeSchema,
          description: buildArgumentDescription(argument),
          ...(argument.default !== undefined && argument.default !== null
            ? { default: argument.default }
            : {}),
        },
        required: isRequired,
        defaultValue: argument.default,
        validation: String(argument.validacao || '').trim() || null,
      };
    })
    .filter(Boolean);
};

const sanitizeToolName = (value) => {
  const safe = sanitizeToken(value, 'command');
  return safe.slice(0, 64);
};

const buildCommandDescription = (commandEntry = {}) => {
  const description = String(commandEntry.descricao || '').trim() || 'Executa um comando do bot.';
  const permission = String(commandEntry.permissao_necessaria || '').trim();
  const where = Array.isArray(commandEntry.local_de_uso)
    ? commandEntry.local_de_uso.filter(Boolean).join(', ')
    : '';

  const extra = [];
  if (permission) extra.push(`Permissao: ${permission}.`);
  if (where) extra.push(`Local: ${where}.`);

  return `${description}${extra.length ? ` ${extra.join(' ')}` : ''}`.trim();
};

export const buildFunctionToolFromCommandConfig = ({ moduleKey, commandEntry } = {}) => {
  if (!commandEntry || commandEntry.enabled === false) return null;

  const commandName = sanitizeToolName(commandEntry.name);
  if (!commandName) return null;

  const argumentSpecs = buildArgumentSpecs(commandEntry);
  const properties = {};
  const required = [];

  for (const spec of argumentSpecs) {
    properties[spec.key] = spec.schema;
    if (spec.required) required.push(spec.key);
  }

  const tool = {
    type: 'function',
    function: {
      name: commandName,
      description: buildCommandDescription(commandEntry),
      parameters: {
        type: 'object',
        properties,
        required,
        additionalProperties: false,
      },
    },
  };

  return {
    moduleKey: String(moduleKey || '').trim() || 'module',
    commandName,
    argumentSpecs,
    tool,
  };
};

export const mapToolArgsToCommandText = (argumentSpecs = [], argsObject = {}) => {
  const safeArgsObject = argsObject && typeof argsObject === 'object' ? argsObject : {};
  const tokenArgs = [];
  const normalizedArgs = {};

  for (const spec of argumentSpecs) {
    let value = safeArgsObject[spec.key];

    if (
      (value === undefined || value === null || value === '') &&
      spec.defaultValue !== undefined
    ) {
      value = spec.defaultValue;
    }

    if (value === undefined || value === null || value === '') continue;

    normalizedArgs[spec.key] = value;

    if (Array.isArray(value)) {
      for (const item of value) {
        const token = String(item || '').trim();
        if (token) tokenArgs.push(token);
      }
      continue;
    }

    const token = String(value).trim();
    if (token) tokenArgs.push(token);
  }

  return {
    normalizedArgs,
    args: tokenArgs,
    text: tokenArgs.join(' ').trim(),
  };
};
