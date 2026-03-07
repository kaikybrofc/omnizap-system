const METHOD_NOT_ALLOWED_BODY = { error: 'Metodo nao permitido.' };

const isReadMethod = (method) => method === 'GET' || method === 'HEAD';
const decodePathSegment = (segment) => {
  try {
    return decodeURIComponent(String(segment || ''));
  } catch {
    return String(segment || '');
  }
};

export const handleCatalogAuthRoutes = async ({
  req,
  res,
  pathname,
  url,
  apiBasePath,
  handlers,
  sendJson,
}) => {
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
    const querySessionToken = decodePathSegment(
      String(url?.searchParams?.get('session_token') || url?.searchParams?.get('token') || ''),
    );
    const queryAction = String(url?.searchParams?.get('action') || '')
      .trim()
      .toLowerCase();

    if (querySessionToken) {
      if (!queryAction) {
        await handlers.handlePasswordRecoverySessionStatusRequest(req, res, {
          sessionToken: querySessionToken,
        });
        return true;
      }

      if (queryAction === 'request') {
        await handlers.handlePasswordRecoverySessionRequest(req, res, {
          sessionToken: querySessionToken,
        });
        return true;
      }

      if (queryAction === 'verify') {
        await handlers.handlePasswordRecoverySessionVerifyRequest(req, res, {
          sessionToken: querySessionToken,
        });
        return true;
      }

      sendJson(req, res, 400, { error: 'Acao de sessao de redefinicao invalida.' });
      return true;
    }

    await handlers.handlePasswordRecoverySessionCreateRequest(req, res);
    return true;
  }

  if (pathname.startsWith(`${passwordRecoverySessionBasePath}/`)) {
    const suffix = pathname.slice(passwordRecoverySessionBasePath.length).replace(/^\/+/, '');
    const [rawSessionToken = '', action = '', extra = ''] = String(suffix).split('/');
    const sessionToken = decodePathSegment(rawSessionToken);

    if (!sessionToken) {
      sendJson(req, res, 400, { error: 'Sessao de redefinicao invalida.' });
      return true;
    }

    if (!action) {
      await handlers.handlePasswordRecoverySessionStatusRequest(req, res, {
        sessionToken,
      });
      return true;
    }

    if (extra) {
      sendJson(req, res, 404, { error: 'Rota de autenticacao nao encontrada.' });
      return true;
    }

    if (action === 'request') {
      await handlers.handlePasswordRecoverySessionRequest(req, res, {
        sessionToken,
      });
      return true;
    }

    if (action === 'verify') {
      await handlers.handlePasswordRecoverySessionVerifyRequest(req, res, {
        sessionToken,
      });
      return true;
    }

    sendJson(req, res, 404, { error: 'Rota de autenticacao nao encontrada.' });
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
