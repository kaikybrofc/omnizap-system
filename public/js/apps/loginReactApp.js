import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';

const html = htm.bind(React.createElement);

const GOOGLE_GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const DEFAULT_API_BASE_PATH = '/api/sticker-packs';
const DEFAULT_HOME_PATH = '/';
const DEFAULT_PANEL_PATH = '/user/';
const DEFAULT_TERMS_URL = '/termos-de-uso/';
const DEFAULT_PRIVACY_URL = '/termos-de-uso/#politica-de-privacidade';
const DEFAULT_BRAND_NAME = 'OmniZap System';
const DEFAULT_BRAND_LOGO = '/assets/images/brand-logo-128.webp';
const LOGIN_CONSENT_STORAGE_KEY = 'omnizap_login_terms_consent_v1';
const LOGIN_CONSENT_HINT = 'Aceite os Termos de Uso e a Politica de Privacidade para continuar.';
const DEFAULT_SUCCESS_CHAT_LABEL = 'Abrir WhatsApp do bot';
const DEFAULT_SUCCESS_HOME_LABEL = 'Ir para o painel';
const ALREADY_LOGGED_HINT_TEXT = 'Nao e necessario fazer login novamente. Escolha uma opcao abaixo.';

const normalizeDigits = (value) => String(value || '').replace(/\D+/g, '');

const formatPhone = (digits) => {
  const value = normalizeDigits(digits);
  if (!value) return '';
  if (value.length <= 4) return value;
  return `${value.slice(0, 2)} ${value.slice(2, -4)}-${value.slice(-4)}`.trim();
};

const normalizeBasePath = (value, fallback) => {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  if (withSlash.length > 1 && withSlash.endsWith('/')) return withSlash.slice(0, -1);
  return withSlash || fallback;
};

const normalizeRoutePath = (value, fallback) => {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  if (raw.startsWith('/')) return raw;
  if (/^https?:\/\//i.test(raw)) return fallback;
  return `/${raw}`;
};

const normalizeUrlPath = (value, fallback) => {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  return raw;
};

const readConsentState = () => {
  try {
    return window.localStorage.getItem(LOGIN_CONSENT_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

const persistConsentState = (accepted) => {
  try {
    if (accepted) {
      window.localStorage.setItem(LOGIN_CONSENT_STORAGE_KEY, '1');
      return;
    }
    window.localStorage.removeItem(LOGIN_CONSENT_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
};

const isAuthenticatedFlagEnabled = (value) => {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1';
  }
  return false;
};

const isAuthenticatedGoogleSession = (sessionData) => {
  if (!sessionData || typeof sessionData !== 'object') return false;
  if (!isAuthenticatedFlagEnabled(sessionData.authenticated)) return false;
  const provider = String(sessionData.provider || '')
    .trim()
    .toLowerCase();
  if (provider && provider !== 'google') return false;
  const ownerJid = String(sessionData.owner_jid || '').trim();
  const userSub = String(sessionData?.user?.sub || '').trim();
  return Boolean(ownerJid || userSub);
};

const readWhatsAppHintFromSearch = (search) => {
  const params = new URLSearchParams(search || '');
  const phone = normalizeDigits(params.get('wa') || '');
  const ts = String(params.get('wa_ts') || '').trim();
  const sig = String(params.get('wa_sig') || '').trim();
  const hasPayload = Boolean(phone || ts || sig);
  return {
    hasPayload,
    phone,
    ts,
    sig,
  };
};

const resolveNextRedirectPathFromUrl = (search) => {
  try {
    const params = new URLSearchParams(search || '');
    const rawNext = String(params.get('next') || '').trim();
    if (!rawNext) return '';

    if (/^[a-z][a-z0-9+.-]*:/i.test(rawNext) || rawNext.startsWith('//')) {
      return '';
    }

    const parsed = new URL(rawNext, window.location.origin);
    if (parsed.origin !== window.location.origin) return '';
    if (!parsed.pathname.startsWith('/')) return '';

    const normalizedPath = String(parsed.pathname || '')
      .replace(/\/+$/, '')
      .toLowerCase();
    if (normalizedPath === '/login') return '';

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '';
  }
};

const resolveAuthenticatedRedirectPath = (search, fallbackPath) => {
  const nextPath = resolveNextRedirectPathFromUrl(search);
  if (nextPath) return nextPath;
  const safeFallback = normalizeRoutePath(fallbackPath, DEFAULT_PANEL_PATH);
  return safeFallback || DEFAULT_PANEL_PATH;
};

const buildWhatsappUrl = (phoneDigits, text) => {
  const digits = normalizeDigits(phoneDigits);
  const params = new URLSearchParams({
    text: String(text || '').trim(),
    type: 'custom_url',
    app_absent: '0',
  });
  if (digits) params.set('phone', digits);
  return `https://api.whatsapp.com/send/?${params.toString()}`;
};

const buildWhatsappStartUrl = (phoneDigits) => buildWhatsappUrl(phoneDigits, 'iniciar');
const buildWhatsappMenuUrl = (phoneDigits) => buildWhatsappUrl(phoneDigits, '/menu');

const resolveGoogleButtonWidth = (buttonElement, areaElement) => {
  const directWidth = Math.floor(Number(buttonElement?.clientWidth || 0));
  if (directWidth > 0) {
    return Math.max(180, Math.min(320, directWidth));
  }

  const areaWidth = Math.floor(Number(areaElement?.clientWidth || 0));
  if (areaWidth > 0) {
    const areaStyles = areaElement ? window.getComputedStyle(areaElement) : null;
    const areaPaddingX = areaStyles ? Number.parseFloat(areaStyles.paddingLeft || '0') + Number.parseFloat(areaStyles.paddingRight || '0') : 0;
    const available = Math.floor(areaWidth - areaPaddingX - 20);
    if (available > 0) return Math.max(180, Math.min(320, available));
  }

  const viewportAvailable = Math.floor(Number(window.innerWidth || 0)) - 96;
  if (viewportAvailable > 0) return Math.max(180, Math.min(320, viewportAvailable));
  return 280;
};

let googleScriptPromise = null;

const loadGoogleScript = () => {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (googleScriptPromise) return googleScriptPromise;

  googleScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GOOGLE_GSI_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.google?.accounts?.id || null), { once: true });
      existing.addEventListener('error', () => reject(new Error('Falha ao carregar SDK Google.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = GOOGLE_GSI_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google?.accounts?.id || null);
    script.onerror = () => reject(new Error('Falha ao carregar SDK Google.'));
    document.head.appendChild(script);
  }).catch((error) => {
    googleScriptPromise = null;
    throw error;
  });

  return googleScriptPromise;
};

const extractPhoneFromJid = (jid) => {
  const raw = String(jid || '').trim();
  if (!raw.includes('@')) return '';
  const userPart = raw.split('@')[0] || '';
  const user = userPart.split(':')[0] || '';
  return normalizeDigits(user);
};

const resolveHintMessage = (hint) => {
  if (!hint.hasPayload) {
    return 'Use e-mail/senha ou abra o link que o bot envia no WhatsApp para liberar o login Google.';
  }
  if (!hint.phone) {
    return 'Este link nao tem um numero valido. Gere um novo enviando "iniciar" no bot.';
  }
  return `Numero detectado: +${formatPhone(hint.phone)}.`;
};

const resolveSummaryState = ({ canUseGoogleLogin, authenticated, sessionOwnerPhone, hintPhone }) => {
  if (!canUseGoogleLogin || !authenticated) {
    return {
      visible: false,
      state: 'ok',
      title: '',
      owner: '',
    };
  }

  if (sessionOwnerPhone) {
    return {
      visible: true,
      state: 'ok',
      title: 'WhatsApp conectado',
      owner: `+${formatPhone(sessionOwnerPhone)}`,
    };
  }

  if (hintPhone) {
    return {
      visible: true,
      state: 'pending',
      title: 'Vinculo em andamento',
      owner: `Numero detectado: +${formatPhone(hintPhone)}`,
    };
  }

  return {
    visible: true,
    state: 'ok',
    title: 'Conta ativa',
    owner: 'Abra o link do WhatsApp para concluir o vinculo.',
  };
};

const resolvePasswordConfigured = (payload) => Boolean(payload?.data?.password?.configured);

const toSafeEmail = (value) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return normalized.includes('@') ? normalized : '';
};

const createLoginApi = (apiBasePath) => {
  const sessionPath = `${apiBasePath}/auth/google/session`;
  const passwordLoginPath = `${apiBasePath}/auth/login`;
  const passwordPath = `${apiBasePath}/auth/password`;
  const passwordRecoveryRequestPath = `${apiBasePath}/auth/password/recovery/request`;
  const passwordRecoveryVerifyPath = `${apiBasePath}/auth/password/recovery/verify`;
  const configPath = `${apiBasePath}/create-config`;
  const botContactPath = `${apiBasePath}/bot-contact`;
  const systemSummaryPath = `${apiBasePath}/system-summary`;
  const catalogPath = `${apiBasePath}?visibility=public&limit=1`;

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
    getSession: () => fetchJson(sessionPath, { method: 'GET' }),
    createSession: (body) =>
      fetchJson(sessionPath, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(body),
      }),
    loginWithPassword: (body) =>
      fetchJson(passwordLoginPath, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(body || {}),
      }),
    getPasswordState: () => fetchJson(passwordPath, { method: 'GET' }),
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
    getConfig: () => fetchJson(configPath, { method: 'GET' }),
    getBotContact: () => fetchJson(botContactPath, { method: 'GET' }),
    getSystemSummary: () => fetchJson(systemSummaryPath, { method: 'GET' }),
    getCatalogSample: () => fetchJson(catalogPath, { method: 'GET' }),
  };
};

const buildSessionPayload = (googleCredential, hint) => {
  const payload = {
    google_id_token: String(googleCredential || '').trim(),
  };

  if (hint.phone) {
    payload.wa = hint.phone;
    if (hint.ts) payload.wa_ts = hint.ts;
    if (hint.sig) payload.wa_sig = hint.sig;
  }

  return payload;
};

const LoginApp = ({ config }) => {
  const api = useMemo(() => createLoginApi(config.apiBasePath), [config.apiBasePath]);
  const hint = useMemo(() => readWhatsAppHintFromSearch(window.location.search), []);
  const canUseGoogleLogin = Boolean(hint.phone);
  const authenticatedRedirectPath = useMemo(() => resolveAuthenticatedRedirectPath(window.location.search, config.panelPath), [config.panelPath]);

  const googleButtonRef = useRef(null);
  const googleAreaRef = useRef(null);
  const googleAccountsRef = useRef(null);
  const googleInitializedRef = useRef(false);
  const redirectTimerRef = useRef(0);
  const successTimerRef = useRef(0);
  const resizeObserverRef = useRef(null);
  const resizeListenerRef = useRef(null);
  const redirectingRef = useRef(false);

  const [statusMessage, setStatusMessage] = useState('Verificando conta Google...');
  const [errorMessage, setErrorMessage] = useState('');
  const [consentErrorMessage, setConsentErrorMessage] = useState('');
  const [consentAccepted, setConsentAccepted] = useState(() => readConsentState());
  const [isBusy, setBusy] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [alreadyLoggedVisible, setAlreadyLoggedVisible] = useState(false);
  const [sessionOwnerPhone, setSessionOwnerPhone] = useState('');
  const [botPhone, setBotPhone] = useState('');
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleReady, setGoogleReady] = useState(false);
  const [showSuccessCelebration, setShowSuccessCelebration] = useState(false);
  const [, setPasswordConfigured] = useState(true);
  const [passwordSetupRequired, setPasswordSetupRequired] = useState(false);
  const [passwordSetupBusy, setPasswordSetupBusy] = useState(false);
  const [passwordSetupError, setPasswordSetupError] = useState('');
  const [passwordSetupForm, setPasswordSetupForm] = useState({
    password: '',
    confirm: '',
  });
  const [passwordLoginBusy, setPasswordLoginBusy] = useState(false);
  const [passwordLoginError, setPasswordLoginError] = useState('');
  const [passwordLoginForm, setPasswordLoginForm] = useState({
    email: '',
    password: '',
  });
  const [passwordRecoveryStep, setPasswordRecoveryStep] = useState('idle');
  const [passwordRecoveryBusy, setPasswordRecoveryBusy] = useState(false);
  const [passwordRecoveryError, setPasswordRecoveryError] = useState('');
  const [passwordRecoveryMessage, setPasswordRecoveryMessage] = useState('');
  const [passwordRecoveryForm, setPasswordRecoveryForm] = useState({
    email: '',
    code: '',
    password: '',
    confirm: '',
  });

  const summary = useMemo(
    () =>
      resolveSummaryState({
        canUseGoogleLogin,
        authenticated,
        sessionOwnerPhone,
        hintPhone: hint.phone,
      }),
    [authenticated, canUseGoogleLogin, hint.phone, sessionOwnerPhone],
  );

  const hintMessage = useMemo(() => resolveHintMessage(hint), [hint]);

  const googleStateMessage = useMemo(() => {
    if (!canUseGoogleLogin) return '';
    if (!googleEnabled || !googleClientId) return 'Login Google desabilitado neste ambiente.';
    if (isBusy) return 'Finalizando login...';
    if (!consentAccepted) return LOGIN_CONSENT_HINT;
    if (!googleReady) return 'Carregando login Google...';
    return '';
  }, [canUseGoogleLogin, consentAccepted, googleClientId, googleEnabled, googleReady, isBusy]);

  const whatsappCtaVisible = useMemo(() => {
    if (canUseGoogleLogin) return false;
    if (authenticated) return false;
    if (sessionOwnerPhone) return false;
    return true;
  }, [authenticated, canUseGoogleLogin, sessionOwnerPhone]);

  const whatsappMeta = botPhone ? `Bot detectado: +${formatPhone(botPhone)}.` : 'Se necessario, escolha o contato do bot no WhatsApp e envie "iniciar".';
  const whatsappCtaHref = buildWhatsappStartUrl(botPhone);
  const successChatHref = buildWhatsappMenuUrl(botPhone);
  const successHomeHref = authenticatedRedirectPath;
  const alreadyLoggedDetail = sessionOwnerPhone ? `Sessao ativa para +${formatPhone(sessionOwnerPhone)}. Nao e necessario fazer login novamente.` : ALREADY_LOGGED_HINT_TEXT;

  const clearResizeBinding = useCallback(() => {
    if (resizeObserverRef.current && typeof resizeObserverRef.current.disconnect === 'function') {
      resizeObserverRef.current.disconnect();
    }
    resizeObserverRef.current = null;

    if (resizeListenerRef.current) {
      window.removeEventListener('resize', resizeListenerRef.current);
    }
    resizeListenerRef.current = null;
  }, []);

  const renderGoogleButton = useCallback(() => {
    const accounts = googleAccountsRef.current;
    const buttonContainer = googleButtonRef.current;
    if (!accounts || !buttonContainer) return false;

    buttonContainer.innerHTML = '';
    const width = resolveGoogleButtonWidth(buttonContainer, googleAreaRef.current);
    accounts.renderButton(buttonContainer, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'continue_with',
      shape: 'pill',
      width,
    });

    return true;
  }, []);

  const triggerAuthenticatedRedirect = useCallback(() => {
    if (redirectingRef.current) return;

    const targetUrl = new URL(authenticatedRedirectPath, window.location.origin);
    const currentUrl = new URL(window.location.href);
    if (targetUrl.pathname === currentUrl.pathname && targetUrl.search === currentUrl.search) {
      return;
    }

    redirectingRef.current = true;
    setStatusMessage('Sessao ativa detectada. Redirecionando...');

    if (redirectTimerRef.current) {
      window.clearTimeout(redirectTimerRef.current);
      redirectTimerRef.current = 0;
    }

    redirectTimerRef.current = window.setTimeout(() => {
      window.location.replace(`${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`);
    }, 120);
  }, [authenticatedRedirectPath]);

  const playSuccessCelebration = useCallback(() => {
    if (successTimerRef.current) {
      window.clearTimeout(successTimerRef.current);
      successTimerRef.current = 0;
    }

    setShowSuccessCelebration(true);
    successTimerRef.current = window.setTimeout(() => {
      setShowSuccessCelebration(false);
      successTimerRef.current = 0;
    }, 2300);
  }, []);

  const refreshPasswordSetupState = useCallback(async () => {
    try {
      const payload = await api.getPasswordState();
      const configured = resolvePasswordConfigured(payload);
      setPasswordConfigured(configured);
      setPasswordSetupRequired(!configured);
      return configured;
    } catch {
      setPasswordConfigured(true);
      setPasswordSetupRequired(false);
      return true;
    }
  }, [api]);

  const handleGoogleCredential = useCallback(
    async (credential) => {
      if (!consentAccepted) {
        setConsentErrorMessage(LOGIN_CONSENT_HINT);
        setBusy(false);
        return;
      }

      const token = String(credential || '').trim();
      if (!token) {
        setErrorMessage('Falha ao receber token do Google. Tente novamente.');
        return;
      }

      setBusy(true);
      setErrorMessage('');
      setConsentErrorMessage('');
      setAlreadyLoggedVisible(false);
      setPasswordSetupError('');

      try {
        const payload = await api.createSession(buildSessionPayload(token, hint));
        const sessionData = payload?.data || {};
        if (!isAuthenticatedGoogleSession(sessionData)) {
          throw new Error('Nao foi possivel criar a sessao Google.');
        }

        setAuthenticated(true);
        setSessionOwnerPhone(String(sessionData?.owner_phone || '').trim());
        const configured = await refreshPasswordSetupState();
        setStatusMessage(configured ? 'Conta Google detectada' : 'Conta Google validada. Crie sua senha para proximos acessos.');
        playSuccessCelebration();
      } catch (error) {
        setErrorMessage(error?.message || 'Falha ao concluir login Google.');
        setStatusMessage('Falha ao validar conta Google');
        setAuthenticated(false);
        setSessionOwnerPhone('');
        setPasswordConfigured(true);
        setPasswordSetupRequired(false);
        setShowSuccessCelebration(false);
      } finally {
        setBusy(false);
      }
    },
    [api, consentAccepted, hint, playSuccessCelebration, refreshPasswordSetupState],
  );

  useEffect(() => {
    googleInitializedRef.current = false;
    setGoogleReady(false);
    clearResizeBinding();
  }, [clearResizeBinding, googleClientId]);

  useEffect(() => {
    let active = true;

    const loadBotPhone = async () => {
      let phone = '';

      try {
        const contactPayload = await api.getBotContact();
        phone = normalizeDigits(contactPayload?.data?.phone || '');
      } catch {
        phone = '';
      }

      if (!active) return '';

      try {
        if (!phone) {
          const summaryPayload = await api.getSystemSummary();
          const botPhoneFromSummary = normalizeDigits(summaryPayload?.data?.bot?.phone || '');
          if (botPhoneFromSummary) {
            phone = botPhoneFromSummary;
          } else {
            phone = extractPhoneFromJid(String(summaryPayload?.data?.bot?.jid || '').trim());
          }
        }
      } catch {
        if (!phone) phone = '';
      }

      if (!active) return '';

      try {
        if (!phone) {
          const catalogPayload = await api.getCatalogSample();
          const firstPack = Array.isArray(catalogPayload?.data) ? catalogPayload.data[0] : null;
          phone = normalizeDigits(firstPack?.whatsapp?.phone || '');
        }
      } catch {
        if (!phone) phone = '';
      }

      return phone;
    };

    const initialize = async () => {
      setErrorMessage('');
      setConsentErrorMessage('');
      setAlreadyLoggedVisible(false);
      setStatusMessage(canUseGoogleLogin ? 'Verificando conta Google...' : 'Entre com e-mail e senha ou gere o link no WhatsApp para login Google');

      try {
        const sessionPayload = await api.getSession();
        if (!active) return;

        const sessionData = sessionPayload?.data || {};
        if (isAuthenticatedGoogleSession(sessionData)) {
          setAuthenticated(true);
          setSessionOwnerPhone(String(sessionData?.owner_phone || '').trim());
          setAlreadyLoggedVisible(true);
          const configured = await refreshPasswordSetupState();
          if (!active) return;
          if (configured) {
            triggerAuthenticatedRedirect();
          } else {
            setStatusMessage('Sessao ativa detectada. Crie sua senha para concluir o setup.');
          }
          return;
        }

        setAuthenticated(false);
        setSessionOwnerPhone('');
        setPasswordConfigured(true);
        setPasswordSetupRequired(false);
        if (canUseGoogleLogin) {
          setStatusMessage('Entre com Google para continuar');
        }
      } catch {
        if (!active) return;
        setAuthenticated(false);
        setSessionOwnerPhone('');
        setPasswordConfigured(true);
        setPasswordSetupRequired(false);
        if (canUseGoogleLogin) {
          setStatusMessage('Nao foi possivel validar sua sessao');
        }
      }

      const detectedPhone = await loadBotPhone();
      if (!active) return;
      setBotPhone(detectedPhone);

      if (!canUseGoogleLogin) return;

      try {
        const configPayload = await api.getConfig();
        if (!active) return;
        const googleConfig = configPayload?.data?.auth?.google || {};
        setGoogleEnabled(Boolean(googleConfig?.enabled));
        setGoogleClientId(String(googleConfig?.client_id || '').trim());
      } catch {
        if (!active) return;
        setGoogleEnabled(false);
        setGoogleClientId('');
      }
    };

    void initialize();

    return () => {
      active = false;
    };
  }, [api, canUseGoogleLogin, refreshPasswordSetupState, triggerAuthenticatedRedirect]);

  useEffect(() => {
    let active = true;
    clearResizeBinding();

    const mountGoogleButton = async () => {
      if (!active) return;
      if (!canUseGoogleLogin || authenticated) {
        setGoogleReady(false);
        return;
      }
      if (!consentAccepted) {
        setGoogleReady(false);
        return;
      }
      if (!googleEnabled || !googleClientId) {
        setGoogleReady(false);
        return;
      }
      if (!googleButtonRef.current) {
        setGoogleReady(false);
        return;
      }

      try {
        const accounts = await loadGoogleScript();
        if (!active) return;
        if (!accounts) throw new Error('SDK Google nao disponivel.');

        googleAccountsRef.current = accounts;

        if (!googleInitializedRef.current) {
          accounts.initialize({
            client_id: googleClientId,
            callback: (response) => {
              void handleGoogleCredential(response?.credential);
            },
            auto_select: false,
            cancel_on_tap_outside: true,
          });
          googleInitializedRef.current = true;
        }

        const rendered = renderGoogleButton();
        setGoogleReady(rendered);

        const onResize = () => {
          renderGoogleButton();
        };

        if (typeof window.ResizeObserver === 'function' && googleAreaRef.current) {
          const observer = new window.ResizeObserver(() => onResize());
          observer.observe(googleAreaRef.current);
          resizeObserverRef.current = observer;
        } else {
          window.addEventListener('resize', onResize);
          resizeListenerRef.current = onResize;
        }
      } catch (error) {
        if (!active) return;
        setGoogleReady(false);
        setErrorMessage(error?.message || 'Falha ao carregar login Google.');
      }
    };

    void mountGoogleButton();

    return () => {
      active = false;
      clearResizeBinding();
    };
  }, [authenticated, canUseGoogleLogin, clearResizeBinding, consentAccepted, googleClientId, googleEnabled, handleGoogleCredential, renderGoogleButton]);

  useEffect(
    () => () => {
      clearResizeBinding();

      if (redirectTimerRef.current) {
        window.clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = 0;
      }

      if (successTimerRef.current) {
        window.clearTimeout(successTimerRef.current);
        successTimerRef.current = 0;
      }
    },
    [clearResizeBinding],
  );

  const onConsentChange = (event) => {
    const accepted = Boolean(event.currentTarget?.checked);
    setConsentAccepted(accepted);
    persistConsentState(accepted);
    if (accepted) setConsentErrorMessage('');
  };

  const handlePasswordSetupSubmit = async () => {
    if (passwordSetupBusy) return;
    if (!passwordSetupForm.password || !passwordSetupForm.confirm) {
      setPasswordSetupError('Preencha senha e confirmacao.');
      return;
    }
    if (passwordSetupForm.password !== passwordSetupForm.confirm) {
      setPasswordSetupError('A confirmacao da senha nao confere.');
      return;
    }

    setPasswordSetupBusy(true);
    setPasswordSetupError('');
    setErrorMessage('');

    try {
      await api.updatePassword(passwordSetupForm.password);
      setPasswordConfigured(true);
      setPasswordSetupRequired(false);
      setPasswordSetupForm({
        password: '',
        confirm: '',
      });
      setStatusMessage('Senha criada com sucesso. Redirecionando...');
      triggerAuthenticatedRedirect();
    } catch (error) {
      setPasswordSetupError(error?.message || 'Falha ao criar senha.');
    } finally {
      setPasswordSetupBusy(false);
    }
  };

  const handlePasswordLoginSubmit = async () => {
    if (passwordLoginBusy) return;
    const email = toSafeEmail(passwordLoginForm.email);
    const password = String(passwordLoginForm.password || '');

    if (!email || !password) {
      setPasswordLoginError('Informe e-mail e senha para continuar.');
      return;
    }

    setPasswordLoginBusy(true);
    setPasswordLoginError('');
    setPasswordRecoveryError('');
    setPasswordRecoveryMessage('');
    setErrorMessage('');

    try {
      const payload = await api.loginWithPassword({
        email,
        password,
      });
      const sessionData = payload?.data?.session || {};
      if (!isAuthenticatedGoogleSession(sessionData)) {
        throw new Error('Falha ao abrir sessao por senha.');
      }

      setAuthenticated(true);
      setSessionOwnerPhone(String(sessionData?.owner_phone || '').trim());
      setPasswordConfigured(true);
      setPasswordSetupRequired(false);
      setStatusMessage('Login por senha concluido. Redirecionando...');
      triggerAuthenticatedRedirect();
    } catch (error) {
      const responseCode = String(error?.payload?.code || '')
        .trim()
        .toUpperCase();
      if (responseCode === 'PASSWORD_NOT_CONFIGURED') {
        setPasswordRecoveryStep('code_request');
        setPasswordRecoveryForm((current) => ({
          ...current,
          email,
        }));
        setPasswordRecoveryMessage('Sua conta ainda nao tem senha. Solicite o codigo para criar sua senha.');
        setPasswordLoginError('Conta sem senha configurada. Use o fluxo de criacao abaixo.');
      } else {
        setPasswordLoginError(error?.message || 'Falha no login por senha.');
      }
    } finally {
      setPasswordLoginBusy(false);
    }
  };

  const handleRecoveryRequestSubmit = async () => {
    if (passwordRecoveryBusy) return;
    const email = toSafeEmail(passwordRecoveryForm.email || passwordLoginForm.email);
    if (!email) {
      setPasswordRecoveryError('Informe um e-mail valido para receber o codigo.');
      return;
    }

    setPasswordRecoveryBusy(true);
    setPasswordRecoveryError('');
    setPasswordRecoveryMessage('');

    try {
      const payload = await api.requestPasswordRecoveryCode({
        email,
        purpose: 'setup',
      });
      const masked = String(payload?.data?.masked_email || '').trim();
      setPasswordRecoveryStep('code_sent');
      setPasswordRecoveryForm((current) => ({
        ...current,
        email,
      }));
      setPasswordRecoveryMessage(masked ? `Codigo enviado para ${masked}.` : 'Codigo enviado por e-mail.');
    } catch (error) {
      setPasswordRecoveryError(error?.message || 'Falha ao enviar codigo.');
    } finally {
      setPasswordRecoveryBusy(false);
    }
  };

  const handleRecoveryVerifySubmit = async () => {
    if (passwordRecoveryBusy) return;
    const email = toSafeEmail(passwordRecoveryForm.email || passwordLoginForm.email);
    const code = String(passwordRecoveryForm.code || '')
      .replace(/\D+/g, '')
      .slice(0, 6);
    const password = String(passwordRecoveryForm.password || '');
    const confirm = String(passwordRecoveryForm.confirm || '');

    if (!email) {
      setPasswordRecoveryError('Informe um e-mail valido.');
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      setPasswordRecoveryError('Informe um codigo de 6 digitos.');
      return;
    }
    if (!password || !confirm) {
      setPasswordRecoveryError('Informe a nova senha e a confirmacao.');
      return;
    }
    if (password !== confirm) {
      setPasswordRecoveryError('A confirmacao da senha nao confere.');
      return;
    }

    setPasswordRecoveryBusy(true);
    setPasswordRecoveryError('');
    setPasswordRecoveryMessage('');

    try {
      const payload = await api.verifyPasswordRecoveryCode({
        email,
        code,
        password,
        purpose: 'setup',
      });
      const sessionData = payload?.data?.session || {};
      if (!isAuthenticatedGoogleSession(sessionData)) {
        throw new Error('Senha criada, mas nao foi possivel abrir sessao automaticamente.');
      }
      setAuthenticated(true);
      setSessionOwnerPhone(String(sessionData?.owner_phone || '').trim());
      setPasswordConfigured(true);
      setPasswordSetupRequired(false);
      setPasswordRecoveryForm({
        email,
        code: '',
        password: '',
        confirm: '',
      });
      setStatusMessage('Senha criada com sucesso. Redirecionando...');
      triggerAuthenticatedRedirect();
    } catch (error) {
      setPasswordRecoveryError(error?.message || 'Falha ao validar codigo.');
    } finally {
      setPasswordRecoveryBusy(false);
    }
  };

  return html`
    <div className="login-page-container relative min-h-screen overflow-hidden px-3 py-6 text-base-content sm:px-4 sm:py-10">
      <main className="mx-auto w-full max-w-3xl overflow-hidden rounded-3xl border border-base-300/70 bg-base-100/75 shadow-2xl backdrop-blur-md">
        <header className="border-b border-base-300/70 px-4 py-4 sm:px-6">
          <a href=${config.homePath} className="inline-flex items-center gap-3 text-base-content no-underline">
            <img src=${config.brandLogo} alt=${config.brandName} className="h-9 w-9 rounded-full border border-base-300/80 object-cover" loading="lazy" decoding="async" />
            <span className="text-base font-extrabold tracking-wide sm:text-lg">${config.brandName}</span>
          </a>
        </header>

        <section className="grid gap-4 px-4 py-5 sm:px-6 sm:py-7">
          <p className="badge badge-info badge-outline w-fit px-3 py-3 font-semibold uppercase tracking-wider">Login seguro OmniZap</p>
          <h1 className="text-balance text-3xl font-black leading-tight sm:text-4xl">Acesse sua conta</h1>
          <p className="text-sm text-base-content/80 sm:text-base">Vincule seu WhatsApp e libere os recursos do OmniZap.</p>

          <article className="grid gap-3 rounded-2xl border border-base-300/80 bg-base-200/50 p-4 sm:p-5">
            <p className="inline-flex w-fit items-center gap-2 rounded-full border border-info/50 bg-info/15 px-3 py-1 text-sm font-semibold text-info">
              <span className="h-2.5 w-2.5 rounded-full bg-info shadow-[0_0_0_4px_rgba(56,189,248,0.2)]"></span>
              ${statusMessage}
            </p>

            <p className="text-sm leading-relaxed text-base-content/75">${hintMessage}</p>

            ${errorMessage
              ? html`
                  <div role="alert" className="alert alert-error py-2 text-sm">
                    <span>${errorMessage}</span>
                  </div>
                `
              : null}
            ${alreadyLoggedVisible
              ? html`
                  <div className="rounded-xl border border-success/45 bg-success/15 p-3">
                    <p className="text-sm font-bold text-success">Voce ja esta logado neste navegador.</p>
                    <p className="mt-1 text-sm leading-relaxed text-success/90">${alreadyLoggedDetail}</p>
                  </div>
                `
              : null}
            ${canUseGoogleLogin
              ? html`
                  <div ref=${googleAreaRef} className="grid gap-3 rounded-xl border border-base-300/80 bg-base-100/60 p-3">
                    ${!authenticated
                      ? html`
                          <div className=${`rounded-xl border border-base-300/80 bg-white p-2 transition-opacity ${isBusy ? 'pointer-events-none opacity-60' : 'opacity-100'} ${consentAccepted ? '' : 'hidden'}`}>
                            <div ref=${googleButtonRef}></div>
                          </div>
                        `
                      : null}

                    <p className="text-xs text-base-content/70">${googleStateMessage}</p>

                    ${!authenticated
                      ? html`
                          <div className=${`rounded-xl border p-3 transition-colors ${consentAccepted ? 'border-success/60 bg-success/10' : 'border-base-300/80 bg-base-100/45'}`}>
                            <label className="grid cursor-pointer grid-cols-[20px_minmax(0,1fr)] items-start gap-2 text-sm leading-relaxed text-base-content/90">
                              <input type="checkbox" className="checkbox checkbox-success checkbox-sm mt-0.5" checked=${consentAccepted} disabled=${isBusy} onChange=${onConsentChange} />
                              <span>
                                Li e aceito os
                                <a className="link link-info ml-1" href=${config.termsUrl} target="_blank" rel="noreferrer noopener">Termos de Uso</a>
                                e a
                                <a className="link link-info ml-1" href=${config.privacyUrl} target="_blank" rel="noreferrer noopener">Politica de Privacidade</a>.
                              </span>
                            </label>
                            ${consentErrorMessage ? html`<p className="mt-2 text-xs text-error">${consentErrorMessage}</p>` : null}
                          </div>
                        `
                      : null}
                  </div>
                `
              : null}
          </article>

          ${authenticated && passwordSetupRequired
            ? html`
                <section className="grid gap-3 rounded-2xl border border-warning/45 bg-warning/10 p-4 sm:p-5">
                  <p className="text-sm font-bold text-warning-content">Senha ainda nao configurada</p>
                  <p className="text-sm text-base-content/80">Para concluir o primeiro acesso, crie sua senha agora. Nos proximos logins voce pode entrar direto por e-mail e senha.</p>
                  ${passwordSetupError
                    ? html`
                        <div role="alert" className="alert alert-error text-sm">
                          <span>${passwordSetupError}</span>
                        </div>
                      `
                    : null}
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="form-control">
                      <span className="label-text text-xs">Nova senha</span>
                      <input
                        type="password"
                        className="input input-bordered w-full"
                        name="new_password"
                        value=${passwordSetupForm.password}
                        onInput=${(event) => {
                          const nextValue = String(event.currentTarget?.value || '');
                          setPasswordSetupForm((current) => ({ ...current, password: nextValue }));
                        }}
                        autocomplete="new-password"
                      />
                    </label>
                    <label className="form-control">
                      <span className="label-text text-xs">Confirmar senha</span>
                      <input
                        type="password"
                        className="input input-bordered w-full"
                        name="new_password_confirm"
                        value=${passwordSetupForm.confirm}
                        onInput=${(event) => {
                          const nextValue = String(event.currentTarget?.value || '');
                          setPasswordSetupForm((current) => ({ ...current, confirm: nextValue }));
                        }}
                        autocomplete="new-password"
                      />
                    </label>
                  </div>
                  <button type="button" className="btn btn-primary w-full sm:w-auto" disabled=${passwordSetupBusy} onClick=${handlePasswordSetupSubmit}>${passwordSetupBusy ? 'Salvando...' : 'Criar senha agora'}</button>
                </section>
              `
            : null}
          ${!authenticated
            ? html`
                <section className="grid gap-3 rounded-2xl border border-base-300/80 bg-base-100/55 p-4 sm:p-5">
                  <p className="text-sm font-bold">Entrar com senha</p>
                  <p className="text-sm text-base-content/75">Use e-mail + senha se sua conta ja estiver configurada.</p>
                  ${passwordLoginError
                    ? html`
                        <div role="alert" className="alert alert-error text-sm">
                          <span>${passwordLoginError}</span>
                        </div>
                      `
                    : null}
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="form-control">
                      <span className="label-text text-xs">E-mail</span>
                      <input
                        type="email"
                        className="input input-bordered w-full"
                        name="username"
                        value=${passwordLoginForm.email}
                        onInput=${(event) => {
                          const nextValue = String(event.currentTarget?.value || '');
                          setPasswordLoginForm((current) => ({
                            ...current,
                            email: nextValue,
                          }));
                        }}
                        autocomplete="email"
                      />
                    </label>
                    <label className="form-control">
                      <span className="label-text text-xs">Senha</span>
                      <input
                        type="password"
                        className="input input-bordered w-full"
                        name="password"
                        value=${passwordLoginForm.password}
                        onInput=${(event) => {
                          const nextValue = String(event.currentTarget?.value || '');
                          setPasswordLoginForm((current) => ({
                            ...current,
                            password: nextValue,
                          }));
                        }}
                        autocomplete="current-password"
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className="btn btn-secondary w-full sm:w-auto" disabled=${passwordLoginBusy} onClick=${handlePasswordLoginSubmit}>${passwordLoginBusy ? 'Entrando...' : 'Entrar com senha'}</button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick=${() => {
                        setPasswordRecoveryStep((step) => (step === 'idle' ? 'code_request' : 'idle'));
                        setPasswordRecoveryError('');
                        setPasswordRecoveryMessage('');
                        setPasswordRecoveryForm((current) => ({
                          ...current,
                          email: current.email || String(passwordLoginForm.email || '').trim(),
                        }));
                      }}
                    >
                      Esqueci / criar senha
                    </button>
                  </div>

                  ${passwordRecoveryStep !== 'idle'
                    ? html`
                        <div className="grid gap-3 rounded-xl border border-base-300/80 bg-base-200/55 p-3">
                          <p className="text-xs font-bold uppercase tracking-wider text-base-content/70">Recuperacao por codigo (6 digitos)</p>
                          ${passwordRecoveryMessage
                            ? html`
                                <div role="status" className="alert alert-success text-sm">
                                  <span>${passwordRecoveryMessage}</span>
                                </div>
                              `
                            : null}
                          ${passwordRecoveryError
                            ? html`
                                <div role="alert" className="alert alert-error text-sm">
                                  <span>${passwordRecoveryError}</span>
                                </div>
                              `
                            : null}
                          <div className="grid gap-2 sm:grid-cols-2">
                            <label className="form-control">
                              <span className="label-text text-xs">E-mail da conta</span>
                              <input
                                type="email"
                                className="input input-bordered w-full"
                                name="username"
                                value=${passwordRecoveryForm.email}
                                onInput=${(event) => {
                                  const nextValue = String(event.currentTarget?.value || '');
                                  setPasswordRecoveryForm((current) => ({
                                    ...current,
                                    email: nextValue,
                                  }));
                                }}
                                autocomplete="email"
                              />
                            </label>
                            <label className="form-control">
                              <span className="label-text text-xs">Codigo</span>
                              <input
                                type="text"
                                inputmode="numeric"
                                className="input input-bordered w-full"
                                name="verification_code"
                                value=${passwordRecoveryForm.code}
                                onInput=${(event) => {
                                  const nextValue = String(event.currentTarget?.value || '')
                                    .replace(/\D+/g, '')
                                    .slice(0, 6);
                                  setPasswordRecoveryForm((current) => ({
                                    ...current,
                                    code: nextValue,
                                  }));
                                }}
                                autocomplete="one-time-code"
                              />
                            </label>
                            <label className="form-control">
                              <span className="label-text text-xs">Nova senha</span>
                              <input
                                type="password"
                                className="input input-bordered w-full"
                                name="new_password"
                                value=${passwordRecoveryForm.password}
                                onInput=${(event) => {
                                  const nextValue = String(event.currentTarget?.value || '');
                                  setPasswordRecoveryForm((current) => ({
                                    ...current,
                                    password: nextValue,
                                  }));
                                }}
                                autocomplete="new-password"
                              />
                            </label>
                            <label className="form-control">
                              <span className="label-text text-xs">Confirmar senha</span>
                              <input
                                type="password"
                                className="input input-bordered w-full"
                                name="new_password_confirm"
                                value=${passwordRecoveryForm.confirm}
                                onInput=${(event) => {
                                  const nextValue = String(event.currentTarget?.value || '');
                                  setPasswordRecoveryForm((current) => ({
                                    ...current,
                                    confirm: nextValue,
                                  }));
                                }}
                                autocomplete="new-password"
                              />
                            </label>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button type="button" className="btn btn-outline w-full sm:w-auto" disabled=${passwordRecoveryBusy} onClick=${handleRecoveryRequestSubmit}>${passwordRecoveryBusy ? 'Enviando...' : 'Enviar codigo por e-mail'}</button>
                            <button type="button" className="btn btn-primary w-full sm:w-auto" disabled=${passwordRecoveryBusy} onClick=${handleRecoveryVerifySubmit}>${passwordRecoveryBusy ? 'Validando...' : 'Validar codigo e criar senha'}</button>
                          </div>
                        </div>
                      `
                    : null}
                </section>
              `
            : null}
          ${summary.visible
            ? html`
                <div className=${`rounded-xl border p-3 ${summary.state === 'pending' ? 'border-warning/45 bg-warning/15 text-warning-content' : 'border-success/45 bg-success/15 text-success-content'}`}>
                  <p className="text-xs font-bold uppercase tracking-wider">${summary.title}</p>
                  <p className="mt-1 text-sm font-semibold">${summary.owner}</p>
                </div>
              `
            : null}
          ${whatsappCtaVisible
            ? html`
                <div className="grid gap-3 rounded-xl border border-base-300/80 bg-base-100/55 p-3 sm:p-4">
                  <p className="text-sm leading-relaxed text-base-content/85">Para liberar o login neste navegador, inicie no WhatsApp e gere seu link seguro.</p>
                  <a className="btn btn-outline w-full justify-center sm:w-auto sm:justify-start" href=${whatsappCtaHref} target="_blank" rel="noreferrer noopener"> Gerar link de login no WhatsApp </a>
                  <p className="text-xs text-base-content/70">${whatsappMeta}</p>
                </div>
              `
            : null}
          ${authenticated
            ? html`
                <div className="grid gap-2 sm:grid-cols-2">
                  <a className="btn btn-primary w-full" href=${successHomeHref}>${DEFAULT_SUCCESS_HOME_LABEL}</a>
                  <a className="btn btn-outline w-full" href=${successChatHref} target="_blank" rel="noreferrer noopener">${DEFAULT_SUCCESS_CHAT_LABEL}</a>
                </div>
              `
            : null}
        </section>
      </main>

      <div className=${`login-success-overlay${showSuccessCelebration ? ' is-visible' : ''}`} aria-live="polite" aria-atomic="true" aria-hidden=${showSuccessCelebration ? 'false' : 'true'}>
        <div className="login-success-card" role="status">
          <div className="login-success-icon" aria-hidden="true">
            <svg className="h-9 w-9" viewBox="0 0 24 24" focusable="false">
              <path className="login-success-check" d="M5 12.5l4.2 4.2L19 7.3" />
            </svg>
          </div>
          <p className="text-lg font-extrabold">Login concluido</p>
          <p className="text-center text-sm text-base-content/80">Sua conta foi vinculada com sucesso.</p>
        </div>
      </div>
    </div>
  `;
};

const rootElement = document.getElementById('login-react-root');

if (rootElement) {
  const config = {
    apiBasePath: normalizeBasePath(rootElement.dataset.apiBasePath, DEFAULT_API_BASE_PATH),
    homePath: normalizeRoutePath(rootElement.dataset.homePath, DEFAULT_HOME_PATH),
    panelPath: normalizeRoutePath(rootElement.dataset.panelPath, DEFAULT_PANEL_PATH),
    termsUrl: normalizeUrlPath(rootElement.dataset.termsUrl, DEFAULT_TERMS_URL),
    privacyUrl: normalizeUrlPath(rootElement.dataset.privacyUrl, DEFAULT_PRIVACY_URL),
    brandName: String(rootElement.dataset.brandName || '').trim() || DEFAULT_BRAND_NAME,
    brandLogo: normalizeUrlPath(rootElement.dataset.brandLogo, DEFAULT_BRAND_LOGO),
  };

  const root = createRoot(rootElement);
  root.render(html`<${LoginApp} config=${config} />`);
}
