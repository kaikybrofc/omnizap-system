import { resolveClientIp } from './clientIp.js';
import { resolveCookieDomainForRequest } from './siteRoutingUtils.js';

const parseEnvBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const shouldTrustForwardedProtoHeader = (req) => {
  const trustProxyHeaders = parseEnvBool(process.env.APP_TRUST_PROXY, parseEnvBool(process.env.RATE_LIMIT_TRUST_PROXY, false));
  if (trustProxyHeaders) return true;

  const socketIp = resolveClientIp(req, { fallback: '', trustProxy: false });
  return LOOPBACK_IPS.has(socketIp);
};

export const sendJson = (req, res, statusCode, payload) => {
  const body = JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(body);
};

export const sendText = (req, res, statusCode, body, contentType) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', contentType);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(body);
};

export const parseCookies = (req) => {
  const raw = String(req?.headers?.cookie || '');
  if (!raw) return {};
  return raw.split(';').reduce((acc, chunk) => {
    const [k, ...rest] = chunk.split('=');
    const key = String(k || '').trim();
    if (!key) return acc;
    const value = rest.join('=').trim();
    try {
      acc[key] = decodeURIComponent(value);
    } catch {
      acc[key] = value;
    }
    return acc;
  }, {});
};

export const getCookieValuesFromRequest = (req, cookieName) => {
  const target = String(cookieName || '').trim();
  if (!target) return [];
  const raw = String(req?.headers?.cookie || '');
  if (!raw) return [];

  const values = [];
  for (const chunk of raw.split(';')) {
    const trimmed = String(chunk || '').trim();
    if (!trimmed) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    if (key !== target) continue;
    const encodedValue = trimmed.slice(separatorIndex + 1).trim();
    if (!encodedValue) continue;
    let decodedValue = encodedValue;
    try {
      decodedValue = decodeURIComponent(encodedValue);
    } catch (error) {
      if (error) decodedValue = encodedValue;
    }
    const normalizedValue = String(decodedValue || '').trim();
    if (!normalizedValue) continue;
    if (!values.includes(normalizedValue)) values.push(normalizedValue);
  }
  return values;
};

export const isRequestSecure = (req) => {
  const socketEncrypted = Boolean(req?.socket?.encrypted);
  const proto = String(req?.headers?.['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (proto && shouldTrustForwardedProtoHeader(req)) {
    return proto === 'https';
  }
  return socketEncrypted;
};

export const resolveRequestRemoteIp = (req) => resolveClientIp(req, { fallback: null });

/**
 * Converte um valor para string ISO ou null se inválido.
 * @param {any} value
 * @returns {string|null}
 */
export const toIsoOrNull = (value) => (value ? new Date(value).toISOString() : null);

/**
 * Formata duração em segundos para HH:MM:SS ou Dd HH:MM:SS.
 * @param {number} totalSeconds
 * @returns {string}
 */
export const formatDuration = (totalSeconds) => {
  const total = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const hhmmss = [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
  return days > 0 ? `${days}d ${hhmmss}` : hhmmss;
};

/**
 * Normaliza caminho base garantindo barra inicial e removendo barra final.
 * @param {string} value
 * @param {string} fallback
 * @returns {string}
 */
export const normalizeBasePath = (value, fallback) => {
  const raw = String(value || '').trim() || fallback;
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const withoutTrailingSlash = withLeadingSlash.length > 1 && withLeadingSlash.endsWith('/') ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
  return withoutTrailingSlash || fallback;
};

export const appendSetCookie = (res, cookieValue) => {
  const current = res.getHeader('Set-Cookie');
  if (!current) {
    res.setHeader('Set-Cookie', cookieValue);
    return;
  }
  if (Array.isArray(current)) {
    res.setHeader('Set-Cookie', [...current, cookieValue]);
    return;
  }
  res.setHeader('Set-Cookie', [String(current), cookieValue]);
};

export const buildCookieString = (name, value, req, options = {}) => {
  const parts = [`${name}=${encodeURIComponent(String(value ?? ''))}`];
  parts.push(`Path=${options.path || '/'}`);
  const cookieDomain = options.domain === false ? '' : String(options.domain || resolveCookieDomainForRequest(req)).trim();
  if (cookieDomain) parts.push(`Domain=${cookieDomain}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  if (isRequestSecure(req)) parts.push('Secure');
  if (Number.isFinite(options.maxAgeSeconds)) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
  return parts.join('; ');
};

export const readJsonBody = async (req, { maxBytes = 64 * 1024 } = {}) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        const error = new Error('Payload excedeu limite permitido.');
        error.statusCode = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        const error = new Error('JSON invalido.');
        error.statusCode = 400;
        reject(error);
      }
    });

    req.on('error', (error) => reject(error));
  });
