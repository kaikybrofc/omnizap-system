import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';
import {
  buildLoginRedirectPath,
  buildSupportWhatsAppUrl,
  buildWhatsAppUrl,
  formatDateTime,
  formatPhone,
  getSessionStatusLabel,
  normalizeDigits,
} from './userProfile/actions.js';

const html = htm.bind(React.createElement);

const DEFAULT_API_BASE_PATH = '/api';
const DEFAULT_LOGIN_PATH = '/login';
const DEFAULT_TERMS_URL = '/termos-de-uso/';
const DEFAULT_PRIVACY_URL = '/politica-de-privacidade/';
const DEFAULT_FALLBACK_AVATAR = '/assets/images/brand-logo-128.webp';
const DEFAULT_PASSWORD_RESET_WEB_PATH = '/user/password-reset';
const DEFAULT_SUPPORT_TEXT = 'Ol\u00e1! Preciso de suporte no OmniZap.';
const LEGACY_PASSWORD_RECOVERY_QUERY_KEYS = [
  'password_recovery_session',
  'recovery_session',
  'reset_session',
  'session_token',
];
const PASSWORD_RECOVERY_HASH_KEY = 'password_recovery_session';

const TABS = [
  { key: 'summary', label: 'Resumo' },
  { key: 'account', label: 'Conta' },
  { key: 'support', label: 'Suporte' },
];

const normalizeBasePath = (value, fallback) => {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  if (withSlash.length > 1 && withSlash.endsWith('/')) return withSlash.slice(0, -1);
  return withSlash || fallback;
};

const normalizeUrlPath = (value, fallback) => {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  return raw;
};

const normalizeRoutePath = (value, fallback = '/') => {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const normalized =
    withSlash.length > 1 && withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash;
  return normalized || fallback;
};

const hasLegacyRecoveryTokenInSearch = (search = '') => {
  try {
    const params = new URLSearchParams(String(search || ''));
    for (const key of LEGACY_PASSWORD_RECOVERY_QUERY_KEYS) {
      if (String(params.get(key) || '').trim()) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
};

const normalizeRecoverySessionToken = (value) =>
  String(value || '')
    .trim()
    .slice(0, 4096);

const readRecoverySessionTokenFromSearch = (search = '') => {
  try {
    const params = new URLSearchParams(String(search || ''));
    for (const key of LEGACY_PASSWORD_RECOVERY_QUERY_KEYS) {
      const token = normalizeRecoverySessionToken(params.get(key));
      if (token) return token;
    }
  } catch {
    return '';
  }
  return '';
};

const readRecoverySessionTokenFromHash = (hash = '') => {
  const normalizedHash = String(hash || '').trim();
  if (!normalizedHash) return '';

  const hashPayload = normalizedHash.startsWith('#') ? normalizedHash.slice(1) : normalizedHash;
  if (!hashPayload) return '';

  const params = new URLSearchParams(
    hashPayload.startsWith('?') ? hashPayload.slice(1) : hashPayload,
  );
  const tokenFromPrimaryKey = normalizeRecoverySessionToken(params.get(PASSWORD_RECOVERY_HASH_KEY));
  if (tokenFromPrimaryKey) return tokenFromPrimaryKey;

  for (const key of LEGACY_PASSWORD_RECOVERY_QUERY_KEYS) {
    const token = normalizeRecoverySessionToken(params.get(key));
    if (token) return token;
  }

  return '';
};

const resolveRecoverySessionTokenFromLocation = (locationLike) => {
  const tokenFromHash = readRecoverySessionTokenFromHash(locationLike?.hash);
  if (tokenFromHash) return tokenFromHash;
  return readRecoverySessionTokenFromSearch(locationLike?.search);
};

const stripRecoverySessionTokenFromSearch = (search = '') => {
  const params = new URLSearchParams(String(search || ''));
  let changed = false;
  for (const key of LEGACY_PASSWORD_RECOVERY_QUERY_KEYS) {
    if (!params.has(key)) continue;
    params.delete(key);
    changed = true;
  }
  return {
    changed,
    search: params.toString() ? `?${params.toString()}` : '',
  };
};

const stripRecoverySessionTokenFromHash = (hash = '') => {
  const normalizedHash = String(hash || '').trim();
  if (!normalizedHash) return { changed: false, hash: '' };

  const hashPayload = normalizedHash.startsWith('#') ? normalizedHash.slice(1) : normalizedHash;
  if (!hashPayload) return { changed: false, hash: '' };

  const params = new URLSearchParams(
    hashPayload.startsWith('?') ? hashPayload.slice(1) : hashPayload,
  );
  let changed = false;
  if (params.has(PASSWORD_RECOVERY_HASH_KEY)) {
    params.delete(PASSWORD_RECOVERY_HASH_KEY);
    changed = true;
  }
  for (const key of LEGACY_PASSWORD_RECOVERY_QUERY_KEYS) {
    if (!params.has(key)) continue;
    params.delete(key);
    changed = true;
  }

  if (!changed) {
    return {
      changed: false,
      hash: normalizedHash.startsWith('#') ? normalizedHash : `#${normalizedHash}`,
    };
  }

  const nextHash = params.toString();
  return {
    changed: true,
    hash: nextHash ? `#${nextHash}` : '',
  };
};

const sanitizeRecoverySessionUrl = ({ normalizedPath = '', shouldNormalizePath = false } = {}) => {
  if (
    typeof window === 'undefined' ||
    typeof window.location?.href !== 'string' ||
    typeof window.history?.replaceState !== 'function'
  ) {
    return;
  }

  const currentUrl = new URL(window.location.href);
  let changed = false;

  if (shouldNormalizePath) {
    const safePath = normalizeRoutePath(normalizedPath, DEFAULT_PASSWORD_RESET_WEB_PATH);
    if (currentUrl.pathname !== safePath) {
      currentUrl.pathname = safePath;
      changed = true;
    }
  }

  const cleanedSearch = stripRecoverySessionTokenFromSearch(currentUrl.search);
  if (cleanedSearch.changed) {
    currentUrl.search = cleanedSearch.search;
    changed = true;
  }

  const cleanedHash = stripRecoverySessionTokenFromHash(currentUrl.hash);
  if (cleanedHash.changed) {
    currentUrl.hash = cleanedHash.hash;
    changed = true;
  }

  if (changed) {
    window.history.replaceState(
      {},
      '',
      `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
    );
  }
};

const buildRecoverySessionDestinationUrl = (destination, sessionToken) => {
  const token = normalizeRecoverySessionToken(sessionToken);
  if (!token) return '';

  const parsedDestination = new URL(String(destination || ''), window.location.origin);
  if (parsedDestination.origin !== window.location.origin) {
    throw new Error('Destino de redefinicao invalido.');
  }

  const hashParams = new URLSearchParams(
    parsedDestination.hash.startsWith('#')
      ? parsedDestination.hash.slice(1)
      : String(parsedDestination.hash || ''),
  );
  hashParams.set(PASSWORD_RECOVERY_HASH_KEY, token);
  parsedDestination.hash = hashParams.toString();

  return `${parsedDestination.pathname}${parsedDestination.search}${parsedDestination.hash}`;
};

const resolvePasswordRecoveryRoute = (pathname, search, passwordResetWebPath) => {
  const safePathname = normalizeRoutePath(pathname, '/');
  const safeResetPath = normalizeRoutePath(passwordResetWebPath, DEFAULT_PASSWORD_RESET_WEB_PATH);
  const hasLegacyQueryToken = hasLegacyRecoveryTokenInSearch(search);
  const hasLegacyPathToken = safePathname.startsWith(`${safeResetPath}/`);

  if (safePathname === safeResetPath || hasLegacyPathToken || hasLegacyQueryToken) {
    return {
      active: true,
      normalizedPath: safeResetPath,
      shouldNormalizeUrl: hasLegacyPathToken || hasLegacyQueryToken,
    };
  }

  return { active: false, normalizedPath: safeResetPath, shouldNormalizeUrl: false };
};

const resolveLogoutPath = (loginPath) => {
  const safe = String(loginPath || '/login').trim() || '/login';
  return safe.endsWith('/') ? safe : `${safe}/`;
};

const resolveAuthenticatedSession = (payload) => {
  const session = payload?.data?.session || null;
  return session && session.authenticated ? session : null;
};

const resolvePasswordState = (payload) => {
  const password = payload?.data?.password || {};
  return {
    configured: Boolean(password?.configured),
    failedAttempts: Number(password?.failed_attempts || 0),
    lastFailedAt: formatDateTime(password?.last_failed_at),
    lastLoginAt: formatDateTime(password?.last_login_at),
    passwordChangedAt: formatDateTime(password?.password_changed_at),
    revokedAt: formatDateTime(password?.revoked_at),
  };
};

const createUserApi = (apiBasePath) => {
  const sessionPath = `${apiBasePath}/auth/google/session`;
  const profilePath = `${apiBasePath}/me`;
  const botContactPath = `${apiBasePath}/bot-contact`;
  const supportPath = `${apiBasePath}/support`;
  const passwordPath = `${apiBasePath}/auth/password`;
  const passwordRecoveryRequestPath = `${apiBasePath}/auth/password/recovery/request`;
  const passwordRecoveryVerifyPath = `${apiBasePath}/auth/password/recovery/verify`;
  const passwordRecoverySessionPath = `${apiBasePath}/auth/password/recovery/session`;
  const passwordRecoverySessionRequestPath = `${passwordRecoverySessionPath}/request`;
  const passwordRecoverySessionVerifyPath = `${passwordRecoverySessionPath}/verify`;
  const buildRecoverySessionHeaders = (sessionToken, baseHeaders = {}) => {
    const token = String(sessionToken || '')
      .trim()
      .slice(0, 4096);
    if (!token) return { ...baseHeaders };
    return {
      ...baseHeaders,
      'X-Password-Recovery-Session': token,
    };
  };

  const fetchJson = async (url, init = {}) => {
    const response = await fetch(url, {
      credentials: 'include',
      ...init,
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const error = new Error(payload?.error || `Falha HTTP ${response.status}`);
      error.statusCode = response.status;
      error.payload = payload;
      throw error;
    }

    return payload || {};
  };

  return {
    fetchSummary: () => fetchJson(`${profilePath}?view=summary`, { method: 'GET' }),
    fetchBotContact: () => fetchJson(botContactPath, { method: 'GET' }),
    fetchSupport: () => fetchJson(supportPath, { method: 'GET' }),
    fetchPasswordState: () => fetchJson(passwordPath, { method: 'GET' }),
    updatePassword: (password) =>
      fetchJson(passwordPath, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({ password }),
      }),
    requestPasswordRecoveryCode: (body) =>
      fetchJson(passwordRecoveryRequestPath, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(body || {}),
      }),
    verifyPasswordRecoveryCode: (body) =>
      fetchJson(passwordRecoveryVerifyPath, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(body || {}),
      }),
    createPasswordRecoverySession: () =>
      fetchJson(passwordRecoverySessionPath, {
        method: 'POST',
      }),
    fetchPasswordRecoverySessionStatus: (sessionToken) =>
      fetchJson(passwordRecoverySessionPath, {
        method: 'GET',
        headers: buildRecoverySessionHeaders(sessionToken),
      }),
    requestPasswordRecoveryCodeBySession: (sessionToken) =>
      fetchJson(passwordRecoverySessionRequestPath, {
        method: 'POST',
        headers: buildRecoverySessionHeaders(sessionToken),
      }),
    verifyPasswordRecoveryCodeBySession: (sessionToken, body) =>
      fetchJson(passwordRecoverySessionVerifyPath, {
        method: 'POST',
        headers: buildRecoverySessionHeaders(sessionToken, {
          'Content-Type': 'application/json; charset=utf-8',
        }),
        body: JSON.stringify(body || {}),
      }),
    logout: () => fetchJson(sessionPath, { method: 'DELETE' }),
  };
};

const resolveSummaryView = (payload, fallbackAvatar) => {
  const data = payload?.data || {};
  const session = data?.session || {};
  const user = session?.user || {};
  const account = data?.account || {};
  const ownerPhone = String(session?.owner_phone || '').trim();
  const ownerJid = String(data?.owner_jid || session?.owner_jid || '').trim();

  return {
    avatar: String(user?.picture || '').trim() || fallbackAvatar,
    name: String(user?.name || '').trim() || 'Conta Google',
    email: String(user?.email || '').trim() || 'E-mail n\u00e3o dispon\u00edvel',
    whatsapp: ownerPhone
      ? `WhatsApp vinculado: +${formatPhone(ownerPhone)}`
      : ownerJid
        ? `Owner vinculado: ${ownerJid}`
        : 'WhatsApp ainda n\u00e3o vinculado.',
    plan: account?.plan_label || 'Conta padr\u00e3o',
    status: account?.status === 'active' ? 'Ativa' : 'Pendente',
    lastLogin: formatDateTime(account?.last_login_at || account?.last_seen_at),
    expiresAt: formatDateTime(session?.expires_at),
    ownerJid: ownerJid || 'N\u00e3o informado',
    sessionStatus: getSessionStatusLabel(session),
  };
};

const toneClassMap = {
  loading: 'alert-info',
  success: 'alert-success',
  warning: 'alert-warning',
};

const UserApp = ({ config }) => {
  const api = useMemo(() => createUserApi(config.apiBasePath), [config.apiBasePath]);
  const recoveryRoute = useMemo(
    () =>
      resolvePasswordRecoveryRoute(
        window.location.pathname,
        window.location.search,
        config.passwordResetWebPath,
      ),
    [config.passwordResetWebPath],
  );
  const isRecoveryRoute = recoveryRoute.active;
  const [recoverySessionToken, setRecoverySessionToken] = useState(() =>
    isRecoveryRoute ? resolveRecoverySessionTokenFromLocation(window.location) : '',
  );

  const [activeTab, setActiveTab] = useState('account');
  const [isMobile, setMobile] = useState(
    Boolean(window.matchMedia?.('(max-width: 1020px)')?.matches),
  );
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [isLoadingSummary, setLoadingSummary] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [isLogoutBusy, setLogoutBusy] = useState(false);
  const [status, setStatus] = useState({
    tone: 'loading',
    message: 'Validando sess\u00e3o e carregando resumo da conta...',
  });
  const [errorMessage, setErrorMessage] = useState('');
  const [summary, setSummary] = useState({
    avatar: config.fallbackAvatar,
    name: 'Conta Google',
    email: 'E-mail n\u00e3o dispon\u00edvel',
    whatsapp: 'WhatsApp ainda n\u00e3o vinculado.',
    plan: 'Conta padr\u00e3o',
    status: 'Pendente',
    lastLogin: 'N\u00e3o informado',
    expiresAt: 'N\u00e3o informado',
    ownerJid: 'N\u00e3o informado',
    sessionStatus: 'Sess\u00e3o n\u00e3o autenticada',
  });
  const [support, setSupport] = useState({
    phone: '',
    text: DEFAULT_SUPPORT_TEXT,
  });
  const [links, setLinks] = useState({
    botUrl: buildWhatsAppUrl('', '/menu'),
    supportUrl: config.termsUrl,
  });
  const [passwordState, setPasswordState] = useState({
    configured: false,
    failedAttempts: 0,
    lastFailedAt: 'N\u00e3o informado',
    lastLoginAt: 'N\u00e3o informado',
    passwordChangedAt: 'N\u00e3o informado',
    revokedAt: 'N\u00e3o informado',
  });
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [recoveryFeedback, setRecoveryFeedback] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const [recoverySessionLoading, setRecoverySessionLoading] = useState(Boolean(isRecoveryRoute));
  const [recoverySessionError, setRecoverySessionError] = useState('');
  const [recoverySessionState, setRecoverySessionState] = useState({
    valid: false,
    maskedEmail: '',
    expiresAt: 'N\u00e3o informado',
    expiresInSeconds: null,
  });
  const accountEmail = String(summary.email || '')
    .trim()
    .toLowerCase()
    .includes('@')
    ? String(summary.email || '')
        .trim()
        .toLowerCase()
    : '';

  const readNamedInputValue = (formElement, inputName) => {
    if (!formElement || typeof formElement.elements?.namedItem !== 'function') return '';
    const field = formElement.elements.namedItem(inputName);
    if (!field || typeof field !== 'object' || !('value' in field)) return '';
    return String(field.value || '');
  };

  useEffect(() => {
    const mediaQuery = window.matchMedia?.('(max-width: 1020px)');
    if (!mediaQuery) return undefined;

    const applyViewport = () => {
      const mobile = Boolean(mediaQuery.matches);
      setMobile(mobile);
    };

    applyViewport();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', applyViewport);
      return () => mediaQuery.removeEventListener('change', applyViewport);
    }

    if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(applyViewport);
      return () => mediaQuery.removeListener(applyViewport);
    }

    return undefined;
  }, []);

  useEffect(() => {
    if (!isSidebarOpen) {
      document.body.style.overflow = '';
      return undefined;
    }

    const onKeyDown = (event) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    document.body.style.overflow = isMobile ? 'hidden' : '';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isMobile, isSidebarOpen]);

  useEffect(() => {
    if (!isRecoveryRoute) {
      setRecoverySessionToken('');
      return;
    }

    const locationToken = resolveRecoverySessionTokenFromLocation(window.location);
    setRecoverySessionToken(locationToken);
    sanitizeRecoverySessionUrl({
      normalizedPath: normalizeRoutePath(
        recoveryRoute.normalizedPath,
        normalizeRoutePath(config.passwordResetWebPath, DEFAULT_PASSWORD_RESET_WEB_PATH),
      ),
      shouldNormalizePath: recoveryRoute.shouldNormalizeUrl,
    });
  }, [
    config.passwordResetWebPath,
    isRecoveryRoute,
    recoveryRoute.normalizedPath,
    recoveryRoute.shouldNormalizeUrl,
  ]);

  useEffect(() => {
    if (isRecoveryRoute) {
      setLoadingSummary(false);
      setErrorMessage('');
      setStatus({
        tone: 'loading',
        message: 'Sessao temporaria de redefinicao carregada.',
      });
      return undefined;
    }

    let active = true;

    const loadProfile = async () => {
      setLoadingSummary(true);
      setErrorMessage('');
      setPasswordError('');
      setPasswordFeedback('');
      setRecoveryError('');
      setRecoveryFeedback('');
      setStatus({
        tone: 'loading',
        message: 'Validando sess\u00e3o e carregando resumo da conta...',
      });

      try {
        const summaryPayload = await api.fetchSummary();
        if (!active) return;

        const session = resolveAuthenticatedSession(summaryPayload);
        if (!session || !session?.user?.sub) {
          window.location.assign(buildLoginRedirectPath(config.loginPath));
          return;
        }

        setSummary(resolveSummaryView(summaryPayload, config.fallbackAvatar));
        setPasswordState(resolvePasswordState(summaryPayload));
        setStatus({
          tone: 'success',
          message: 'Resumo da conta carregado com sucesso.',
        });

        const [botResult, supportResult] = await Promise.allSettled([
          api.fetchBotContact(),
          api.fetchSupport(),
        ]);
        if (!active) return;

        let botUrl = buildWhatsAppUrl('', '/menu');
        if (botResult.status === 'fulfilled') {
          const botData = botResult.value?.data || {};
          const botPhone = normalizeDigits(botData?.phone || '');
          const preferredMenuUrl = String(botData?.urls?.menu || '').trim();
          botUrl = preferredMenuUrl || buildWhatsAppUrl(botPhone, '/menu');
        }

        let supportUrl = config.termsUrl;
        let supportPhone = '';
        let supportText = DEFAULT_SUPPORT_TEXT;
        if (supportResult.status === 'fulfilled') {
          const supportData = supportResult.value?.data || {};
          supportPhone = normalizeDigits(supportData?.phone || '');
          supportText = String(supportData?.text || '').trim() || DEFAULT_SUPPORT_TEXT;
          const preferredSupportUrl = String(supportData?.url || '').trim();
          supportUrl =
            preferredSupportUrl ||
            buildSupportWhatsAppUrl(supportPhone, supportText) ||
            config.termsUrl;
        } else {
          supportText = 'Contato de suporte indispon\u00edvel no momento.';
        }

        setLinks({
          botUrl,
          supportUrl,
        });
        setSupport({
          phone: supportPhone,
          text: supportText,
        });
      } catch (error) {
        if (!active) return;
        setStatus({
          tone: 'warning',
          message: 'N\u00e3o foi poss\u00edvel concluir a leitura dos dados.',
        });
        setErrorMessage(error?.message || 'Falha ao carregar resumo da conta.');
      } finally {
        if (active) setLoadingSummary(false);
      }
    };

    void loadProfile();

    return () => {
      active = false;
    };
  }, [api, config.fallbackAvatar, config.loginPath, config.termsUrl, isRecoveryRoute, reloadKey]);

  useEffect(() => {
    if (!isRecoveryRoute) {
      setRecoverySessionLoading(false);
      setRecoverySessionError('');
      setRecoverySessionState({
        valid: false,
        maskedEmail: '',
        expiresAt: 'Nao informado',
        expiresInSeconds: null,
      });
      return undefined;
    }

    let active = true;

    const loadRecoverySession = async () => {
      setRecoverySessionLoading(true);
      setRecoverySessionError('');
      setRecoveryFeedback('');
      setRecoveryError('');

      if (!recoverySessionToken) {
        if (!active) return;
        setRecoverySessionState({
          valid: false,
          maskedEmail: '',
          expiresAt: 'Nao informado',
          expiresInSeconds: null,
        });
        setRecoverySessionError(
          'Sessao de redefinicao ausente ou expirada. Solicite uma nova sessao.',
        );
        setRecoverySessionLoading(false);
        return;
      }

      try {
        const payload = await api.fetchPasswordRecoverySessionStatus(recoverySessionToken);
        if (!active) return;
        const data = payload?.data || {};
        setRecoverySessionState({
          valid: Boolean(data?.valid),
          maskedEmail: String(data?.masked_email || '').trim(),
          expiresAt: formatDateTime(data?.expires_at),
          expiresInSeconds: Number(data?.expires_in_seconds || 0) || null,
        });
      } catch (error) {
        if (!active) return;
        setRecoverySessionToken('');
        setRecoverySessionState({
          valid: false,
          maskedEmail: '',
          expiresAt: 'Nao informado',
          expiresInSeconds: null,
        });
        setRecoverySessionError(error?.message || 'Sessao de redefinicao invalida ou expirada.');
      } finally {
        if (active) setRecoverySessionLoading(false);
      }
    };

    void loadRecoverySession();

    return () => {
      active = false;
    };
  }, [api, isRecoveryRoute, recoverySessionToken]);

  const handleTabSelect = (tabKey) => {
    setActiveTab(tabKey);
    setSidebarOpen(false);
  };

  const toggleSidebar = () => {
    setSidebarOpen((open) => !open);
  };

  const closeSidebar = () => {
    setSidebarOpen(false);
  };

  const handleRetry = () => {
    setReloadKey((current) => current + 1);
  };

  const handleLogout = async () => {
    if (isLogoutBusy) return;
    setLogoutBusy(true);
    try {
      await api.logout();
    } catch {
      // no-op
    }
    window.location.assign(resolveLogoutPath(config.loginPath));
  };

  const handlePasswordUpdate = async (event) => {
    event?.preventDefault?.();
    const formElement = event?.currentTarget || null;
    const typedPassword = readNamedInputValue(formElement, 'new_password');
    const typedConfirm = readNamedInputValue(formElement, 'new_password_confirm');
    const resolvedPassword = String(typedPassword || '');
    const resolvedConfirm = String(typedConfirm || '');

    if (passwordBusy) return;
    if (!resolvedPassword || !resolvedConfirm) {
      setPasswordError('Preencha senha e confirmacao.');
      setPasswordFeedback('');
      return;
    }
    if (resolvedPassword !== resolvedConfirm) {
      setPasswordError('A confirmacao nao confere com a senha.');
      setPasswordFeedback('');
      return;
    }

    setPasswordBusy(true);
    setPasswordError('');
    setPasswordFeedback('');

    try {
      const payload = await api.updatePassword(resolvedPassword);
      setPasswordState(resolvePasswordState(payload));
      if (formElement && typeof formElement.reset === 'function') formElement.reset();
      setPasswordFeedback('Senha salva com sucesso.');
    } catch (error) {
      setPasswordError(error?.message || 'Falha ao salvar senha.');
    } finally {
      setPasswordBusy(false);
    }
  };

  const handleOpenRecoverySession = async () => {
    if (recoveryBusy) return;
    if (!passwordState.configured) {
      setRecoveryError('Defina sua senha inicial antes de usar a redefinicao por e-mail.');
      setRecoveryFeedback('');
      return;
    }

    setRecoveryBusy(true);
    setRecoveryError('');
    setRecoveryFeedback('');

    try {
      const payload = await api.createPasswordRecoverySession();
      const sessionToken = String(payload?.data?.session_token || '').trim();
      const sessionPath = String(payload?.data?.session_path || '').trim();
      const sessionUrl = String(payload?.data?.session_url || '').trim();
      const destination =
        sessionPath ||
        sessionUrl ||
        normalizeRoutePath(config.passwordResetWebPath, DEFAULT_PASSWORD_RESET_WEB_PATH);

      if (!sessionToken || !destination) {
        throw new Error('Nao foi possivel abrir a sessao de redefinicao.');
      }

      const navigationTarget = buildRecoverySessionDestinationUrl(destination, sessionToken);
      if (!navigationTarget) {
        throw new Error('Nao foi possivel abrir a sessao de redefinicao.');
      }
      window.location.assign(navigationTarget);
    } catch (error) {
      setRecoveryError(error?.message || 'Falha ao iniciar sessao de redefinicao.');
    } finally {
      setRecoveryBusy(false);
    }
  };

  const handleRequestRecoveryCodeBySession = async () => {
    if (recoveryBusy || !recoverySessionToken) return;
    if (!recoverySessionState.valid) {
      setRecoveryError('A sessao de redefinicao nao esta valida.');
      setRecoveryFeedback('');
      return;
    }

    setRecoveryBusy(true);
    setRecoveryError('');
    setRecoveryFeedback('');

    try {
      const payload = await api.requestPasswordRecoveryCodeBySession(recoverySessionToken);
      const masked =
        String(payload?.data?.masked_email || '').trim() || recoverySessionState.maskedEmail;
      setRecoveryFeedback(masked ? `Codigo enviado para ${masked}.` : 'Codigo enviado por e-mail.');
    } catch (error) {
      setRecoveryError(error?.message || 'Falha ao enviar codigo de verificacao.');
    } finally {
      setRecoveryBusy(false);
    }
  };

  const handleVerifyRecoveryCodeBySession = async (event) => {
    event?.preventDefault?.();
    const formElement = event?.currentTarget || null;
    const resolvedCode = readNamedInputValue(formElement, 'verification_code')
      .replace(/\D+/g, '')
      .slice(0, 6);
    const resolvedPassword = readNamedInputValue(formElement, 'new_password');
    const resolvedConfirm = readNamedInputValue(formElement, 'new_password_confirm');

    if (recoveryBusy || !recoverySessionToken) return;
    if (!recoverySessionState.valid) {
      setRecoveryError('A sessao de redefinicao nao esta valida.');
      setRecoveryFeedback('');
      return;
    }
    if (!/^\d{6}$/.test(resolvedCode)) {
      setRecoveryError('Informe um codigo com 6 digitos.');
      setRecoveryFeedback('');
      return;
    }
    if (!resolvedPassword || !resolvedConfirm) {
      setRecoveryError('Preencha a nova senha e a confirmacao.');
      setRecoveryFeedback('');
      return;
    }
    if (resolvedPassword !== resolvedConfirm) {
      setRecoveryError('A confirmacao nao confere com a nova senha.');
      setRecoveryFeedback('');
      return;
    }

    setRecoveryBusy(true);
    setRecoveryError('');
    setRecoveryFeedback('');

    try {
      const payload = await api.verifyPasswordRecoveryCodeBySession(recoverySessionToken, {
        code: resolvedCode,
        password: resolvedPassword,
      });
      setPasswordState(resolvePasswordState(payload));
      if (formElement && typeof formElement.reset === 'function') formElement.reset();
      setRecoveryFeedback('Senha redefinida com sucesso. Redirecionando...');
      window.setTimeout(() => {
        window.location.assign('/user/');
      }, 900);
    } catch (error) {
      setRecoveryError(error?.message || 'Falha ao validar codigo de verificacao.');
    } finally {
      setRecoveryBusy(false);
    }
  };

  if (isRecoveryRoute) {
    return html`
      <div className="relative min-h-screen text-base-content">
        <header
          className="sticky top-0 z-40 border-b border-base-300 bg-base-100/90 backdrop-blur-md"
        >
          <div
            className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-3 py-2 sm:px-4 lg:px-6"
          >
            <a
              className="btn btn-ghost h-10 min-h-0 justify-start gap-2 px-2 text-sm normal-case"
              href="/"
            >
              <img
                src="/assets/images/brand-logo-128.webp"
                alt="OmniZap"
                className="h-8 w-8 rounded-full border border-base-300 object-cover"
                loading="lazy"
                decoding="async"
              />
              <span className="truncate font-bold tracking-wide">OmniZap System</span>
            </a>
            <div className="flex items-center gap-2">
              <a className="btn btn-ghost btn-sm" href="/user/">Minha conta</a>
              <button
                type="button"
                className="btn btn-error btn-sm"
                onClick=${handleLogout}
                disabled=${isLogoutBusy}
              >
                ${isLogoutBusy ? 'Encerrando...' : 'Encerrar sessao'}
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-4xl px-3 pb-16 pt-6 sm:px-4 lg:px-6">
          <section
            className="rounded-2xl border border-base-300 bg-base-100/80 p-4 shadow-xl sm:p-6"
          >
            <p className="text-xs font-bold uppercase tracking-widest text-error">
              Sessao temporaria
            </p>
            <h1 className="mt-1 text-2xl font-black sm:text-3xl">Redefinir senha</h1>
            <p className="mt-2 text-sm text-base-content/75">
              Esta rota expira automaticamente. Envie o codigo de 6 digitos para confirmar a
              redefinicao.
            </p>

            <div className="mt-4 grid gap-2">
              ${recoveryFeedback
                ? html`
                    <div role="status" className="alert alert-success text-sm">
                      <span>${recoveryFeedback}</span>
                    </div>
                  `
                : null}
              ${recoveryError
                ? html`
                    <div role="alert" className="alert alert-error text-sm">
                      <span>${recoveryError}</span>
                    </div>
                  `
                : null}
              ${recoverySessionError
                ? html`
                    <div role="alert" className="alert alert-error text-sm">
                      <span>${recoverySessionError}</span>
                    </div>
                  `
                : null}
            </div>

            <div className="mt-4 grid gap-3 min-[520px]:grid-cols-2">
              <article className="rounded-xl border border-base-300 bg-base-200/70 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-base-content/60">
                  Destino do codigo
                </p>
                <p className="mt-1 text-base font-semibold">
                  ${recoverySessionLoading
                    ? 'Carregando...'
                    : recoverySessionState.maskedEmail || 'Nao informado'}
                </p>
              </article>
              <article className="rounded-xl border border-base-300 bg-base-200/70 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-base-content/60">
                  Expira em
                </p>
                <p className="mt-1 text-base font-semibold">
                  ${recoverySessionLoading
                    ? 'Carregando...'
                    : recoverySessionState.expiresAt || 'Nao informado'}
                </p>
              </article>
            </div>

            ${recoverySessionState.valid
              ? html`
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn btn-error w-full sm:w-auto"
                      disabled=${recoveryBusy}
                      onClick=${handleRequestRecoveryCodeBySession}
                    >
                      ${recoveryBusy ? 'Enviando...' : 'Enviar codigo por e-mail'}
                    </button>
                    <a className="btn btn-outline w-full sm:w-auto" href="/user/"
                      >Voltar para minha conta</a
                    >
                  </div>

                  <form className="mt-4" onSubmit=${handleVerifyRecoveryCodeBySession}>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <label className="form-control">
                        <span className="label-text text-xs">Codigo (6 digitos)</span>
                        <input
                          type="text"
                          inputmode="numeric"
                          pattern="[0-9]*"
                          maxlength="6"
                          className="input input-bordered w-full"
                          name="verification_code"
                          autocomplete="one-time-code"
                        />
                      </label>
                      <label className="form-control">
                        <span className="label-text text-xs">Nova senha</span>
                        <input
                          type="password"
                          className="input input-bordered w-full"
                          name="new_password"
                          autocomplete="new-password"
                        />
                      </label>
                      <label className="form-control">
                        <span className="label-text text-xs">Confirmar senha</span>
                        <input
                          type="password"
                          className="input input-bordered w-full"
                          name="new_password_confirm"
                          autocomplete="new-password"
                        />
                      </label>
                    </div>

                    <div className="mt-3">
                      <button
                        type="submit"
                        className="btn btn-primary w-full sm:w-auto"
                        disabled=${recoveryBusy}
                      >
                        ${recoveryBusy ? 'Validando...' : 'Validar codigo e redefinir'}
                      </button>
                    </div>
                  </form>
                `
              : html`
                  <div className="mt-4">
                    <a className="btn btn-outline w-full sm:w-auto" href="/user/"
                      >Voltar para minha conta</a
                    >
                  </div>
                `}
          </section>
        </main>
      </div>
    `;
  }

  return html`
    <div className="relative min-h-screen text-base-content">
      <header
        className="sticky top-0 z-50 border-b border-base-300 bg-base-100/90 backdrop-blur-md"
      >
        <div
          className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-3 py-2 sm:px-4 lg:px-6"
        >
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              className="btn btn-square h-10 min-h-0 border border-base-300 bg-base-200/70"
              aria-label=${isSidebarOpen ? 'Fechar barra lateral' : 'Abrir barra lateral'}
              aria-expanded=${isSidebarOpen ? 'true' : 'false'}
              onClick=${toggleSidebar}
            >
              ${isSidebarOpen ? '\u2715' : '\u2630'}
            </button>
            <a
              className="btn btn-ghost h-10 min-h-0 max-w-[74vw] justify-start gap-2 px-2 text-sm normal-case sm:max-w-none"
              href="/"
            >
              <img
                src="/assets/images/brand-logo-128.webp"
                alt="OmniZap"
                className="h-8 w-8 rounded-full border border-base-300 object-cover"
                loading="lazy"
                decoding="async"
              />
              <span className="truncate font-bold tracking-wide">OmniZap System</span>
            </a>
          </div>

          <div className="lg:hidden">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick=${handleLogout}
              disabled=${isLogoutBusy}
            >
              ${isLogoutBusy ? 'Saindo...' : 'Sair'}
            </button>
          </div>

          <nav className="hidden items-center gap-2 lg:flex" aria-label="Navegação da conta">
            <a className="btn btn-ghost btn-sm" href="/user/">Área do Usuário</a>
            <a
              className="btn btn-ghost btn-sm"
              href=${config.termsUrl}
              target="_blank"
              rel="noreferrer noopener"
              >Termos</a
            >
            <a
              className="btn btn-ghost btn-sm"
              href=${config.privacyUrl}
              target="_blank"
              rel="noreferrer noopener"
              >Privacidade</a
            >
            <button
              type="button"
              className="btn btn-error btn-sm"
              onClick=${handleLogout}
              disabled=${isLogoutBusy}
            >
              ${isLogoutBusy ? 'Encerrando...' : 'Encerrar sess\u00e3o'}
            </button>
          </nav>
        </div>
      </header>

      <main
        className=${`mx-auto w-full max-w-[min(96vw,1740px)] px-2 pb-20 pt-3 transition-[padding-left] duration-300 sm:px-4 sm:pb-14 sm:pt-6 lg:px-6 xl:px-8 ${!isMobile && isSidebarOpen ? 'lg:pl-[372px]' : 'lg:pl-0'}`}
      >
        <aside
          className=${`fixed left-0 top-16 z-[60] h-[calc(100dvh-4rem)] w-[min(88vw,340px)] lg:w-[360px] px-2 pb-3 transition-transform duration-300 ease-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-[108%]'}`}
          aria-hidden=${isSidebarOpen ? 'false' : 'true'}
        >
          <div
            className=${`h-full overflow-y-auto rounded-r-2xl border border-base-300 bg-base-100/95 shadow-2xl backdrop-blur ${isMobile ? 'border-base-300/70 p-3' : 'p-5'}`}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-base-content/70">
                Navegação
              </p>
              <button type="button" className="btn btn-ghost btn-xs" onClick=${closeSidebar}>
                Fechar
              </button>
            </div>

            ${!isMobile
              ? html`
                  <div className="mb-4 rounded-2xl border border-base-300 bg-base-200/60 p-3">
                    <div className="flex items-center gap-3">
                      <img
                        src=${summary.avatar}
                        alt="Avatar da conta"
                        className="h-12 w-12 rounded-xl border border-base-300 object-cover"
                        onError=${(event) => {
                          const image = event.currentTarget;
                          image.src = config.fallbackAvatar;
                        }}
                      />
                      <div className="min-w-0">
                        <p
                          className=${`truncate text-sm font-bold ${isLoadingSummary ? 'skeleton h-5 w-32 text-transparent' : ''}`}
                        >
                          ${isLoadingSummary ? 'Carregando...' : summary.name}
                        </p>
                        <p
                          className=${`truncate text-xs text-base-content/70 ${isLoadingSummary ? 'skeleton mt-1 h-4 w-40 text-transparent' : ''}`}
                        >
                          ${isLoadingSummary ? 'email@exemplo.com' : summary.email}
                        </p>
                      </div>
                    </div>
                  </div>
                `
              : null}

            <div className="space-y-2">
              ${TABS.map(
                (tab) => html`
                  <button
                    type="button"
                    className=${`btn w-full justify-start ${activeTab === tab.key ? 'btn-primary' : 'btn-outline'}`}
                    aria-selected=${activeTab === tab.key ? 'true' : 'false'}
                    onClick=${() => handleTabSelect(tab.key)}
                  >
                    ${tab.label}
                  </button>
                `,
              )}
            </div>

            <div className="divider my-3"></div>
            <div className="grid gap-2">
              <a
                className="btn btn-success w-full justify-start"
                href=${links.botUrl}
                target="_blank"
                rel="noreferrer noopener"
                onClick=${closeSidebar}
                >Abrir bot no WhatsApp</a
              >
              <a
                className="btn btn-outline w-full justify-start"
                href=${links.supportUrl}
                target="_blank"
                rel="noreferrer noopener"
                onClick=${closeSidebar}
                >Falar com suporte</a
              >
            </div>

            <div className="divider my-3"></div>
            <p className="text-xs leading-relaxed text-base-content/65">
              Use os atalhos para abrir o bot ou falar com o suporte quando precisar.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <a
                className="link link-info text-xs"
                href=${config.termsUrl}
                target="_blank"
                rel="noreferrer noopener"
                onClick=${closeSidebar}
                >Termos de Serviço</a
              >
              <a
                className="link link-info text-xs"
                href=${config.privacyUrl}
                target="_blank"
                rel="noreferrer noopener"
                onClick=${closeSidebar}
                >Política de Privacidade</a
              >
            </div>
          </div>
        </aside>

        ${isMobile && isSidebarOpen
          ? html`<button
              type="button"
              className="fixed inset-0 z-50 bg-slate-950/55"
              aria-label="Fechar barra lateral"
              onClick=${closeSidebar}
            ></button>`
          : null}

        <section
          className="rounded-2xl border border-base-300 bg-base-100/80 p-2.5 shadow-xl sm:p-5 lg:p-7"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 sm:mb-4">
            <div>
              ${!isMobile
                ? html`<p className="text-xs font-bold uppercase tracking-widest text-info">
                    Painel do usuário
                  </p>`
                : null}
              <h1 className="mt-1 text-xl font-black sm:text-3xl lg:text-4xl">Minha Conta</h1>
              ${!isMobile
                ? html`<p className="mt-1 text-sm text-base-content/70">
                    Resumo da sua conta e canais diretos de suporte.
                  </p>`
                : null}
            </div>
            ${!isMobile
              ? html`
                  <div className="hidden lg:flex items-center gap-2">
                    <a
                      className="btn btn-success"
                      href=${links.botUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      >Abrir bot</a
                    >
                    <a
                      className="btn btn-outline"
                      href=${links.supportUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      >Suporte</a
                    >
                  </div>
                `
              : null}
          </div>

          <div className="mb-4 grid gap-2">
            <div
              role="status"
              className=${`alert ${toneClassMap[status.tone] || 'alert-info'} text-sm`}
            >
              <span>${status.message}</span>
            </div>
            ${errorMessage
              ? html`
                  <div role="alert" className="alert alert-error text-sm">
                    <span>${errorMessage}</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-outline w-full sm:w-auto"
                    onClick=${handleRetry}
                  >
                    Tentar novamente
                  </button>
                `
              : null}
          </div>

          ${activeTab === 'summary'
            ? html`
                <div className="space-y-4">
                  <section className="rounded-xl border border-base-300 bg-base-200/70 p-3 sm:p-4">
                    <div
                      className="flex flex-col items-start gap-3 min-[520px]:flex-row min-[520px]:items-center"
                    >
                      <img
                        src=${summary.avatar}
                        alt="Avatar do usuário"
                        className="h-16 w-16 rounded-xl border border-base-300 object-cover sm:h-20 sm:w-20"
                        onError=${(event) => {
                          const image = event.currentTarget;
                          image.src = config.fallbackAvatar;
                        }}
                      />
                      <div className="min-w-0 space-y-1">
                        <p
                          className=${`text-xl font-black sm:text-2xl ${isLoadingSummary ? 'skeleton h-7 w-44 text-transparent' : ''}`}
                        >
                          ${isLoadingSummary ? 'Carregando' : summary.name}
                        </p>
                        <p
                          className=${`text-sm text-base-content/75 ${isLoadingSummary ? 'skeleton h-5 w-56 text-transparent' : ''}`}
                        >
                          ${isLoadingSummary ? 'email@exemplo.com' : summary.email}
                        </p>
                        <p
                          className=${`text-sm text-base-content/75 ${isLoadingSummary ? 'skeleton h-5 w-64 text-transparent' : ''}`}
                        >
                          ${isLoadingSummary ? 'WhatsApp vinculado' : summary.whatsapp}
                        </p>
                      </div>
                    </div>
                  </section>

                  <div className="grid gap-3 min-[520px]:grid-cols-2 xl:grid-cols-4">
                    <article className="rounded-xl border border-base-300 bg-base-200/70 p-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-base-content/60">
                        Plano
                      </p>
                      <p
                        className=${`mt-1 text-base font-semibold ${isLoadingSummary ? 'skeleton h-6 w-32 text-transparent' : ''}`}
                      >
                        ${isLoadingSummary ? '--' : summary.plan}
                      </p>
                    </article>
                    <article className="rounded-xl border border-base-300 bg-base-200/70 p-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-base-content/60">
                        Status
                      </p>
                      <p
                        className=${`mt-1 text-base font-semibold ${isLoadingSummary ? 'skeleton h-6 w-24 text-transparent' : ''}`}
                      >
                        ${isLoadingSummary ? '--' : summary.status}
                      </p>
                    </article>
                    <article className="rounded-xl border border-base-300 bg-base-200/70 p-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-base-content/60">
                        Último login
                      </p>
                      <p
                        className=${`mt-1 text-base font-semibold ${isLoadingSummary ? 'skeleton h-6 w-36 text-transparent' : ''}`}
                      >
                        ${isLoadingSummary ? '--' : summary.lastLogin}
                      </p>
                    </article>
                    <article className="rounded-xl border border-base-300 bg-base-200/70 p-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-base-content/60">
                        Sessão expira em
                      </p>
                      <p
                        className=${`mt-1 text-base font-semibold ${isLoadingSummary ? 'skeleton h-6 w-36 text-transparent' : ''}`}
                      >
                        ${isLoadingSummary ? '--' : summary.expiresAt}
                      </p>
                    </article>
                  </div>
                </div>
              `
            : null}
          ${activeTab === 'account'
            ? html`
                <div className="space-y-4">
                  <div className="grid gap-3 min-[520px]:grid-cols-2 xl:grid-cols-4">
                    <article className="rounded-xl border border-base-300 bg-base-200/70 p-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-base-content/60">
                        Status da sessão
                      </p>
                      <p
                        className=${`mt-1 text-base font-semibold ${isLoadingSummary ? 'skeleton h-6 w-36 text-transparent' : ''}`}
                      >
                        ${isLoadingSummary ? '--' : summary.sessionStatus}
                      </p>
                    </article>
                    <article className="rounded-xl border border-base-300 bg-base-200/70 p-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-base-content/60">
                        Owner vinculado
                      </p>
                      <p
                        className=${`mt-1 text-base font-semibold ${isLoadingSummary ? 'skeleton h-6 w-40 text-transparent' : ''}`}
                      >
                        ${isLoadingSummary ? '--' : summary.ownerJid}
                      </p>
                    </article>
                    <article className="rounded-xl border border-base-300 bg-base-200/70 p-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-base-content/60">
                        Último login
                      </p>
                      <p
                        className=${`mt-1 text-base font-semibold ${isLoadingSummary ? 'skeleton h-6 w-36 text-transparent' : ''}`}
                      >
                        ${isLoadingSummary ? '--' : summary.lastLogin}
                      </p>
                    </article>
                    <article className="rounded-xl border border-base-300 bg-base-200/70 p-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-base-content/60">
                        Expiração da sessão
                      </p>
                      <p
                        className=${`mt-1 text-base font-semibold ${isLoadingSummary ? 'skeleton h-6 w-36 text-transparent' : ''}`}
                      >
                        ${isLoadingSummary ? '--' : summary.expiresAt}
                      </p>
                    </article>
                  </div>

                  <section className="rounded-xl border border-base-300 bg-base-200/70 p-3 sm:p-4">
                    <p className="text-xs font-bold uppercase tracking-widest text-base-content/60">
                      Seguranca da senha
                    </p>
                    <div className="mt-3 grid gap-3 min-[520px]:grid-cols-2 xl:grid-cols-4">
                      <article className="rounded-lg border border-base-300 bg-base-100/70 p-3">
                        <p
                          className="text-xs font-bold uppercase tracking-wide text-base-content/60"
                        >
                          Status
                        </p>
                        <p className="mt-1 text-base font-semibold">
                          ${passwordState.configured
                            ? 'Senha configurada'
                            : 'Senha nao configurada'}
                        </p>
                      </article>
                      <article className="rounded-lg border border-base-300 bg-base-100/70 p-3">
                        <p
                          className="text-xs font-bold uppercase tracking-wide text-base-content/60"
                        >
                          Ultima alteracao
                        </p>
                        <p className="mt-1 text-base font-semibold">
                          ${passwordState.passwordChangedAt}
                        </p>
                      </article>
                      <article className="rounded-lg border border-base-300 bg-base-100/70 p-3">
                        <p
                          className="text-xs font-bold uppercase tracking-wide text-base-content/60"
                        >
                          Falhas recentes
                        </p>
                        <p className="mt-1 text-base font-semibold">
                          ${String(passwordState.failedAttempts)}
                        </p>
                      </article>
                      <article className="rounded-lg border border-base-300 bg-base-100/70 p-3">
                        <p
                          className="text-xs font-bold uppercase tracking-wide text-base-content/60"
                        >
                          Ultimo login por senha
                        </p>
                        <p className="mt-1 text-base font-semibold">${passwordState.lastLoginAt}</p>
                      </article>
                    </div>

                    <div className="mt-4 grid gap-2">
                      ${passwordFeedback
                        ? html`
                            <div role="status" className="alert alert-success text-sm">
                              <span>${passwordFeedback}</span>
                            </div>
                          `
                        : null}
                      ${passwordError
                        ? html`
                            <div role="alert" className="alert alert-error text-sm">
                              <span>${passwordError}</span>
                            </div>
                          `
                        : null}
                    </div>

                    ${!passwordState.configured
                      ? html`
                          <form className="mt-3" onSubmit=${handlePasswordUpdate}>
                            <input
                              type="email"
                              className="hidden"
                              name="username"
                              autocomplete="username"
                              value=${accountEmail}
                              readonly
                            />
                            <div className="grid gap-2 min-[520px]:grid-cols-2">
                              <label className="form-control">
                                <span className="label-text text-xs">Nova senha</span>
                                <input
                                  type="password"
                                  className="input input-bordered w-full"
                                  name="new_password"
                                  autocomplete="new-password"
                                />
                              </label>
                              <label className="form-control">
                                <span className="label-text text-xs">Confirmar senha</span>
                                <input
                                  type="password"
                                  className="input input-bordered w-full"
                                  name="new_password_confirm"
                                  autocomplete="new-password"
                                />
                              </label>
                            </div>

                            <div className="mt-3">
                              <button
                                type="submit"
                                className="btn btn-primary w-full sm:w-auto"
                                disabled=${passwordBusy}
                              >
                                ${passwordBusy ? 'Salvando...' : 'Criar senha'}
                              </button>
                            </div>
                          </form>
                        `
                      : html`
                          <p className="mt-3 text-sm text-base-content/75">
                            Para alterar sua senha, use a sessao segura de redefinicao por e-mail
                            abaixo.
                          </p>
                        `}
                  </section>

                  <section className="rounded-xl border border-base-300 bg-base-200/70 p-3 sm:p-4">
                    <p className="text-xs font-bold uppercase tracking-widest text-base-content/60">
                      Redefinicao por e-mail
                    </p>
                    <p className="mt-1 text-sm text-base-content/75">
                      Abra uma sessao temporaria com expiracao automatica para redefinir sua senha
                      com codigo de 6 digitos.
                    </p>

                    <div className="mt-3 grid gap-2">
                      ${recoveryFeedback
                        ? html`
                            <div role="status" className="alert alert-success text-sm">
                              <span>${recoveryFeedback}</span>
                            </div>
                          `
                        : null}
                      ${recoveryError
                        ? html`
                            <div role="alert" className="alert alert-error text-sm">
                              <span>${recoveryError}</span>
                            </div>
                          `
                        : null}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn btn-error"
                        disabled=${recoveryBusy || !passwordState.configured || !accountEmail}
                        onClick=${handleOpenRecoverySession}
                      >
                        ${recoveryBusy ? 'Abrindo...' : 'Redefinir senha em sessao segura'}
                      </button>
                      ${!passwordState.configured
                        ? html`<span className="text-xs text-base-content/65 self-center"
                            >Disponivel apos configurar a senha inicial.</span
                          >`
                        : accountEmail
                          ? html`<span className="text-xs text-base-content/65 self-center"
                              >Destino: ${accountEmail}</span
                            >`
                          : html`<span className="text-xs text-warning self-center"
                              >Conta sem e-mail valido para recuperacao.</span
                            >`}
                    </div>
                  </section>

                  <p className="text-sm text-base-content/70">
                    Ao usar o login você concorda com os termos e regras de privacidade do projeto.
                  </p>
                  <div className="flex flex-wrap gap-3 text-sm">
                    <a
                      className="link link-info"
                      href=${config.termsUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      >Termos de Serviço</a
                    >
                    <a
                      className="link link-info"
                      href=${config.privacyUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      >Política de Privacidade</a
                    >
                  </div>
                </div>
              `
            : null}
          ${activeTab === 'support'
            ? html`
                <div className="space-y-4">
                  <p className="text-sm text-base-content/70">
                    Canal oficial para dúvidas sobre login e uso geral do OmniZap.
                  </p>

                  <div className="grid gap-3 min-[520px]:grid-cols-2">
                    <article className="rounded-xl border border-base-300 bg-base-200/70 p-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-base-content/60">
                        Contato
                      </p>
                      <p
                        className=${`mt-1 text-base font-semibold ${isLoadingSummary ? 'skeleton h-6 w-36 text-transparent' : ''}`}
                      >
                        ${isLoadingSummary
                          ? '--'
                          : support.phone
                            ? `+${formatPhone(support.phone)}`
                            : 'N\u00e3o informado'}
                      </p>
                    </article>
                    <article className="rounded-xl border border-base-300 bg-base-200/70 p-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-base-content/60">
                        Mensagem padrão
                      </p>
                      <p
                        className=${`mt-1 text-base font-semibold ${isLoadingSummary ? 'skeleton h-6 w-40 text-transparent' : ''}`}
                      >
                        ${isLoadingSummary ? '--' : support.text}
                      </p>
                    </article>
                  </div>

                  <div className="grid gap-2 min-[520px]:grid-cols-2">
                    <a
                      className="btn btn-success w-full"
                      href=${links.supportUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      >Abrir suporte no WhatsApp</a
                    >
                    <a
                      className="btn btn-outline w-full"
                      href=${config.termsUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      >Ver novos Termos</a
                    >
                  </div>
                </div>
              `
            : null}

          <p className="mt-5 text-center text-xs text-base-content/60">
            OmniZap System · ${String(new Date().getFullYear())}
          </p>
        </section>
      </main>
    </div>
  `;
};

const rootElement = document.getElementById('user-react-root');

if (rootElement) {
  const config = {
    apiBasePath: normalizeBasePath(rootElement.dataset.apiBasePath, DEFAULT_API_BASE_PATH),
    loginPath: normalizeBasePath(rootElement.dataset.loginPath, DEFAULT_LOGIN_PATH),
    passwordResetWebPath: normalizeBasePath(
      rootElement.dataset.passwordResetWebPath,
      DEFAULT_PASSWORD_RESET_WEB_PATH,
    ),
    termsUrl: normalizeUrlPath(rootElement.dataset.termsUrl, DEFAULT_TERMS_URL),
    privacyUrl: normalizeUrlPath(rootElement.dataset.privacyUrl, DEFAULT_PRIVACY_URL),
    fallbackAvatar: normalizeUrlPath(rootElement.dataset.fallbackAvatar, DEFAULT_FALLBACK_AVATAR),
  };

  const root = createRoot(rootElement);
  root.render(html`<${UserApp} config=${config} />`);
}
