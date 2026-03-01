let stickerCatalogControllerPromise = null;

const loadStickerCatalogController = async () => {
  if (!stickerCatalogControllerPromise) {
    stickerCatalogControllerPromise = import('../../controllers/stickerCatalogController.js');
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

const DEFAULT_STICKER_WEB_PATH = '/stickers';

export const getStickerSiteRouterConfig = async () => {
  const controller = await loadStickerCatalogController();
  const legacyConfig = (typeof controller?.getStickerCatalogConfig === 'function' ? controller.getStickerCatalogConfig() : null) || {};
  return {
    ...legacyConfig,
    webPath: normalizeBasePath(legacyConfig.webPath, DEFAULT_STICKER_WEB_PATH),
  };
};

export const shouldHandleStickerSitePath = (pathname, stickerConfig = null) => {
  const resolvedWebPath = normalizeBasePath(stickerConfig?.webPath, DEFAULT_STICKER_WEB_PATH);
  return pathname === '/sitemap.xml' || startsWithPath(pathname, resolvedWebPath);
};

export const maybeHandleStickerSiteRequest = async (req, res, { pathname, url }) => {
  const controller = await loadStickerCatalogController();
  if (typeof controller?.maybeHandleStickerCatalogRequest !== 'function') return false;
  return controller.maybeHandleStickerCatalogRequest(req, res, { pathname, url });
};
