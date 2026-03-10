import { randomUUID } from 'node:crypto';
import { executeQuery, TABLES } from '../../../database/index.js';
import { appendSetCookie, buildCookieString, parseCookies } from '../../http/httpRequestUtils.js';
import { toRequestHost } from '../../http/siteRoutingUtils.js';

const WEB_VISITOR_COOKIE_NAME = 'omnizap_vid';
const WEB_SESSION_COOKIE_NAME = 'omnizap_sid';
const WEB_VISITOR_COOKIE_TTL_SECONDS = Number(process.env.WEB_VISITOR_COOKIE_TTL_SECONDS || 60 * 60 * 24 * 365);
const WEB_SESSION_COOKIE_TTL_SECONDS = Number(process.env.WEB_SESSION_COOKIE_TTL_SECONDS || 60 * 60 * 24 * 30);

const normalizeVisitToken = (raw) =>
  String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '')
    .slice(0, 80);

const normalizeVisitPath = (raw) => {
  const normalized = String(raw || '')
    .trim()
    .replace(/\s+/g, '')
    .slice(0, 255);
  if (!normalized) return '/';
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
};

const normalizeVisitSource = (raw) =>
  String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '')
    .slice(0, 32) || 'web';

const normalizeVisitReferrer = (raw) =>
  String(raw || '')
    .trim()
    .slice(0, 1024) || null;

const normalizeVisitUserAgent = (raw) =>
  String(raw || '')
    .trim()
    .slice(0, 512) || null;

const resolveVisitPathFromReferrer = (req) => {
  const rawReferrer = String(req?.headers?.referer || req?.headers?.referrer || '').trim();
  if (!rawReferrer) return '/';
  try {
    const parsed = new URL(rawReferrer);
    const requestHost = toRequestHost(req);
    if (requestHost && parsed.host && parsed.host.toLowerCase() !== requestHost.toLowerCase()) return '/';
    return normalizeVisitPath(parsed.pathname || '/');
  } catch {
    return '/';
  }
};

const ensureWebVisitCookies = (req, res) => {
  const cookies = parseCookies(req);
  const currentVisitor = normalizeVisitToken(cookies[WEB_VISITOR_COOKIE_NAME]);
  const currentSession = normalizeVisitToken(cookies[WEB_SESSION_COOKIE_NAME]);
  const visitorKey = currentVisitor || randomUUID();
  const sessionKey = currentSession || randomUUID();

  if (!currentVisitor) {
    appendSetCookie(
      res,
      buildCookieString(WEB_VISITOR_COOKIE_NAME, visitorKey, req, {
        maxAgeSeconds: WEB_VISITOR_COOKIE_TTL_SECONDS,
      }),
    );
  }

  appendSetCookie(
    res,
    buildCookieString(WEB_SESSION_COOKIE_NAME, sessionKey, req, {
      maxAgeSeconds: WEB_SESSION_COOKIE_TTL_SECONDS,
    }),
  );

  return { visitorKey, sessionKey };
};

export const trackWebVisitMetric = (req, res, { pagePath = '/', source = 'web' } = {}) => {
  if ((req.method || '').toUpperCase() === 'HEAD') return Promise.resolve(false);
  const { visitorKey, sessionKey } = ensureWebVisitCookies(req, res);
  const safePath = normalizeVisitPath(pagePath || resolveVisitPathFromReferrer(req));
  const safeSource = normalizeVisitSource(source);
  const safeReferrer = normalizeVisitReferrer(req?.headers?.referer || req?.headers?.referrer || '');
  const safeUserAgent = normalizeVisitUserAgent(req?.headers?.['user-agent'] || '');

  return executeQuery(
    `INSERT INTO ${TABLES.WEB_VISIT_EVENT}
      (visitor_key, session_key, page_path, referrer, user_agent, source)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [visitorKey, sessionKey, safePath, safeReferrer, safeUserAgent, safeSource],
  ).catch((error) => {
    if (error?.code === 'ER_NO_SUCH_TABLE') return false;
    throw error;
  });
};
