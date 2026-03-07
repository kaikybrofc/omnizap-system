import { isIP } from 'node:net';

const parseEnvBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

const TRUST_PROXY_HEADERS = parseEnvBool(
  process.env.APP_TRUST_PROXY,
  parseEnvBool(process.env.RATE_LIMIT_TRUST_PROXY, false),
);
const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const normalizeIpCandidate = (value) => {
  let raw = String(value || '').trim();
  if (!raw) return '';

  if (raw.startsWith('for=')) raw = raw.slice(4).trim();
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length > 1) raw = raw.slice(1, -1).trim();
  if (raw === 'unknown') return '';

  if (raw.startsWith('[')) {
    const closeBracketIndex = raw.indexOf(']');
    if (closeBracketIndex > 1) {
      raw = raw.slice(1, closeBracketIndex).trim();
    }
  }

  const ipv4WithPortMatch = raw.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (ipv4WithPortMatch?.[1]) raw = ipv4WithPortMatch[1];

  const zoneIndex = raw.indexOf('%');
  if (zoneIndex > 0) raw = raw.slice(0, zoneIndex);

  if (raw.startsWith('::ffff:') && isIP(raw.slice(7)) === 4) raw = raw.slice(7);

  return isIP(raw) ? raw : '';
};

const pickFirstValidIpFromCommaList = (value) => {
  const raw = Array.isArray(value) ? value.join(',') : String(value || '');
  if (!raw.trim()) return '';

  for (const part of raw.split(',')) {
    const ip = normalizeIpCandidate(part);
    if (ip) return ip;
  }

  return '';
};

const pickFirstValidIpFromForwardedHeader = (value) => {
  const raw = Array.isArray(value) ? value.join(',') : String(value || '');
  if (!raw.trim()) return '';

  const entries = raw.split(',');
  for (const entry of entries) {
    const directives = entry.split(';');
    for (const directive of directives) {
      const trimmed = String(directive || '').trim();
      if (!trimmed || !trimmed.toLowerCase().startsWith('for=')) continue;
      const ip = normalizeIpCandidate(trimmed);
      if (ip) return ip;
    }
  }

  return '';
};

const shouldTrustForwardedHeaders = (socketIp = '', explicitTrustProxy = undefined) => {
  if (typeof explicitTrustProxy === 'boolean') return explicitTrustProxy;
  if (TRUST_PROXY_HEADERS) return true;
  return LOOPBACK_IPS.has(socketIp);
};

export const resolveClientIp = (req, { fallback = 'unknown', trustProxy = undefined } = {}) => {
  const socketIp = normalizeIpCandidate(req?.socket?.remoteAddress);

  if (shouldTrustForwardedHeaders(socketIp, trustProxy)) {
    const cfConnectingIp = normalizeIpCandidate(req?.headers?.['cf-connecting-ip']);
    if (cfConnectingIp) return cfConnectingIp;

    const xRealIp = normalizeIpCandidate(req?.headers?.['x-real-ip']);
    if (xRealIp) return xRealIp;

    const forwardedFor = pickFirstValidIpFromCommaList(req?.headers?.['x-forwarded-for']);
    if (forwardedFor) return forwardedFor;

    const forwarded = pickFirstValidIpFromForwardedHeader(req?.headers?.forwarded);
    if (forwarded) return forwarded;
  }

  if (socketIp) return socketIp;
  return fallback;
};
