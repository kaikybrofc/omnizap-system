import {
  DEFAULT_LEGACY_STICKER_API_BASE_PATH,
  DEFAULT_USER_API_BASE_PATH,
  buildUserApiPaths,
  isUserApiPath,
  normalizeBasePath,
} from './userApiPaths.js';
export { buildUserApiPaths };

let userControllerPromise = null;

const loadUserController = async () => {
  if (!userControllerPromise) {
    userControllerPromise = import('../../controllers/userController.js');
  }
  return userControllerPromise;
};

const startsWithPath = (pathname, prefix) => {
  if (!pathname || !prefix) return false;
  if (pathname === prefix) return true;
  return pathname.startsWith(`${prefix}/`);
};

const DEFAULT_USER_WEB_PATH = '/user';
const DEFAULT_USER_LEGACY_API_BASE_PATH = DEFAULT_LEGACY_STICKER_API_BASE_PATH;
const DEFAULT_USER_PASSWORD_RESET_WEB_PATH = `${DEFAULT_USER_WEB_PATH}/password-reset`;
const resolveDefaultPasswordResetWebPath = (webPath) => {
  const normalizedWebPath = normalizeBasePath(webPath, DEFAULT_USER_WEB_PATH);
  if (normalizedWebPath === '/') return DEFAULT_USER_PASSWORD_RESET_WEB_PATH;
  return normalizeBasePath(
    `${normalizedWebPath}/password-reset`,
    DEFAULT_USER_PASSWORD_RESET_WEB_PATH,
  );
};

export const getUserRouterConfig = async () => {
  const controller = await loadUserController();
  const legacyConfig =
    (typeof controller?.getUserRouteConfig === 'function'
      ? controller.getUserRouteConfig()
      : null) || {};
  const webPath = normalizeBasePath(legacyConfig.webPath, DEFAULT_USER_WEB_PATH);
  const fallbackPasswordResetWebPath = resolveDefaultPasswordResetWebPath(webPath);
  return {
    webPath,
    passwordResetWebPath: normalizeBasePath(
      legacyConfig.passwordResetWebPath,
      fallbackPasswordResetWebPath,
    ),
    apiBasePath: normalizeBasePath(legacyConfig.apiBasePath, DEFAULT_USER_API_BASE_PATH),
    legacyApiBasePath: normalizeBasePath(
      legacyConfig.legacyApiBasePath,
      DEFAULT_USER_LEGACY_API_BASE_PATH,
    ),
  };
};

export const shouldHandleUserPath = (pathname, userConfig = null) => {
  const resolvedConfig = userConfig || {
    webPath: DEFAULT_USER_WEB_PATH,
    passwordResetWebPath: DEFAULT_USER_PASSWORD_RESET_WEB_PATH,
    apiBasePath: DEFAULT_USER_API_BASE_PATH,
    legacyApiBasePath: DEFAULT_USER_LEGACY_API_BASE_PATH,
  };
  const webPath = normalizeBasePath(resolvedConfig.webPath, DEFAULT_USER_WEB_PATH);
  const fallbackPasswordResetWebPath = resolveDefaultPasswordResetWebPath(webPath);
  const passwordResetWebPath = normalizeBasePath(
    resolvedConfig.passwordResetWebPath,
    fallbackPasswordResetWebPath,
  );

  if (startsWithPath(pathname, webPath) || startsWithPath(pathname, passwordResetWebPath))
    return true;

  const apiBasePath = normalizeBasePath(resolvedConfig.apiBasePath, DEFAULT_USER_API_BASE_PATH);
  if (isUserApiPath(pathname, apiBasePath)) return true;

  const legacyApiBasePath = normalizeBasePath(
    resolvedConfig.legacyApiBasePath,
    DEFAULT_USER_LEGACY_API_BASE_PATH,
  );
  return isUserApiPath(pathname, legacyApiBasePath);
};

export const maybeHandleUserRequest = async (req, res, { pathname, url }) => {
  const controller = await loadUserController();
  if (typeof controller?.maybeHandleUserRequest !== 'function') return false;
  return controller.maybeHandleUserRequest(req, res, { pathname, url });
};
