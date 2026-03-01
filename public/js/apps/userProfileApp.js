/* global document, window, fetch, URL, URLSearchParams */

const DEFAULT_API_BASE_PATH = '/api/sticker-packs';
const DEFAULT_STICKERS_PATH = '/stickers';
const DEFAULT_LOGIN_PATH = '/login';
const FALLBACK_AVATAR = 'https://iili.io/FC3FABe.jpg';

const root = document.getElementById('user-app-root');

if (root) {
  const ui = {
    status: document.getElementById('user-status'),
    error: document.getElementById('user-error'),
    profile: document.getElementById('user-profile'),
    avatar: document.getElementById('user-avatar'),
    name: document.getElementById('user-name'),
    email: document.getElementById('user-email'),
    whatsapp: document.getElementById('user-whatsapp'),
    grid: document.getElementById('user-grid'),
    metricPacks: document.getElementById('metric-packs'),
    metricStickers: document.getElementById('metric-stickers'),
    metricDownloads: document.getElementById('metric-downloads'),
    metricLikes: document.getElementById('metric-likes'),
    summary: document.getElementById('user-summary'),
    ownerJid: document.getElementById('user-owner-jid'),
    googleSub: document.getElementById('user-google-sub'),
    expiresAt: document.getElementById('user-expires-at'),
    actions: document.getElementById('user-actions'),
    chatLink: document.getElementById('user-chat-link'),
    logoutBtn: document.getElementById('user-logout-btn'),
    manageHeadLink: document.getElementById('user-manage-head-link'),
    manageMainLink: document.getElementById('user-manage-main-link'),
    currentYear: document.getElementById('user-current-year'),
  };

  const state = {
    apiBasePath: String(root.dataset.apiBasePath || DEFAULT_API_BASE_PATH).trim() || DEFAULT_API_BASE_PATH,
    stickersPath: String(root.dataset.stickersPath || DEFAULT_STICKERS_PATH).trim() || DEFAULT_STICKERS_PATH,
    loginPath: String(root.dataset.loginPath || DEFAULT_LOGIN_PATH).trim() || DEFAULT_LOGIN_PATH,
    botPhone: '',
  };

  const sessionApiPath = `${state.apiBasePath}/auth/google/session`;
  const myProfileApiPath = `${state.apiBasePath}/me`;
  const botContactApiPath = `${state.apiBasePath}/bot-contact`;

  const setText = (el, value) => {
    if (!el) return;
    el.textContent = String(value || '');
  };

  const showError = (message) => {
    if (!ui.error) return;
    const safeMessage = String(message || '').trim();
    ui.error.hidden = !safeMessage;
    if (safeMessage) ui.error.textContent = safeMessage;
  };

  const normalizeDigits = (value) => String(value || '').replace(/\D+/g, '');

  const formatPhone = (digits) => {
    const value = normalizeDigits(digits);
    if (!value) return '';
    if (value.length <= 4) return value;
    return `${value.slice(0, 2)} ${value.slice(2, -4)}-${value.slice(-4)}`.trim();
  };

  const formatNumber = (value) =>
    new Intl.NumberFormat('pt-BR', {
      maximumFractionDigits: 0,
    }).format(Math.max(0, Number(value || 0)));

  const formatDateTime = (value) => {
    const ms = Date.parse(String(value || ''));
    if (!Number.isFinite(ms)) return 'n/d';
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(ms));
  };

  const buildLoginRedirectUrl = () => {
    const loginUrl = new URL(state.loginPath, window.location.origin);
    loginUrl.searchParams.set('next', '/user/');
    return `${loginUrl.pathname}${loginUrl.search}`;
  };

  const buildWhatsAppMenuUrl = (phoneDigits) => {
    const params = new URLSearchParams({
      text: '/menu',
      type: 'custom_url',
      app_absent: '0',
    });
    const digits = normalizeDigits(phoneDigits);
    if (digits) params.set('phone', digits);
    return `https://api.whatsapp.com/send/?${params.toString()}`;
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
      throw err;
    }
    return payload || {};
  };

  const redirectToLogin = () => {
    window.location.assign(buildLoginRedirectUrl());
  };

  const loadBotPhone = async () => {
    try {
      const payload = await fetchJson(botContactApiPath, { method: 'GET' });
      state.botPhone = normalizeDigits(payload?.data?.phone || '');
    } catch {
      state.botPhone = '';
    }
    if (ui.chatLink) ui.chatLink.href = buildWhatsAppMenuUrl(state.botPhone);
  };

  const renderSession = (sessionData) => {
    const user = sessionData?.user || {};
    const ownerPhone = String(sessionData?.owner_phone || '').trim();
    const ownerJid = String(sessionData?.owner_jid || '').trim();

    setText(ui.name, user?.name || 'Conta Google');
    setText(ui.email, user?.email || 'Email não disponível');
    if (ownerPhone) {
      setText(ui.whatsapp, `WhatsApp vinculado: +${formatPhone(ownerPhone)}`);
    } else if (ownerJid) {
      setText(ui.whatsapp, `WhatsApp vinculado via owner: ${ownerJid}`);
    } else {
      setText(ui.whatsapp, 'WhatsApp não vinculado.');
    }

    if (ui.avatar) {
      const picture = String(user?.picture || '').trim() || FALLBACK_AVATAR;
      ui.avatar.src = picture;
      ui.avatar.onerror = () => {
        ui.avatar.src = FALLBACK_AVATAR;
      };
    }

    setText(ui.ownerJid, ownerJid || 'n/d');
    setText(ui.googleSub, String(user?.sub || '').trim() || 'n/d');
    setText(ui.expiresAt, formatDateTime(sessionData?.expires_at));

    if (ui.profile) ui.profile.hidden = false;
    if (ui.summary) ui.summary.hidden = false;
    if (ui.actions) ui.actions.hidden = false;
  };

  const renderPackMetrics = (payload) => {
    const data = payload?.data || {};
    const packs = Array.isArray(data?.packs) ? data.packs : [];
    const stats = data?.stats && typeof data.stats === 'object' ? data.stats : {};

    let stickers = 0;
    let downloads = 0;
    let likes = 0;

    for (const pack of packs) {
      stickers += Number(pack?.sticker_count || 0);
      downloads += Number(pack?.engagement?.open_count || 0);
      likes += Number(pack?.engagement?.like_count || 0);
    }

    setText(ui.metricPacks, formatNumber(stats.total || packs.length));
    setText(ui.metricStickers, formatNumber(stickers));
    setText(ui.metricDownloads, formatNumber(downloads));
    setText(ui.metricLikes, formatNumber(likes));
    if (ui.grid) ui.grid.hidden = false;
  };

  const handleLogout = async () => {
    if (!ui.logoutBtn) return;
    ui.logoutBtn.disabled = true;
    ui.logoutBtn.textContent = 'Encerrando...';
    try {
      await fetchJson(sessionApiPath, { method: 'DELETE' });
    } catch {
      // no-op
    }
    window.location.assign(`${state.loginPath}/`);
  };

  const init = async () => {
    const manageHref = `${state.stickersPath.replace(/\/+$/, '') || DEFAULT_STICKERS_PATH}/perfil`;
    if (ui.manageHeadLink) ui.manageHeadLink.href = manageHref;
    if (ui.manageMainLink) ui.manageMainLink.href = manageHref;
    if (ui.currentYear) ui.currentYear.textContent = String(new Date().getFullYear());

    setText(ui.status, 'Validando sua sessão...');
    showError('');

    let sessionData = null;
    try {
      const sessionPayload = await fetchJson(sessionApiPath, { method: 'GET' });
      sessionData = sessionPayload?.data || {};
      if (!sessionData?.authenticated || !sessionData?.user?.sub) {
        redirectToLogin();
        return;
      }
    } catch (error) {
      showError(error?.message || 'Falha ao validar sessão.');
      setText(ui.status, 'Não foi possível validar sua sessão agora.');
      return;
    }

    renderSession(sessionData);
    await loadBotPhone();

    try {
      const myProfilePayload = await fetchJson(myProfileApiPath, { method: 'GET' });
      const sessionOk = Boolean(myProfilePayload?.data?.session?.authenticated);
      if (!sessionOk) {
        redirectToLogin();
        return;
      }
      renderPackMetrics(myProfilePayload);
      setText(ui.status, 'Sessão ativa. Dados da sua conta carregados com sucesso.');
    } catch (error) {
      showError(error?.message || 'Falha ao carregar dados da conta.');
      setText(ui.status, 'Sessão ativa, mas não foi possível carregar todos os dados.');
    }
  };

  if (ui.logoutBtn) {
    ui.logoutBtn.addEventListener('click', () => {
      void handleLogout();
    });
  }

  void init();
}
