import jwt from 'jsonwebtoken';

const parseEnvBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

const clampInt = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
};

const WEB_AUTH_JWT_SECRET = String(process.env.WEB_AUTH_JWT_SECRET || '').trim();
const WEB_AUTH_JWT_ISSUER =
  String(process.env.WEB_AUTH_JWT_ISSUER || 'omnizap-system').trim() || 'omnizap-system';
const WEB_AUTH_JWT_AUDIENCE =
  String(process.env.WEB_AUTH_JWT_AUDIENCE || 'omnizap-web').trim() || 'omnizap-web';
const WEB_AUTH_JWT_EXPIRES_IN = String(process.env.WEB_AUTH_JWT_EXPIRES_IN || '7d').trim() || '7d';
const WEB_AUTH_JWT_DISABLED = parseEnvBool(process.env.WEB_AUTH_JWT_DISABLED, false);

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const normalizeGoogleSubject = (value) =>
  String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 80);

const normalizeEmail = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .slice(0, 255);

const normalizeJid = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .slice(0, 255);

const normalizeName = (value) =>
  String(value || '')
    .trim()
    .slice(0, 120);

const resolveExpiresIn = ({ expiresInSeconds = null } = {}) => {
  if (Number.isFinite(Number(expiresInSeconds))) {
    return clampInt(expiresInSeconds, 60, 60, 60 * 60 * 24 * 365);
  }
  return WEB_AUTH_JWT_EXPIRES_IN;
};

export const isWebAuthJwtEnabled = () =>
  !WEB_AUTH_JWT_DISABLED && isNonEmptyString(WEB_AUTH_JWT_SECRET);

export const extractBearerTokenFromRequest = (req) => {
  const headerValue = req?.headers?.authorization;
  if (typeof headerValue !== 'string') return '';

  const trimmed = headerValue.trim();
  if (!trimmed) return '';

  const [scheme, token] = trimmed.split(/\s+/, 2);
  if (!scheme || !token) return '';
  if (scheme.toLowerCase() !== 'bearer') return '';

  return String(token || '').trim();
};

export const signWebAuthJwt = (
  {
    sub = '',
    sessionToken = '',
    ownerJid = '',
    ownerPhone = '',
    email = '',
    name = '',
    authMethod = 'google',
  } = {},
  { expiresInSeconds = null } = {},
) => {
  if (!isWebAuthJwtEnabled()) return '';

  const normalizedSub = normalizeGoogleSubject(sub);
  const normalizedSessionToken = String(sessionToken || '')
    .trim()
    .slice(0, 36);
  const normalizedOwnerJid = normalizeJid(ownerJid);
  const normalizedOwnerPhone = String(ownerPhone || '')
    .trim()
    .replace(/\D+/g, '')
    .slice(0, 20);
  const normalizedEmail = normalizeEmail(email);
  const normalizedName = normalizeName(name);

  if (!normalizedSub) return '';

  const payload = {
    sub: normalizedSub,
    amr:
      String(authMethod || 'google')
        .trim()
        .toLowerCase() || 'google',
  };

  if (normalizedSessionToken) payload.sid = normalizedSessionToken;
  if (normalizedOwnerJid) payload.owner_jid = normalizedOwnerJid;
  if (normalizedOwnerPhone) payload.owner_phone = normalizedOwnerPhone;
  if (normalizedEmail) payload.email = normalizedEmail;
  if (normalizedName) payload.name = normalizedName;

  return jwt.sign(payload, WEB_AUTH_JWT_SECRET, {
    issuer: WEB_AUTH_JWT_ISSUER,
    audience: WEB_AUTH_JWT_AUDIENCE,
    expiresIn: resolveExpiresIn({ expiresInSeconds }),
  });
};

export const verifyWebAuthJwt = (token) => {
  if (!isWebAuthJwtEnabled()) return null;

  const rawToken = String(token || '').trim();
  if (!rawToken) return null;

  try {
    const decoded = jwt.verify(rawToken, WEB_AUTH_JWT_SECRET, {
      issuer: WEB_AUTH_JWT_ISSUER,
      audience: WEB_AUTH_JWT_AUDIENCE,
    });

    if (!decoded || typeof decoded !== 'object') return null;

    const normalizedSub = normalizeGoogleSubject(decoded.sub);
    if (!normalizedSub) return null;

    return {
      sub: normalizedSub,
      sid: String(decoded.sid || '')
        .trim()
        .slice(0, 36),
      owner_jid: normalizeJid(decoded.owner_jid),
      owner_phone: String(decoded.owner_phone || '')
        .replace(/\D+/g, '')
        .slice(0, 20),
      email: normalizeEmail(decoded.email),
      name: normalizeName(decoded.name),
      amr:
        String(decoded.amr || '')
          .trim()
          .toLowerCase() || 'google',
      exp: Number(decoded.exp || 0),
      iat: Number(decoded.iat || 0),
    };
  } catch {
    return null;
  }
};
