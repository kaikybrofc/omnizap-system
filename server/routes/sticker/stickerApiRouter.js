import { requireAdminAuth } from '../../middleware/requireAdminAuth.js';
import { createAdminApiRateLimit } from '../../middleware/rateLimit.js';

let stickerCatalogControllerPromise = null;

const loadStickerCatalogController = async () => {
  if (!stickerCatalogControllerPromise) {
    stickerCatalogControllerPromise = import('../../controllers/sticker/stickerCatalogController.js');
  }
  return stickerCatalogControllerPromise;
};

const normalizeBasePath = (value, fallback) => {
  const raw = String(value || '').trim() || fallback;
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const withoutTrailingSlash = withLeadingSlash.length > 1 && withLeadingSlash.endsWith('/') ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
  return withoutTrailingSlash || fallback;
};

const startsWithPath = (pathname, prefix) => {
  if (!pathname || !prefix) return false;
  if (pathname === prefix) return true;
  return pathname.startsWith(`${prefix}/`);
};

const DEFAULT_STICKER_API_BASE_PATH = '/api/sticker-packs';
const DEFAULT_MARKETPLACE_STATS_PATH = '/api/marketplace/stats';
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PATCH', 'DELETE']);
const adminApiRateLimit = createAdminApiRateLimit();

const sendMethodNotAllowed = (req, res) => {
  if (res.writableEnded) return;
  res.statusCode = 405;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(JSON.stringify({ error: 'Method Not Allowed' }));
};

export const getStickerApiRouterConfig = async () => {
  const controller = await loadStickerCatalogController();
  const legacyConfig = (typeof controller?.getStickerCatalogConfig === 'function' ? controller.getStickerCatalogConfig() : null) || {};
  return {
    apiBasePath: normalizeBasePath(legacyConfig.apiBasePath, DEFAULT_STICKER_API_BASE_PATH),
    marketplaceStatsPath: DEFAULT_MARKETPLACE_STATS_PATH,
  };
};

export const shouldHandleStickerApiPath = (pathname, stickerConfig = null) => {
  const apiBasePath = normalizeBasePath(stickerConfig?.apiBasePath, DEFAULT_STICKER_API_BASE_PATH);
  const marketplaceStatsPath = normalizeBasePath(stickerConfig?.marketplaceStatsPath, DEFAULT_MARKETPLACE_STATS_PATH);
  return startsWithPath(pathname, apiBasePath) || startsWithPath(pathname, marketplaceStatsPath);
};

export const maybeHandleStickerApiRequest = async (req, res, { pathname, url, config = null }) => {
  const resolvedConfig = config || (await getStickerApiRouterConfig());
  if (!shouldHandleStickerApiPath(pathname, resolvedConfig)) return false;

  const method = String(req.method || '').toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    sendMethodNotAllowed(req, res);
    return true;
  }

  const apiBasePath = normalizeBasePath(resolvedConfig.apiBasePath, DEFAULT_STICKER_API_BASE_PATH);
  const adminBasePath = `${apiBasePath}/admin`;
  const adminSessionPath = `${adminBasePath}/session`;

  if (startsWithPath(pathname, adminBasePath)) {
    const allowedByRateLimit = adminApiRateLimit(req, res);
    if (!allowedByRateLimit) return true;
  }

  if (startsWithPath(pathname, adminBasePath) && pathname !== adminSessionPath) {
    const allowed = requireAdminAuth(req, res);
    if (!allowed) return true;
  }

  const controller = await loadStickerCatalogController();
  if (typeof controller?.maybeHandleStickerCatalogRequest !== 'function') return false;
  return controller.maybeHandleStickerCatalogRequest(req, res, { pathname, url });
};
