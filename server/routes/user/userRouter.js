let userControllerPromise = null;

const loadUserController = async () => {
  if (!userControllerPromise) {
    userControllerPromise = import('../../controllers/userController.js');
  }
  return userControllerPromise;
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

const DEFAULT_USER_WEB_PATH = '/user';
const DEFAULT_STICKER_API_BASE_PATH = '/api/sticker-packs';

export const buildUserApiPaths = (apiBasePath) => {
  const resolvedApiBasePath = normalizeBasePath(apiBasePath, DEFAULT_STICKER_API_BASE_PATH);
  return new Set([`${resolvedApiBasePath}/auth/google/session`, `${resolvedApiBasePath}/me`, `${resolvedApiBasePath}/bot-contact`]);
};

export const getUserRouterConfig = async () => {
  const controller = await loadUserController();
  const legacyConfig = (typeof controller?.getUserRouteConfig === 'function' ? controller.getUserRouteConfig() : null) || {};
  return {
    webPath: normalizeBasePath(legacyConfig.webPath, DEFAULT_USER_WEB_PATH),
    apiBasePath: normalizeBasePath(legacyConfig.apiBasePath, DEFAULT_STICKER_API_BASE_PATH),
  };
};

export const shouldHandleUserPath = (pathname, userConfig = null) => {
  const resolvedConfig = userConfig || {
    webPath: DEFAULT_USER_WEB_PATH,
    apiBasePath: DEFAULT_STICKER_API_BASE_PATH,
  };

  if (startsWithPath(pathname, resolvedConfig.webPath)) return true;

  const userApiPaths = buildUserApiPaths(resolvedConfig.apiBasePath);
  return userApiPaths.has(pathname);
};

export const maybeHandleUserRequest = async (req, res, { pathname, url }) => {
  const controller = await loadUserController();
  if (typeof controller?.maybeHandleUserRequest !== 'function') return false;
  return controller.maybeHandleUserRequest(req, res, { pathname, url });
};
