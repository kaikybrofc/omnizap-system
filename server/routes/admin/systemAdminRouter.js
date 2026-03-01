let systemAdminControllerPromise = null;

const loadSystemAdminController = async () => {
  if (!systemAdminControllerPromise) {
    systemAdminControllerPromise = import('../../controllers/systemAdminController.js');
  }
  return systemAdminControllerPromise;
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

const DEFAULT_USER_SYSTEM_ADMIN_WEB_PATH = '/user/systemadm';
const DEFAULT_LEGACY_STICKER_ADMIN_WEB_PATH = '/stickers/admin';
const DEFAULT_STICKER_ADMIN_API_BASE_PATH = '/api/sticker-packs/admin';
const DEFAULT_STICKER_ADMIN_API_SESSION_PATH = '/api/sticker-packs/admin/session';

export const getSystemAdminRouterConfig = async () => {
  const controller = await loadSystemAdminController();
  const legacyConfig = (typeof controller?.getSystemAdminRouteConfig === 'function' ? controller.getSystemAdminRouteConfig() : null) || {};
  return {
    webPath: normalizeBasePath(legacyConfig.webPath, DEFAULT_USER_SYSTEM_ADMIN_WEB_PATH),
    legacyWebPath: normalizeBasePath(legacyConfig.legacyWebPath, DEFAULT_LEGACY_STICKER_ADMIN_WEB_PATH),
    apiAdminBasePath: normalizeBasePath(legacyConfig.apiAdminBasePath, DEFAULT_STICKER_ADMIN_API_BASE_PATH),
    apiAdminSessionPath: normalizeBasePath(legacyConfig.apiAdminSessionPath, DEFAULT_STICKER_ADMIN_API_SESSION_PATH),
  };
};

export const shouldHandleSystemAdminPath = (pathname, systemAdminConfig = null) => {
  const resolvedConfig = systemAdminConfig || {
    webPath: DEFAULT_USER_SYSTEM_ADMIN_WEB_PATH,
    legacyWebPath: DEFAULT_LEGACY_STICKER_ADMIN_WEB_PATH,
    apiAdminBasePath: DEFAULT_STICKER_ADMIN_API_BASE_PATH,
    apiAdminSessionPath: DEFAULT_STICKER_ADMIN_API_SESSION_PATH,
  };

  if (startsWithPath(pathname, resolvedConfig.webPath)) return true;
  if (startsWithPath(pathname, resolvedConfig.legacyWebPath)) return true;
  return false;
};

export const maybeHandleSystemAdminRequest = async (req, res, { pathname, url }) => {
  const controller = await loadSystemAdminController();
  if (typeof controller?.maybeHandleSystemAdminRequest !== 'function') return false;
  return controller.maybeHandleSystemAdminRequest(req, res, { pathname, url });
};
