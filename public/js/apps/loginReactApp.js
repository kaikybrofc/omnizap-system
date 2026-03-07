import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';

const html = htm.bind(React.createElement);

const GOOGLE_GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const DEFAULT_API_BASE_PATH = '/api';
const DEFAULT_HOME_PATH = '/';
const DEFAULT_PANEL_PATH = '/user/';
const DEFAULT_TERMS_URL = '/termos-de-uso/';
const DEFAULT_PRIVACY_URL = '/politica-de-privacidade/';
const DEFAULT_AUP_URL = '/aup/';
const DEFAULT_SUPPORT_URL = 'https://wa.me/559591122954';
const DEFAULT_DOCS_URL = '/api-docs/';
const DEFAULT_STATUS_URL = '/healthz';
const DEFAULT_BRAND_NAME = 'OmniZap System';
const DEFAULT_BRAND_LOGO = '/assets/images/brand-logo-128.webp';
const LOGIN_CONSENT_STORAGE_KEY = 'omnizap_login_terms_consent_v1';
const LOGIN_CONSENT_RECEIPT_STORAGE_KEY = 'omnizap_login_terms_consent_receipt_v1';
const LOGIN_CONSENT_HINT = 'Aceite os Termos de Uso, Politica de Privacidade e AUP para continuar.';
const LEGAL_ACCEPTANCE_DOCUMENTS = Object.freeze([
  { document_key: 'termos_de_uso', document_version: '2026-03-07' },
  { document_key: 'politica_de_privacidade', document_version: '2026-03-07' },
  { document_key: 'politica_uso_aceitavel', document_version: '2026-03-07' },
]);
const DEFAULT_SUCCESS_CHAT_LABEL = 'Abrir WhatsApp do bot';
const DEFAULT_SUCCESS_HOME_LABEL = 'Ir para o painel';
const ALREADY_LOGGED_HINT_TEXT =
  'Nao e necessario fazer login novamente. Escolha uma opcao abaixo.';

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

const isAbsoluteHttpUrl = (value) => /^https?:\/\//i.test(String(value || '').trim());

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

const normalizeConsentDocument = (value) => {
  const documentKey = String(value?.document_key || '')
    .trim()
    .toLowerCase();
  const documentVersion = String(value?.document_version || '').trim();
  if (!documentKey || !documentVersion) return null;
  return {
    document_key: documentKey,
    document_version: documentVersion,
  };
};

const normalizeConsentReceipt = (value) => {
  const acceptedDocuments = Array.isArray(value?.accepted_documents)
    ? value.accepted_documents.map(normalizeConsentDocument).filter(Boolean)
    : [];
  const acceptedAt = String(value?.accepted_at || '').trim();
  if (!acceptedDocuments.length || !acceptedAt) return null;
  return {
    accepted_documents: acceptedDocuments,
    accepted_at: acceptedAt,
  };
};

const persistConsentReceiptState = (receipt) => {
  try {
    if (!receipt) {
      window.localStorage.removeItem(LOGIN_CONSENT_RECEIPT_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(LOGIN_CONSENT_RECEIPT_STORAGE_KEY, JSON.stringify(receipt));
  } catch {
    // Ignore storage errors.
  }
};

const readConsentReceiptState = () => {
  try {
    const raw = window.localStorage.getItem(LOGIN_CONSENT_RECEIPT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return normalizeConsentReceipt(parsed);
  } catch {
    return null;
  }
};

const buildConsentDocumentKey = (doc) => `${doc.document_key}:${doc.document_version}`;

const hasRequiredConsentReceipt = (receipt) => {
  const normalizedReceipt = normalizeConsentReceipt(receipt);
  if (!normalizedReceipt) return false;
  const expected = new Set(LEGAL_ACCEPTANCE_DOCUMENTS.map(buildConsentDocumentKey));
  const informed = new Set(normalizedReceipt.accepted_documents.map(buildConsentDocumentKey));
  if (informed.size < expected.size) return false;
  for (const requiredKey of expected) {
    if (!informed.has(requiredKey)) return false;
  }
  return true;
};

const buildTermsAcceptancePayload = () => ({
  accepted: true,
  accepted_at: new Date().toISOString(),
  source: 'login_web',
  documents: LEGAL_ACCEPTANCE_DOCUMENTS,
});

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
    const areaPaddingX = areaStyles
      ? Number.parseFloat(areaStyles.paddingLeft || '0') +
        Number.parseFloat(areaStyles.paddingRight || '0')
      : 0;
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
      existing.addEventListener('load', () => resolve(window.google?.accounts?.id || null), {
        once: true,
      });
      existing.addEventListener('error', () => reject(new Error('Falha ao carregar SDK Google.')), {
        once: true,
      });
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
    return 'Abra o WhatsApp do bot e envie "iniciar" para receber seu link seguro de login.';
  }
  if (!hint.phone) {
    return 'Este link nao tem um numero valido. Gere um novo enviando "iniciar" no bot.';
  }
  return `Numero detectado: +${formatPhone(hint.phone)}.`;
};

const resolveSummaryState = ({
  canUseGoogleLogin,
  authenticated,
  sessionOwnerPhone,
  hintPhone,
}) => {
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

const decodeBase64UrlToText = (value) => {
  const normalized = String(value || '')
    .trim()
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  if (!normalized) return '';

  const padding = (4 - (normalized.length % 4)) % 4;
  const padded = `${normalized}${'='.repeat(padding)}`;

  try {
    const binary = window.atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    if (typeof window.TextDecoder === 'function') {
      return new window.TextDecoder().decode(bytes);
    }
    return binary;
  } catch {
    return '';
  }
};

const decodeGoogleCredentialPayload = (credential) => {
  const rawToken = String(credential || '').trim();
  if (!rawToken) return null;
  const parts = rawToken.split('.');
  if (parts.length < 2) return null;
  const payloadRaw = decodeBase64UrlToText(parts[1]);
  if (!payloadRaw) return null;

  try {
    const parsed = JSON.parse(payloadRaw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const buildGoogleAccountPreview = (credential) => {
  const payload = decodeGoogleCredentialPayload(credential);
  if (!payload) return null;

  const sub = String(payload.sub || '')
    .trim()
    .slice(0, 80);
  const email = toSafeEmail(payload.email).slice(0, 255);
  const name = String(payload.name || payload.given_name || email || 'Conta Google')
    .trim()
    .slice(0, 120);
  const pictureRaw = String(payload.picture || '')
    .trim()
    .slice(0, 512);
  const picture = /^https?:\/\//i.test(pictureRaw) ? pictureRaw : '';
  const initialSource = name || email || 'G';
  const initial = String(initialSource).trim().slice(0, 1).toUpperCase() || 'G';

  if (!sub && !email && !name) return null;
  return {
    sub,
    name,
    email,
    picture,
    initial,
  };
};

const createLoginApi = (apiBasePath) => {
  const sessionPath = `${apiBasePath}/auth/google/session`;
  const termsAcceptancePath = `${apiBasePath}/auth/terms/acceptance`;
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
    recordTermsAcceptance: (body) =>
      fetchJson(termsAcceptancePath, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(body || {}),
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
  const authenticatedRedirectPath = useMemo(
    () => resolveAuthenticatedRedirectPath(window.location.search, config.panelPath),
    [config.panelPath],
  );

  const googleButtonRef = useRef(null);
  const googleAreaRef = useRef(null);
  const googleAccountsRef = useRef(null);
  const googleInitializedRef = useRef(false);
  const redirectTimerRef = useRef(0);
  const successTimerRef = useRef(0);
  const resizeObserverRef = useRef(null);
  const resizeListenerRef = useRef(null);
  const redirectingRef = useRef(false);

  const [statusMessage, setStatusMessage] = useState('Ambiente seguro pronto para login.');
  const [errorMessage, setErrorMessage] = useState('');
  const [consentErrorMessage, setConsentErrorMessage] = useState('');
  const [consentAccepted, setConsentAccepted] = useState(() => readConsentState());
  const [consentReceipt, setConsentReceipt] = useState(() => readConsentReceiptState());
  const [consentSaving, setConsentSaving] = useState(false);
  const [isBusy, setBusy] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [alreadyLoggedVisible, setAlreadyLoggedVisible] = useState(false);
  const [sessionOwnerPhone, setSessionOwnerPhone] = useState('');
  const [botPhone, setBotPhone] = useState('');
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleReady, setGoogleReady] = useState(false);
  const [pendingGoogleCredential, setPendingGoogleCredential] = useState('');
  const [selectedGoogleAccount, setSelectedGoogleAccount] = useState(null);
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
  const hasConsentReceipt = useMemo(
    () => hasRequiredConsentReceipt(consentReceipt),
    [consentReceipt],
  );

  const googleStateMessage = useMemo(() => {
    if (!canUseGoogleLogin) return '';
    if (!googleEnabled || !googleClientId) return 'Login Google desabilitado neste ambiente.';
    if (isBusy || consentSaving) return 'Finalizando login...';
    if (!googleReady) return 'Carregando login Google...';
    if (pendingGoogleCredential) {
      if (!consentAccepted) {
        if (selectedGoogleAccount?.email) {
          return `Conta ${selectedGoogleAccount.email} selecionada. Aceite os termos e clique em Finalizar.`;
        }
        return 'Conta Google selecionada. Aceite os termos e clique em Finalizar.';
      }
      return 'Tudo pronto. Clique em Finalizar para concluir o login.';
    }
    if (!consentAccepted) return 'Selecione sua conta Google para continuar.';
    if (!hasConsentReceipt) return 'Registrando aceite juridico...';
    return '';
  }, [
    canUseGoogleLogin,
    consentAccepted,
    consentSaving,
    googleClientId,
    googleEnabled,
    googleReady,
    hasConsentReceipt,
    isBusy,
    pendingGoogleCredential,
    selectedGoogleAccount,
  ]);

  const showLinkGoogleFlow = !authenticated && hint.hasPayload;
  const showPasswordMethod = false;
  const showGoogleMethod = showLinkGoogleFlow;
  const showDirectWhatsAppOnly = !authenticated && !hint.hasPayload;
  const shouldShowConsentCard =
    showLinkGoogleFlow &&
    (Boolean(pendingGoogleCredential) ||
      consentAccepted ||
      consentSaving ||
      Boolean(consentErrorMessage));
  const shouldShowStatusCard =
    !showDirectWhatsAppOnly || Boolean(errorMessage) || alreadyLoggedVisible;

  const whatsappMeta = botPhone
    ? `Bot detectado: +${formatPhone(botPhone)}.`
    : 'Se necessario, escolha o contato do bot no WhatsApp e envie "iniciar".';
  const whatsappCtaHref = buildWhatsappStartUrl(botPhone);
  const successChatHref = buildWhatsappMenuUrl(botPhone);
  const successHomeHref = authenticatedRedirectPath;
  const supportLinkExternal = isAbsoluteHttpUrl(config.supportUrl);
  const docsLinkExternal = isAbsoluteHttpUrl(config.docsUrl);
  const statusLinkExternal = isAbsoluteHttpUrl(config.statusUrl);
  const alreadyLoggedDetail = sessionOwnerPhone
    ? `Sessao ativa para +${formatPhone(sessionOwnerPhone)}. Nao e necessario fazer login novamente.`
    : ALREADY_LOGGED_HINT_TEXT;

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

  const registerConsentReceipt = useCallback(async () => {
    const payload = await api.recordTermsAcceptance(buildTermsAcceptancePayload());
    const receipt = normalizeConsentReceipt(payload?.data || {});
    if (!receipt) {
      throw new Error('Nao foi possivel validar o registro de aceite juridico.');
    }
    setConsentReceipt(receipt);
    persistConsentReceiptState(receipt);
    return receipt;
  }, [api]);

  const ensureConsentReceipt = useCallback(async () => {
    if (!consentAccepted) {
      setConsentErrorMessage(LOGIN_CONSENT_HINT);
      return false;
    }

    if (hasRequiredConsentReceipt(consentReceipt)) {
      return true;
    }

    setConsentSaving(true);
    setConsentErrorMessage('');
    try {
      await registerConsentReceipt();
      return true;
    } catch (error) {
      setConsentErrorMessage(
        error?.message || 'Falha ao registrar aceite juridico. Tente novamente.',
      );
      return false;
    } finally {
      setConsentSaving(false);
    }
  }, [consentAccepted, consentReceipt, registerConsentReceipt]);

  const finalizeGoogleCredential = useCallback(
    async (token) => {
      const normalizedToken = String(token || '').trim();
      if (!normalizedToken) {
        setErrorMessage('Falha ao receber token do Google. Tente novamente.');
        return;
      }

      setBusy(true);
      setErrorMessage('');
      setConsentErrorMessage('');
      setAlreadyLoggedVisible(false);
      setPasswordSetupError('');
      setPendingGoogleCredential('');

      try {
        const payload = await api.createSession(buildSessionPayload(normalizedToken, hint));
        const sessionData = payload?.data || {};
        if (!isAuthenticatedGoogleSession(sessionData)) {
          throw new Error('Nao foi possivel criar a sessao Google.');
        }

        setAuthenticated(true);
        setSessionOwnerPhone(String(sessionData?.owner_phone || '').trim());
        const configured = await refreshPasswordSetupState();
        setStatusMessage(
          configured
            ? 'Conta Google detectada'
            : 'Conta Google validada. Crie sua senha para proximos acessos.',
        );
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
    [api, hint, playSuccessCelebration, refreshPasswordSetupState],
  );

  const handleGoogleCredential = useCallback(
    async (credential) => {
      const token = String(credential || '').trim();
      if (!token) {
        setErrorMessage('Falha ao receber token do Google. Tente novamente.');
        setSelectedGoogleAccount(null);
        return;
      }

      setSelectedGoogleAccount(buildGoogleAccountPreview(token));

      if (showLinkGoogleFlow && !consentAccepted) {
        setPendingGoogleCredential(token);
        setStatusMessage('Conta Google selecionada. Aceite os termos para concluir o login.');
        setConsentErrorMessage('');
        return;
      }

      const consentReady = await ensureConsentReceipt();
      if (!consentReady) return;

      await finalizeGoogleCredential(token);
    },
    [consentAccepted, ensureConsentReceipt, finalizeGoogleCredential, showLinkGoogleFlow],
  );

  const handleFinalizeGoogleLogin = useCallback(async () => {
    if (isBusy || consentSaving) return;

    if (!pendingGoogleCredential) {
      setConsentErrorMessage('');
      setErrorMessage('Selecione sua conta Google para continuar.');
      return;
    }

    if (!consentAccepted) {
      setConsentErrorMessage(LOGIN_CONSENT_HINT);
      return;
    }

    setStatusMessage('Concluindo login Google...');
    setErrorMessage('');
    const consentReady = await ensureConsentReceipt();
    if (!consentReady) return;

    await finalizeGoogleCredential(pendingGoogleCredential);
  }, [
    consentAccepted,
    consentSaving,
    ensureConsentReceipt,
    finalizeGoogleCredential,
    isBusy,
    pendingGoogleCredential,
  ]);

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
      setStatusMessage(
        canUseGoogleLogin
          ? 'Verificando conta Google...'
          : 'Abra o WhatsApp do bot para receber seu link de login.',
      );

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
  }, [
    authenticated,
    canUseGoogleLogin,
    clearResizeBinding,
    googleClientId,
    googleEnabled,
    handleGoogleCredential,
    renderGoogleButton,
  ]);

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
    setConsentErrorMessage('');

    if (!accepted) {
      setConsentReceipt(null);
      persistConsentReceiptState(null);
    }
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

    const consentReady = await ensureConsentReceipt();
    if (!consentReady) return;

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
      setPasswordLoginError(
        error?.message ||
          'Credenciais invalidas. Se precisar, use o fluxo de recuperacao/criacao de senha.',
      );
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
      setPasswordRecoveryMessage(
        masked ? `Codigo enviado para ${masked}.` : 'Codigo enviado por e-mail.',
      );
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
    <div className="login-page-container">
      <div className="login-bg-grid" aria-hidden="true"></div>
      <div className="login-bg-orb login-bg-orb-a" aria-hidden="true"></div>
      <div className="login-bg-orb login-bg-orb-b" aria-hidden="true"></div>
      <div className="login-bg-noise" aria-hidden="true"></div>

      <main className="login-shell">
        <div className="login-stage">
          <aside className="login-showcase" aria-label="Visao geral OmniZap">
            <p className="login-showcase-badge">OmniZap Platform</p>
            <h2 className="login-showcase-title">
              Controle seus grupos com automacao inteligente e acesso seguro.
            </h2>
            <p className="login-showcase-subtitle">
              Em desktop, esta area mostra o contexto da plataforma para aproveitar melhor o espaco
              da tela sem poluir o fluxo principal de login.
            </p>

            <div className="login-showcase-grid">
              <article className="login-showcase-item">
                <p className="login-showcase-item-label">Operacao centralizada</p>
                <p className="login-showcase-item-text">
                  Dashboard unico para grupos, catalogo e automacoes.
                </p>
              </article>
              <article className="login-showcase-item">
                <p className="login-showcase-item-label">Seguranca ativa</p>
                <p className="login-showcase-item-text">
                  Cookies protegidos, sessao segura e autenticacao criptografada.
                </p>
              </article>
              <article className="login-showcase-item">
                <p className="login-showcase-item-label">Onboarding rapido</p>
                <p className="login-showcase-item-text">
                  Fluxo com WhatsApp em poucos passos para acelerar o primeiro acesso.
                </p>
              </article>
              <article className="login-showcase-item">
                <p className="login-showcase-item-label">Fallback completo</p>
                <p className="login-showcase-item-text">
                  Google e email/senha disponiveis para continuidade operacional.
                </p>
              </article>
            </div>

            <ol className="login-showcase-flow" aria-label="Passo a passo do login">
              <li>1. Clique em "Entrar com WhatsApp".</li>
              <li>2. Receba o link seguro no WhatsApp.</li>
              <li>3. Confirme o acesso e finalize o login.</li>
              <li>4. Abra o painel e gerencie suas automacoes.</li>
            </ol>

            <div className="login-showcase-links">
              <a
                className="login-showcase-link"
                href=${config.docsUrl}
                target=${docsLinkExternal ? '_blank' : null}
                rel=${docsLinkExternal ? 'noreferrer noopener' : null}
              >
                Ver documentacao
              </a>
              <a
                className="login-showcase-link"
                href=${config.supportUrl}
                target=${supportLinkExternal ? '_blank' : null}
                rel=${supportLinkExternal ? 'noreferrer noopener' : null}
              >
                Falar com suporte
              </a>
            </div>
          </aside>

          <section className="login-card">
            <header className="login-card-header">
              <a href=${config.homePath} className="login-brand" aria-label="Voltar para a home">
                <img
                  src=${config.brandLogo}
                  alt=${config.brandName}
                  className="login-brand-logo"
                  loading="lazy"
                  decoding="async"
                />
                <span className="login-brand-name">${config.brandName}</span>
              </a>
            </header>

            <section className="login-card-body">
              <p className="login-badge">OmniZap Secure Access</p>
              <h1 className="login-title">Entrar no OmniZap</h1>
              <p className="login-subtitle">
                Conecte seu WhatsApp e gerencie seus grupos com automação inteligente.
              </p>

              ${shouldShowStatusCard
                ? html`
                    <article className="login-status-card">
                      <p className="login-status-chip">
                        <span className="login-status-dot"></span>
                        ${statusMessage}
                      </p>
                      <p className="login-helper-text">${hintMessage}</p>

                      ${errorMessage
                        ? html`<p role="alert" className="login-inline-message is-error">
                            ${errorMessage}
                          </p>`
                        : null}
                      ${alreadyLoggedVisible
                        ? html`
                            <div className="login-inline-message is-success">
                              <p className="font-semibold">Voce ja esta logado neste navegador.</p>
                              <p>${alreadyLoggedDetail}</p>
                            </div>
                          `
                        : null}
                    </article>
                  `
                : null}
              ${showDirectWhatsAppOnly
                ? html`
                    <section className="login-method-panel login-method-panel-primary">
                      <div className="login-method-head">
                        <h2>Entrar com WhatsApp</h2>
                        <p>Receba um link seguro no WhatsApp e finalize o acesso.</p>
                      </div>
                      <a
                        className="login-btn-whatsapp login-btn-whatsapp-main"
                        href=${whatsappCtaHref}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        Entrar com WhatsApp
                      </a>
                      <p className="login-helper-text">${whatsappMeta}</p>
                    </section>
                  `
                : null}
              ${showGoogleMethod
                ? html`
                    <section className="login-method-panel" data-method="google">
                      <div className="login-method-head">
                        <h2>Selecione sua conta Google</h2>
                        <p>Depois confirme os termos para finalizar o login com seguranca.</p>
                      </div>

                      ${canUseGoogleLogin
                        ? html`
                            <div ref=${googleAreaRef} className="login-google-area">
                              <div
                                className=${`login-google-slot ${isBusy || consentSaving ? 'is-busy' : ''}`}
                              >
                                <div ref=${googleButtonRef}></div>
                              </div>
                              ${selectedGoogleAccount
                                ? html`
                                    <div className="login-google-account-preview">
                                      ${selectedGoogleAccount.picture
                                        ? html`
                                            <img
                                              src=${selectedGoogleAccount.picture}
                                              alt="Foto do perfil Google selecionado"
                                              className="login-google-account-avatar"
                                              loading="lazy"
                                              referrerPolicy="no-referrer"
                                            />
                                          `
                                        : html`
                                            <span className="login-google-account-avatar login-google-account-avatar-fallback">
                                              ${selectedGoogleAccount.initial}
                                            </span>
                                          `}
                                      <div className="login-google-account-content">
                                        <p className="login-google-account-label">
                                          Conta selecionada
                                        </p>
                                        <p className="login-google-account-name">
                                          ${selectedGoogleAccount.name || 'Conta Google'}
                                        </p>
                                        ${selectedGoogleAccount.email
                                          ? html`
                                              <p className="login-google-account-email">
                                                ${selectedGoogleAccount.email}
                                              </p>
                                            `
                                          : null}
                                      </div>
                                    </div>
                                  `
                                : null}
                              <p className="login-helper-text">
                                ${googleStateMessage ||
                                'Continue com sua conta Google para entrar.'}
                              </p>
                            </div>
                          `
                        : html`
                            <div className="login-inline-message is-warning">
                              <p>
                                Este navegador não recebeu um link válido do WhatsApp para Google.
                              </p>
                            </div>
                          `}
                    </section>
                  `
                : null}
              ${shouldShowConsentCard
                ? html`
                    <article
                      className=${`login-consent-card${consentAccepted ? ' is-accepted' : ''}`}
                    >
                      <label className="login-consent-label">
                        <input
                          type="checkbox"
                          className="login-consent-checkbox"
                          checked=${consentAccepted}
                          disabled=${isBusy || consentSaving}
                          onChange=${onConsentChange}
                        />
                        <span className="login-consent-text">
                          Eu concordo com os
                          <a href=${config.termsUrl} target="_blank" rel="noreferrer noopener"
                            >Termos de Uso</a
                          >
                          , a
                          <a href=${config.privacyUrl} target="_blank" rel="noreferrer noopener"
                            >Politica de Privacidade</a
                          >
                          e a
                          <a href=${config.aupUrl} target="_blank" rel="noreferrer noopener"
                            >Politica de Uso Aceitavel (AUP)</a
                          >.
                        </span>
                      </label>
                      <button
                        type="button"
                        className="login-btn-primary login-consent-submit"
                        disabled=${!pendingGoogleCredential || !consentAccepted || isBusy || consentSaving}
                        onClick=${() => {
                          void handleFinalizeGoogleLogin();
                        }}
                      >
                        ${isBusy || consentSaving ? 'Finalizando...' : 'Finalizar'}
                      </button>
                      ${!isBusy && !consentSaving && !pendingGoogleCredential
                        ? html`<p className="login-consent-helper">
                            Selecione uma conta Google para habilitar a finalizacao.
                          </p>`
                        : null}
                      ${!isBusy &&
                      !consentSaving &&
                      pendingGoogleCredential &&
                      !consentAccepted
                        ? html`<p className="login-consent-helper">
                            Marque os termos para habilitar o botao Finalizar.
                          </p>`
                        : null}
                      ${consentAccepted && hasConsentReceipt
                        ? html`<p className="login-consent-meta">
                            Aceite juridico registrado com hash de versao.
                          </p>`
                        : null}
                      ${consentErrorMessage
                        ? html`<p className="login-field-error">${consentErrorMessage}</p>`
                        : null}
                    </article>
                  `
                : null}
              ${showPasswordMethod
                ? html`
                    <section className="login-method-panel" data-method="password">
                      <div className="login-method-head">
                        <h2>Entrar com Email e Senha</h2>
                        <p>Use sua credencial para acessar rapidamente a conta.</p>
                      </div>

                      <form
                        className="login-form-grid"
                        onSubmit=${(event) => {
                          event.preventDefault();
                          void handlePasswordLoginSubmit();
                        }}
                      >
                        <label className="login-field-group">
                          <span className="login-field-label">Email</span>
                          <span className="login-input-wrap">
                            <span className="login-input-icon" aria-hidden="true">@</span>
                            <input
                              type="email"
                              className="login-input-control"
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
                              placeholder="voce@empresa.com"
                            />
                          </span>
                        </label>

                        <label className="login-field-group">
                          <span className="login-field-label">Senha</span>
                          <span className="login-input-wrap">
                            <span className="login-input-icon" aria-hidden="true">•</span>
                            <input
                              type="password"
                              className="login-input-control"
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
                              placeholder="Sua senha"
                            />
                          </span>
                        </label>

                        ${passwordLoginError
                          ? html`<p role="alert" className="login-field-error">
                              ${passwordLoginError}
                            </p>`
                          : null}

                        <button
                          type="submit"
                          className="login-btn-primary"
                          disabled=${passwordLoginBusy || consentSaving}
                        >
                          ${passwordLoginBusy ? 'Entrando...' : 'Entrar'}
                        </button>
                      </form>

                      <button
                        type="button"
                        className="login-link-button"
                        onClick=${() => {
                          setPasswordRecoveryStep((step) =>
                            step === 'idle' ? 'code_request' : 'idle',
                          );
                          setPasswordRecoveryError('');
                          setPasswordRecoveryMessage('');
                          setPasswordRecoveryForm((current) => ({
                            ...current,
                            email: current.email || String(passwordLoginForm.email || '').trim(),
                          }));
                        }}
                      >
                        Esqueci minha senha
                      </button>

                      ${passwordRecoveryStep !== 'idle'
                        ? html`
                            <div className="login-recovery-card">
                              <p className="login-recovery-title">
                                Recuperação por código (6 dígitos)
                              </p>
                              ${passwordRecoveryMessage
                                ? html`<p className="login-inline-message is-success">
                                    ${passwordRecoveryMessage}
                                  </p>`
                                : null}
                              ${passwordRecoveryError
                                ? html`<p role="alert" className="login-field-error">
                                    ${passwordRecoveryError}
                                  </p>`
                                : null}

                              <div className="login-recovery-grid">
                                <label className="login-field-group">
                                  <span className="login-field-label">Email da conta</span>
                                  <span className="login-input-wrap">
                                    <span className="login-input-icon" aria-hidden="true">@</span>
                                    <input
                                      type="email"
                                      className="login-input-control"
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
                                      placeholder="voce@empresa.com"
                                    />
                                  </span>
                                </label>

                                <label className="login-field-group">
                                  <span className="login-field-label">Código</span>
                                  <span className="login-input-wrap">
                                    <span className="login-input-icon" aria-hidden="true">#</span>
                                    <input
                                      type="text"
                                      inputmode="numeric"
                                      className="login-input-control"
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
                                      placeholder="000000"
                                    />
                                  </span>
                                </label>

                                <label className="login-field-group">
                                  <span className="login-field-label">Nova senha</span>
                                  <span className="login-input-wrap">
                                    <span className="login-input-icon" aria-hidden="true">•</span>
                                    <input
                                      type="password"
                                      className="login-input-control"
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
                                      placeholder="Nova senha"
                                    />
                                  </span>
                                </label>

                                <label className="login-field-group">
                                  <span className="login-field-label">Confirmar senha</span>
                                  <span className="login-input-wrap">
                                    <span className="login-input-icon" aria-hidden="true">•</span>
                                    <input
                                      type="password"
                                      className="login-input-control"
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
                                      placeholder="Repita a senha"
                                    />
                                  </span>
                                </label>
                              </div>

                              <div className="login-recovery-actions">
                                <button
                                  type="button"
                                  className="login-btn-secondary"
                                  disabled=${passwordRecoveryBusy}
                                  onClick=${handleRecoveryRequestSubmit}
                                >
                                  ${passwordRecoveryBusy
                                    ? 'Enviando...'
                                    : 'Enviar código por email'}
                                </button>
                                <button
                                  type="button"
                                  className="login-btn-primary"
                                  disabled=${passwordRecoveryBusy}
                                  onClick=${handleRecoveryVerifySubmit}
                                >
                                  ${passwordRecoveryBusy
                                    ? 'Validando...'
                                    : 'Validar código e criar senha'}
                                </button>
                              </div>
                            </div>
                          `
                        : null}
                    </section>
                  `
                : null}
              ${authenticated && passwordSetupRequired
                ? html`
                    <section className="login-method-panel is-warning">
                      <div className="login-method-head">
                        <h2>Senha ainda não configurada</h2>
                        <p>
                          Para concluir o primeiro acesso, crie sua senha agora. Nos próximos logins
                          você pode entrar direto por email e senha.
                        </p>
                      </div>
                      ${passwordSetupError
                        ? html`<p role="alert" className="login-field-error">
                            ${passwordSetupError}
                          </p>`
                        : null}
                      <div className="login-recovery-grid">
                        <label className="login-field-group">
                          <span className="login-field-label">Nova senha</span>
                          <span className="login-input-wrap">
                            <span className="login-input-icon" aria-hidden="true">•</span>
                            <input
                              type="password"
                              className="login-input-control"
                              name="new_password"
                              value=${passwordSetupForm.password}
                              onInput=${(event) => {
                                const nextValue = String(event.currentTarget?.value || '');
                                setPasswordSetupForm((current) => ({
                                  ...current,
                                  password: nextValue,
                                }));
                              }}
                              autocomplete="new-password"
                              placeholder="Nova senha"
                            />
                          </span>
                        </label>
                        <label className="login-field-group">
                          <span className="login-field-label">Confirmar senha</span>
                          <span className="login-input-wrap">
                            <span className="login-input-icon" aria-hidden="true">•</span>
                            <input
                              type="password"
                              className="login-input-control"
                              name="new_password_confirm"
                              value=${passwordSetupForm.confirm}
                              onInput=${(event) => {
                                const nextValue = String(event.currentTarget?.value || '');
                                setPasswordSetupForm((current) => ({
                                  ...current,
                                  confirm: nextValue,
                                }));
                              }}
                              autocomplete="new-password"
                              placeholder="Repita a senha"
                            />
                          </span>
                        </label>
                      </div>
                      <button
                        type="button"
                        className="login-btn-primary"
                        disabled=${passwordSetupBusy}
                        onClick=${handlePasswordSetupSubmit}
                      >
                        ${passwordSetupBusy ? 'Salvando...' : 'Criar senha agora'}
                      </button>
                    </section>
                  `
                : null}
              ${summary.visible
                ? html`
                    <div
                      className=${`login-inline-message ${summary.state === 'pending' ? 'is-warning' : 'is-success'}`}
                    >
                      <p className="font-semibold">${summary.title}</p>
                      <p>${summary.owner}</p>
                    </div>
                  `
                : null}
              ${authenticated
                ? html`
                    <div className="login-success-actions">
                      <a className="login-btn-primary" href=${successHomeHref}
                        >${DEFAULT_SUCCESS_HOME_LABEL}</a
                      >
                      <a
                        className="login-btn-secondary"
                        href=${successChatHref}
                        target="_blank"
                        rel="noreferrer noopener"
                        >${DEFAULT_SUCCESS_CHAT_LABEL}</a
                      >
                    </div>
                  `
                : null}

              <footer className="login-trust-footer">
                <a
                  className="login-footer-link"
                  href=${config.supportUrl}
                  target=${supportLinkExternal ? '_blank' : null}
                  rel=${supportLinkExternal ? 'noreferrer noopener' : null}
                >
                  Suporte
                </a>
                <a
                  className="login-footer-link"
                  href=${config.docsUrl}
                  target=${docsLinkExternal ? '_blank' : null}
                  rel=${docsLinkExternal ? 'noreferrer noopener' : null}
                >
                  Documentacao
                </a>
                <a
                  className="login-footer-link"
                  href=${config.statusUrl}
                  target=${statusLinkExternal ? '_blank' : null}
                  rel=${statusLinkExternal ? 'noreferrer noopener' : null}
                >
                  Status do sistema
                </a>
              </footer>
            </section>
          </section>
        </div>
      </main>

      <div
        className=${`login-success-overlay${showSuccessCelebration ? ' is-visible' : ''}`}
        aria-live="polite"
        aria-atomic="true"
        aria-hidden=${showSuccessCelebration ? 'false' : 'true'}
      >
        <div className="login-success-card" role="status">
          <div className="login-success-icon" aria-hidden="true">
            <svg className="h-9 w-9" viewBox="0 0 24 24" focusable="false">
              <path className="login-success-check" d="M5 12.5l4.2 4.2L19 7.3" />
            </svg>
          </div>
          <p className="text-lg font-extrabold">Login concluido</p>
          <p className="text-center text-sm text-base-content/80">
            Sua conta foi vinculada com sucesso.
          </p>
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
    aupUrl: normalizeUrlPath(rootElement.dataset.aupUrl, DEFAULT_AUP_URL),
    supportUrl: normalizeUrlPath(rootElement.dataset.supportUrl, DEFAULT_SUPPORT_URL),
    docsUrl: normalizeUrlPath(rootElement.dataset.docsUrl, DEFAULT_DOCS_URL),
    statusUrl: normalizeUrlPath(rootElement.dataset.statusUrl, DEFAULT_STATUS_URL),
    brandName: String(rootElement.dataset.brandName || '').trim() || DEFAULT_BRAND_NAME,
    brandLogo: normalizeUrlPath(rootElement.dataset.brandLogo, DEFAULT_BRAND_LOGO),
  };

  const root = createRoot(rootElement);
  root.render(html`<${LoginApp} config=${config} />`);
}
