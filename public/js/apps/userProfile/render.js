/* global document */

import { formatDateTime, formatPhone, getSessionStatusLabel } from './actions.js';

const byId = (id) => document.getElementById(id);

const setText = (element, value) => {
  if (!element) return;
  element.textContent = String(value || '');
};

const setHidden = (element, hidden) => {
  if (!element) return;
  element.hidden = Boolean(hidden);
};

const setHref = (element, href) => {
  if (!element || !href) return;
  element.href = href;
};

const toggleSkeleton = (elements, enabled) => {
  for (const element of elements) {
    if (!element) continue;
    element.classList.toggle('skeleton', Boolean(enabled));
  }
};

export const createUserProfileUi = (root) => {
  const tabButtons = Array.from(root.querySelectorAll('[data-tab-target]'));
  const tabPanels = Array.from(root.querySelectorAll('[data-tab-panel]'));

  return {
    status: byId('user-status'),
    error: byId('user-error'),
    retryBtn: byId('user-retry-btn'),
    logoutBtn: byId('user-logout-btn'),
    sidebarPanel: byId('user-side-panel'),
    sidebarToggleBtn: byId('sidebar-toggle-btn'),
    sidebarCloseBtn: byId('sidebar-close-btn'),
    sidebarOverlay: byId('sidebar-overlay'),
    quickActions: byId('user-quick-actions'),
    quickBot: byId('quick-action-bot'),
    quickSupport: byId('quick-action-support'),
    currentYear: byId('user-current-year'),
    tabButtons,
    tabPanels,
    summary: {
      avatar: byId('summary-avatar'),
      name: byId('summary-name'),
      email: byId('summary-email'),
      whatsapp: byId('summary-whatsapp'),
      plan: byId('summary-plan'),
      status: byId('summary-status'),
      lastLogin: byId('summary-last-login'),
      expires: byId('summary-expires'),
    },
    account: {
      sessionStatus: byId('account-session-status'),
      ownerJid: byId('account-owner-jid'),
      lastLogin: byId('account-last-login'),
      expiresAt: byId('account-expires-at'),
      termsLink: byId('account-terms-link'),
      privacyLink: byId('account-privacy-link'),
    },
    support: {
      phone: byId('support-phone'),
      message: byId('support-message'),
      whatsappLink: byId('support-whatsapp-link'),
      termsLink: byId('support-terms-link'),
    },
    footer: {
      termsLink: byId('footer-terms-link'),
      privacyLink: byId('footer-privacy-link'),
    },
  };
};

export const renderBaseLinks = (ui, state) => {
  if (ui.currentYear) ui.currentYear.textContent = String(new Date().getFullYear());

  const termsTargets = [ui.account.termsLink, ui.support.termsLink, ui.footer.termsLink];
  const privacyTargets = [ui.account.privacyLink, ui.footer.privacyLink];

  for (const link of termsTargets) setHref(link, state.termsUrl);
  for (const link of privacyTargets) setHref(link, state.privacyUrl);
};

export const renderSidebarState = (root, ui, open) => {
  if (!root) return;
  const isOpen = Boolean(open);
  root.dataset.sidebar = isOpen ? 'open' : 'closed';

  if (ui.sidebarPanel) ui.sidebarPanel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  if (ui.sidebarToggleBtn) ui.sidebarToggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
};

export const renderStatus = (ui, message, tone = 'loading') => {
  if (!ui.status) return;
  ui.status.dataset.tone = String(tone || 'loading');
  setText(ui.status, message);
};

export const renderError = (ui, message, { showRetry = false } = {}) => {
  const safe = String(message || '').trim();
  if (ui.error) {
    ui.error.hidden = !safe;
    if (safe) ui.error.textContent = safe;
  }
  if (ui.retryBtn) ui.retryBtn.hidden = !showRetry;
};

export const activateTab = (ui, tabName) => {
  for (const button of ui.tabButtons) {
    const selected = String(button?.dataset?.tabTarget || '') === tabName;
    button.setAttribute('aria-selected', selected ? 'true' : 'false');
  }

  for (const panel of ui.tabPanels) {
    const isTarget = String(panel?.dataset?.tabPanel || '') === tabName;
    panel.hidden = !isTarget;
  }
};

export const renderQuickActions = (ui, { botUrl, supportUrl } = {}) => {
  if (botUrl) setHref(ui.quickBot, botUrl);
  if (supportUrl) {
    setHref(ui.quickSupport, supportUrl);
    setHref(ui.support.whatsappLink, supportUrl);
  }
  setHidden(ui.quickActions, false);
};

export const renderSummary = (ui, state, payload) => {
  const data = payload?.data || {};
  const session = data?.session || {};
  const user = session?.user || {};
  const account = data?.account || {};
  const ownerPhone = String(session?.owner_phone || '').trim();
  const ownerJid = String(data?.owner_jid || session?.owner_jid || '').trim();

  setText(ui.summary.name, user?.name || 'Conta Google');
  setText(ui.summary.email, user?.email || 'E-mail não disponível');
  if (ownerPhone) {
    setText(ui.summary.whatsapp, `WhatsApp vinculado: +${formatPhone(ownerPhone)}`);
  } else if (ownerJid) {
    setText(ui.summary.whatsapp, `Owner vinculado: ${ownerJid}`);
  } else {
    setText(ui.summary.whatsapp, 'WhatsApp ainda não vinculado.');
  }

  setText(ui.summary.plan, account?.plan_label || 'Conta padrão');
  setText(ui.summary.status, account?.status === 'active' ? 'Ativa' : 'Pendente');
  setText(ui.summary.lastLogin, formatDateTime(account?.last_login_at || account?.last_seen_at));
  setText(ui.summary.expires, formatDateTime(session?.expires_at));

  if (ui.summary.avatar) {
    const picture = String(user?.picture || '').trim() || state.fallbackAvatar;
    ui.summary.avatar.src = picture;
    ui.summary.avatar.onerror = () => {
      ui.summary.avatar.src = state.fallbackAvatar;
    };
  }

  setText(ui.account.sessionStatus, getSessionStatusLabel(session));
  setText(ui.account.ownerJid, ownerJid || 'Não informado');
  setText(ui.account.lastLogin, formatDateTime(account?.last_login_at || account?.last_seen_at));
  setText(ui.account.expiresAt, formatDateTime(session?.expires_at));

  toggleSkeleton(
    [
      ui.summary.name,
      ui.summary.email,
      ui.summary.whatsapp,
      ui.summary.plan,
      ui.summary.status,
      ui.summary.lastLogin,
      ui.summary.expires,
      ui.account.sessionStatus,
      ui.account.ownerJid,
      ui.account.lastLogin,
      ui.account.expiresAt,
    ],
    false,
  );
};

export const renderSupportInfo = (ui, support) => {
  const phone = String(support?.phone || '').trim();
  const text = String(support?.text || '').trim() || 'Olá! Preciso de suporte no OmniZap.';

  setText(ui.support.phone, phone ? `+${formatPhone(phone)}` : 'Não informado');
  setText(ui.support.message, text);

  toggleSkeleton([ui.support.phone, ui.support.message], false);
};
