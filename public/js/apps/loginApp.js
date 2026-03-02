/* global document, window, fetch, URLSearchParams */

const GOOGLE_GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const DEFAULT_API_BASE_PATH = '/api/sticker-packs';
const LOGIN_CONSENT_STORAGE_KEY = 'omnizap_login_terms_consent_v1';
const LOGIN_CONSENT_HINT = 'Aceite os Termos de Uso e a Politica de Privacidade para continuar.';
const DEFAULT_SUCCESS_CHAT_LABEL = 'Abrir WhatsApp do bot';
const DEFAULT_SUCCESS_HOME_LABEL = 'Ir para o painel';
const ALREADY_LOGGED_HINT_TEXT = 'Nao e necessario fazer login novamente. Escolha uma opcao abaixo.';

const root = document.getElementById('login-app-root');

if (root) {
  const ui = {
    loginCard: document.getElementById('login-main-card'),
    status: document.getElementById('login-status'),
    hint: document.getElementById('login-hint'),
    error: document.getElementById('login-error'),
    googleArea: document.getElementById('google-login-area'),
    googleButtonShell: document.getElementById('google-login-button-shell'),
    googleButton: document.querySelector('[data-google-login-button]'),
    googleState: document.getElementById('google-login-state'),
    consentBox: document.getElementById('login-consent-box'),
    consentCheckbox: document.getElementById('login-consent-checkbox'),
    consentError: document.getElementById('login-consent-error'),
    alreadyLoggedBanner: document.getElementById('already-logged-banner'),
    alreadyLoggedTitle: document.getElementById('already-logged-title'),
    alreadyLoggedDetail: document.getElementById('already-logged-detail'),
    summary: document.getElementById('login-summary'),
    summaryTitle: document.getElementById('login-summary-title'),
    summaryOwner: document.getElementById('login-summary-owner'),
    whatsappCta: document.getElementById('whatsapp-cta'),
    whatsappCtaLink: document.getElementById('whatsapp-cta-link'),
    whatsappCtaMeta: document.getElementById('whatsapp-cta-meta'),
    successActions: document.getElementById('login-success-actions'),
    successChat: document.getElementById('login-success-chat'),
    successHome: document.getElementById('login-success-home'),
    successCelebration: document.getElementById('login-success-celebration'),
  };

  const state = {
    apiBasePath: String(root.dataset.apiBasePath || DEFAULT_API_BASE_PATH).trim() || DEFAULT_API_BASE_PATH,
    googleClientId: '',
    googleEnabled: false,
    googleReady: false,
    busy: false,
    authenticated: false,
    consentAccepted: false,
    successAnimationTimer: 0,
    botPhone: '',
    sessionOwnerPhone: '',
    hint: readWhatsAppHintFromUrl(window.location.search),
  };

  const sessionApiPath = `${state.apiBasePath}/auth/google/session`;
  const createConfigPath = `${state.apiBasePath}/create-config`;

  const setText = (element, value) => {
    if (!element) return;
    element.textContent = String(value || '');
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

  const normalizeDigits = (value) => String(value || '').replace(/\D+/g, '');

  const showError = (message) => {
    if (!ui.error) return;
    const safe = String(message || '').trim();
    ui.error.hidden = !safe;
    if (safe) ui.error.textContent = safe;
  };

  const showConsentError = (message) => {
    if (!ui.consentError) return;
    const safe = String(message || '').trim();
    ui.consentError.hidden = !safe;
    if (safe) ui.consentError.textContent = safe;
  };

  const persistConsentState = (accepted) => {
    try {
      if (accepted) {
        window.localStorage.setItem(LOGIN_CONSENT_STORAGE_KEY, '1');
      } else {
        window.localStorage.removeItem(LOGIN_CONSENT_STORAGE_KEY);
      }
    } catch {
      // Ignore storage errors (private mode or blocked storage).
    }
  };

  const readConsentState = () => {
    try {
      return window.localStorage.getItem(LOGIN_CONSENT_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  };

  const hideSuccessCelebration = () => {
    if (!ui.successCelebration) return;
    ui.successCelebration.classList.remove('is-visible');
    window.setTimeout(() => {
      if (!ui.successCelebration?.classList.contains('is-visible')) {
        ui.successCelebration.hidden = true;
      }
    }, 320);
  };

  const playSuccessCelebration = () => {
    if (!ui.successCelebration) return;
    if (state.successAnimationTimer) {
      window.clearTimeout(state.successAnimationTimer);
      state.successAnimationTimer = 0;
    }

    ui.successCelebration.hidden = false;
    ui.successCelebration.classList.remove('is-visible');
    void ui.successCelebration.offsetWidth;
    ui.successCelebration.classList.add('is-visible');

    state.successAnimationTimer = window.setTimeout(() => {
      hideSuccessCelebration();
      state.successAnimationTimer = 0;
    }, 2300);
  };

  const setBusy = (value) => {
    state.busy = Boolean(value);
    if (ui.googleButton) {
      const canInteract = !state.busy && state.consentAccepted;
      ui.googleButton.style.opacity = canInteract ? '1' : '0.55';
      ui.googleButton.style.pointerEvents = canInteract ? 'auto' : 'none';
    }
    setText(ui.googleState, state.busy ? 'Finalizando login...' : state.consentAccepted ? (state.googleReady ? '' : 'Carregando login Google...') : LOGIN_CONSENT_HINT);
  };

  const renderGoogleLoginControls = () => {
    const hideLoginControls = state.authenticated;
    if (ui.consentBox) {
      ui.consentBox.hidden = hideLoginControls;
    }
    if (ui.googleButtonShell) {
      ui.googleButtonShell.hidden = hideLoginControls || !state.consentAccepted;
    }
  };

  const renderLoginCardVisibility = () => {
    if (!ui.loginCard) return;
    ui.loginCard.hidden = Boolean(state.authenticated);
  };

  const resolveGoogleButtonWidth = () => {
    const directWidth = Math.floor(Number(ui.googleButton?.clientWidth || 0));
    if (directWidth > 0) {
      return Math.max(180, Math.min(320, directWidth));
    }

    const areaWidth = Math.floor(Number(ui.googleArea?.clientWidth || 0));
    if (areaWidth > 0) {
      const areaStyles = ui.googleArea ? window.getComputedStyle(ui.googleArea) : null;
      const shellStyles = ui.googleButtonShell ? window.getComputedStyle(ui.googleButtonShell) : null;
      const areaPaddingX = areaStyles ? Number.parseFloat(areaStyles.paddingLeft || '0') + Number.parseFloat(areaStyles.paddingRight || '0') : 0;
      const shellPaddingX = shellStyles ? Number.parseFloat(shellStyles.paddingLeft || '0') + Number.parseFloat(shellStyles.paddingRight || '0') : 16;
      const shellBorderX = shellStyles ? Number.parseFloat(shellStyles.borderLeftWidth || '0') + Number.parseFloat(shellStyles.borderRightWidth || '0') : 2;
      const available = Math.floor(areaWidth - areaPaddingX - shellPaddingX - shellBorderX);
      if (available > 0) {
        return Math.max(180, Math.min(320, available));
      }
    }

    const viewportAvailable = Math.floor(Number(window.innerWidth || 0)) - 96;
    if (viewportAvailable > 0) {
      return Math.max(180, Math.min(320, viewportAvailable));
    }
    return 280;
  };

  const formatPhone = (digits) => {
    const value = normalizeDigits(digits);
    if (!value) return '';
    if (value.length <= 4) return value;
    return `${value.slice(0, 2)} ${value.slice(2, -4)}-${value.slice(-4)}`.trim();
  };

  const buildWhatsappStartUrl = (phoneDigits) => {
    const command = 'iniciar';
    const digits = normalizeDigits(phoneDigits);
    const params = new URLSearchParams({
      text: command,
      type: 'custom_url',
      app_absent: '0',
    });
    if (digits) params.set('phone', digits);
    return `https://api.whatsapp.com/send/?${params.toString()}`;
  };

  const buildWhatsappMenuUrl = (phoneDigits) => {
    const command = '/menu';
    const digits = normalizeDigits(phoneDigits);
    const params = new URLSearchParams({
      text: command,
      type: 'custom_url',
      app_absent: '0',
    });
    if (digits) params.set('phone', digits);
    return `https://api.whatsapp.com/send/?${params.toString()}`;
  };

  const extractPhoneFromJid = (jid) => {
    const raw = String(jid || '').trim();
    if (!raw.includes('@')) return '';
    const userPart = raw.split('@')[0] || '';
    const user = userPart.split(':')[0] || '';
    return normalizeDigits(user);
  };

  const canUseGoogleLogin = () => Boolean(state.hint.phone);

  const renderSuccessActions = (sessionData, options = {}) => {
    if (!ui.successActions) return;
    const authenticated = isAuthenticatedFlagEnabled(sessionData?.authenticated);
    ui.successActions.hidden = !authenticated;
    if (!authenticated) return;

    const chatLabel = String(options.chatLabel || DEFAULT_SUCCESS_CHAT_LABEL);
    const homeLabel = String(options.homeLabel || DEFAULT_SUCCESS_HOME_LABEL);
    const homeHref = String(options.homeHref || '/user/');

    if (ui.successChat) {
      ui.successChat.href = buildWhatsappMenuUrl(state.botPhone);
      setText(ui.successChat, chatLabel);
    }
    if (ui.successHome) {
      ui.successHome.href = homeHref;
      setText(ui.successHome, homeLabel);
    }
  };

  const renderAlreadyLoggedBanner = ({ visible = false, ownerPhone = '' } = {}) => {
    if (!ui.alreadyLoggedBanner) return;
    ui.alreadyLoggedBanner.hidden = !visible;
    if (!visible) return;
    setText(ui.alreadyLoggedTitle, 'Voce ja esta logado neste navegador.');
    if (ownerPhone) {
      setText(ui.alreadyLoggedDetail, `Sessao ativa para +${formatPhone(ownerPhone)}. Nao e necessario fazer login novamente.`);
      return;
    }
    setText(ui.alreadyLoggedDetail, ALREADY_LOGGED_HINT_TEXT);
  };

  const renderAlreadyLoggedInState = (sessionData) => {
    const ownerPhone = String(sessionData?.owner_phone || '').trim();
    state.authenticated = true;
    state.sessionOwnerPhone = ownerPhone;

    showError('');
    showConsentError('');
    hideSuccessCelebration();
    renderSessionSummary(sessionData);
  };

  const renderWhatsAppCta = () => {
    if (!ui.whatsappCta || !ui.whatsappCtaLink) return;

    if (state.hint.phone) {
      ui.whatsappCta.hidden = true;
      return;
    }

    if (state.sessionOwnerPhone) {
      ui.whatsappCta.hidden = true;
      return;
    }

    if (state.authenticated) {
      ui.whatsappCta.hidden = true;
      return;
    }

    ui.whatsappCta.hidden = false;

    ui.whatsappCtaLink.href = buildWhatsappStartUrl(state.botPhone);
    if (state.botPhone) {
      setText(ui.whatsappCtaMeta, `Bot detectado: +${formatPhone(state.botPhone)}.`);
    } else {
      setText(ui.whatsappCtaMeta, 'Se necessário, escolha o contato do bot no WhatsApp e envie "iniciar".');
    }
  };

  const renderHint = () => {
    if (!state.hint.hasPayload) {
      setText(ui.hint, 'Abra o link que o bot envia no WhatsApp para liberar o login neste navegador.');
      return;
    }

    if (!state.hint.phone) {
      setText(ui.hint, 'Este link nao tem um numero valido. Gere um novo enviando "iniciar" no bot.');
      return;
    }

    setText(ui.hint, `Numero detectado: +${formatPhone(state.hint.phone)}.`);
  };

  const renderSessionSummary = (sessionData) => {
    renderAlreadyLoggedBanner({ visible: false });
    if (!canUseGoogleLogin()) {
      state.authenticated = false;
      state.sessionOwnerPhone = '';
      renderGoogleLoginControls();
      renderLoginCardVisibility();
      if (ui.summary) ui.summary.hidden = true;
      renderSuccessActions(null);
      renderWhatsAppCta();
      return;
    }

    const authenticated = isAuthenticatedGoogleSession(sessionData);
    state.authenticated = authenticated;
    renderGoogleLoginControls();
    renderLoginCardVisibility();
    renderSuccessActions(sessionData);
    if (ui.summary) ui.summary.hidden = !authenticated;
    if (!authenticated) {
      state.sessionOwnerPhone = '';
      renderWhatsAppCta();
      return;
    }

    const ownerPhone = String(sessionData?.owner_phone || '').trim();
    state.sessionOwnerPhone = ownerPhone;
    if (ownerPhone) {
      if (ui.summary) ui.summary.dataset.state = 'ok';
      setText(ui.summaryTitle, 'WhatsApp conectado');
      setText(ui.summaryOwner, `+${formatPhone(ownerPhone)}`);
      renderWhatsAppCta();
      return;
    }

    if (state.hint.phone) {
      if (ui.summary) ui.summary.dataset.state = 'pending';
      setText(ui.summaryTitle, 'Vinculo em andamento');
      setText(ui.summaryOwner, `Numero detectado: +${formatPhone(state.hint.phone)}`);
      renderWhatsAppCta();
      return;
    }

    if (ui.summary) ui.summary.dataset.state = 'ok';
    setText(ui.summaryTitle, 'Conta ativa');
    setText(ui.summaryOwner, 'Abra o link do WhatsApp para concluir o vinculo.');
    renderWhatsAppCta();
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
      const err = new Error(payload?.error || `Falha HTTP ${response.status}`);
      err.statusCode = response.status;
      err.payload = payload;
      throw err;
    }
    return payload || {};
  };

  const buildSessionPayload = (googleCredential) => {
    const payload = {
      google_id_token: String(googleCredential || '').trim(),
    };

    if (state.hint.phone) {
      payload.wa = state.hint.phone;
      if (state.hint.ts) payload.wa_ts = state.hint.ts;
      if (state.hint.sig) payload.wa_sig = state.hint.sig;
    }

    return payload;
  };

  const syncConsentState = () => {
    state.consentAccepted = Boolean(ui.consentCheckbox?.checked);
    persistConsentState(state.consentAccepted);
    if (ui.consentBox) {
      ui.consentBox.classList.toggle('is-checked', state.consentAccepted);
    }
    if (state.consentAccepted) {
      showConsentError('');
    }
    renderGoogleLoginControls();
    setBusy(state.busy);
  };

  const handleGoogleCredential = async (credential) => {
    if (!state.consentAccepted) {
      showConsentError(LOGIN_CONSENT_HINT);
      setBusy(false);
      return;
    }

    const token = String(credential || '').trim();
    if (!token) {
      showError('Falha ao receber token do Google. Tente novamente.');
      return;
    }

    setBusy(true);
    showError('');
    try {
      const sessionPayload = await fetchJson(sessionApiPath, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(buildSessionPayload(token)),
      });
      const sessionData = sessionPayload?.data || {};
      if (!isAuthenticatedGoogleSession(sessionData)) {
        throw new Error('Nao foi possivel criar a sessao Google.');
      }
      setText(ui.status, 'Conta Google detectada');
      renderSessionSummary(sessionData);
      setText(ui.googleState, 'Login Google ativo.');
      playSuccessCelebration();
    } catch (error) {
      showError(error?.message || 'Falha ao concluir login Google.');
      setText(ui.status, 'Falha ao validar conta Google');
      renderSessionSummary(null);
      hideSuccessCelebration();
    } finally {
      setBusy(false);
    }
  };

  const loadGoogleScript = () =>
    new Promise((resolve, reject) => {
      if (window.google?.accounts?.id) {
        resolve(window.google.accounts.id);
        return;
      }

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
    });

  const mountGoogleButton = async () => {
    if (!canUseGoogleLogin()) return;
    if (!state.googleEnabled || !state.googleClientId) {
      setText(ui.googleState, 'Login Google desabilitado neste ambiente.');
      return;
    }
    if (!ui.googleButton) return;

    setText(ui.googleState, 'Carregando login Google...');
    try {
      const accounts = await loadGoogleScript();
      if (!accounts) throw new Error('SDK Google nao disponivel.');

      accounts.initialize({
        client_id: state.googleClientId,
        callback: (response) => {
          void handleGoogleCredential(response?.credential);
        },
        auto_select: false,
        cancel_on_tap_outside: true,
      });

      ui.googleButton.innerHTML = '';
      const buttonWidth = resolveGoogleButtonWidth();
      accounts.renderButton(ui.googleButton, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'pill',
        width: buttonWidth,
      });

      state.googleReady = true;
      setBusy(state.busy);
    } catch (error) {
      state.googleReady = false;
      setBusy(state.busy);
      showError(error?.message || 'Falha ao carregar login Google.');
    }
  };

  const loadConfig = async () => {
    try {
      const payload = await fetchJson(createConfigPath, { method: 'GET' });
      const google = payload?.data?.auth?.google || {};
      state.googleEnabled = Boolean(google.enabled);
      state.googleClientId = String(google.client_id || '').trim();
    } catch {
      state.googleEnabled = false;
      state.googleClientId = '';
    }
  };

  const loadBotPhone = async () => {
    let phone = '';
    try {
      const contactPayload = await fetchJson(`${state.apiBasePath}/bot-contact`, { method: 'GET' });
      phone = normalizeDigits(contactPayload?.data?.phone || '');
    } catch {
      phone = '';
    }

    try {
      if (!phone) {
        const summaryPayload = await fetchJson(`${state.apiBasePath}/system-summary`, { method: 'GET' });
        const botPhone = normalizeDigits(summaryPayload?.data?.bot?.phone || '');
        if (botPhone) {
          phone = botPhone;
        } else {
          const botJid = String(summaryPayload?.data?.bot?.jid || '').trim();
          phone = extractPhoneFromJid(botJid);
        }
      }
    } catch {
      if (!phone) phone = '';
    }

    if (!phone) {
      try {
        const payload = await fetchJson(`${state.apiBasePath}?visibility=public&limit=1`, { method: 'GET' });
        const firstPack = Array.isArray(payload?.data) ? payload.data[0] : null;
        phone = normalizeDigits(firstPack?.whatsapp?.phone || '');
      } catch {
        phone = '';
      }
    }

    state.botPhone = phone;
    renderWhatsAppCta();
    renderSuccessActions({ authenticated: Boolean(state.sessionOwnerPhone) });
  };

  const loadCurrentSession = async () => {
    try {
      const payload = await fetchJson(sessionApiPath, { method: 'GET' });
      const sessionData = payload?.data || {};
      if (isAuthenticatedGoogleSession(sessionData)) {
        renderAlreadyLoggedInState(sessionData);
        return true;
      }
      if (canUseGoogleLogin()) {
        setText(ui.status, 'Entre com Google para continuar');
      } else {
        state.authenticated = false;
        state.sessionOwnerPhone = '';
      }
      renderSessionSummary(null);
    } catch {
      if (canUseGoogleLogin()) {
        setText(ui.status, 'Nao foi possivel validar sua sessao');
      }
      renderSessionSummary(null);
    }
    return false;
  };

  const renderGoogleLoginGate = () => {
    const allowed = canUseGoogleLogin();
    if (ui.googleArea) {
      ui.googleArea.hidden = !allowed;
    }
    renderGoogleLoginControls();
    if (!allowed) {
      renderAlreadyLoggedBanner({ visible: false });
    }
    if (!allowed) {
      setText(ui.status, 'Abra o link enviado no WhatsApp para continuar');
      setText(ui.googleState, '');
      if (ui.summary) ui.summary.hidden = true;
      renderSuccessActions(null);
      showError('');
    }
    return allowed;
  };

  const init = async () => {
    renderAlreadyLoggedBanner({ visible: false });
    if (ui.consentCheckbox) {
      ui.consentCheckbox.checked = readConsentState();
      ui.consentCheckbox.addEventListener('change', syncConsentState);
    }
    syncConsentState();
    renderHint();
    if (ui.whatsappCta && state.hint.phone) {
      ui.whatsappCta.hidden = true;
    }
    renderWhatsAppCta();
    renderSuccessActions(null);
    const allowGoogleLogin = renderGoogleLoginGate();
    await loadBotPhone();
    if (!allowGoogleLogin) {
      renderSessionSummary(null);
      return;
    }
    const alreadyLogged = await loadCurrentSession();
    if (alreadyLogged) return;
    await loadConfig();
    await mountGoogleButton();
  };

  void init();
}

function readWhatsAppHintFromUrl(search) {
  const params = new URLSearchParams(search || '');
  const phone = String(params.get('wa') || '').replace(/\D+/g, '');
  const ts = String(params.get('wa_ts') || '').trim();
  const sig = String(params.get('wa_sig') || '').trim();
  const hasPayload = Boolean(phone || ts || sig);
  return {
    hasPayload,
    phone,
    ts,
    sig,
  };
}
