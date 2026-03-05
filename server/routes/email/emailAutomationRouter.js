let emailAutomationControllerPromise = null;

const loadEmailAutomationController = async () => {
  if (!emailAutomationControllerPromise) {
    emailAutomationControllerPromise = import('../../controllers/email/emailAutomationController.js');
  }
  return emailAutomationControllerPromise;
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

const DEFAULT_EMAIL_AUTOMATION_API_BASE_PATH = '/api/email';

export const getEmailAutomationRouterConfig = async () => {
  const controller = await loadEmailAutomationController();
  const routeConfig = (typeof controller?.getEmailAutomationRouteConfig === 'function' ? controller.getEmailAutomationRouteConfig() : null) || {};

  return {
    apiBasePath: normalizeBasePath(routeConfig.apiBasePath, DEFAULT_EMAIL_AUTOMATION_API_BASE_PATH),
  };
};

export const shouldHandleEmailAutomationPath = (pathname, config = null) => {
  const resolvedConfig = config || {
    apiBasePath: DEFAULT_EMAIL_AUTOMATION_API_BASE_PATH,
  };

  return startsWithPath(pathname, resolvedConfig.apiBasePath);
};

export const maybeHandleEmailAutomationRequest = async (req, res, { pathname, url }) => {
  const controller = await loadEmailAutomationController();
  if (typeof controller?.maybeHandleEmailAutomationRequest !== 'function') return false;
  return controller.maybeHandleEmailAutomationRequest(req, res, { pathname, url });
};
