import { resolveClientIp } from './clientIp.js';
import { resolveCookieDomainForRequest } from './siteRoutingUtils.js';

export const sendJson = (req, res, statusCode, payload) => {
  const body = JSON.stringify(payload);
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
  const proto = String(req?.headers?.['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (proto) return proto === 'https';
  return Boolean(req?.socket?.encrypted);
};

export const resolveRequestRemoteIp = (req) => resolveClientIp(req, { fallback: null });

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
  const cookieDomain =
    options.domain === false
      ? ''
      : String(options.domain || resolveCookieDomainForRequest(req)).trim();
  if (cookieDomain) parts.push(`Domain=${cookieDomain}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  if (isRequestSecure(req)) parts.push('Secure');
  if (Number.isFinite(options.maxAgeSeconds))
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
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
