const METHOD_NOT_ALLOWED_BODY = { error: 'Metodo nao permitido.' };

const isReadMethod = (method) => method === 'GET' || method === 'HEAD';

export const handleCatalogAuthRoutes = async ({ req, res, pathname, url, apiBasePath, handlers, sendJson }) => {
  if (pathname === `${apiBasePath}/auth/google/session`) {
    await handlers.handleGoogleAuthSessionRequest(req, res);
    return true;
  }

  if (pathname === `${apiBasePath}/auth/login`) {
    await handlers.handlePasswordLoginRequest(req, res);
    return true;
  }

  if (pathname === `${apiBasePath}/auth/terms/acceptance`) {
    await handlers.handleTermsAcceptanceRequest(req, res);
    return true;
  }

  if (pathname === `${apiBasePath}/auth/password`) {
    await handlers.handlePasswordAuthRequest(req, res);
    return true;
  }

  if (pathname === `${apiBasePath}/auth/password/recovery/request`) {
    await handlers.handlePasswordRecoveryRequest(req, res);
    return true;
  }

  if (pathname === `${apiBasePath}/auth/password/recovery/verify`) {
    await handlers.handlePasswordRecoveryVerifyRequest(req, res);
    return true;
  }

  const passwordRecoverySessionBasePath = `${apiBasePath}/auth/password/recovery/session`;
  if (pathname === passwordRecoverySessionBasePath) {
    if (isReadMethod(req.method || '')) {
      await handlers.handlePasswordRecoverySessionStatusRequest(req, res);
      return true;
    }

    if (req.method === 'POST') {
      await handlers.handlePasswordRecoverySessionCreateRequest(req, res);
      return true;
    }

    sendJson(req, res, 405, METHOD_NOT_ALLOWED_BODY);
    return true;
  }

  if (pathname === `${passwordRecoverySessionBasePath}/request`) {
    await handlers.handlePasswordRecoverySessionRequest(req, res);
    return true;
  }

  if (pathname === `${passwordRecoverySessionBasePath}/verify`) {
    await handlers.handlePasswordRecoverySessionVerifyRequest(req, res);
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
