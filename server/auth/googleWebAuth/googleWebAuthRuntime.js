import { createGoogleWebAuthService } from './googleWebAuthService.js';

const normalizeBasePath = (value, fallback) => {
  const raw = String(value || '').trim() || fallback;
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const withoutTrailingSlash = withLeadingSlash.length > 1 && withLeadingSlash.endsWith('/') ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
  return withoutTrailingSlash || fallback;
};

export const normalizeGoogleSubject = (value) =>
  String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 80);

export const createGoogleWebAuthRuntime = ({ executeQuery, runSqlTransaction, tables, logger, sendJson, readJsonBody, parseCookies, getCookieValuesFromRequest, appendSetCookie, buildCookieString, normalizeEmail, normalizeJid, sanitizeText, toIsoOrNull, toWhatsAppPhoneDigits, resolveWhatsAppOwnerJidFromLoginPayload, assertGoogleIdentityNotBanned, googleClientId, sessionTtlMs, apiBasePath, webPath, loginWebPath, configuredSessionCookiePath, notAllowedErrorCode, onGoogleWebSessionCreated = null }) => {
  const buildGoogleOwnerJid = (googleSub) => {
    const normalizedSub = normalizeGoogleSubject(googleSub);
    if (!normalizedSub) return '';
    return normalizeJid(`g${normalizedSub}@google.oauth`) || '';
  };

  const googleWebSessionDbTouchIntervalMs = Math.max(30_000, Number(process.env.STICKER_WEB_GOOGLE_SESSION_DB_TOUCH_INTERVAL_MS) || 60_000);
  const googleWebSessionDbPruneIntervalMs = Math.max(5 * 60 * 1000, Number(process.env.STICKER_WEB_GOOGLE_SESSION_DB_PRUNE_INTERVAL_MS) || 60 * 60 * 1000);
  const normalizedConfiguredCookiePath = normalizeBasePath(configuredSessionCookiePath, normalizeBasePath(process.env.STICKER_WEB_GOOGLE_SESSION_COOKIE_PATH, '/'));
  const legacyCookiePaths = Array.from(new Set([normalizedConfiguredCookiePath, normalizeBasePath(apiBasePath, '/api/sticker-packs'), `${normalizeBasePath(apiBasePath, '/api/sticker-packs')}/auth`, normalizeBasePath(webPath, '/stickers'), normalizeBasePath(loginWebPath, '/login')]));

  const googleWebAuth = createGoogleWebAuthService({
    executeQuery,
    runSqlTransaction,
    tables,
    logger,
    sendJson,
    readJsonBody,
    parseCookies,
    getCookieValuesFromRequest,
    appendSetCookie,
    buildCookieString,
    normalizeGoogleSubject,
    normalizeEmail,
    normalizeJid,
    sanitizeText,
    toIsoOrNull,
    toWhatsAppPhoneDigits,
    resolveWhatsAppOwnerJidFromLoginPayload,
    buildGoogleOwnerJid,
    assertGoogleIdentityNotBanned,
    googleClientId,
    sessionTtlMs,
    sessionDbTouchIntervalMs: googleWebSessionDbTouchIntervalMs,
    sessionDbPruneIntervalMs: googleWebSessionDbPruneIntervalMs,
    notAllowedErrorCode,
    onGoogleWebSessionCreated,
    sessionCookiePath: '/',
    legacyCookiePaths,
  });

  return {
    ...googleWebAuth,
    buildGoogleOwnerJid,
  };
};
