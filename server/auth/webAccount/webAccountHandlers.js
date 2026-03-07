const MY_PROFILE_DEFAULT_STATS = Object.freeze({
  total: 0,
  published: 0,
  drafts: 0,
  private: 0,
  unlisted: 0,
  public: 0,
});

const buildMyProfileStatsTemplate = () => ({ ...MY_PROFILE_DEFAULT_STATS });

const normalizeMyProfileView = (value) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'summary') return 'summary';
  if (normalized === 'packs') return 'packs';
  return 'full';
};

const toUserPasswordStatePayload = (credential) => {
  if (!credential) {
    return {
      configured: false,
      failed_attempts: 0,
      last_failed_at: null,
      last_login_at: null,
      password_changed_at: null,
      revoked_at: null,
    };
  }

  return {
    configured: Boolean(credential.has_password && !credential.revoked_at),
    failed_attempts: Number(credential.failed_attempts || 0),
    last_failed_at: credential.last_failed_at || null,
    last_login_at: credential.last_login_at || null,
    password_changed_at: credential.password_changed_at || null,
    revoked_at: credential.revoked_at || null,
  };
};

const maskEmailForResponse = (value, { normalizeEmail }) => {
  const normalized = normalizeEmail(value);
  if (!normalized || !normalized.includes('@')) return null;
  const [localPart, domainPart] = normalized.split('@');
  if (!localPart || !domainPart) return null;
  const safeLocal =
    localPart.length <= 2 ? `${localPart.charAt(0) || '*'}*` : `${localPart.slice(0, 2)}***`;
  const domainSegments = domainPart.split('.');
  const domainHead = String(domainSegments.shift() || '');
  const safeDomainHead =
    domainHead.length <= 2 ? `${domainHead.charAt(0) || '*'}*` : `${domainHead.slice(0, 2)}***`;
  const suffix = domainSegments.length ? `.${domainSegments.join('.')}` : '';
  return `${safeLocal}@${safeDomainHead}${suffix}`;
};

const normalizePasswordRecoverySessionToken = (value) =>
  String(value || '')
    .trim()
    .slice(0, 4096);

const buildPasswordRecoverySessionLegacyPath = (sessionToken, { userPasswordResetWebPath }) =>
  `${userPasswordResetWebPath}/${encodeURIComponent(String(sessionToken || ''))}`;

const buildPasswordRecoverySessionPath = (
  sessionToken,
  {
    userProfileWebPath,
    userPasswordRecoverySessionQueryParam,
  },
) => {
  const rawToken = String(sessionToken || '').trim();
  if (!rawToken) return `${userProfileWebPath}/`;
  const safeProfilePath = userProfileWebPath.endsWith('/')
    ? userProfileWebPath
    : `${userProfileWebPath}/`;
  const search = new URLSearchParams({
    [userPasswordRecoverySessionQueryParam]: rawToken,
  }).toString();
  return `${safeProfilePath}?${search}`;
};

const toPasswordRecoverySessionExpiresAt = (claims) => {
  const expUnix = Number(claims?.exp || 0);
  if (!Number.isFinite(expUnix) || expUnix <= 0) return null;
  return new Date(expUnix * 1000).toISOString();
};

const toPasswordRecoverySessionExpiresIn = (claims) => {
  const expUnix = Number(claims?.exp || 0);
  if (!Number.isFinite(expUnix) || expUnix <= 0) return null;
  return Math.max(0, Math.floor(expUnix - Date.now() / 1000));
};

const signPasswordRecoverySessionToken = (
  { sub = '', email = '', ownerJid = '' } = {},
  {
    isWebAuthJwtEnabled,
    signWebAuthJwt,
    passwordRecoverySessionAuthMethod,
    passwordRecoverySessionTtlSeconds,
  },
) => {
  if (!isWebAuthJwtEnabled()) return '';
  return signWebAuthJwt(
    {
      sub,
      email,
      ownerJid,
      authMethod: passwordRecoverySessionAuthMethod,
    },
    {
      expiresInSeconds: passwordRecoverySessionTtlSeconds,
    },
  );
};

const resolvePasswordRecoverySessionClaims = (
  sessionToken,
  {
    isWebAuthJwtEnabled,
    verifyWebAuthJwt,
    passwordRecoverySessionAuthMethod,
    normalizeJid,
    normalizeEmail,
  },
) => {
  if (!isWebAuthJwtEnabled()) {
    return {
      ok: false,
      statusCode: 503,
      error: 'JWT de autenticacao nao configurado no servidor.',
      code: 'JWT_NOT_CONFIGURED',
    };
  }

  const normalizedSessionToken = normalizePasswordRecoverySessionToken(sessionToken);
  if (!normalizedSessionToken) {
    return {
      ok: false,
      statusCode: 400,
      error: 'Sessao de redefinicao invalida.',
      code: 'PASSWORD_RECOVERY_SESSION_INVALID',
    };
  }

  const claims = verifyWebAuthJwt(normalizedSessionToken);
  if (!claims?.sub || claims.amr !== passwordRecoverySessionAuthMethod) {
    return {
      ok: false,
      statusCode: 401,
      error: 'Sessao de redefinicao invalida ou expirada.',
      code: 'PASSWORD_RECOVERY_SESSION_EXPIRED',
    };
  }

  const normalizedOwnerJid = normalizeJid(claims.owner_jid || '');
  const normalizedEmail = normalizeEmail(claims.email || '');
  if (!normalizedOwnerJid || !normalizedEmail || !normalizedEmail.includes('@')) {
    return {
      ok: false,
      statusCode: 401,
      error: 'Sessao de redefinicao invalida.',
      code: 'PASSWORD_RECOVERY_SESSION_INVALID',
    };
  }

  return {
    ok: true,
    claims,
    identity: {
      googleSub: claims.sub,
      email: normalizedEmail,
      ownerJid: normalizedOwnerJid,
      purpose: 'reset',
    },
  };
};

const toObjectDetailsIfAny = (error) => {
  if (Array.isArray(error?.details)) return error.details;
  if (error?.details && typeof error.details === 'object') return error.details;
  return undefined;
};

export const createWebAccountAuthHandlers = ({
  sendJson,
  readJsonBody,
  logger,
  parseUserPasswordUpsertPayload,
  parseUserPasswordRecoveryRequestPayload,
  parseUserPasswordRecoveryVerifyPayload,
  parseUserPasswordLoginPayload,
  resolveGoogleWebSessionFromRequest,
  mapGoogleSessionResponseData,
  createPersistedGoogleWebSessionFromIdentity,
  setGoogleWebSessionCookie,
  issueAccessTokenForSession,
  userPasswordAuthService,
  userPasswordRecoveryService,
  resolveRequestRemoteIp,
  normalizeEmail,
  normalizeGoogleSubject,
  normalizeJid,
  isWebAuthJwtEnabled,
  signWebAuthJwt,
  verifyWebAuthJwt,
  passwordRecoverySessionAuthMethod,
  passwordRecoverySessionTtlSeconds,
  userPasswordResetWebPath,
  userProfileWebPath,
  userPasswordRecoverySessionQueryParam,
  toSiteAbsoluteUrl,
  executeQuery,
  tables,
  toIsoOrNull,
  sanitizeText,
  listStickerPacksByOwner,
  listStickerPackEngagementByPackIds,
  mapPackSummary,
  isPackPubliclyVisible,
  resolveMyProfileOwnerCandidates,
  shouldHidePackFromMyProfileDefault,
  parseEnvBool,
  clampInt,
  stickerWebGoogleClientId,
  stickerWebGoogleAuthRequired,
}) => {
  const handlePasswordAuthRequest = async (req, res) => {
    if (!['GET', 'HEAD', 'POST', 'DELETE'].includes(req.method || '')) {
      sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
      return;
    }

    const googleSession = await resolveGoogleWebSessionFromRequest(req);
    if (!googleSession?.sub || !googleSession?.ownerJid) {
      sendJson(req, res, 401, { error: 'Sessao Google invalida ou expirada.' });
      return;
    }

    const identity = {
      googleSub: googleSession.sub,
      email: googleSession.email,
      ownerJid: googleSession.ownerJid,
    };

    if (req.method === 'GET' || req.method === 'HEAD') {
      const credential = await userPasswordAuthService.findCredentialByIdentity(identity, {
        includeRevoked: true,
      });
      sendJson(req, res, 200, {
        data: {
          session: mapGoogleSessionResponseData(googleSession),
          password: toUserPasswordStatePayload(credential),
        },
      });
      return;
    }

    if (req.method === 'DELETE') {
      const revoked = await userPasswordAuthService.revokePasswordForIdentity(identity);
      sendJson(req, res, 200, {
        data: {
          revoked: Boolean(revoked),
          session: mapGoogleSessionResponseData(googleSession),
          password: toUserPasswordStatePayload(revoked),
        },
      });
      return;
    }

    let payload = {};
    try {
      payload = await readJsonBody(req);
    } catch (error) {
      sendJson(req, res, Number(error?.statusCode || 400), {
        error: error?.message || 'Body invalido.',
      });
      return;
    }

    try {
      payload = parseUserPasswordUpsertPayload(payload);
    } catch (error) {
      sendJson(req, res, Number(error?.statusCode || 400), {
        error: error?.message || 'Payload de senha invalido.',
        code: error?.code || 'INVALID_PAYLOAD',
        details: Array.isArray(error?.details) ? error.details : undefined,
      });
      return;
    }

    try {
      const credential = await userPasswordAuthService.setPasswordForIdentity({
        ...identity,
        password: payload.password,
      });
      sendJson(req, res, 200, {
        data: {
          updated: true,
          session: mapGoogleSessionResponseData(googleSession),
          password: toUserPasswordStatePayload(credential),
        },
      });
    } catch (error) {
      sendJson(req, res, Number(error?.statusCode || 400), {
        error: error?.message || 'Falha ao salvar senha.',
        code: error?.code || 'PASSWORD_UPDATE_FAILED',
        details: Array.isArray(error?.details) ? error.details : undefined,
      });
    }
  };

  const handlePasswordRecoveryRequest = async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
      return;
    }

    let payload = {};
    try {
      payload = await readJsonBody(req);
    } catch (error) {
      sendJson(req, res, Number(error?.statusCode || 400), {
        error: error?.message || 'Body invalido.',
      });
      return;
    }

    try {
      payload = parseUserPasswordRecoveryRequestPayload(payload);
    } catch (error) {
      sendJson(req, res, Number(error?.statusCode || 400), {
        error: error?.message || 'Payload de recuperacao de senha invalido.',
        code: error?.code || 'INVALID_PAYLOAD',
        details: Array.isArray(error?.details) ? error.details : undefined,
      });
      return;
    }

    try {
      const result = await userPasswordRecoveryService.requestPasswordRecoveryCode({
        googleSub: payload.google_sub,
        email: payload.email,
        ownerJid: payload.owner_jid,
        purpose: payload.purpose || 'reset',
        requestMeta: {
          remoteIp: resolveRequestRemoteIp(req),
          userAgent: req.headers?.['user-agent'] || null,
        },
      });

      sendJson(req, res, 200, {
        data: {
          accepted: true,
          queued: Boolean(result?.queued),
          cooldown_active: Boolean(result?.cooldown_active),
          rate_limited: Boolean(result?.rate_limited),
          expires_in_seconds: Number(result?.expires_in_seconds || 0) || null,
          masked_email:
            result?.masked_email ||
            maskEmailForResponse(payload.email, {
              normalizeEmail,
            }) ||
            null,
        },
      });
    } catch (error) {
      const retryAfterSeconds = Math.max(0, Number(error?.details?.retry_after_seconds || 0));
      if (retryAfterSeconds > 0) {
        res.setHeader('Retry-After', String(retryAfterSeconds));
      }
      sendJson(req, res, Number(error?.statusCode || 400), {
        error: error?.message || 'Falha ao solicitar codigo de verificacao.',
        code: error?.code || 'PASSWORD_RECOVERY_REQUEST_FAILED',
        details: toObjectDetailsIfAny(error),
      });
    }
  };

  const handlePasswordRecoveryVerifyRequest = async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
      return;
    }

    let payload = {};
    try {
      payload = await readJsonBody(req);
    } catch (error) {
      sendJson(req, res, Number(error?.statusCode || 400), {
        error: error?.message || 'Body invalido.',
      });
      return;
    }

    try {
      payload = parseUserPasswordRecoveryVerifyPayload(payload);
    } catch (error) {
      sendJson(req, res, Number(error?.statusCode || 400), {
        error: error?.message || 'Payload de verificacao invalido.',
        code: error?.code || 'INVALID_PAYLOAD',
        details: Array.isArray(error?.details) ? error.details : undefined,
      });
      return;
    }

    try {
      const recoveryResult = await userPasswordRecoveryService.verifyPasswordRecoveryCode({
        googleSub: payload.google_sub,
        email: payload.email,
        ownerJid: payload.owner_jid,
        purpose: payload.purpose || '',
        code: payload.code,
        password: payload.password,
        requestMeta: {
          remoteIp: resolveRequestRemoteIp(req),
          userAgent: req.headers?.['user-agent'] || null,
        },
      });

      let sessionPayload = mapGoogleSessionResponseData(null);
      if (recoveryResult?.credential?.google_sub && recoveryResult?.credential?.owner_jid) {
        try {
          const session = await createPersistedGoogleWebSessionFromIdentity({
            sub: recoveryResult.credential.google_sub,
            email: recoveryResult.credential.email || '',
            name: recoveryResult.credential.name || '',
            picture: recoveryResult.credential.picture || '',
            ownerJid: recoveryResult.credential.owner_jid,
            requestMeta: {
              remoteIp: resolveRequestRemoteIp(req),
              userAgent: req.headers?.['user-agent'] || null,
            },
          });
          setGoogleWebSessionCookie(req, res, session.token);
          const accessToken = issueAccessTokenForSession(session);
          sessionPayload = mapGoogleSessionResponseData(session, { accessToken });
        } catch (sessionError) {
          logger.warn('Senha redefinida, mas sessao automatica nao foi criada.', {
            action: 'web_password_recovery_session_create_failed',
            error: sessionError?.message,
            google_sub: recoveryResult?.credential?.google_sub || null,
          });
        }
      }

      sendJson(req, res, 200, {
        data: {
          updated: true,
          auth_method: 'password_recovery',
          session: sessionPayload,
          password: toUserPasswordStatePayload(recoveryResult?.credential || null),
          masked_email:
            recoveryResult?.masked_email ||
            maskEmailForResponse(payload.email, {
              normalizeEmail,
            }) ||
            null,
        },
      });
    } catch (error) {
      sendJson(req, res, Number(error?.statusCode || 400), {
        error: error?.message || 'Falha ao validar codigo de verificacao.',
        code: error?.code || 'PASSWORD_RECOVERY_VERIFY_FAILED',
        details: Array.isArray(error?.details) ? error.details : undefined,
      });
    }
  };

  const handlePasswordRecoverySessionCreateRequest = async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
      return;
    }

    const googleSession = await resolveGoogleWebSessionFromRequest(req);
    if (!googleSession?.sub || !googleSession?.ownerJid) {
      sendJson(req, res, 401, { error: 'Sessao Google invalida ou expirada.' });
      return;
    }

    const normalizedEmail = normalizeEmail(googleSession.email || '');
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      sendJson(req, res, 400, {
        error: 'Conta sem e-mail valido para recuperacao.',
        code: 'PASSWORD_RECOVERY_EMAIL_REQUIRED',
      });
      return;
    }

    const sessionToken = signPasswordRecoverySessionToken(
      {
        sub: googleSession.sub,
        email: normalizedEmail,
        ownerJid: googleSession.ownerJid,
      },
      {
        isWebAuthJwtEnabled,
        signWebAuthJwt,
        passwordRecoverySessionAuthMethod,
        passwordRecoverySessionTtlSeconds,
      },
    );

    if (!sessionToken) {
      sendJson(req, res, 503, {
        error: 'JWT de autenticacao nao configurado no servidor.',
        code: 'JWT_NOT_CONFIGURED',
      });
      return;
    }

    const claims = verifyWebAuthJwt(sessionToken);
    const sessionPath = buildPasswordRecoverySessionPath(sessionToken, {
      userProfileWebPath,
      userPasswordRecoverySessionQueryParam,
    });
    const sessionUrl = toSiteAbsoluteUrl(sessionPath);
    const sessionPathLegacy = buildPasswordRecoverySessionLegacyPath(sessionToken, {
      userPasswordResetWebPath,
    });
    const sessionUrlLegacy = toSiteAbsoluteUrl(sessionPathLegacy);

    sendJson(req, res, 200, {
      data: {
        created: true,
        purpose: 'reset',
        session_path: sessionPath,
        session_url: sessionUrl,
        session_path_legacy: sessionPathLegacy,
        session_url_legacy: sessionUrlLegacy,
        masked_email: maskEmailForResponse(normalizedEmail, {
          normalizeEmail,
        }),
        expires_at: toPasswordRecoverySessionExpiresAt(claims),
        expires_in_seconds: toPasswordRecoverySessionExpiresIn(claims),
      },
    });
  };

  const handlePasswordRecoverySessionStatusRequest = async (
    req,
    res,
    { sessionToken = '' } = {},
  ) => {
    if (!['GET', 'HEAD'].includes(req.method || '')) {
      sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
      return;
    }

    const resolvedSession = resolvePasswordRecoverySessionClaims(sessionToken, {
      isWebAuthJwtEnabled,
      verifyWebAuthJwt,
      passwordRecoverySessionAuthMethod,
      normalizeJid,
      normalizeEmail,
    });
    if (!resolvedSession.ok) {
      sendJson(req, res, resolvedSession.statusCode, {
        error: resolvedSession.error,
        code: resolvedSession.code,
      });
      return;
    }

    const credential = await userPasswordAuthService.findCredentialByIdentity(
      {
        googleSub: resolvedSession.identity.googleSub,
        email: resolvedSession.identity.email,
        ownerJid: resolvedSession.identity.ownerJid,
      },
      { includeRevoked: true },
    );

    sendJson(req, res, 200, {
      data: {
        valid: true,
        purpose: resolvedSession.identity.purpose,
        masked_email: maskEmailForResponse(resolvedSession.identity.email, {
          normalizeEmail,
        }),
        expires_at: toPasswordRecoverySessionExpiresAt(resolvedSession.claims),
        expires_in_seconds: toPasswordRecoverySessionExpiresIn(resolvedSession.claims),
        password: toUserPasswordStatePayload(credential),
      },
    });
  };

  const handlePasswordRecoverySessionRequest = async (req, res, { sessionToken = '' } = {}) => {
    if (req.method !== 'POST') {
      sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
      return;
    }

    const resolvedSession = resolvePasswordRecoverySessionClaims(sessionToken, {
      isWebAuthJwtEnabled,
      verifyWebAuthJwt,
      passwordRecoverySessionAuthMethod,
      normalizeJid,
      normalizeEmail,
    });
    if (!resolvedSession.ok) {
      sendJson(req, res, resolvedSession.statusCode, {
        error: resolvedSession.error,
        code: resolvedSession.code,
      });
      return;
    }

    try {
      const result = await userPasswordRecoveryService.requestPasswordRecoveryCode({
        googleSub: resolvedSession.identity.googleSub,
        email: resolvedSession.identity.email,
        ownerJid: resolvedSession.identity.ownerJid,
        purpose: resolvedSession.identity.purpose,
        requestMeta: {
          remoteIp: resolveRequestRemoteIp(req),
          userAgent: req.headers?.['user-agent'] || null,
        },
      });

      sendJson(req, res, 200, {
        data: {
          accepted: true,
          queued: Boolean(result?.queued),
          cooldown_active: Boolean(result?.cooldown_active),
          rate_limited: Boolean(result?.rate_limited),
          expires_in_seconds: Number(result?.expires_in_seconds || 0) || null,
          masked_email:
            result?.masked_email ||
            maskEmailForResponse(resolvedSession.identity.email, {
              normalizeEmail,
            }) ||
            null,
        },
      });
    } catch (error) {
      const retryAfterSeconds = Math.max(0, Number(error?.details?.retry_after_seconds || 0));
      if (retryAfterSeconds > 0) {
        res.setHeader('Retry-After', String(retryAfterSeconds));
      }
      sendJson(req, res, Number(error?.statusCode || 400), {
        error: error?.message || 'Falha ao solicitar codigo de verificacao.',
        code: error?.code || 'PASSWORD_RECOVERY_REQUEST_FAILED',
        details: toObjectDetailsIfAny(error),
      });
    }
  };

  const handlePasswordRecoverySessionVerifyRequest = async (
    req,
    res,
    { sessionToken = '' } = {},
  ) => {
    if (req.method !== 'POST') {
      sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
      return;
    }

    const resolvedSession = resolvePasswordRecoverySessionClaims(sessionToken, {
      isWebAuthJwtEnabled,
      verifyWebAuthJwt,
      passwordRecoverySessionAuthMethod,
      normalizeJid,
      normalizeEmail,
    });
    if (!resolvedSession.ok) {
      sendJson(req, res, resolvedSession.statusCode, {
        error: resolvedSession.error,
        code: resolvedSession.code,
      });
      return;
    }

    let payload = {};
    try {
      payload = await readJsonBody(req);
    } catch (error) {
      sendJson(req, res, Number(error?.statusCode || 400), {
        error: error?.message || 'Body invalido.',
      });
      return;
    }

    try {
      payload = parseUserPasswordRecoveryVerifyPayload({
        ...payload,
        google_sub: resolvedSession.identity.googleSub,
        email: resolvedSession.identity.email,
        owner_jid: resolvedSession.identity.ownerJid,
        purpose: resolvedSession.identity.purpose,
      });
    } catch (error) {
      sendJson(req, res, Number(error?.statusCode || 400), {
        error: error?.message || 'Payload de verificacao invalido.',
        code: error?.code || 'INVALID_PAYLOAD',
        details: Array.isArray(error?.details) ? error.details : undefined,
      });
      return;
    }

    try {
      const recoveryResult = await userPasswordRecoveryService.verifyPasswordRecoveryCode({
        googleSub: payload.google_sub,
        email: payload.email,
        ownerJid: payload.owner_jid,
        purpose: payload.purpose || '',
        code: payload.code,
        password: payload.password,
        requestMeta: {
          remoteIp: resolveRequestRemoteIp(req),
          userAgent: req.headers?.['user-agent'] || null,
        },
      });

      let sessionPayload = mapGoogleSessionResponseData(null);
      if (recoveryResult?.credential?.google_sub && recoveryResult?.credential?.owner_jid) {
        try {
          const session = await createPersistedGoogleWebSessionFromIdentity({
            sub: recoveryResult.credential.google_sub,
            email: recoveryResult.credential.email || '',
            name: recoveryResult.credential.name || '',
            picture: recoveryResult.credential.picture || '',
            ownerJid: recoveryResult.credential.owner_jid,
            requestMeta: {
              remoteIp: resolveRequestRemoteIp(req),
              userAgent: req.headers?.['user-agent'] || null,
            },
          });
          setGoogleWebSessionCookie(req, res, session.token);
          const accessToken = issueAccessTokenForSession(session);
          sessionPayload = mapGoogleSessionResponseData(session, { accessToken });
        } catch (sessionError) {
          logger.warn('Senha redefinida por sessao, mas login automatico nao foi criado.', {
            action: 'web_password_recovery_session_login_create_failed',
            error: sessionError?.message,
            google_sub: recoveryResult?.credential?.google_sub || null,
          });
        }
      }

      sendJson(req, res, 200, {
        data: {
          updated: true,
          auth_method: 'password_recovery_session',
          session: sessionPayload,
          password: toUserPasswordStatePayload(recoveryResult?.credential || null),
          masked_email:
            recoveryResult?.masked_email ||
            maskEmailForResponse(payload.email, {
              normalizeEmail,
            }) ||
            null,
        },
      });
    } catch (error) {
      sendJson(req, res, Number(error?.statusCode || 400), {
        error: error?.message || 'Falha ao validar codigo de verificacao.',
        code: error?.code || 'PASSWORD_RECOVERY_VERIFY_FAILED',
        details: Array.isArray(error?.details) ? error.details : undefined,
      });
    }
  };

  const handlePasswordLoginRequest = async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
      return;
    }

    let payload = {};
    try {
      payload = await readJsonBody(req);
    } catch (error) {
      sendJson(req, res, Number(error?.statusCode || 400), {
        error: error?.message || 'Body invalido.',
      });
      return;
    }

    try {
      payload = parseUserPasswordLoginPayload(payload);
    } catch (error) {
      sendJson(req, res, Number(error?.statusCode || 400), {
        error: error?.message || 'Payload de login por senha invalido.',
        code: error?.code || 'INVALID_PAYLOAD',
        details: Array.isArray(error?.details) ? error.details : undefined,
      });
      return;
    }

    const authResult = await userPasswordAuthService.verifyPasswordForIdentity({
      googleSub: payload.google_sub,
      email: payload.email,
      ownerJid: payload.owner_jid,
      password: payload.password,
    });

    if (
      !authResult?.authenticated ||
      !authResult?.credential?.google_sub ||
      !authResult?.credential?.owner_jid
    ) {
      let errorCode = authResult?.reason || 'INVALID_PASSWORD';
      let passwordSetupRequired = false;
      let suggestedMaskedEmail = null;

      if (errorCode === 'CREDENTIAL_NOT_FOUND') {
        const knownUser = await userPasswordAuthService.findKnownGoogleUserByIdentity({
          googleSub: payload.google_sub,
          email: payload.email,
          ownerJid: payload.owner_jid,
        });

        if (knownUser?.google_sub) {
          errorCode = 'PASSWORD_NOT_CONFIGURED';
          passwordSetupRequired = true;
          suggestedMaskedEmail = maskEmailForResponse(knownUser.email || payload.email, {
            normalizeEmail,
          });
        }
      }

      sendJson(req, res, 401, {
        error: 'Credenciais invalidas.',
        code: errorCode,
        data: {
          password: toUserPasswordStatePayload(authResult?.credential || null),
          password_setup_required: passwordSetupRequired,
          masked_email: suggestedMaskedEmail,
        },
      });
      return;
    }

    try {
      const credential = authResult.credential;
      const session = await createPersistedGoogleWebSessionFromIdentity({
        sub: credential.google_sub,
        email: credential.email || '',
        name: credential.name || '',
        picture: credential.picture || '',
        ownerJid: credential.owner_jid,
        requestMeta: {
          remoteIp: resolveRequestRemoteIp(req),
          userAgent: req.headers?.['user-agent'] || null,
        },
      });

      setGoogleWebSessionCookie(req, res, session.token);
      const accessToken = issueAccessTokenForSession(session);
      sendJson(req, res, 200, {
        data: {
          auth_method: 'password',
          session: mapGoogleSessionResponseData(session, { accessToken }),
          password: toUserPasswordStatePayload(credential),
        },
      });
    } catch (error) {
      sendJson(req, res, Number(error?.statusCode || 500), {
        error: error?.message || 'Falha ao finalizar login por senha.',
        code: error?.code || 'PASSWORD_LOGIN_FAILED',
      });
    }
  };

  const resolveMyProfileAccountSummary = async (session) => {
    if (!session) return null;

    const planLabel =
      sanitizeText(process.env.STICKER_WEB_USER_PLAN_LABEL || '', 80, { allowEmpty: true }) ||
      'Conta padrao';
    const normalizedSub = normalizeGoogleSubject(session?.sub);
    const normalizedEmail = normalizeEmail(session?.email);
    const normalizedOwnerJid = normalizeJid(session?.ownerJid || '') || '';
    const identityClauses = [];
    const identityParams = [];

    if (normalizedSub) {
      identityClauses.push('google_sub = ?');
      identityParams.push(normalizedSub);
    }
    if (normalizedEmail) {
      identityClauses.push('email = ?');
      identityParams.push(normalizedEmail);
    }
    if (normalizedOwnerJid) {
      identityClauses.push('owner_jid = ?');
      identityParams.push(normalizedOwnerJid);
    }

    let lastLoginAt = null;
    let lastSeenAt = null;

    if (identityClauses.length) {
      try {
        const rows = await executeQuery(
          `SELECT last_login_at, last_seen_at
             FROM ${tables.STICKER_WEB_GOOGLE_USER}
            WHERE ${identityClauses.join(' OR ')}
            ORDER BY COALESCE(last_login_at, last_seen_at, updated_at, created_at) DESC
            LIMIT 1`,
          identityParams,
        );
        const entry = Array.isArray(rows) ? rows[0] : null;
        lastLoginAt = toIsoOrNull(entry?.last_login_at);
        lastSeenAt = toIsoOrNull(entry?.last_seen_at);
      } catch (error) {
        logger.warn('Falha ao resolver resumo de conta do perfil web.', {
          action: 'sticker_pack_my_profile_account_summary_failed',
          google_sub: normalizedSub,
          owner_jid: normalizedOwnerJid,
          error: error?.message,
        });
      }
    }

    return {
      plan_label: planLabel,
      status: 'active',
      last_login_at: lastLoginAt,
      last_seen_at: lastSeenAt,
    };
  };

  const handleMyProfileRequest = async (req, res, url = null) => {
    if (!['GET', 'HEAD'].includes(req.method || '')) {
      sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
      return;
    }

    const session = await resolveGoogleWebSessionFromRequest(req);
    const authGoogle = {
      enabled: Boolean(stickerWebGoogleClientId),
      required: Boolean(stickerWebGoogleAuthRequired),
      client_id: stickerWebGoogleClientId || null,
    };
    const sessionIdentity = {
      googleSub: normalizeGoogleSubject(session?.sub),
      email: normalizeEmail(session?.email),
      ownerJid: normalizeJid(session?.ownerJid || ''),
    };
    const credential =
      sessionIdentity.googleSub || sessionIdentity.email || sessionIdentity.ownerJid
        ? await userPasswordAuthService
            .findCredentialByIdentity(sessionIdentity, { includeRevoked: true })
            .catch(() => null)
        : null;
    const passwordState = toUserPasswordStatePayload(credential);
    const view = normalizeMyProfileView(url?.searchParams?.get('view'));
    const shouldIncludePacks = view !== 'summary';

    if (!session?.ownerJid && !session?.email && !session?.ownerPhone) {
      sendJson(req, res, 200, {
        data: {
          auth: { google: authGoogle },
          session: mapGoogleSessionResponseData(null),
          owner_jid: null,
          owner_jids: [],
          account: null,
          password: passwordState,
          packs: [],
          stats: shouldIncludePacks ? buildMyProfileStatsTemplate() : null,
          meta: {
            view,
            lazy: !shouldIncludePacks,
          },
        },
      });
      return;
    }

    const account = await resolveMyProfileAccountSummary(session);
    const ownerCandidates = await resolveMyProfileOwnerCandidates(session);
    const primaryOwnerJid = normalizeJid(session?.ownerJid || '') || ownerCandidates[0] || null;

    if (!ownerCandidates.length) {
      sendJson(req, res, 200, {
        data: {
          auth: { google: authGoogle },
          session: mapGoogleSessionResponseData(session),
          owner_jid: primaryOwnerJid,
          owner_jids: [],
          account,
          password: passwordState,
          packs: [],
          stats: shouldIncludePacks ? buildMyProfileStatsTemplate() : null,
          meta: {
            view,
            lazy: !shouldIncludePacks,
          },
        },
      });
      return;
    }

    if (!shouldIncludePacks) {
      sendJson(req, res, 200, {
        data: {
          auth: { google: authGoogle },
          session: mapGoogleSessionResponseData(session),
          owner_jid: primaryOwnerJid,
          owner_jids: ownerCandidates,
          account,
          password: passwordState,
          packs: [],
          stats: null,
          meta: {
            view,
            lazy: true,
          },
        },
      });
      return;
    }

    const packLimit = clampInt(url?.searchParams?.get('limit'), view === 'packs' ? 120 : 300, 1, 300);
    const ownerPacks = await Promise.all(
      ownerCandidates.map((ownerJid) => listStickerPacksByOwner(ownerJid, { limit: 200, offset: 0 })),
    );
    const includeAutoPacks = parseEnvBool(
      url?.searchParams?.get('include_auto'),
      parseEnvBool(process.env.STICKER_WEB_MY_PROFILE_INCLUDE_AUTO_PACKS, false),
    );

    const dedupPacks = new Map();
    for (const packList of ownerPacks) {
      for (const pack of Array.isArray(packList) ? packList : []) {
        if (!pack?.id) continue;
        if (shouldHidePackFromMyProfileDefault(pack, { includeAutoPacks })) continue;
        const existing = dedupPacks.get(pack.id);
        if (!existing) {
          dedupPacks.set(pack.id, pack);
          continue;
        }
        const currentUpdatedAt = Date.parse(String(pack.updated_at || pack.created_at || ''));
        const existingUpdatedAt = Date.parse(
          String(existing.updated_at || existing.created_at || ''),
        );
        if (
          Number.isFinite(currentUpdatedAt) &&
          (!Number.isFinite(existingUpdatedAt) || currentUpdatedAt > existingUpdatedAt)
        ) {
          dedupPacks.set(pack.id, pack);
        }
      }
    }

    const packs = Array.from(dedupPacks.values())
      .sort((a, b) => {
        const aUpdatedAt = Date.parse(String(a?.updated_at || a?.created_at || ''));
        const bUpdatedAt = Date.parse(String(b?.updated_at || b?.created_at || ''));
        if (!Number.isFinite(aUpdatedAt) && !Number.isFinite(bUpdatedAt)) return 0;
        if (!Number.isFinite(aUpdatedAt)) return 1;
        if (!Number.isFinite(bUpdatedAt)) return -1;
        return bUpdatedAt - aUpdatedAt;
      })
      .slice(0, packLimit);

    const engagementByPackId = await listStickerPackEngagementByPackIds(
      packs.map((pack) => pack.id),
    );

    const mappedPacks = packs.map((pack) => {
      const safeSummary = mapPackSummary(pack, engagementByPackId.get(pack.id) || null, null);
      const publicVisible = isPackPubliclyVisible(pack);
      return {
        ...safeSummary,
        is_publicly_visible: publicVisible,
        cover_url: publicVisible ? safeSummary.cover_url : null,
        cover_preview_url: publicVisible ? safeSummary.cover_preview_url : null,
      };
    });

    const stats = mappedPacks.reduce((acc, pack) => {
      acc.total += 1;
      const status = String(pack.status || '').toLowerCase();
      const visibility = String(pack.visibility || '').toLowerCase();
      if (status === 'published') acc.published += 1;
      if (status === 'draft') acc.drafts += 1;
      if (visibility === 'private') acc.private += 1;
      if (visibility === 'unlisted') acc.unlisted += 1;
      if (visibility === 'public') acc.public += 1;
      return acc;
    }, buildMyProfileStatsTemplate());

    sendJson(req, res, 200, {
      data: {
        auth: { google: authGoogle },
        session: mapGoogleSessionResponseData(session),
        owner_jid: primaryOwnerJid,
        owner_jids: ownerCandidates,
        account,
        password: passwordState,
        packs: mappedPacks,
        stats,
        meta: {
          view,
          lazy: view === 'packs',
        },
      },
    });
  };

  return {
    handlePasswordAuthRequest,
    handlePasswordRecoveryRequest,
    handlePasswordRecoveryVerifyRequest,
    handlePasswordRecoverySessionCreateRequest,
    handlePasswordRecoverySessionStatusRequest,
    handlePasswordRecoverySessionRequest,
    handlePasswordRecoverySessionVerifyRequest,
    handlePasswordLoginRequest,
    handleMyProfileRequest,
  };
};
