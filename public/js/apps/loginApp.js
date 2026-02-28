/* global document, window, fetch, URLSearchParams */

const GOOGLE_GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const DEFAULT_API_BASE_PATH = '/api/sticker-packs';

const root = document.getElementById('login-app-root');

if (root) {
  const ui = {
    status: document.getElementById('login-status'),
    hint: document.getElementById('login-hint'),
    error: document.getElementById('login-error'),
    googleArea: document.getElementById('google-login-area'),
    googleButton: document.querySelector('[data-google-login-button]'),
    googleState: document.getElementById('google-login-state'),
    summary: document.getElementById('login-summary'),
    summaryOwner: document.getElementById('login-summary-owner'),
    whatsappCta: document.getElementById('whatsapp-cta'),
    whatsappCtaLink: document.getElementById('whatsapp-cta-link'),
    whatsappCtaMeta: document.getElementById('whatsapp-cta-meta'),
    successActions: document.getElementById('login-success-actions'),
    successChat: document.getElementById('login-success-chat'),
    successHome: document.getElementById('login-success-home'),
  };

  const state = {
    apiBasePath: String(root.dataset.apiBasePath || DEFAULT_API_BASE_PATH).trim() || DEFAULT_API_BASE_PATH,
    googleClientId: '',
    googleEnabled: false,
    googleReady: false,
    busy: false,
    authenticated: false,
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

  const normalizeDigits = (value) => String(value || '').replace(/\D+/g, '');

  const showError = (message) => {
    if (!ui.error) return;
    const safe = String(message || '').trim();
    ui.error.hidden = !safe;
    if (safe) ui.error.textContent = safe;
  };

  const setBusy = (value) => {
    state.busy = Boolean(value);
    if (ui.googleButton) {
      ui.googleButton.style.opacity = state.busy ? '0.55' : '1';
      ui.googleButton.style.pointerEvents = state.busy ? 'none' : 'auto';
    }
    setText(ui.googleState, state.busy ? 'Finalizando login...' : state.googleReady ? '' : 'Carregando login Google...');
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

  const renderSuccessActions = (sessionData) => {
    if (!ui.successActions) return;
    const authenticated = Boolean(sessionData?.authenticated);
    ui.successActions.hidden = !authenticated;
    if (!authenticated) return;

    if (ui.successChat) {
      ui.successChat.href = buildWhatsappMenuUrl(state.botPhone);
    }
    if (ui.successHome) {
      ui.successHome.href = '/';
    }
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
      setText(
        ui.hint,
        'Voce abriu esta pagina direto. Por seguranca, gere seu link no WhatsApp clicando no botao abaixo e enviando "iniciar".',
      );
      return;
    }

    if (!state.hint.phone) {
      setText(
        ui.hint,
        'Este link nao trouxe um numero de WhatsApp valido. Ele pode ter sido alterado ou expirado. Gere um novo link enviando "iniciar".',
      );
      return;
    }

    setText(ui.hint, `Numero detectado para vinculo: +${formatPhone(state.hint.phone)}.`);
  };

  const renderSessionSummary = (sessionData) => {
    if (!canUseGoogleLogin()) {
      state.authenticated = false;
      state.sessionOwnerPhone = '';
      if (ui.summary) ui.summary.hidden = true;
      renderSuccessActions(null);
      renderWhatsAppCta();
      return;
    }

    const authenticated = Boolean(sessionData?.authenticated);
    state.authenticated = authenticated;
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
      setText(ui.summaryOwner, `WhatsApp vinculado: +${formatPhone(ownerPhone)}`);
      renderWhatsAppCta();
      return;
    }

    if (state.hint.phone) {
      setText(
        ui.summaryOwner,
        `Numero detectado: +${formatPhone(state.hint.phone)}. Clique no botao do Google para concluir o vinculo.`,
      );
      renderWhatsAppCta();
      return;
    }

    setText(ui.summaryOwner, 'Conta Google ativa. Vincule o WhatsApp abrindo o link pelo "iniciar".');
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

  const handleGoogleCredential = async (credential) => {
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
      if (!sessionData?.authenticated) {
        throw new Error('Nao foi possivel criar a sessao Google.');
      }
      setText(ui.status, 'Login concluido. Seu acesso foi vinculado com sucesso.');
      renderSessionSummary(sessionData);
      setText(ui.googleState, 'Login Google ativo.');
    } catch (error) {
      showError(error?.message || 'Falha ao concluir login Google.');
      setText(ui.status, 'Nao foi possivel concluir o login agora.');
      renderSessionSummary(null);
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
      const measuredWidth = Math.floor(Number(ui.googleButton.clientWidth || 0));
      const buttonWidth = Math.max(180, Math.min(320, measuredWidth || 320));
      accounts.renderButton(ui.googleButton, {
        type: 'standard',
        theme: 'filled_black',
        size: 'large',
        text: 'signin_with',
        shape: 'pill',
        width: buttonWidth,
      });

      state.googleReady = true;
      setText(ui.googleState, '');
    } catch (error) {
      state.googleReady = false;
      setText(ui.googleState, '');
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
    if (!canUseGoogleLogin()) {
      renderSessionSummary(null);
      return;
    }
    try {
      const payload = await fetchJson(sessionApiPath, { method: 'GET' });
      const sessionData = payload?.data || {};
      if (sessionData?.authenticated) {
        setText(ui.status, 'Sessao Google ativa neste navegador.');
        renderSessionSummary(sessionData);
      } else {
        setText(ui.status, 'Use o login Google abaixo para entrar no OmniZap.');
        renderSessionSummary(null);
      }
    } catch {
      setText(ui.status, 'Nao foi possivel validar sua sessao atual.');
      renderSessionSummary(null);
    }
  };

  const renderGoogleLoginGate = () => {
    const allowed = canUseGoogleLogin();
    if (ui.googleArea) {
      ui.googleArea.hidden = !allowed;
    }
    if (!allowed) {
      setText(ui.status, 'Para fazer login, abra esta pagina pelo link do WhatsApp (envie "iniciar" no bot).');
      setText(ui.googleState, '');
      if (ui.summary) ui.summary.hidden = true;
      renderSuccessActions(null);
      showError('');
    }
    return allowed;
  };

  const init = async () => {
    renderHint();
    if (ui.whatsappCta && state.hint.phone) {
      ui.whatsappCta.hidden = true;
    }
    renderWhatsAppCta();
    renderSuccessActions(null);
    const allowGoogleLogin = renderGoogleLoginGate();
    await loadBotPhone();
    if (!allowGoogleLogin) return;
    await loadConfig();
    await loadCurrentSession();
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
