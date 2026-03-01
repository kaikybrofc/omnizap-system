/* global document, window, fetch, URL, URLSearchParams, Blob, Element */

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

    adminPanel: document.getElementById('user-admin-panel'),
    adminRole: document.getElementById('user-admin-role'),
    adminStatus: document.getElementById('user-admin-status'),
    adminError: document.getElementById('user-admin-error'),
    adminUnlockForm: document.getElementById('user-admin-unlock-form'),
    adminPassword: document.getElementById('user-admin-password'),
    adminUnlockBtn: document.getElementById('user-admin-unlock-btn'),
    adminOverview: document.getElementById('user-admin-overview'),
    adminRefreshBtn: document.getElementById('user-admin-refresh-btn'),
    adminLogoutBtn: document.getElementById('user-admin-logout-btn'),

    adminBotsOnline: document.getElementById('user-admin-bots-online'),
    adminMessagesToday: document.getElementById('user-admin-messages-today'),
    adminSpamBlocked: document.getElementById('user-admin-spam-blocked'),
    adminUptime: document.getElementById('user-admin-uptime'),
    adminErrors5xx: document.getElementById('user-admin-errors-5xx'),
    adminTotalPacks: document.getElementById('user-admin-total-packs'),
    adminTotalStickers: document.getElementById('user-admin-total-stickers'),
    adminActiveBans: document.getElementById('user-admin-active-bans'),
    adminKnownUsers: document.getElementById('user-admin-known-users'),
    adminActiveSessions: document.getElementById('user-admin-active-sessions'),
    adminVisits24h: document.getElementById('user-admin-visits-24h'),
    adminVisits7d: document.getElementById('user-admin-visits-7d'),
    adminUniqueVisitors7d: document.getElementById('user-admin-unique-visitors-7d'),

    adminHealthCpu: document.getElementById('user-admin-health-cpu'),
    adminHealthRam: document.getElementById('user-admin-health-ram'),
    adminHealthLatency: document.getElementById('user-admin-health-latency'),
    adminHealthQueue: document.getElementById('user-admin-health-queue'),
    adminHealthDb: document.getElementById('user-admin-health-db'),

    adminModerationList: document.getElementById('user-admin-moderation-list'),
    adminSessionsList: document.getElementById('user-admin-sessions-list'),
    adminUsersList: document.getElementById('user-admin-users-list'),
    adminBansList: document.getElementById('user-admin-bans-list'),
    adminAuditList: document.getElementById('user-admin-audit-list'),
    adminFlagsList: document.getElementById('user-admin-flags-list'),
    adminAlertsList: document.getElementById('user-admin-alerts-list'),
    adminOpsStatus: document.getElementById('user-admin-ops-status'),

    adminSearchForm: document.getElementById('user-admin-search-form'),
    adminSearchInput: document.getElementById('user-admin-search-input'),
    adminSearchBtn: document.getElementById('user-admin-search-btn'),
    adminSearchResults: document.getElementById('user-admin-search-results'),

    adminExportMetricsJsonBtn: document.getElementById('user-admin-export-metrics-json'),
    adminExportMetricsCsvBtn: document.getElementById('user-admin-export-metrics-csv'),
    adminExportEventsJsonBtn: document.getElementById('user-admin-export-events-json'),
    adminExportEventsCsvBtn: document.getElementById('user-admin-export-events-csv'),
    adminOpButtons: Array.from(document.querySelectorAll('[data-admin-op-action]')),
  };

  const state = {
    apiBasePath: String(root.dataset.apiBasePath || DEFAULT_API_BASE_PATH).trim() || DEFAULT_API_BASE_PATH,
    stickersPath: String(root.dataset.stickersPath || DEFAULT_STICKERS_PATH).trim() || DEFAULT_STICKERS_PATH,
    loginPath: String(root.dataset.loginPath || DEFAULT_LOGIN_PATH).trim() || DEFAULT_LOGIN_PATH,
    botPhone: '',
    adminBusy: false,
    adminStatusPayload: null,
    adminOverviewPayload: null,
    adminSearchPayload: null,
    adminOpsMessage: '',
  };

  const sessionApiPath = `${state.apiBasePath}/auth/google/session`;
  const myProfileApiPath = `${state.apiBasePath}/me`;
  const botContactApiPath = `${state.apiBasePath}/bot-contact`;
  const adminSessionApiPath = `${state.apiBasePath}/admin/session`;
  const adminOverviewApiPath = `${state.apiBasePath}/admin/overview`;
  const adminForceLogoutApiPath = `${state.apiBasePath}/admin/users/force-logout`;
  const adminFeatureFlagsApiPath = `${state.apiBasePath}/admin/feature-flags`;
  const adminOpsApiPath = `${state.apiBasePath}/admin/ops`;
  const adminSearchApiPath = `${state.apiBasePath}/admin/search`;
  const adminExportApiPath = `${state.apiBasePath}/admin/export`;
  const adminBansApiPath = `${state.apiBasePath}/admin/bans`;

  const setText = (el, value) => {
    if (!el) return;
    el.textContent = String(value || '');
  };

  const clearNode = (el) => {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  };

  const showError = (message) => {
    if (!ui.error) return;
    const safeMessage = String(message || '').trim();
    ui.error.hidden = !safeMessage;
    if (safeMessage) ui.error.textContent = safeMessage;
  };

  const showAdminError = (message) => {
    if (!ui.adminError) return;
    const safeMessage = String(message || '').trim();
    ui.adminError.hidden = !safeMessage;
    if (safeMessage) ui.adminError.textContent = safeMessage;
  };

  const normalizeDigits = (value) => String(value || '').replace(/\D+/g, '');
  const normalizeString = (value) => String(value || '').trim();
  const isObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));

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

  const formatPercent = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 'n/d';
    return `${numeric.toFixed(1)}%`;
  };

  const formatMilliseconds = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 'n/d';
    return `${Math.round(numeric)} ms`;
  };

  const formatIntegerOrNd = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 'n/d';
    return formatNumber(numeric);
  };

  const buildLoginRedirectUrl = () => {
    const loginUrl = new URL(state.loginPath, window.location.origin);
    const nextPath = `${window.location.pathname || '/user/systemadm/'}${window.location.search || ''}`;
    loginUrl.searchParams.set('next', nextPath);
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

  const fetchWithAuth = async (url, init = {}) => {
    const response = await fetch(url, {
      credentials: 'include',
      ...init,
    });
    if (!response.ok) {
      let message = `Falha HTTP ${response.status}`;
      try {
        const payload = await response.json();
        if (payload?.error) message = payload.error;
      } catch {
        // noop
      }
      const error = new Error(message);
      error.statusCode = response.status;
      throw error;
    }
    return response;
  };

  const redirectToLogin = () => {
    window.location.assign(buildLoginRedirectUrl());
  };

  const normalizeOwnerJidCandidate = (value) => {
    const jid = normalizeString(value);
    if (!jid || !jid.includes('@')) return '';
    if (jid.endsWith('@g.us')) return '';
    return jid;
  };

  const compactIdentityPayload = (raw = {}) => {
    const payload = {};
    const sessionToken = normalizeString(raw.session_token);
    const googleSub = normalizeString(raw.google_sub);
    const email = normalizeString(raw.email);
    const ownerJid = normalizeOwnerJidCandidate(raw.owner_jid);
    if (sessionToken) payload.session_token = sessionToken;
    if (googleSub) payload.google_sub = googleSub;
    if (email) payload.email = email;
    if (ownerJid) payload.owner_jid = ownerJid;
    return payload;
  };

  const buildIdentityLabel = (identity = {}) => {
    const email = normalizeString(identity.email);
    const ownerJid = normalizeString(identity.owner_jid);
    const googleSub = normalizeString(identity.google_sub);
    const sessionToken = normalizeString(identity.session_token);
    if (email) return email;
    if (ownerJid) return ownerJid;
    if (googleSub) return googleSub;
    if (sessionToken) return `${sessionToken.slice(0, 8)}...`;
    return 'identidade';
  };

  const getAdminSession = () => state.adminStatusPayload?.session || null;
  const isAdminAuthenticated = () => Boolean(getAdminSession()?.authenticated);
  const isAdminEligible = () => Boolean(state.adminStatusPayload?.eligible_google_login || isAdminAuthenticated());

  const resolveAdminRole = () =>
    String(getAdminSession()?.role || state.adminStatusPayload?.eligible_role || '')
      .trim()
      .toLowerCase();

  const formatAdminRole = (role) => {
    if (role === 'owner') return 'dono';
    if (role === 'moderator') return 'moderador';
    return 'admin';
  };

  const createItemMeta = (text) => {
    const p = document.createElement('p');
    p.className = 'admin-item-meta';
    p.textContent = text;
    return p;
  };

  const createBadge = (label, severity = 'low') => {
    const normalizedSeverity = ['critical', 'high', 'medium', 'low'].includes(String(severity)) ? String(severity) : 'low';
    const badge = document.createElement('span');
    badge.className = `admin-badge ${normalizedSeverity}`;
    badge.textContent = String(label || '').trim() || normalizedSeverity.toUpperCase();
    return badge;
  };

  const createMiniButton = (label, onClick) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'admin-mini-btn';
    button.textContent = label;
    button.addEventListener('click', () => {
      if (typeof onClick === 'function') void onClick();
    });
    return button;
  };

  const createMiniLink = (label, href) => {
    const link = document.createElement('a');
    link.className = 'admin-mini-btn';
    link.textContent = label;
    link.href = href;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    return link;
  };

  const renderListPlaceholder = (container, message) => {
    if (!container) return;
    clearNode(container);
    container.appendChild(createItemMeta(message));
  };

  const appendListItem = ({ container, title, severity = '', badgeLabel = '', meta = [], actions = [], customNode = null }) => {
    if (!container) return;

    const item = document.createElement('article');
    item.className = 'admin-item';

    const titleEl = document.createElement('p');
    titleEl.className = 'admin-item-title';
    titleEl.textContent = title;
    item.appendChild(titleEl);

    if (badgeLabel) {
      item.appendChild(createBadge(badgeLabel, severity));
    }

    for (const line of meta) {
      const text = normalizeString(line);
      if (!text) continue;
      item.appendChild(createItemMeta(text));
    }

    if (customNode) item.appendChild(customNode);

    if (Array.isArray(actions) && actions.length) {
      const actionsWrap = document.createElement('div');
      actionsWrap.className = 'admin-item-actions';
      for (const actionNode of actions) {
        if (actionNode instanceof Element) actionsWrap.appendChild(actionNode);
      }
      if (actionsWrap.childNodes.length > 0) {
        item.appendChild(actionsWrap);
      }
    }

    container.appendChild(item);
  };

  const setAdminBusy = (value) => {
    const busy = Boolean(value);
    state.adminBusy = busy;

    const authenticated = isAdminAuthenticated();
    const eligible = isAdminEligible();

    if (ui.adminPanel) {
      const controls = ui.adminPanel.querySelectorAll('button, input, select, textarea');
      for (const control of controls) {
        const inUnlockForm = Boolean(control.closest('#user-admin-unlock-form'));
        const inOverview = Boolean(control.closest('#user-admin-overview'));
        if (inUnlockForm) {
          control.disabled = busy || !eligible || authenticated;
          continue;
        }
        if (inOverview) {
          control.disabled = busy || !authenticated;
          continue;
        }
        control.disabled = busy;
      }
    }

    if (ui.adminPassword) ui.adminPassword.disabled = busy || !isAdminEligible() || isAdminAuthenticated();
    if (ui.adminUnlockBtn) ui.adminUnlockBtn.disabled = busy || !isAdminEligible() || isAdminAuthenticated();
    if (ui.adminRefreshBtn) ui.adminRefreshBtn.disabled = busy || !isAdminAuthenticated();
    if (ui.adminLogoutBtn) ui.adminLogoutBtn.disabled = busy || !isAdminAuthenticated();
  };

  const renderSession = (sessionData) => {
    const user = sessionData?.user || {};
    const ownerPhone = normalizeString(sessionData?.owner_phone);
    const ownerJid = normalizeString(sessionData?.owner_jid);

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
      const picture = normalizeString(user?.picture) || FALLBACK_AVATAR;
      ui.avatar.src = picture;
      ui.avatar.onerror = () => {
        ui.avatar.src = FALLBACK_AVATAR;
      };
    }

    setText(ui.ownerJid, ownerJid || 'n/d');
    setText(ui.googleSub, normalizeString(user?.sub) || 'n/d');
    setText(ui.expiresAt, formatDateTime(sessionData?.expires_at));

    if (ui.profile) ui.profile.hidden = false;
    if (ui.summary) ui.summary.hidden = false;
    if (ui.actions) ui.actions.hidden = false;
  };

  const renderPackMetrics = (payload) => {
    const data = payload?.data || {};
    const packs = Array.isArray(data?.packs) ? data.packs : [];
    const stats = isObject(data?.stats) ? data.stats : {};

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

  const setAdminMetricsDefaults = () => {
    setText(ui.adminBotsOnline, '0');
    setText(ui.adminMessagesToday, 'n/d');
    setText(ui.adminSpamBlocked, 'n/d');
    setText(ui.adminUptime, 'n/d');
    setText(ui.adminErrors5xx, '0');
    setText(ui.adminTotalPacks, '0');
    setText(ui.adminTotalStickers, '0');
    setText(ui.adminActiveBans, '0');
    setText(ui.adminKnownUsers, '0');
    setText(ui.adminActiveSessions, '0');
    setText(ui.adminVisits24h, '0');
    setText(ui.adminVisits7d, '0');
    setText(ui.adminUniqueVisitors7d, '0');

    setText(ui.adminHealthCpu, 'n/d');
    setText(ui.adminHealthRam, 'n/d');
    setText(ui.adminHealthLatency, 'n/d');
    setText(ui.adminHealthQueue, 'n/d');
    setText(ui.adminHealthDb, 'n/d');

    renderListPlaceholder(ui.adminModerationList, 'Nenhum evento recente de moderação.');
    renderListPlaceholder(ui.adminSessionsList, 'Nenhuma sessão ativa encontrada.');
    renderListPlaceholder(ui.adminUsersList, 'Nenhum usuário encontrado.');
    renderListPlaceholder(ui.adminBansList, 'Nenhuma conta bloqueada.');
    renderListPlaceholder(ui.adminAuditList, 'Sem eventos de auditoria recentes.');
    renderListPlaceholder(ui.adminFlagsList, 'Nenhuma feature flag disponível.');
    renderListPlaceholder(ui.adminAlertsList, 'Sem alertas ativos no momento.');
    renderListPlaceholder(ui.adminSearchResults, 'Faça uma busca para ver usuários, grupos, packs e sessões.');
    setText(ui.adminOpsStatus, state.adminOpsMessage || 'Ações operacionais disponíveis.');
  };

  const buildBanPayloadFromEvent = (event) => {
    const metadata = isObject(event?.metadata) ? event.metadata : {};
    const payload = compactIdentityPayload({
      google_sub: metadata.google_sub,
      email: metadata.email,
      owner_jid: event?.sender_id || metadata.owner_jid,
    });
    if (!Object.keys(payload).length) return null;
    payload.reason = `Ban via moderação (${normalizeString(event?.event_type) || 'evento'})`;
    return payload;
  };

  const buildForceLogoutPayloadFromAny = (entry = {}) =>
    compactIdentityPayload({
      session_token: entry?.session_token,
      google_sub: entry?.google_sub,
      email: entry?.email,
      owner_jid: entry?.owner_jid,
    });

  const handleAdminForceLogout = async (identity, contextLabel = '') => {
    const payload = compactIdentityPayload(identity);
    if (!Object.keys(payload).length) {
      showAdminError('Não foi possível forçar logout: identidade ausente.');
      return;
    }
    if (state.adminBusy) return;

    showAdminError('');
    setAdminBusy(true);
    try {
      const response = await fetchJson(adminForceLogoutApiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload),
      });
      const removed = Number(response?.data?.removed_sessions || 0);
      const label = normalizeString(contextLabel) || buildIdentityLabel(payload);
      state.adminOpsMessage = `Logout forçado concluído para ${label}. Sessões removidas: ${removed}.`;
      await refreshAdminArea({ keepCurrentError: true });
    } catch (error) {
      showAdminError(error?.message || 'Falha ao forçar logout.');
    } finally {
      setAdminBusy(false);
      renderAdminPanel();
    }
  };

  const handleAdminBanCreate = async (banPayload, contextLabel = '') => {
    if (!isObject(banPayload)) return;
    const payload = {
      ...compactIdentityPayload(banPayload),
      reason: normalizeString(banPayload.reason),
    };
    if (!payload.google_sub && !payload.email && !payload.owner_jid) {
      showAdminError('Não foi possível banir: identidade ausente.');
      return;
    }
    if (state.adminBusy) return;

    showAdminError('');
    setAdminBusy(true);
    try {
      const response = await fetchJson(adminBansApiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload),
      });
      const created = Boolean(response?.data?.created);
      const label = normalizeString(contextLabel) || buildIdentityLabel(payload);
      state.adminOpsMessage = created ? `Conta banida: ${label}.` : `Conta já estava banida: ${label}.`;
      await refreshAdminArea({ keepCurrentError: true });
    } catch (error) {
      showAdminError(error?.message || 'Falha ao criar ban.');
    } finally {
      setAdminBusy(false);
      renderAdminPanel();
    }
  };

  const handleAdminBanRevoke = async (banId) => {
    const normalizedId = normalizeString(banId);
    if (!normalizedId || state.adminBusy) return;

    showAdminError('');
    setAdminBusy(true);
    try {
      await fetchJson(`${adminBansApiPath}/${encodeURIComponent(normalizedId)}/revoke`, { method: 'DELETE' });
      state.adminOpsMessage = `Ban ${normalizedId} revogado com sucesso.`;
      await refreshAdminArea({ keepCurrentError: true });
    } catch (error) {
      showAdminError(error?.message || 'Falha ao revogar ban.');
    } finally {
      setAdminBusy(false);
      renderAdminPanel();
    }
  };

  const handleAdminFeatureFlagUpdate = async ({ flagName = '', isEnabled = false, rolloutPercent = 100, description = '' } = {}) => {
    const normalizedName = normalizeString(flagName);
    if (!normalizedName || state.adminBusy) return;

    showAdminError('');
    setAdminBusy(true);
    try {
      await fetchJson(adminFeatureFlagsApiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          flag_name: normalizedName,
          is_enabled: Boolean(isEnabled),
          rollout_percent: Math.max(0, Math.min(100, Math.floor(Number(rolloutPercent) || 0))),
          description: normalizeString(description),
        }),
      });
      state.adminOpsMessage = `Feature flag ${normalizedName} atualizada.`;
      await refreshAdminArea({ keepCurrentError: true });
    } catch (error) {
      showAdminError(error?.message || 'Falha ao atualizar feature flag.');
    } finally {
      setAdminBusy(false);
      renderAdminPanel();
    }
  };

  const handleAdminOpsAction = async (action) => {
    const normalizedAction = normalizeString(action);
    if (!normalizedAction || state.adminBusy) return;

    showAdminError('');
    setAdminBusy(true);
    try {
      const response = await fetchJson(adminOpsApiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ action: normalizedAction }),
      });
      const message = normalizeString(response?.data?.message) || `Ação ${normalizedAction} concluída.`;
      state.adminOpsMessage = `${message} (${formatDateTime(response?.data?.updated_at)})`;
      setText(ui.adminOpsStatus, state.adminOpsMessage);
      await refreshAdminArea({ keepCurrentError: true });
    } catch (error) {
      showAdminError(error?.message || 'Falha ao executar ação operacional.');
    } finally {
      setAdminBusy(false);
      renderAdminPanel();
    }
  };

  const renderModerationQueue = (events) => {
    const list = Array.isArray(events) ? events : [];
    clearNode(ui.adminModerationList);

    if (!list.length) {
      renderListPlaceholder(ui.adminModerationList, 'Nenhum evento recente de moderação.');
      return;
    }

    for (const event of list) {
      const title = normalizeString(event?.title) || 'Evento de moderação';
      const severity = normalizeString(event?.severity) || 'low';
      const badgeLabel = severity.toUpperCase();
      const createdAt = formatDateTime(event?.created_at || event?.revoked_at);
      const meta = [normalizeString(event?.subtitle), `Tipo: ${normalizeString(event?.event_type) || 'evento'} • ${createdAt}`];

      if (normalizeString(event?.reason)) meta.push(`Motivo: ${normalizeString(event.reason)}`);

      const actions = [];
      if (event?.event_type === 'ban') {
        if (event?.ban_id && !event?.revoked_at) {
          actions.push(createMiniButton('Revogar ban', () => handleAdminBanRevoke(event.ban_id)));
        }
      } else {
        const banPayload = buildBanPayloadFromEvent(event);
        if (banPayload) {
          actions.push(createMiniButton('Banir conta', () => handleAdminBanCreate(banPayload, buildIdentityLabel(banPayload))));
        }
        const logoutPayload = compactIdentityPayload({
          session_token: event?.metadata?.session_token,
          google_sub: event?.metadata?.google_sub,
          email: event?.metadata?.email,
          owner_jid: event?.sender_id || event?.metadata?.owner_jid,
        });
        if (Object.keys(logoutPayload).length) {
          actions.push(createMiniButton('Forçar logout', () => handleAdminForceLogout(logoutPayload, buildIdentityLabel(logoutPayload))));
        }
      }

      appendListItem({
        container: ui.adminModerationList,
        title,
        severity,
        badgeLabel,
        meta,
        actions,
      });
    }
  };

  const renderActiveSessions = (sessions) => {
    const list = Array.isArray(sessions) ? sessions : [];
    clearNode(ui.adminSessionsList);

    if (!list.length) {
      renderListPlaceholder(ui.adminSessionsList, 'Nenhuma sessão ativa encontrada.');
      return;
    }

    for (const session of list) {
      const identity = compactIdentityPayload(session);
      const title = normalizeString(session?.name || session?.email || session?.owner_jid || 'Sessão ativa');
      const meta = [`Email: ${normalizeString(session?.email) || 'n/d'}`, `Owner: ${normalizeString(session?.owner_jid) || 'n/d'}`, `Último acesso: ${formatDateTime(session?.last_seen_at)} • Expira: ${formatDateTime(session?.expires_at)}`];
      const actions = [];
      if (Object.keys(identity).length) {
        actions.push(createMiniButton('Forçar logout', () => handleAdminForceLogout(identity, buildIdentityLabel(identity))));
      }
      appendListItem({
        container: ui.adminSessionsList,
        title,
        severity: 'low',
        badgeLabel: 'ATIVA',
        meta,
        actions,
      });
    }
  };

  const renderKnownUsers = (users) => {
    const list = Array.isArray(users) ? users : [];
    clearNode(ui.adminUsersList);

    if (!list.length) {
      renderListPlaceholder(ui.adminUsersList, 'Nenhum usuário encontrado.');
      return;
    }

    for (const user of list) {
      const identity = buildForceLogoutPayloadFromAny(user);
      const title = normalizeString(user?.name || user?.email || user?.owner_jid || 'Usuário');
      const meta = [`Email: ${normalizeString(user?.email) || 'n/d'}`, `Owner: ${normalizeString(user?.owner_jid) || 'n/d'}`, `Último login: ${formatDateTime(user?.last_login_at)} • Último acesso: ${formatDateTime(user?.last_seen_at)}`];
      const actions = [];
      if (Object.keys(identity).length) {
        actions.push(createMiniButton('Forçar logout', () => handleAdminForceLogout(identity, buildIdentityLabel(identity))));
      }
      appendListItem({
        container: ui.adminUsersList,
        title,
        severity: 'low',
        badgeLabel: 'USER',
        meta,
        actions,
      });
    }
  };

  const renderBlockedAccounts = (bans) => {
    const list = Array.isArray(bans) ? bans : [];
    clearNode(ui.adminBansList);

    if (!list.length) {
      renderListPlaceholder(ui.adminBansList, 'Nenhuma conta bloqueada.');
      return;
    }

    for (const ban of list) {
      const identity = normalizeString(ban?.email || ban?.owner_jid || ban?.google_sub || `ban:${ban?.id || ''}`);
      const isRevoked = Boolean(ban?.revoked_at);
      const meta = [`Criado: ${formatDateTime(ban?.created_at)}${isRevoked ? ` • Revogado: ${formatDateTime(ban?.revoked_at)}` : ''}`, `Motivo: ${normalizeString(ban?.reason) || 'não informado'}`];
      const actions = [];
      if (!isRevoked && normalizeString(ban?.id)) {
        actions.push(createMiniButton('Revogar ban', () => handleAdminBanRevoke(ban.id)));
      }
      appendListItem({
        container: ui.adminBansList,
        title: identity,
        severity: isRevoked ? 'low' : 'critical',
        badgeLabel: isRevoked ? 'REVOGADO' : 'BLOQUEADO',
        meta,
        actions,
      });
    }
  };

  const renderAuditLog = (events) => {
    const list = Array.isArray(events) ? events : [];
    clearNode(ui.adminAuditList);

    if (!list.length) {
      renderListPlaceholder(ui.adminAuditList, 'Sem eventos de auditoria recentes.');
      return;
    }

    for (const item of list.slice(0, 80)) {
      const action = normalizeString(item?.action || 'action');
      const targetType = normalizeString(item?.target_type || 'target');
      const targetId = normalizeString(item?.target_id || '');
      const status = normalizeString(item?.status || 'success');
      const details = isObject(item?.details) ? Object.entries(item.details).slice(0, 3) : [];
      const detailLine = details.length ? `Detalhes: ${details.map(([key, value]) => `${key}=${value}`).join(' • ')}` : '';

      const meta = [`Admin: ${normalizeString(item?.admin_email || item?.admin_google_sub || item?.admin_owner_jid || 'n/d')} (${formatAdminRole(normalizeString(item?.admin_role || 'admin'))})`, `Alvo: ${targetType}${targetId ? ` / ${targetId}` : ''} • Em: ${formatDateTime(item?.created_at)}`];
      if (detailLine) meta.push(detailLine);

      appendListItem({
        container: ui.adminAuditList,
        title: action,
        severity: status === 'success' ? 'low' : 'high',
        badgeLabel: status.toUpperCase(),
        meta,
      });
    }
  };

  const renderFeatureFlags = (flags) => {
    const list = Array.isArray(flags) ? flags : [];
    clearNode(ui.adminFlagsList);

    if (!list.length) {
      renderListPlaceholder(ui.adminFlagsList, 'Nenhuma feature flag disponível.');
      return;
    }

    for (const flag of list) {
      const flagName = normalizeString(flag?.flag_name);
      const isEnabled = Boolean(flag?.is_enabled);
      const rollout = Math.max(0, Math.min(100, Math.floor(Number(flag?.rollout_percent) || 0)));
      const description = normalizeString(flag?.description);
      const updatedBy = normalizeString(flag?.updated_by);

      const rolloutForm = document.createElement('form');
      rolloutForm.className = 'admin-inline-form';

      const rolloutInput = document.createElement('input');
      rolloutInput.className = 'admin-input';
      rolloutInput.type = 'number';
      rolloutInput.min = '0';
      rolloutInput.max = '100';
      rolloutInput.step = '1';
      rolloutInput.value = String(rollout);
      rolloutInput.setAttribute('aria-label', `Rollout de ${flagName}`);

      const rolloutBtn = document.createElement('button');
      rolloutBtn.type = 'submit';
      rolloutBtn.className = 'admin-mini-btn';
      rolloutBtn.textContent = 'Salvar rollout';

      rolloutForm.appendChild(rolloutInput);
      rolloutForm.appendChild(rolloutBtn);
      rolloutForm.addEventListener('submit', (event) => {
        event.preventDefault();
        void handleAdminFeatureFlagUpdate({
          flagName,
          isEnabled,
          rolloutPercent: rolloutInput.value,
          description,
        });
      });

      const actions = [
        createMiniButton(isEnabled ? 'Desativar' : 'Ativar', () =>
          handleAdminFeatureFlagUpdate({
            flagName,
            isEnabled: !isEnabled,
            rolloutPercent: rollout,
            description,
          }),
        ),
      ];

      appendListItem({
        container: ui.adminFlagsList,
        title: flagName || 'feature_flag',
        severity: isEnabled ? 'low' : 'medium',
        badgeLabel: isEnabled ? 'ON' : 'OFF',
        meta: [`Rollout: ${rollout}%`, description ? `Descrição: ${description}` : 'Descrição: n/d', `Atualizado por: ${updatedBy || 'n/d'} • ${formatDateTime(flag?.updated_at)}`],
        actions,
        customNode: rolloutForm,
      });
    }
  };

  const renderAlerts = (alerts) => {
    const list = Array.isArray(alerts) ? alerts : [];
    clearNode(ui.adminAlertsList);

    if (!list.length) {
      renderListPlaceholder(ui.adminAlertsList, 'Sem alertas ativos no momento.');
      return;
    }

    for (const alert of list) {
      const severity = normalizeString(alert?.severity || 'low');
      const title = normalizeString(alert?.title || alert?.code || 'Alerta');
      const meta = [normalizeString(alert?.message || ''), `Código: ${normalizeString(alert?.code || 'n/d')} • ${formatDateTime(alert?.created_at)}`];
      appendListItem({
        container: ui.adminAlertsList,
        title,
        severity,
        badgeLabel: severity.toUpperCase(),
        meta,
      });
    }
  };

  const renderSearchResults = (payload = state.adminSearchPayload) => {
    if (!ui.adminSearchResults) return;
    clearNode(ui.adminSearchResults);

    if (!payload || !isObject(payload)) {
      renderListPlaceholder(ui.adminSearchResults, 'Faça uma busca para ver usuários, grupos, packs e sessões.');
      return;
    }

    const q = normalizeString(payload?.q);
    const totals = isObject(payload?.totals) ? payload.totals : {};
    const results = isObject(payload?.results) ? payload.results : {};

    appendListItem({
      container: ui.adminSearchResults,
      title: `Resultado para "${q || 'consulta'}"`,
      severity: 'low',
      badgeLabel: 'BUSCA',
      meta: [`Usuários: ${formatIntegerOrNd(totals.users)}`, `Sessões: ${formatIntegerOrNd(totals.sessions)}`, `Grupos: ${formatIntegerOrNd(totals.groups)}`, `Packs: ${formatIntegerOrNd(totals.packs)}`],
    });

    const users = Array.isArray(results.users) ? results.users : [];
    for (const user of users) {
      const identity = buildForceLogoutPayloadFromAny(user);
      const actions = [];
      if (Object.keys(identity).length) {
        actions.push(createMiniButton('Forçar logout', () => handleAdminForceLogout(identity, buildIdentityLabel(identity))));
      }
      appendListItem({
        container: ui.adminSearchResults,
        title: `[Usuário] ${normalizeString(user?.name || user?.email || user?.owner_jid || 'registro')}`,
        severity: 'low',
        badgeLabel: 'USER',
        meta: [`Email: ${normalizeString(user?.email) || 'n/d'}`, `Owner: ${normalizeString(user?.owner_jid) || 'n/d'}`],
        actions,
      });
    }

    const sessions = Array.isArray(results.sessions) ? results.sessions : [];
    for (const session of sessions) {
      const identity = buildForceLogoutPayloadFromAny(session);
      const actions = [];
      if (Object.keys(identity).length) {
        actions.push(createMiniButton('Forçar logout', () => handleAdminForceLogout(identity, buildIdentityLabel(identity))));
      }
      appendListItem({
        container: ui.adminSearchResults,
        title: `[Sessão] ${normalizeString(session?.name || session?.email || session?.owner_jid || 'ativa')}`,
        severity: 'low',
        badgeLabel: 'SESSÃO',
        meta: [`Email: ${normalizeString(session?.email) || 'n/d'}`, `Expira: ${formatDateTime(session?.expires_at)}`],
        actions,
      });
    }

    const groups = Array.isArray(results.groups) ? results.groups : [];
    for (const group of groups) {
      appendListItem({
        container: ui.adminSearchResults,
        title: `[Grupo] ${normalizeString(group?.subject || group?.id || 'grupo')}`,
        severity: 'medium',
        badgeLabel: 'GRUPO',
        meta: [`ID: ${normalizeString(group?.id) || 'n/d'}`, `Atualizado: ${formatDateTime(group?.updated_at)}`],
      });
    }

    const packs = Array.isArray(results.packs) ? results.packs : [];
    for (const pack of packs) {
      const packUrl = normalizeString(pack?.web_url);
      const actions = [];
      if (packUrl) actions.push(createMiniLink('Abrir pack', packUrl));
      appendListItem({
        container: ui.adminSearchResults,
        title: `[Pack] ${normalizeString(pack?.name || pack?.pack_key || 'pack')}`,
        severity: 'low',
        badgeLabel: normalizeString(pack?.visibility || 'pack').toUpperCase(),
        meta: [`Owner: ${normalizeString(pack?.owner_jid) || 'n/d'}`, `Stickers: ${formatIntegerOrNd(pack?.stickers_count)}`],
        actions,
      });
    }

    if (!users.length && !sessions.length && !groups.length && !packs.length) {
      appendListItem({
        container: ui.adminSearchResults,
        title: 'Nenhum resultado encontrado.',
        severity: 'low',
        badgeLabel: 'VAZIO',
        meta: ['Tente outro termo de busca.'],
      });
    }
  };

  const renderSystemHealth = (health) => {
    const statusMap = {
      ok: 'OK',
      degraded: 'Degradado',
      unknown: 'Indefinido',
    };
    setText(ui.adminHealthCpu, formatPercent(health?.cpu_percent));
    setText(ui.adminHealthRam, formatPercent(health?.ram_percent));
    setText(ui.adminHealthLatency, formatMilliseconds(health?.http_latency_p95_ms));
    setText(ui.adminHealthQueue, formatIntegerOrNd(health?.queue_pending));
    setText(ui.adminHealthDb, statusMap[normalizeString(health?.db_status)] || 'n/d');
  };

  const renderAdminOverview = () => {
    const payload = state.adminOverviewPayload || {};
    const counters = isObject(payload?.counters) ? payload.counters : {};
    const dashboard = isObject(payload?.dashboard_quick) ? payload.dashboard_quick : {};
    const usersSessions = isObject(payload?.users_sessions) ? payload.users_sessions : {};
    const health = isObject(payload?.system_health) ? payload.system_health : {};

    setText(ui.adminBotsOnline, formatIntegerOrNd(dashboard?.bots_online || 0));
    setText(ui.adminMessagesToday, formatIntegerOrNd(dashboard?.messages_today));
    setText(ui.adminSpamBlocked, formatIntegerOrNd(dashboard?.spam_blocked_today));
    setText(ui.adminUptime, normalizeString(dashboard?.uptime) || 'n/d');
    setText(ui.adminErrors5xx, formatIntegerOrNd(dashboard?.errors_5xx || 0));

    setText(ui.adminTotalPacks, formatIntegerOrNd(counters?.total_packs_any_status || 0));
    setText(ui.adminTotalStickers, formatIntegerOrNd(counters?.total_stickers_any_status || 0));
    setText(ui.adminActiveBans, formatIntegerOrNd(counters?.active_bans || 0));
    setText(ui.adminKnownUsers, formatIntegerOrNd(counters?.known_google_users || 0));
    setText(ui.adminActiveSessions, formatIntegerOrNd(counters?.active_google_sessions || 0));
    setText(ui.adminVisits24h, formatIntegerOrNd(counters?.visit_events_24h || 0));
    setText(ui.adminVisits7d, formatIntegerOrNd(counters?.visit_events_7d || 0));
    setText(ui.adminUniqueVisitors7d, formatIntegerOrNd(counters?.unique_visitors_7d || 0));

    renderSystemHealth(health);
    renderModerationQueue(payload?.moderation_queue);
    renderActiveSessions(usersSessions?.active_sessions);
    renderKnownUsers(usersSessions?.users);
    renderBlockedAccounts(usersSessions?.blocked_accounts);
    renderAuditLog(payload?.audit_log);
    renderFeatureFlags(payload?.feature_flags);
    renderAlerts(payload?.alerts);
    renderSearchResults();
    setText(ui.adminOpsStatus, state.adminOpsMessage || 'Ações operacionais disponíveis.');
  };

  const renderAdminPanel = () => {
    if (!ui.adminPanel) return;

    const enabled = state.adminStatusPayload?.enabled !== false;
    const authenticated = isAdminAuthenticated();
    const eligible = isAdminEligible();
    const role = resolveAdminRole();

    if (!enabled || (!eligible && !authenticated)) {
      ui.adminPanel.hidden = true;
      if (ui.adminUnlockForm) ui.adminUnlockForm.hidden = true;
      if (ui.adminOverview) ui.adminOverview.hidden = true;
      showAdminError('');
      return;
    }

    ui.adminPanel.hidden = false;
    setText(ui.adminRole, formatAdminRole(role));

    if (authenticated) {
      setText(ui.adminStatus, `Sessão admin ativa como ${formatAdminRole(role)}. Ferramentas operacionais liberadas abaixo.`);
      if (ui.adminUnlockForm) ui.adminUnlockForm.hidden = true;
      if (ui.adminOverview) ui.adminOverview.hidden = false;
      renderAdminOverview();
    } else {
      setText(ui.adminStatus, `Conta elegível para admin (${formatAdminRole(role)}). Informe a senha para liberar os dados sensíveis.`);
      if (ui.adminUnlockForm) ui.adminUnlockForm.hidden = false;
      if (ui.adminOverview) ui.adminOverview.hidden = true;
      setAdminMetricsDefaults();
    }

    setAdminBusy(state.adminBusy);
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

  const loadAdminStatus = async () => {
    const payload = await fetchJson(adminSessionApiPath, { method: 'GET' });
    state.adminStatusPayload = payload?.data || null;
  };

  const loadAdminOverview = async () => {
    if (!isAdminAuthenticated()) {
      state.adminOverviewPayload = null;
      return;
    }
    const payload = await fetchJson(adminOverviewApiPath, { method: 'GET' });
    state.adminOverviewPayload = payload?.data || null;
  };

  const refreshAdminArea = async ({ keepCurrentError = false } = {}) => {
    if (!keepCurrentError) showAdminError('');
    try {
      await loadAdminStatus();
      await loadAdminOverview();
    } catch (error) {
      if (error?.statusCode === 404) {
        state.adminStatusPayload = { enabled: false };
        state.adminOverviewPayload = null;
      } else {
        showAdminError(error?.message || 'Falha ao carregar área admin.');
      }
    }
    renderAdminPanel();
  };

  const handleAdminUnlock = async () => {
    const password = normalizeString(ui.adminPassword?.value);
    if (!password) {
      showAdminError('Informe a senha do painel admin.');
      return;
    }
    if (state.adminBusy) return;

    showAdminError('');
    setAdminBusy(true);
    try {
      const payload = await fetchJson(adminSessionApiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ password }),
      });
      state.adminStatusPayload = payload?.data || null;
      state.adminOpsMessage = '';
      state.adminSearchPayload = null;
      if (ui.adminPassword) ui.adminPassword.value = '';
      await loadAdminOverview();
    } catch (error) {
      showAdminError(error?.message || 'Falha ao desbloquear área admin.');
      await loadAdminStatus().catch(() => {});
      state.adminOverviewPayload = null;
    } finally {
      setAdminBusy(false);
      renderAdminPanel();
    }
  };

  const handleAdminLogout = async () => {
    if (state.adminBusy) return;
    showAdminError('');
    setAdminBusy(true);
    try {
      await fetchJson(adminSessionApiPath, { method: 'DELETE' });
    } catch {
      // no-op
    }
    state.adminOverviewPayload = null;
    state.adminSearchPayload = null;
    state.adminOpsMessage = '';
    await loadAdminStatus().catch(() => {
      state.adminStatusPayload = null;
    });
    setAdminBusy(false);
    renderAdminPanel();
  };

  const handleAdminRefresh = async () => {
    if (state.adminBusy) return;
    setAdminBusy(true);
    await refreshAdminArea({ keepCurrentError: false });
    setAdminBusy(false);
    renderAdminPanel();
  };

  const handleAdminSearchSubmit = async () => {
    if (state.adminBusy) return;

    const q = normalizeString(ui.adminSearchInput?.value);
    if (!q) {
      state.adminSearchPayload = null;
      renderSearchResults();
      return;
    }

    showAdminError('');
    setAdminBusy(true);
    try {
      const query = new URLSearchParams({ q, limit: '12' }).toString();
      const payload = await fetchJson(`${adminSearchApiPath}?${query}`, { method: 'GET' });
      state.adminSearchPayload = payload?.data || null;
      state.adminOpsMessage = `Busca concluída para "${q}".`;
      renderSearchResults();
      setText(ui.adminOpsStatus, state.adminOpsMessage);
    } catch (error) {
      showAdminError(error?.message || 'Falha ao buscar dados.');
    } finally {
      setAdminBusy(false);
      renderAdminPanel();
    }
  };

  const downloadBlob = (blob, filename) => {
    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => {
      window.URL.revokeObjectURL(objectUrl);
    }, 250);
  };

  const extractFilenameFromDisposition = (contentDisposition, fallbackName) => {
    const source = normalizeString(contentDisposition);
    if (!source) return fallbackName;
    const utf8Match = source.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1]);
    const plainMatch = source.match(/filename="?([^"]+)"?/i);
    if (plainMatch?.[1]) return plainMatch[1];
    return fallbackName;
  };

  const handleAdminExport = async ({ type = 'metrics', format = 'json' } = {}) => {
    if (state.adminBusy) return;

    const normalizedType = normalizeString(type || 'metrics').toLowerCase();
    const normalizedFormat = normalizeString(format || 'json').toLowerCase();
    const fallbackName = `admin-${normalizedType}-${Date.now()}.${normalizedFormat === 'csv' ? 'csv' : 'json'}`;

    showAdminError('');
    setAdminBusy(true);
    try {
      const query = new URLSearchParams({
        type: normalizedType,
        format: normalizedFormat,
      }).toString();
      const response = await fetchWithAuth(`${adminExportApiPath}?${query}`, { method: 'GET' });

      if (normalizedFormat === 'csv') {
        const blob = await response.blob();
        const contentDisposition = response.headers.get('content-disposition');
        const filename = extractFilenameFromDisposition(contentDisposition, fallbackName);
        downloadBlob(blob, filename);
      } else {
        const payload = await response.json().catch(() => ({}));
        const blob = new Blob([JSON.stringify(payload?.data || payload || {}, null, 2)], { type: 'application/json; charset=utf-8' });
        downloadBlob(blob, fallbackName);
      }

      state.adminOpsMessage = `Exportação ${normalizedType.toUpperCase()} (${normalizedFormat.toUpperCase()}) concluída.`;
      setText(ui.adminOpsStatus, state.adminOpsMessage);
    } catch (error) {
      showAdminError(error?.message || 'Falha ao exportar dados.');
    } finally {
      setAdminBusy(false);
      renderAdminPanel();
    }
  };

  const handleLogout = async () => {
    if (!ui.logoutBtn) return;
    ui.logoutBtn.disabled = true;
    ui.logoutBtn.textContent = 'Encerrando...';
    try {
      await fetchJson(sessionApiPath, { method: 'DELETE' });
    } catch {
      // clear local navigation even if request fails
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
    setAdminMetricsDefaults();

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
    await refreshAdminArea();

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

  if (ui.adminUnlockForm) {
    ui.adminUnlockForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void handleAdminUnlock();
    });
  }

  if (ui.adminLogoutBtn) {
    ui.adminLogoutBtn.addEventListener('click', () => {
      void handleAdminLogout();
    });
  }

  if (ui.adminRefreshBtn) {
    ui.adminRefreshBtn.addEventListener('click', () => {
      void handleAdminRefresh();
    });
  }

  if (ui.adminSearchForm) {
    ui.adminSearchForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void handleAdminSearchSubmit();
    });
  }

  if (ui.adminOpButtons.length) {
    for (const button of ui.adminOpButtons) {
      button.addEventListener('click', () => {
        const action = normalizeString(button.dataset.adminOpAction);
        if (!action) return;
        void handleAdminOpsAction(action);
      });
    }
  }

  if (ui.adminExportMetricsJsonBtn) {
    ui.adminExportMetricsJsonBtn.addEventListener('click', () => {
      void handleAdminExport({ type: 'metrics', format: 'json' });
    });
  }
  if (ui.adminExportMetricsCsvBtn) {
    ui.adminExportMetricsCsvBtn.addEventListener('click', () => {
      void handleAdminExport({ type: 'metrics', format: 'csv' });
    });
  }
  if (ui.adminExportEventsJsonBtn) {
    ui.adminExportEventsJsonBtn.addEventListener('click', () => {
      void handleAdminExport({ type: 'events', format: 'json' });
    });
  }
  if (ui.adminExportEventsCsvBtn) {
    ui.adminExportEventsCsvBtn.addEventListener('click', () => {
      void handleAdminExport({ type: 'events', format: 'csv' });
    });
  }

  void init();
}
