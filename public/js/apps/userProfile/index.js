/* global document, window */

import { createUserProfileApi } from './api.js';
import { buildLoginRedirectPath, buildSupportWhatsAppUrl, buildWhatsAppUrl, normalizeDigits } from './actions.js';
import { activateTab, createUserProfileUi, renderBaseLinks, renderError, renderQuickActions, renderSidebarState, renderStatus, renderSummary, renderSupportInfo } from './render.js';
import { createUserProfileState } from './state.js';

const resolveAuthenticatedSession = (payload) => {
  const session = payload?.data?.session || null;
  return session && session.authenticated ? session : null;
};

const resolveLogoutPath = (loginPath) => {
  const safe = String(loginPath || '/login').trim() || '/login';
  return safe.endsWith('/') ? safe : `${safe}/`;
};

export const initUserProfileApp = () => {
  const root = document.getElementById('user-app-root');
  if (!root) return;

  const state = createUserProfileState(root);
  const ui = createUserProfileUi(root);
  const api = createUserProfileApi(state);
  const mobileViewport = window.matchMedia('(max-width: 1020px)');

  const redirectToLogin = () => {
    window.location.assign(buildLoginRedirectPath(state.loginPath));
  };

  const setFailure = (message) => {
    state.lastFailedScope = 'summary';
    renderError(ui, message, { showRetry: true });
    renderStatus(ui, 'Não foi possível concluir a leitura dos dados.', 'warning');
  };

  const clearFailure = () => {
    state.lastFailedScope = null;
    renderError(ui, '', { showRetry: false });
  };

  const setSidebarOpen = (open) => {
    state.sidebarOpen = Boolean(open);
    renderSidebarState(root, ui, state.sidebarOpen);
  };

  const toggleSidebar = () => {
    setSidebarOpen(!state.sidebarOpen);
  };

  const closeSidebarOnMobile = () => {
    if (mobileViewport.matches) setSidebarOpen(false);
  };

  const loadContactActions = async () => {
    const [botResult, supportResult] = await Promise.allSettled([api.fetchBotContact(), api.fetchSupport()]);

    let botUrl = buildWhatsAppUrl(state.botPhone, '/menu');
    if (botResult.status === 'fulfilled') {
      const botData = botResult.value?.data || {};
      const botPhone = normalizeDigits(botData?.phone || '');
      const preferredMenuUrl = String(botData?.urls?.menu || '').trim();
      if (botPhone) state.botPhone = botPhone;
      botUrl = preferredMenuUrl || buildWhatsAppUrl(state.botPhone, '/menu');
    }

    let supportUrl = state.termsUrl;
    if (supportResult.status === 'fulfilled') {
      const supportData = supportResult.value?.data || {};
      state.supportPhone = normalizeDigits(supportData?.phone || '');
      state.supportText = String(supportData?.text || '').trim();
      const preferredSupportUrl = String(supportData?.url || '').trim();
      supportUrl = preferredSupportUrl || buildSupportWhatsAppUrl(state.supportPhone, state.supportText) || state.termsUrl;
      state.supportUrl = supportUrl;
      renderSupportInfo(ui, {
        phone: state.supportPhone,
        text: state.supportText,
      });
    } else {
      renderSupportInfo(ui, {
        phone: '',
        text: 'Contato de suporte indisponível no momento.',
      });
      state.supportUrl = state.termsUrl;
    }

    renderQuickActions(ui, { botUrl, supportUrl: state.supportUrl || supportUrl || state.termsUrl });
  };

  const loadSummary = async () => {
    renderStatus(ui, 'Validando sessão e carregando resumo da conta...', 'loading');
    clearFailure();

    let summaryPayload;
    try {
      summaryPayload = await api.fetchSummary();
    } catch (error) {
      setFailure(error?.message || 'Falha ao carregar resumo da conta.');
      return;
    }

    const activeSession = resolveAuthenticatedSession(summaryPayload);
    if (!activeSession) {
      redirectToLogin();
      return;
    }

    renderSummary(ui, state, summaryPayload);
    state.summaryLoaded = true;
    renderStatus(ui, 'Resumo da conta carregado com sucesso.', 'success');

    void loadContactActions();
  };

  const handleRetry = () => {
    void loadSummary();
  };

  const handleLogout = async () => {
    if (!ui.logoutBtn) return;
    ui.logoutBtn.disabled = true;
    ui.logoutBtn.textContent = 'Encerrando...';
    try {
      await api.logout();
    } catch {
      // no-op
    }
    window.location.assign(resolveLogoutPath(state.loginPath));
  };

  const handleTabClick = (tabName) => {
    state.activeTab = tabName;
    activateTab(ui, tabName);
    closeSidebarOnMobile();
  };

  renderBaseLinks(ui, state);
  renderQuickActions(ui, {
    botUrl: buildWhatsAppUrl('', '/menu'),
    supportUrl: state.termsUrl,
  });
  activateTab(ui, 'summary');
  setSidebarOpen(false);

  if (ui.sidebarToggleBtn) {
    ui.sidebarToggleBtn.addEventListener('click', () => {
      toggleSidebar();
    });
  }

  if (ui.sidebarCloseBtn) {
    ui.sidebarCloseBtn.addEventListener('click', () => {
      setSidebarOpen(false);
    });
  }

  if (ui.sidebarOverlay) {
    ui.sidebarOverlay.addEventListener('click', () => {
      setSidebarOpen(false);
    });
  }

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setSidebarOpen(false);
    }
  });

  for (const button of ui.tabButtons) {
    button.addEventListener('click', () => {
      const tabName = String(button?.dataset?.tabTarget || '').trim();
      if (!tabName) return;
      handleTabClick(tabName);
    });
  }

  if (ui.retryBtn) {
    ui.retryBtn.addEventListener('click', () => {
      handleRetry();
    });
  }

  if (ui.logoutBtn) {
    ui.logoutBtn.addEventListener('click', () => {
      void handleLogout();
    });
  }

  void loadSummary();
};
