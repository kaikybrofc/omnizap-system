const parseEnvBool = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

export const toRequestHost = (req) =>
  String(req?.headers?.host || '')
    .split(',')[0]
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
    .split(':')[0];

export const isIpLiteralHost = (value) => {
  const host = String(value || '')
    .trim()
    .toLowerCase();
  if (!host) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(':');
};

const SITE_CANONICAL_HOST =
  String(process.env.SITE_CANONICAL_HOST || 'omnizap.shop')
    .trim()
    .toLowerCase() || 'omnizap.shop';
const SITE_CANONICAL_SCHEME =
  String(process.env.SITE_CANONICAL_SCHEME || 'https')
    .trim()
    .toLowerCase() === 'http'
    ? 'http'
    : 'https';
const SITE_CANONICAL_REDIRECT_ENABLED = parseEnvBool(process.env.SITE_CANONICAL_REDIRECT_ENABLED, true);
const SITE_ORIGIN = String(process.env.SITE_ORIGIN || `${SITE_CANONICAL_SCHEME}://${SITE_CANONICAL_HOST}`)
  .trim()
  .replace(/\/+$/, '');
const SITE_COOKIE_DOMAIN = String(process.env.SITE_COOKIE_DOMAIN || SITE_CANONICAL_HOST)
  .trim()
  .toLowerCase()
  .replace(/^https?:\/\//, '')
  .split('/')[0]
  .split(':')[0]
  .replace(/^\.+/, '')
  .replace(/\.+$/, '');

export const getSiteRoutingConfig = () => ({
  canonicalHost: SITE_CANONICAL_HOST,
  canonicalScheme: SITE_CANONICAL_SCHEME,
  canonicalRedirectEnabled: SITE_CANONICAL_REDIRECT_ENABLED,
  origin: SITE_ORIGIN,
  cookieDomain: SITE_COOKIE_DOMAIN,
});

export const toSiteAbsoluteUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return SITE_ORIGIN;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${SITE_ORIGIN}${raw.startsWith('/') ? raw : `/${raw}`}`;
};

export const resolveCookieDomainForRequest = (req) => {
  if (!SITE_COOKIE_DOMAIN || isIpLiteralHost(SITE_COOKIE_DOMAIN)) return '';
  const requestHost = toRequestHost(req);
  if (!requestHost || isIpLiteralHost(requestHost) || requestHost === 'localhost') return '';
  if (requestHost === SITE_COOKIE_DOMAIN) return SITE_COOKIE_DOMAIN;
  if (requestHost.endsWith(`.${SITE_COOKIE_DOMAIN}`)) return SITE_COOKIE_DOMAIN;
  return '';
};

export const maybeRedirectToCanonicalHost = (req, res, url) => {
  if (!SITE_CANONICAL_REDIRECT_ENABLED) return false;
  if (!['GET', 'HEAD'].includes(req.method || '')) return false;
  if (!SITE_CANONICAL_HOST) return false;

  const requestHost = toRequestHost(req);
  if (requestHost !== `www.${SITE_CANONICAL_HOST}`) return false;

  const location = `${SITE_CANONICAL_SCHEME}://${SITE_CANONICAL_HOST}${url.pathname}${url.search || ''}`;
  res.statusCode = 301;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.end();
  return true;
};
