import { randomUUID } from 'node:crypto';
import axios from 'axios';

const GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const GOOGLE_WEB_SESSION_COOKIE_NAME = 'omnizap_google_session';

const normalizeCookiePath = (value, fallback = '/') => {
  const raw = String(value || '').trim();
  const base = raw || fallback;
  const withSlash = base.startsWith('/') ? base : `/${base}`;
  if (withSlash.length > 1 && withSlash.endsWith('/')) return withSlash.slice(0, -1);
  return withSlash || '/';
};

export const createGoogleWebAuthService = ({ executeQuery, runSqlTransaction, tables, logger, sendJson, readJsonBody, parseCookies, getCookieValuesFromRequest, appendSetCookie, buildCookieString, normalizeGoogleSubject, normalizeEmail, normalizeJid, sanitizeText, toIsoOrNull, toWhatsAppPhoneDigits, resolveWhatsAppOwnerJidFromLoginPayload, buildGoogleOwnerJid, assertGoogleIdentityNotBanned, googleClientId, sessionTtlMs, sessionDbTouchIntervalMs, sessionDbPruneIntervalMs, notAllowedErrorCode, sessionCookiePath = '/', legacyCookiePaths = [] }) => {
  const webGoogleSessionMap = new Map();
  let googleWebSessionDbPruneAt = 0;
  const normalizedSessionCookiePath = normalizeCookiePath(sessionCookiePath, '/');
  const normalizedLegacyCookiePaths = Array.from(new Set(['/', normalizedSessionCookiePath, ...legacyCookiePaths].map((pathValue) => normalizeCookiePath(pathValue, '/')).filter(Boolean)));

  const pruneExpiredGoogleSessions = () => {
    const now = Date.now();
    for (const [token, session] of webGoogleSessionMap.entries()) {
      if (!session || Number(session.expiresAt || 0) <= now) {
        webGoogleSessionMap.delete(token);
      }
    }
  };

  const verifyGoogleIdToken = async (idToken) => {
    const token = String(idToken || '').trim();
    if (!token) {
      const error = new Error('Token Google ausente.');
      error.statusCode = 401;
      throw error;
    }

    let response;
    try {
      response = await axios.get(GOOGLE_TOKENINFO_URL, {
        params: { id_token: token },
        timeout: 5000,
        validateStatus: () => true,
      });
    } catch (error) {
      const wrapped = new Error('Falha ao validar login Google.');
      wrapped.statusCode = 502;
      wrapped.cause = error;
      throw wrapped;
    }

    if (response.status < 200 || response.status >= 300) {
      const reason = String(response?.data?.error_description || response?.data?.error || '').trim();
      const error = new Error(reason || 'Token Google inválido.');
      error.statusCode = 401;
      throw error;
    }

    const claims = response?.data && typeof response.data === 'object' ? response.data : {};
    const aud = String(claims.aud || '').trim();
    const iss = String(claims.iss || '').trim();
    const sub = normalizeGoogleSubject(claims.sub);
    const email = String(claims.email || '')
      .trim()
      .toLowerCase();
    const emailVerified = String(claims.email_verified || '')
      .trim()
      .toLowerCase();

    if (googleClientId && aud !== googleClientId) {
      const error = new Error('Login Google não pertence a este aplicativo.');
      error.statusCode = 403;
      throw error;
    }
    if (iss && !['accounts.google.com', 'https://accounts.google.com'].includes(iss)) {
      const error = new Error('Emissor do token Google inválido.');
      error.statusCode = 401;
      throw error;
    }
    if (!sub) {
      const error = new Error('Token Google sem identificador de usuário.');
      error.statusCode = 401;
      throw error;
    }
    if (email && emailVerified && !['true', '1'].includes(emailVerified)) {
      const error = new Error('Conta Google sem e-mail verificado.');
      error.statusCode = 403;
      throw error;
    }

    return {
      sub,
      email: email || null,
      name: sanitizeText(claims.name || claims.given_name || '', 120, { allowEmpty: true }) || null,
      picture: String(claims.picture || '').trim() || null,
    };
  };

  const getGoogleWebSessionTokensFromRequest = (req) => {
    const direct = getCookieValuesFromRequest(req, GOOGLE_WEB_SESSION_COOKIE_NAME);
    if (direct.length > 0) return direct;
    const cookies = parseCookies(req);
    const fallback = String(cookies[GOOGLE_WEB_SESSION_COOKIE_NAME] || '').trim();
    return fallback ? [fallback] : [];
  };

  const normalizeGoogleWebSessionRow = (row) => {
    if (!row || typeof row !== 'object') return null;
    const token = String(row.session_token || '').trim();
    const sub = normalizeGoogleSubject(row.google_sub);
    const ownerJid = normalizeJid(row.owner_jid) || '';
    const ownerPhone = toWhatsAppPhoneDigits(row.owner_phone || ownerJid) || '';
    const expiresAt = Number(new Date(row.expires_at || 0));
    if (!token || !sub || !ownerJid || !Number.isFinite(expiresAt)) return null;
    const createdAtRaw = Number(new Date(row.created_at || 0));
    const lastSeenAtRaw = Number(new Date(row.last_seen_at || 0));
    return {
      token,
      sub,
      email:
        String(row.email || '')
          .trim()
          .toLowerCase() || null,
      name: sanitizeText(row.name || '', 120, { allowEmpty: true }) || null,
      picture: String(row.picture_url || '').trim() || null,
      ownerJid,
      ownerPhone,
      createdAt: Number.isFinite(createdAtRaw) ? createdAtRaw : Date.now(),
      expiresAt,
      lastSeenAt: Number.isFinite(lastSeenAtRaw) ? lastSeenAtRaw : 0,
      lastDbTouchAt: Date.now(),
    };
  };

  const maybePruneExpiredGoogleSessionsFromDb = async () => {
    const now = Date.now();
    if (now - googleWebSessionDbPruneAt < sessionDbPruneIntervalMs) return;
    googleWebSessionDbPruneAt = now;
    try {
      await executeQuery(
        `DELETE FROM ${tables.STICKER_WEB_GOOGLE_SESSION}
         WHERE revoked_at IS NOT NULL OR expires_at <= UTC_TIMESTAMP()`,
      );
    } catch (error) {
      logger.warn('Falha ao limpar sessões Google web expiradas do banco.', {
        action: 'sticker_pack_google_web_session_db_prune_failed',
        error: error?.message,
      });
    }
  };

  const upsertGoogleWebUserRecord = async (user, connection = null) => {
    const sub = normalizeGoogleSubject(user?.sub);
    const ownerJid = normalizeJid(user?.ownerJid) || '';
    if (!sub || !ownerJid) return;
    const ownerPhone = toWhatsAppPhoneDigits(ownerJid) || null;
    const email =
      String(user?.email || '')
        .trim()
        .toLowerCase() || null;
    const name = sanitizeText(user?.name || '', 120, { allowEmpty: true }) || null;
    const pictureUrl =
      String(user?.picture || '')
        .trim()
        .slice(0, 1024) || null;

    await executeQuery(
      `DELETE FROM ${tables.STICKER_WEB_GOOGLE_USER}
        WHERE owner_jid = ?
          AND google_sub <> ?`,
      [ownerJid, sub],
      connection,
    );

    await executeQuery(
      `INSERT INTO ${tables.STICKER_WEB_GOOGLE_USER}
        (google_sub, owner_jid, email, name, picture_url, last_login_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE
        owner_jid = VALUES(owner_jid),
        email = VALUES(email),
        name = VALUES(name),
        picture_url = VALUES(picture_url),
        last_login_at = UTC_TIMESTAMP(),
        last_seen_at = UTC_TIMESTAMP()`,
      [sub, ownerJid, email, name, pictureUrl],
      connection,
    );

    await executeQuery(
      `UPDATE ${tables.STICKER_WEB_GOOGLE_USER}
          SET owner_phone = COALESCE(?, owner_phone)
        WHERE google_sub = ?`,
      [ownerPhone, sub],
      connection,
    ).catch(() => {});
  };

  const upsertGoogleWebSessionRecord = async (session, connection = null) => {
    const token = String(session?.token || '').trim();
    const sub = normalizeGoogleSubject(session?.sub);
    const ownerJid = normalizeJid(session?.ownerJid) || '';
    const ownerPhone = toWhatsAppPhoneDigits(session?.ownerPhone || ownerJid) || null;
    const expiresAt = Number(session?.expiresAt || 0);
    if (!token || !sub || !ownerJid || !Number.isFinite(expiresAt) || expiresAt <= 0) return;
    const email =
      String(session?.email || '')
        .trim()
        .toLowerCase() || null;
    const name = sanitizeText(session?.name || '', 120, { allowEmpty: true }) || null;
    const pictureUrl =
      String(session?.picture || '')
        .trim()
        .slice(0, 1024) || null;

    await executeQuery(
      `INSERT INTO ${tables.STICKER_WEB_GOOGLE_SESSION}
        (session_token, google_sub, owner_jid, email, name, picture_url, expires_at, revoked_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE
        google_sub = VALUES(google_sub),
        owner_jid = VALUES(owner_jid),
        email = VALUES(email),
        name = VALUES(name),
        picture_url = VALUES(picture_url),
        expires_at = VALUES(expires_at),
        revoked_at = NULL,
        last_seen_at = UTC_TIMESTAMP()`,
      [token, sub, ownerJid, email, name, pictureUrl, new Date(expiresAt)],
      connection,
    );

    await executeQuery(
      `UPDATE ${tables.STICKER_WEB_GOOGLE_SESSION}
          SET owner_phone = COALESCE(?, owner_phone)
        WHERE session_token = ?`,
      [ownerPhone, token],
      connection,
    ).catch(() => {});
  };

  const persistGoogleWebSessionToDb = async (session) => {
    if (!session?.token || !session?.sub || !session?.ownerJid) return;
    await maybePruneExpiredGoogleSessionsFromDb();
    await runSqlTransaction(async (connection) => {
      await upsertGoogleWebUserRecord(
        {
          sub: session.sub,
          ownerJid: session.ownerJid,
          email: session.email,
          name: session.name,
          picture: session.picture,
        },
        connection,
      );
      await upsertGoogleWebSessionRecord(session, connection);
    });
  };

  const findGoogleWebSessionInDbByToken = async (sessionToken) => {
    const token = String(sessionToken || '').trim();
    if (!token) return null;
    await maybePruneExpiredGoogleSessionsFromDb();
    const rows = await executeQuery(
      `SELECT session_token, google_sub, owner_jid, owner_phone, email, name, picture_url, created_at, expires_at, last_seen_at
         FROM ${tables.STICKER_WEB_GOOGLE_SESSION}
        WHERE session_token = ?
          AND revoked_at IS NULL
          AND expires_at > UTC_TIMESTAMP()
        LIMIT 1`,
      [token],
    );
    return normalizeGoogleWebSessionRow(Array.isArray(rows) ? rows[0] : null);
  };

  const touchGoogleWebSessionSeenInDb = async (sessionToken) => {
    const token = String(sessionToken || '').trim();
    if (!token) return;
    await executeQuery(
      `UPDATE ${tables.STICKER_WEB_GOOGLE_SESSION}
          SET last_seen_at = UTC_TIMESTAMP()
        WHERE session_token = ?
          AND revoked_at IS NULL`,
      [token],
    );
  };

  const touchGoogleWebUserSeenInDb = async (googleSub) => {
    const sub = normalizeGoogleSubject(googleSub);
    if (!sub) return;
    await executeQuery(
      `UPDATE ${tables.STICKER_WEB_GOOGLE_USER}
          SET last_seen_at = UTC_TIMESTAMP()
        WHERE google_sub = ?`,
      [sub],
    );
  };

  const deleteGoogleWebSessionFromDb = async (sessionToken) => {
    const token = String(sessionToken || '').trim();
    if (!token) return 0;
    const result = await executeQuery(`DELETE FROM ${tables.STICKER_WEB_GOOGLE_SESSION} WHERE session_token = ?`, [token]);
    return Number(result?.affectedRows || 0);
  };

  const createGoogleWebSession = (claims, { ownerJid } = {}) => {
    pruneExpiredGoogleSessions();
    const token = randomUUID();
    const now = Date.now();
    const resolvedOwnerJid = normalizeJid(ownerJid) || buildGoogleOwnerJid(claims.sub);
    const resolvedOwnerPhone = toWhatsAppPhoneDigits(resolvedOwnerJid) || '';
    return {
      token,
      sub: claims.sub,
      email: claims.email || null,
      name: claims.name || null,
      picture: claims.picture || null,
      ownerJid: resolvedOwnerJid,
      ownerPhone: resolvedOwnerPhone,
      createdAt: now,
      expiresAt: now + sessionTtlMs,
      lastSeenAt: now,
      lastDbTouchAt: 0,
    };
  };

  const activateGoogleWebSession = (session) => {
    if (!session?.token) return;
    pruneExpiredGoogleSessions();
    webGoogleSessionMap.set(session.token, session);
  };

  const resolveGoogleWebSessionFromRequest = async (req) => {
    pruneExpiredGoogleSessions();
    const sessionTokens = getGoogleWebSessionTokensFromRequest(req);
    if (!sessionTokens.length) return null;

    for (const sessionToken of sessionTokens) {
      const session = webGoogleSessionMap.get(sessionToken);
      if (!session) continue;
      if (Number(session.expiresAt || 0) <= Date.now()) {
        webGoogleSessionMap.delete(sessionToken);
        continue;
      }

      const now = Date.now();
      session.lastSeenAt = now;
      if (now - Number(session.lastDbTouchAt || 0) >= sessionDbTouchIntervalMs) {
        session.lastDbTouchAt = now;
        void touchGoogleWebSessionSeenInDb(sessionToken).catch((error) => {
          logger.warn('Falha ao atualizar last_seen da sessão Google web.', {
            action: 'sticker_pack_google_web_session_touch_failed',
            error: error?.message,
          });
        });
        void touchGoogleWebUserSeenInDb(session.sub).catch(() => {});
      }
      try {
        await assertGoogleIdentityNotBanned({
          sub: session.sub,
          email: session.email,
          ownerJid: session.ownerJid,
        });
        return session;
      } catch {
        webGoogleSessionMap.delete(sessionToken);
        void deleteGoogleWebSessionFromDb(sessionToken).catch(() => {});
      }
    }

    for (const sessionToken of sessionTokens) {
      try {
        const persistedSession = await findGoogleWebSessionInDbByToken(sessionToken);
        if (!persistedSession) continue;
        try {
          await assertGoogleIdentityNotBanned({
            sub: persistedSession.sub,
            email: persistedSession.email,
            ownerJid: persistedSession.ownerJid,
          });
        } catch {
          await deleteGoogleWebSessionFromDb(sessionToken).catch(() => {});
          continue;
        }
        webGoogleSessionMap.set(sessionToken, persistedSession);
        return persistedSession;
      } catch (error) {
        logger.warn('Falha ao resolver sessão Google web no banco.', {
          action: 'sticker_pack_google_web_session_db_resolve_failed',
          error: error?.message,
        });
      }
    }

    return null;
  };

  const clearGoogleWebSessionCookie = (req, res) => {
    for (const pathValue of normalizedLegacyCookiePaths) {
      appendSetCookie(
        res,
        buildCookieString(GOOGLE_WEB_SESSION_COOKIE_NAME, '', req, {
          path: pathValue,
          maxAgeSeconds: 0,
        }),
      );
      appendSetCookie(
        res,
        buildCookieString(GOOGLE_WEB_SESSION_COOKIE_NAME, '', req, {
          path: pathValue,
          maxAgeSeconds: 0,
          domain: false,
        }),
      );
    }
  };

  const mapGoogleSessionResponseData = (session) =>
    session
      ? {
          authenticated: true,
          provider: 'google',
          user: {
            sub: session.sub,
            email: session.email,
            name: session.name,
            picture: session.picture,
          },
          owner_jid: session.ownerJid,
          owner_phone: toWhatsAppPhoneDigits(session.ownerPhone || session.ownerJid) || null,
          expires_at: toIsoOrNull(session.expiresAt),
        }
      : {
          authenticated: false,
          provider: 'google',
          user: null,
          owner_jid: null,
          owner_phone: null,
          expires_at: null,
        };

  const revokeGoogleWebSessionsByIdentity = async ({ googleSub = '', email = '', ownerJid = '' } = {}) => {
    const normalizedSub = normalizeGoogleSubject(googleSub);
    const normalizedEmail = normalizeEmail(email);
    const normalizedOwnerJid = normalizeJid(ownerJid) || '';

    const clauses = [];
    const params = [];
    if (normalizedSub) {
      clauses.push('google_sub = ?');
      params.push(normalizedSub);
    }
    if (normalizedEmail) {
      clauses.push('email = ?');
      params.push(normalizedEmail);
    }
    if (normalizedOwnerJid) {
      clauses.push('owner_jid = ?');
      params.push(normalizedOwnerJid);
    }
    if (!clauses.length) return 0;

    await executeQuery(
      `DELETE FROM ${tables.STICKER_WEB_GOOGLE_SESSION}
        WHERE ${clauses.join(' OR ')}`,
      params,
    ).catch(() => {});

    let removed = 0;
    for (const [token, session] of webGoogleSessionMap.entries()) {
      if (!session) continue;
      const sessionSub = normalizeGoogleSubject(session.sub);
      const sessionEmail = normalizeEmail(session.email);
      const sessionOwner = normalizeJid(session.ownerJid) || '';
      if ((normalizedSub && sessionSub === normalizedSub) || (normalizedEmail && sessionEmail === normalizedEmail) || (normalizedOwnerJid && sessionOwner === normalizedOwnerJid)) {
        webGoogleSessionMap.delete(token);
        removed += 1;
      }
    }

    return removed;
  };

  const handleGoogleAuthSessionRequest = async (req, res) => {
    if (!googleClientId) {
      sendJson(req, res, 404, { error: 'Login Google desabilitado.' });
      return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      const session = await resolveGoogleWebSessionFromRequest(req);
      sendJson(req, res, 200, {
        data: mapGoogleSessionResponseData(session),
      });
      return;
    }

    if (req.method === 'DELETE') {
      const tokens = getGoogleWebSessionTokensFromRequest(req);
      for (const token of tokens) {
        webGoogleSessionMap.delete(token);
        await deleteGoogleWebSessionFromDb(token).catch((error) => {
          logger.warn('Falha ao remover sessão Google web do banco.', {
            action: 'sticker_pack_google_web_session_db_delete_failed',
            error: error?.message,
          });
        });
      }
      clearGoogleWebSessionCookie(req, res);
      sendJson(req, res, 200, { data: { cleared: true } });
      return;
    }

    if (req.method !== 'POST') {
      sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
      return;
    }

    let payload = {};
    try {
      payload = await readJsonBody(req);
    } catch (error) {
      sendJson(req, res, Number(error?.statusCode || 400), { error: error?.message || 'Body inválido.' });
      return;
    }

    try {
      const claims = await verifyGoogleIdToken(payload?.google_id_token || payload?.id_token);
      const linkedOwner = resolveWhatsAppOwnerJidFromLoginPayload(payload);
      if (!linkedOwner.ownerJid) {
        if (!linkedOwner.hasPayload) {
          sendJson(req, res, 400, {
            error: 'Abra esta pagina pelo link enviado no WhatsApp. Envie "iniciar" no bot para gerar o link de login.',
            code: 'WHATSAPP_LOGIN_LINK_REQUIRED',
            reason: 'missing_link',
          });
          return;
        }

        const reason = String(linkedOwner.reason || '')
          .trim()
          .toLowerCase();
        const isUnauthorizedAttempt = ['invalid_signature', 'missing_signature'].includes(reason);
        const statusCode = isUnauthorizedAttempt ? 403 : 400;
        const errorMessage = reason === 'expired' ? 'Link de login expirado. Envie "iniciar" novamente no WhatsApp.' : isUnauthorizedAttempt ? 'Tentativa de login sem permissao detectada. Gere um novo link enviando "iniciar" no privado do bot.' : 'Link de login invalido. Envie "iniciar" novamente no WhatsApp.';

        logger.warn('Tentativa de login web bloqueada por validacao do link WhatsApp.', {
          action: 'sticker_pack_google_web_login_link_blocked',
          reason: reason || 'unknown',
          remote_ip: req.socket?.remoteAddress || null,
          user_agent: req.headers?.['user-agent'] || null,
        });

        sendJson(req, res, statusCode, {
          error: errorMessage,
          code: 'WHATSAPP_LOGIN_LINK_INVALID',
          reason: reason || 'invalid_link',
        });
        return;
      }
      const ownerJid = linkedOwner.ownerJid;

      await assertGoogleIdentityNotBanned({
        sub: claims.sub,
        email: claims.email,
        ownerJid,
      });
      const session = createGoogleWebSession(claims, { ownerJid });
      if (!session.ownerJid) {
        sendJson(req, res, 400, { error: 'Nao foi possivel vincular a conta Google.' });
        return;
      }
      try {
        await persistGoogleWebSessionToDb(session);
        activateGoogleWebSession(session);
      } catch (persistError) {
        logger.error('Falha ao persistir sessão Google web no banco.', {
          action: 'sticker_pack_google_web_session_db_persist_failed',
          error: persistError?.message,
        });
        sendJson(req, res, 500, { error: 'Falha ao salvar sessão Google. Tente novamente.' });
        return;
      }

      appendSetCookie(
        res,
        buildCookieString(GOOGLE_WEB_SESSION_COOKIE_NAME, session.token, req, {
          path: normalizedSessionCookiePath,
          maxAgeSeconds: Math.floor(sessionTtlMs / 1000),
        }),
      );
      sendJson(req, res, 200, {
        data: mapGoogleSessionResponseData(session),
      });
    } catch (error) {
      sendJson(req, res, Number(error?.statusCode || 401), {
        error: error?.message || 'Login Google inválido.',
        code: notAllowedErrorCode,
      });
    }
  };

  return {
    cookieName: GOOGLE_WEB_SESSION_COOKIE_NAME,
    getGoogleWebSessionTokensFromRequest,
    upsertGoogleWebUserRecord,
    resolveGoogleWebSessionFromRequest,
    clearGoogleWebSessionCookie,
    deleteGoogleWebSessionFromDb,
    mapGoogleSessionResponseData,
    handleGoogleAuthSessionRequest,
    revokeGoogleWebSessionsByIdentity,
  };
};
