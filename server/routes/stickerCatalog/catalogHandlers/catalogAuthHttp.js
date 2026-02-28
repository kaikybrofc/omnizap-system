const METHOD_NOT_ALLOWED_BODY = { error: 'Metodo nao permitido.' };

const isReadMethod = (method) => method === 'GET' || method === 'HEAD';

export const handleCatalogAuthRoutes = async ({ req, res, pathname, url, apiBasePath, handlers, sendJson }) => {
  if (pathname === `${apiBasePath}/auth/google/session`) {
    await handlers.handleGoogleAuthSessionRequest(req, res);
    return true;
  }

  if (pathname === `${apiBasePath}/me`) {
    if (!isReadMethod(req.method || '')) {
      sendJson(req, res, 405, METHOD_NOT_ALLOWED_BODY);
      return true;
    }
    await handlers.handleMyProfileRequest(req, res, url);
    return true;
  }

  if (pathname === `${apiBasePath}/admin/session`) {
    await handlers.handleAdminPanelSessionRequest(req, res);
    return true;
  }

  return false;
};
