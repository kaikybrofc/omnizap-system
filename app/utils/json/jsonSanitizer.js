/**
 * Sanitiza caracteres Unicode invalidos para JSON.
 * Substitui surrogates "soltos" (sem par valido) por U+FFFD.
 *
 * @param {string} value
 * @returns {string}
 */
export const sanitizeUnicodeString = (value) => {
  if (typeof value !== 'string' || value.length === 0) {
    return value;
  }

  if (!/[\uD800-\uDFFF]/.test(value)) {
    return value;
  }

  let normalized = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);

    if (code >= 0xd800 && code <= 0xdbff) {
      const nextCode = value.charCodeAt(i + 1);
      if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
        normalized += value[i] + value[i + 1];
        i += 1;
      } else {
        normalized += '\uFFFD';
      }
      continue;
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      normalized += '\uFFFD';
      continue;
    }

    normalized += value[i];
  }

  return normalized;
};

/**
 * Cria replacer para JSON.stringify com suporte a:
 * - strings com surrogate invalido
 * - referencias circulares
 * - bigint
 * - numeros nao finitos
 *
 * @returns {(key:string, value:any)=>any}
 */
const createSafeJsonReplacer = () => {
  const seen = new WeakSet();

  return (_, value) => {
    if (typeof value === 'string') {
      return sanitizeUnicodeString(value);
    }

    if (typeof value === 'bigint') {
      return value.toString();
    }

    if (typeof value === 'number' && !Number.isFinite(value)) {
      return null;
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }

    if (value && typeof value === 'object') {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }

    return value;
  };
};

/**
 * Converte qualquer valor para texto JSON seguro para colunas JSON do MySQL.
 * - Objetos/arrays sao serializados com saneamento
 * - Strings sao saneadas; se nao forem JSON valido, viram JSON string
 *
 * @param {*} value
 * @returns {string|null}
 */
export const toSafeJsonColumnValue = (value) => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'string') {
    const sanitized = sanitizeUnicodeString(value);
    try {
      const parsed = JSON.parse(sanitized);
      const normalizedJson = JSON.stringify(parsed, createSafeJsonReplacer());
      return normalizedJson === undefined ? null : normalizedJson;
    } catch {
      return JSON.stringify(sanitized);
    }
  }

  try {
    const json = JSON.stringify(value, createSafeJsonReplacer());
    return json === undefined ? null : json;
  } catch {
    return JSON.stringify('[Unserializable]');
  }
};
