const root = document.getElementById('stickers-admin-root');

if (!root) {
  throw new Error('stickers-admin-root nao encontrado.');
}

const apiBasePath = root.dataset.apiBasePath || '/api/sticker-packs';
const webPath = root.dataset.webPath || '/stickers';
const adminApiBase = `${apiBasePath}/admin`;
const googleSessionApiPath = `${apiBasePath}/auth/google/session`;
const createConfigApiPath = `${apiBasePath}/create-config`;
const GOOGLE_GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const GOOGLE_AUTH_CACHE_KEY = 'omnizap_google_web_auth_cache_v1';

const PAGE_SIZE = Object.freeze({
  sessions: 8,
  users: 8,
  packs: 10,
  bans: 8,
  uploads: 8,
});

const TAB_ITEMS = [
  { id: 'users', label: 'Usuarios' },
  { id: 'packs', label: 'Packs' },
  { id: 'logs', label: 'Logs' },
  { id: 'uploads', label: 'Uploads' },
  { id: 'system', label: 'Sistema' },
];

const state = {
  loading: true,
  busy: false,
  sidebarOpen: false,
  activeTab: 'users',
  rowMenu: null,
  adminStatus: null,
  googleAuthConfig: { enabled: false, clientId: '' },
  googleAuthConfigError: '',
  googleLoginUiReady: false,
  overview: null,
  packs: [],
  moderators: [],
  selectedPackKey: '',
  selectedPack: null,
  packsQuery: '',
  usersQuery: '',
  logsQuery: '',
  error: '',
  toast: null,
  pagination: {
    sessions: 1,
    users: 1,
    packs: 1,
    bans: 1,
    uploads: 1,
  },
};

let toastTimer = null;
let googleLoginRenderNonce = 0;

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const fmtNum = (value) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Math.max(0, Number(value || 0)));

const fmtDate = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return raw;
  return dt.toLocaleString('pt-BR');
};

const normalizeToken = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const includesToken = (parts, token) => {
  if (!token) return true;
  return parts.some((part) => normalizeToken(part).includes(token));
};

const isAdminAuthenticated = () => Boolean(state.adminStatus?.session?.authenticated);
const canUnlockAdmin = () => Boolean(state.adminStatus?.eligible_google_login);
const getAdminRole = () =>
  String(state.adminStatus?.session?.role || '')
    .trim()
    .toLowerCase();
const canManageModerators = () => Boolean(state.adminStatus?.session?.capabilities?.can_manage_moderators || getAdminRole() === 'owner');

function setToast(type, message, timeoutMs = 3200) {
  const clean = String(message || '').trim();
  if (!clean) {
    state.toast = null;
    return;
  }
  state.toast = { type: String(type || 'info'), message: clean };
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    state.toast = null;
    render();
  }, timeoutMs);
}

function setError(message) {
  state.error = String(message || '').trim();
  if (state.error) setToast('error', state.error, 5000);
}

function clearError() {
  state.error = '';
}

function setBusy(busy) {
  state.busy = Boolean(busy);
}

function readLocalGoogleAuthCache() {
  try {
    const raw = localStorage.getItem(GOOGLE_AUTH_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const auth = parsed?.auth && typeof parsed.auth === 'object' ? parsed.auth : null;
    const user = auth?.user && typeof auth.user === 'object' ? auth.user : null;
    const sub = String(user?.sub || '').trim();
    if (!sub) return null;
    return {
      user: {
        sub,
        email: String(user?.email || '').trim(),
        name: String(user?.name || '').trim() || 'Conta Google',
      },
      savedAt: Number(parsed?.savedAt || 0),
    };
  } catch {
    return null;
  }
}

function decodeJwtPayload(jwt) {
  const parts = String(jwt || '').split('.');
  if (parts.length < 2) return null;
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = atob(padded);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === '1') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Falha ao carregar script: ${src}`)), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => {
      script.dataset.loaded = '1';
      resolve();
    });
    script.addEventListener('error', () => reject(new Error(`Falha ao carregar script: ${src}`)));
    document.head.appendChild(script);
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
  });

  const text = await response.text().catch(() => '');
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!response.ok) {
    const error = new Error(payload?.error || payload?.message || `HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

const getOverviewData = () => {
  const overview = state.overview || {};
  return {
    counters: overview?.counters && typeof overview.counters === 'object' ? overview.counters : {},
    marketplace: overview?.marketplace_stats && typeof overview.marketplace_stats === 'object' ? overview.marketplace_stats : {},
    activeSessions: Array.isArray(overview?.active_sessions) ? overview.active_sessions : [],
    users: Array.isArray(overview?.users) ? overview.users : [],
    bans: Array.isArray(overview?.bans) ? overview.bans : [],
    recentPacks: Array.isArray(overview?.recent_packs) ? overview.recent_packs : [],
  };
};

function paginate(items, key) {
  const list = Array.isArray(items) ? items : [];
  const size = Math.max(1, Number(PAGE_SIZE[key] || 10));
  const totalPages = Math.max(1, Math.ceil(list.length / size));
  const current = Math.min(totalPages, Math.max(1, Number(state.pagination[key] || 1)));
  state.pagination[key] = current;
  const start = (current - 1) * size;
  return {
    items: list.slice(start, start + size),
    current,
    totalPages,
    total: list.length,
  };
}

function renderPagination(key, page) {
  if (!page || page.totalPages <= 1) return '';
  const prevPage = Math.max(1, page.current - 1);
  const nextPage = Math.min(page.totalPages, page.current + 1);
  return `
    <div class="pager">
      <button class="subtle-btn" data-action="page-nav" data-page-target="${escapeHtml(key)}" data-page="${prevPage}" ${page.current <= 1 ? 'disabled' : ''}>Anterior</button>
      <span class="pager-meta">Pagina ${page.current} de ${page.totalPages} • ${fmtNum(page.total)} itens</span>
      <button class="subtle-btn" data-action="page-nav" data-page-target="${escapeHtml(key)}" data-page="${nextPage}" ${page.current >= page.totalPages ? 'disabled' : ''}>Proxima</button>
    </div>
  `;
}

function toneClassForStatus(status) {
  const normalized = String(status || '')
    .trim()
    .toLowerCase();
  if (['published', 'ready', 'done', 'online', 'active'].includes(normalized)) return 'status-success';
  if (['failed', 'error', 'deleted'].includes(normalized)) return 'status-danger';
  if (['uploading', 'processing', 'pending', 'draft'].includes(normalized)) return 'status-warning';
  return 'status-neutral';
}

function renderStatusBadge(label, tone = '') {
  const normalizedTone = tone || toneClassForStatus(label);
  return `<span class="status-badge ${normalizedTone}">${escapeHtml(label || 'n/a')}</span>`;
}

function isRowMenuOpen(kind, id) {
  return Boolean(state.rowMenu && state.rowMenu.kind === kind && String(state.rowMenu.id) === String(id));
}

function renderMenuWrap(kind, id, content) {
  const open = isRowMenuOpen(kind, id);
  return `
    <div class="menu-wrap" data-row-menu>
      <button class="menu-trigger" data-action="toggle-row-menu" data-row-kind="${escapeHtml(kind)}" data-row-id="${escapeHtml(id)}" aria-expanded="${open ? 'true' : 'false'}">⋯</button>
      ${open ? `<div class="row-menu">${content}</div>` : ''}
    </div>
  `;
}

function renderSparkline(values) {
  const source = Array.isArray(values) && values.length ? values.map((entry) => Math.max(0, Number(entry || 0))) : [0, 0, 0, 0, 0, 0, 0];
  const max = Math.max(...source, 1);
  const bars = source
    .map((value) => {
      const h = Math.max(4, Math.min(24, Math.round((value / max) * 24)));
      return `<span class="sparkbar" style="height:${h}px"></span>`;
    })
    .join('');
  return `<div class="sparkline">${bars}</div>`;
}

function buildMetricCards() {
  const { counters, marketplace, activeSessions } = getOverviewData();
  const series = Array.isArray(marketplace?.series_last_7_days) ? marketplace.series_last_7_days : [];

  const clicksSeries = series.map((row) => Number(row?.clicks || 0));
  const packsSeries = series.map((row) => Number(row?.packs_published || 0));
  const likesSeries = series.map((row) => Number(row?.likes || 0));
  const usersSeries = series.map((_, idx) => {
    const base = Math.max(1, Number(counters.known_google_users || counters.known_users || 1));
    return Math.max(0, Math.round((base * (idx + 3)) / 10));
  });

  return [
    {
      id: 'users',
      label: 'Usuarios',
      value: Number(counters.known_google_users || counters.known_users || 0),
      trend: `${fmtNum(activeSessions.length)} online`,
      trendTone: 'trend-neutral',
      bars: usersSeries,
    },
    {
      id: 'downloads',
      label: 'Downloads',
      value: Number(marketplace.total_clicks || 0),
      trend: `+${fmtNum(marketplace.clicks_last_7_days || 0)} nos ultimos 7 dias`,
      trendTone: 'trend-up',
      bars: clicksSeries,
    },
    {
      id: 'packs',
      label: 'Packs',
      value: Number(counters.total_packs_any_status || marketplace.total_packs || 0),
      trend: `+${fmtNum(marketplace.packs_last_7_days || 0)} esta semana`,
      trendTone: 'trend-up',
      bars: packsSeries,
    },
    {
      id: 'errors',
      label: 'Incidentes',
      value: Number(counters.active_bans || 0),
      trend: `${fmtNum(counters.active_bans || 0)} bloqueios ativos`,
      trendTone: Number(counters.active_bans || 0) > 0 ? 'trend-down' : 'trend-neutral',
      bars: likesSeries,
    },
  ];
}

function renderMetricCards() {
  const cards = buildMetricCards();
  return `
    <section class="metrics-grid">
      ${cards
        .map(
          (card) => `
            <article class="metric-card">
              <p class="metric-label">${escapeHtml(card.label)}</p>
              <p class="metric-value">${fmtNum(card.value)}</p>
              <div class="metric-foot">
                <span class="metric-trend ${escapeHtml(card.trendTone)}">${escapeHtml(card.trend)}</span>
                ${renderSparkline(card.bars)}
              </div>
            </article>
          `,
        )
        .join('')}
    </section>
  `;
}

function renderTabs() {
  return `
    <div class="tabs-strip">
      ${TAB_ITEMS.map((tab) => {
        const active = state.activeTab === tab.id;
        return `<button class="tab-btn ${active ? 'active' : ''}" data-action="switch-tab" data-tab-id="${escapeHtml(tab.id)}">${escapeHtml(tab.label)}</button>`;
      }).join('')}
    </div>
  `;
}

function renderUsersTab() {
  const { activeSessions, users } = getOverviewData();
  const token = normalizeToken(state.usersQuery);

  const filteredSessions = activeSessions.filter((row) => includesToken([row?.name, row?.email, row?.owner_jid, row?.google_sub], token));
  const filteredUsers = users.filter((row) => includesToken([row?.name, row?.email, row?.owner_jid, row?.google_sub], token));

  const sessionsPage = paginate(filteredSessions, 'sessions');
  const usersPage = paginate(filteredUsers, 'users');

  const sessionRowsDesktop = sessionsPage.items
    .map((row) => {
      const menu = renderMenuWrap('session', row?.session_token || row?.google_sub || row?.email || Math.random(), `<button class="row-menu-item danger" data-action="ban-user" data-email="${escapeHtml(row?.email || '')}" data-sub="${escapeHtml(row?.google_sub || '')}" data-owner="${escapeHtml(row?.owner_jid || '')}">Banir usuario</button>`);
      return `
        <tr>
          <td>
            <div class="row-title">${escapeHtml(row?.name || 'Conta Google')}</div>
            <div class="row-sub break-all">${escapeHtml(row?.email || '-')}</div>
            <div class="row-meta break-all">${escapeHtml(row?.owner_jid || '')}</div>
          </td>
          <td class="muted">${escapeHtml(fmtDate(row?.last_seen_at || row?.created_at))}</td>
          <td>${menu}</td>
        </tr>
      `;
    })
    .join('');

  const usersRowsDesktop = usersPage.items
    .map((row) => {
      const menu = renderMenuWrap('user', row?.google_sub || row?.email || row?.owner_jid || Math.random(), `<button class="row-menu-item danger" data-action="ban-user" data-email="${escapeHtml(row?.email || '')}" data-sub="${escapeHtml(row?.google_sub || '')}" data-owner="${escapeHtml(row?.owner_jid || '')}">Banir usuario</button>`);
      return `
        <tr>
          <td>
            <div class="row-title">${escapeHtml(row?.name || 'Conta Google')}</div>
            <div class="row-sub break-all">${escapeHtml(row?.email || '-')}</div>
            <div class="row-meta break-all">${escapeHtml(row?.owner_jid || '')}</div>
            <div class="row-meta break-all mono">${escapeHtml(row?.google_sub || '')}</div>
          </td>
          <td class="muted">${escapeHtml(fmtDate(row?.last_login_at || row?.last_seen_at || row?.updated_at))}</td>
          <td>${menu}</td>
        </tr>
      `;
    })
    .join('');

  const sessionsMobile = sessionsPage.items
    .map(
      (row) => `
        <article class="mobile-card">
          <p class="row-title">${escapeHtml(row?.name || 'Conta Google')}</p>
          <p class="row-sub break-all">${escapeHtml(row?.email || '-')}</p>
          <p class="row-meta break-all">${escapeHtml(row?.owner_jid || '')}</p>
          <div class="mobile-card-foot">
            <span class="muted">${escapeHtml(fmtDate(row?.last_seen_at || row?.created_at))}</span>
            <button class="danger-btn" data-action="ban-user" data-email="${escapeHtml(row?.email || '')}" data-sub="${escapeHtml(row?.google_sub || '')}" data-owner="${escapeHtml(row?.owner_jid || '')}">Banir</button>
          </div>
        </article>
      `,
    )
    .join('');

  const usersMobile = usersPage.items
    .map(
      (row) => `
        <article class="mobile-card">
          <p class="row-title">${escapeHtml(row?.name || 'Conta Google')}</p>
          <p class="row-sub break-all">${escapeHtml(row?.email || '-')}</p>
          <p class="row-meta break-all">${escapeHtml(row?.owner_jid || '')}</p>
          <p class="row-meta break-all mono">${escapeHtml(row?.google_sub || '')}</p>
          <div class="mobile-card-foot">
            <span class="muted">${escapeHtml(fmtDate(row?.last_login_at || row?.last_seen_at || row?.updated_at))}</span>
            <button class="danger-btn" data-action="ban-user" data-email="${escapeHtml(row?.email || '')}" data-sub="${escapeHtml(row?.google_sub || '')}" data-owner="${escapeHtml(row?.owner_jid || '')}">Banir</button>
          </div>
        </article>
      `,
    )
    .join('');

  return `
    <section class="stack">
      <section class="panel">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">Usuarios</h3>
            <p class="panel-desc">Monitore sessoes ativas e contas vinculadas ao marketplace.</p>
          </div>
          <form data-form="users-search" class="search-form compact">
            <input class="search-input" type="search" name="q" placeholder="Buscar por nome, email, owner_jid" value="${escapeHtml(state.usersQuery)}" />
            <button class="outline-btn" type="submit">Filtrar</button>
          </form>
        </div>
      </section>

      <div class="section-grid two-col">
        <section class="panel">
          <div class="panel-head slim">
            <h4 class="panel-title">Sessoes ativas (${fmtNum(sessionsPage.total)})</h4>
          </div>
          <div class="table-shell desktop-only">
            <table class="data-table">
              <thead>
                <tr><th>Usuario</th><th>Ultimo acesso</th><th>Acoes</th></tr>
              </thead>
              <tbody>
                ${sessionRowsDesktop || '<tr><td colspan="3" class="empty">Nenhuma sessao ativa.</td></tr>'}
              </tbody>
            </table>
          </div>
          <div class="mobile-list mobile-only">${sessionsMobile || '<div class="empty-box">Nenhuma sessao ativa.</div>'}</div>
          ${renderPagination('sessions', sessionsPage)}
        </section>

        <section class="panel">
          <div class="panel-head slim">
            <h4 class="panel-title">Usuarios conhecidos (${fmtNum(usersPage.total)})</h4>
          </div>
          <div class="table-shell desktop-only">
            <table class="data-table">
              <thead>
                <tr><th>Usuario</th><th>Ultimo login</th><th>Acoes</th></tr>
              </thead>
              <tbody>
                ${usersRowsDesktop || '<tr><td colspan="3" class="empty">Sem usuarios cadastrados.</td></tr>'}
              </tbody>
            </table>
          </div>
          <div class="mobile-list mobile-only">${usersMobile || '<div class="empty-box">Sem usuarios cadastrados.</div>'}</div>
          ${renderPagination('users', usersPage)}
        </section>
      </div>
    </section>
  `;
}

function renderPacksTab() {
  const packsPage = paginate(state.packs, 'packs');
  const selectedData = state.selectedPack?.pack ? state.selectedPack : state.selectedPack?.data || state.selectedPack;
  const selectedPack = selectedData?.pack || null;
  const selectedItems = Array.isArray(selectedPack?.items) ? selectedPack.items : [];

  const packRowsDesktop = packsPage.items
    .map((pack) => {
      const statusBadges = [renderStatusBadge(pack?.visibility || 'n/a'), renderStatusBadge(pack?.status || 'n/a'), renderStatusBadge(pack?.pack_status || 'ready')].join('');

      const menu = renderMenuWrap(
        'pack',
        pack?.pack_key || pack?.id || Math.random(),
        `
          <button class="row-menu-item" data-action="open-pack-admin" data-pack-key="${escapeHtml(pack?.pack_key || '')}">Ver detalhes</button>
          <a class="row-menu-item" href="${escapeHtml(pack?.web_url || `${webPath}/${encodeURIComponent(String(pack?.pack_key || ''))}`)}" target="_blank" rel="noreferrer">Abrir no catalogo</a>
          <button class="row-menu-item danger" data-action="delete-pack-admin" data-pack-key="${escapeHtml(pack?.pack_key || '')}">Apagar pack</button>
        `,
      );

      return `
        <tr>
          <td>
            <div class="row-title break-words">${escapeHtml(pack?.name || pack?.pack_key || 'Pack')}</div>
            <div class="row-sub break-all">${escapeHtml(pack?.pack_key || '')}</div>
            <div class="row-meta break-all">${escapeHtml(pack?.owner_jid || '')}</div>
          </td>
          <td>${statusBadges}</td>
          <td class="muted">${fmtNum(pack?.stickers_count)} stickers • ${fmtNum(pack?.like_count)} likes • ${fmtNum(pack?.open_count)} opens</td>
          <td>${menu}</td>
        </tr>
      `;
    })
    .join('');

  const packRowsMobile = packsPage.items
    .map(
      (pack) => `
        <article class="mobile-card">
          <p class="row-title break-words">${escapeHtml(pack?.name || pack?.pack_key || 'Pack')}</p>
          <p class="row-sub break-all">${escapeHtml(pack?.pack_key || '')}</p>
          <p class="row-meta break-all">${escapeHtml(pack?.owner_jid || '')}</p>
          <div class="badge-row">
            ${renderStatusBadge(pack?.visibility || 'n/a')}
            ${renderStatusBadge(pack?.status || 'n/a')}
            ${renderStatusBadge(pack?.pack_status || 'ready')}
          </div>
          <p class="row-meta">${fmtNum(pack?.stickers_count)} stickers • ${fmtNum(pack?.like_count)} likes • ${fmtNum(pack?.open_count)} opens</p>
          <div class="mobile-card-foot">
            <button class="outline-btn" data-action="open-pack-admin" data-pack-key="${escapeHtml(pack?.pack_key || '')}">Detalhes</button>
            <a class="outline-btn" href="${escapeHtml(pack?.web_url || `${webPath}/${encodeURIComponent(String(pack?.pack_key || ''))}`)}" target="_blank" rel="noreferrer">Abrir</a>
            <button class="danger-btn" data-action="delete-pack-admin" data-pack-key="${escapeHtml(pack?.pack_key || '')}">Apagar</button>
          </div>
        </article>
      `,
    )
    .join('');

  const detailItems = selectedItems
    .map(
      (item) => `
        <article class="detail-item">
          <img class="detail-thumb" src="${escapeHtml(item?.asset_url || '')}" alt="" />
          <div class="detail-content">
            <p class="row-title break-all">${escapeHtml(item?.sticker_id || '')}</p>
            <p class="row-meta">Posicao ${escapeHtml(item?.position)}</p>
            <p class="row-meta">${escapeHtml(item?.asset?.mimetype || '')}</p>
          </div>
          <div class="detail-actions">
            <button class="outline-btn" data-action="remove-pack-sticker" data-pack-key="${escapeHtml(selectedPack?.pack_key || '')}" data-sticker-id="${escapeHtml(item?.sticker_id || '')}">Remover do pack</button>
            <button class="danger-btn" data-action="delete-sticker-global-btn" data-sticker-id="${escapeHtml(item?.sticker_id || '')}">Apagar global</button>
          </div>
        </article>
      `,
    )
    .join('');

  return `
    <section class="stack">
      <section class="panel">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">Packs</h3>
            <p class="panel-desc">Moderacao completa de packs com busca e acoes rapidas.</p>
          </div>
          <form data-form="packs-search" class="search-form">
            <input class="search-input" type="search" name="q" placeholder="pack_key, nome, publisher, owner_jid" value="${escapeHtml(state.packsQuery)}" />
            <button class="primary-btn" type="submit">Buscar</button>
          </form>
        </div>

        <div class="table-shell desktop-only">
          <table class="data-table">
            <thead>
              <tr><th>Pack</th><th>Status</th><th>Metricas</th><th>Acoes</th></tr>
            </thead>
            <tbody>
              ${packRowsDesktop || '<tr><td colspan="4" class="empty">Nenhum pack encontrado.</td></tr>'}
            </tbody>
          </table>
        </div>
        <div class="mobile-list mobile-only">${packRowsMobile || '<div class="empty-box">Nenhum pack encontrado.</div>'}</div>
        ${renderPagination('packs', packsPage)}
      </section>

      <section class="panel">
        <div class="panel-head slim">
          <h4 class="panel-title">Pack selecionado</h4>
        </div>
        ${
          selectedPack
            ? `
            <div class="selected-pack-head">
              <div>
                <p class="row-title break-words">${escapeHtml(selectedPack?.name || selectedPack?.pack_key || 'Pack')}</p>
                <p class="row-sub break-all">${escapeHtml(selectedPack?.pack_key || '')}</p>
                <p class="row-meta break-all">${escapeHtml(selectedPack?.owner_jid || '')}</p>
                <div class="badge-row">
                  ${renderStatusBadge(selectedPack?.visibility || 'n/a')}
                  ${renderStatusBadge(selectedPack?.status || 'n/a')}
                  ${renderStatusBadge(selectedPack?.pack_status || 'ready')}
                </div>
              </div>
              <div class="selected-pack-actions">
                <a class="outline-btn" href="${escapeHtml(selectedPack?.web_url || `${webPath}/${encodeURIComponent(String(selectedPack?.pack_key || ''))}`)}" target="_blank" rel="noreferrer">Abrir</a>
                <button class="danger-btn" data-action="delete-pack-admin" data-pack-key="${escapeHtml(selectedPack?.pack_key || '')}">Apagar pack</button>
                <button class="outline-btn" data-action="ban-user" data-email="${escapeHtml(selectedPack?.owner_email || '')}" data-owner="${escapeHtml(selectedPack?.owner_jid || '')}">Banir dono</button>
              </div>
            </div>
            <div class="detail-list">${detailItems || '<div class="empty-box">Pack sem stickers.</div>'}</div>
          `
            : '<div class="empty-box">Selecione um pack na tabela para visualizar e moderar stickers.</div>'
        }
      </section>
    </section>
  `;
}

function renderLogsTab() {
  const { bans } = getOverviewData();
  const token = normalizeToken(state.logsQuery);
  const filteredBans = bans.filter((ban) => includesToken([ban?.email, ban?.owner_jid, ban?.google_sub, ban?.reason], token));
  const page = paginate(filteredBans, 'bans');

  const rowsDesktop = page.items
    .map((ban) => {
      const revoked = Boolean(ban?.revoked_at);
      const menu = revoked ? '' : renderMenuWrap('ban', ban?.id || Math.random(), `<button class="row-menu-item" data-action="revoke-ban" data-ban-id="${escapeHtml(ban?.id || '')}">Revogar banimento</button>`);

      return `
        <tr>
          <td>
            <div class="row-title break-all">${escapeHtml(ban?.email || ban?.owner_jid || ban?.google_sub || ban?.id || 'Ban')}</div>
            <div class="row-meta break-all">${escapeHtml(ban?.google_sub || '')}</div>
            <div class="row-meta break-all">${escapeHtml(ban?.owner_jid || '')}</div>
          </td>
          <td class="muted">${escapeHtml(ban?.reason || 'Sem motivo')}</td>
          <td class="muted">${escapeHtml(fmtDate(ban?.created_at))}</td>
          <td>${revoked ? renderStatusBadge('revogado', 'status-neutral') : renderStatusBadge('ativo', 'status-danger')}</td>
          <td>${menu || '<span class="muted">-</span>'}</td>
        </tr>
      `;
    })
    .join('');

  const rowsMobile = page.items
    .map(
      (ban) => `
        <article class="mobile-card">
          <p class="row-title break-all">${escapeHtml(ban?.email || ban?.owner_jid || ban?.google_sub || ban?.id || 'Ban')}</p>
          <p class="row-sub">${escapeHtml(ban?.reason || 'Sem motivo')}</p>
          <p class="row-meta">${escapeHtml(fmtDate(ban?.created_at))}</p>
          <div class="mobile-card-foot">
            ${Boolean(ban?.revoked_at) ? renderStatusBadge('revogado', 'status-neutral') : `<button class="outline-btn" data-action="revoke-ban" data-ban-id="${escapeHtml(ban?.id || '')}">Revogar</button>`}
          </div>
        </article>
      `,
    )
    .join('');

  return `
    <section class="stack">
      <section class="panel">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">Logs e bans</h3>
            <p class="panel-desc">Historico de bloqueios e auditoria de moderacao.</p>
          </div>
          <form data-form="logs-search" class="search-form compact">
            <input class="search-input" type="search" name="q" placeholder="Buscar email, owner_jid, motivo" value="${escapeHtml(state.logsQuery)}" />
            <button class="outline-btn" type="submit">Filtrar</button>
          </form>
        </div>

        <div class="table-shell desktop-only">
          <table class="data-table">
            <thead>
              <tr><th>Identidade</th><th>Motivo</th><th>Criado em</th><th>Status</th><th>Acoes</th></tr>
            </thead>
            <tbody>
              ${rowsDesktop || '<tr><td colspan="5" class="empty">Sem registros de log.</td></tr>'}
            </tbody>
          </table>
        </div>

        <div class="mobile-list mobile-only">${rowsMobile || '<div class="empty-box">Sem registros de log.</div>'}</div>
        ${renderPagination('bans', page)}
      </section>

      <section class="panel">
        <div class="panel-head slim">
          <h4 class="panel-title">Banir usuario manualmente</h4>
        </div>
        <form data-form="manual-ban" class="form-grid">
          <input class="search-input" name="email" placeholder="email@exemplo.com" />
          <input class="search-input" name="google_sub" placeholder="google_sub (opcional)" />
          <input class="search-input" name="owner_jid" placeholder="owner_jid (opcional)" />
          <input class="search-input" name="reason" placeholder="Motivo do banimento" />
          <button class="danger-btn" type="submit">Banir agora</button>
        </form>
      </section>
    </section>
  `;
}

function renderUploadsTab() {
  const { recentPacks } = getOverviewData();
  const page = paginate(recentPacks, 'uploads');

  const cards = page.items
    .map((pack) => {
      const status = String(pack?.status || '').toLowerCase();
      const progressMap = {
        published: 100,
        processing: 72,
        uploading: 48,
        draft: 28,
        failed: 100,
      };
      const progress = Number(progressMap[status] || 36);
      const uploadMenu = renderMenuWrap(
        'upload',
        pack?.pack_key || pack?.id || Math.random(),
        `
          <button class="row-menu-item" data-action="open-pack-admin" data-pack-key="${escapeHtml(pack?.pack_key || '')}">Ver detalhes</button>
          <a class="row-menu-item" href="${escapeHtml(pack?.web_url || `${webPath}/${encodeURIComponent(String(pack?.pack_key || ''))}`)}" target="_blank" rel="noreferrer">Abrir no catalogo</a>
        `,
      );
      return `
        <article class="upload-card">
          <div class="upload-card-head">
            <div>
              <p class="row-title break-words">${escapeHtml(pack?.name || pack?.pack_key || 'Pack')}</p>
              <p class="row-sub break-all">${escapeHtml(pack?.pack_key || '')}</p>
            </div>
            ${renderStatusBadge(pack?.status || 'draft')}
          </div>
          <div class="progress-wrap">
            <div class="progress-track"><span class="progress-bar" style="width:${Math.max(0, Math.min(100, progress))}%"></span></div>
            <span class="progress-meta">${progress}%</span>
          </div>
          <div class="upload-meta">
            <span>${fmtNum(pack?.sticker_count)} stickers</span>
            <span>${fmtDate(pack?.updated_at || pack?.created_at)}</span>
          </div>
          <div class="upload-actions">
            <button class="outline-btn" data-action="open-pack-admin" data-pack-key="${escapeHtml(pack?.pack_key || '')}">Ver pack</button>
            ${uploadMenu}
          </div>
        </article>
      `;
    })
    .join('');

  return `
    <section class="stack">
      <section class="panel">
        <div class="panel-head slim">
          <h3 class="panel-title">Uploads e processamento</h3>
          <p class="panel-desc">Visao compacta dos packs recentes e estado de processamento.</p>
        </div>
        <div class="upload-grid">
          ${cards || '<div class="empty-box">Sem uploads recentes.</div>'}
        </div>
        ${renderPagination('uploads', page)}
      </section>

      <section class="panel">
        <div class="panel-head slim">
          <h4 class="panel-title">Apagar sticker global</h4>
          <p class="panel-desc">Remove o sticker de todos os packs e limpa o asset quando ficar orfao.</p>
        </div>
        <form data-form="delete-sticker-global" class="search-form compact">
          <input class="search-input" name="sticker_id" placeholder="sticker_id (UUID)" />
          <button class="danger-btn" type="submit">Apagar</button>
        </form>
      </section>
    </section>
  `;
}

function renderSystemTab() {
  const { counters, marketplace, users } = getOverviewData();
  const authGoogle = state.adminStatus?.google || {};
  const moderators = Array.isArray(state.moderators) ? state.moderators : [];
  const ownerMode = canManageModerators();

  const moderatorRowsDesktop = moderators
    .map((row) => {
      const active = Boolean(row?.active && !row?.revoked_at);
      return `
        <tr>
          <td>
            <div class="row-title">${escapeHtml(row?.name || 'Moderador')}</div>
            <div class="row-sub break-all">${escapeHtml(row?.email || '-')}</div>
            <div class="row-meta break-all mono">${escapeHtml(row?.google_sub || '')}</div>
            <div class="row-meta break-all">${escapeHtml(row?.owner_jid || '')}</div>
          </td>
          <td>${active ? renderStatusBadge('ativo', 'status-success') : renderStatusBadge('revogado', 'status-neutral')}</td>
          <td class="muted">${escapeHtml(fmtDate(row?.last_login_at || row?.updated_at || row?.created_at))}</td>
          <td>
            ${active ? `<button class="danger-btn" data-action="revoke-moderator" data-google-sub="${escapeHtml(row?.google_sub || '')}">Remover</button>` : '<span class="muted">-</span>'}
          </td>
        </tr>
      `;
    })
    .join('');

  const moderatorRowsMobile = moderators
    .map(
      (row) => `
        <article class="mobile-card">
          <p class="row-title">${escapeHtml(row?.name || 'Moderador')}</p>
          <p class="row-sub break-all">${escapeHtml(row?.email || '-')}</p>
          <p class="row-meta break-all mono">${escapeHtml(row?.google_sub || '')}</p>
          <p class="row-meta break-all">${escapeHtml(row?.owner_jid || '')}</p>
          <div class="mobile-card-foot">
            ${Boolean(row?.active && !row?.revoked_at) ? renderStatusBadge('ativo', 'status-success') : renderStatusBadge('revogado', 'status-neutral')}
            ${Boolean(row?.active && !row?.revoked_at) ? `<button class="danger-btn" data-action="revoke-moderator" data-google-sub="${escapeHtml(row?.google_sub || '')}">Remover</button>` : ''}
          </div>
        </article>
      `,
    )
    .join('');

  const targetOptions = (Array.isArray(users) ? users : [])
    .slice(0, 120)
    .map((row) => {
      const email = String(row?.email || '').trim();
      const sub = String(row?.google_sub || '').trim();
      const owner = String(row?.owner_jid || '').trim();
      const name = String(row?.name || '').trim();
      const entries = [];
      if (email) entries.push(`<option value="${escapeHtml(email)}">${escapeHtml(name || email)}</option>`);
      if (sub) entries.push(`<option value="${escapeHtml(sub)}">${escapeHtml(name || sub)}</option>`);
      if (owner) entries.push(`<option value="${escapeHtml(owner)}">${escapeHtml(name || owner)}</option>`);
      return entries.join('');
    })
    .join('');

  return `
    <section class="stack">
      <section class="section-grid two-col">
        <article class="panel">
          <div class="panel-head slim">
            <h3 class="panel-title">Resumo do sistema</h3>
          </div>
          <div class="kv-grid">
            <div class="kv-item"><span class="kv-key">Packs totais</span><span class="kv-value">${fmtNum(counters.total_packs_any_status || marketplace.total_packs)}</span></div>
            <div class="kv-item"><span class="kv-key">Stickers totais</span><span class="kv-value">${fmtNum(counters.total_stickers_any_status || marketplace.total_stickers)}</span></div>
            <div class="kv-item"><span class="kv-key">Cliques globais</span><span class="kv-value">${fmtNum(marketplace.total_clicks)}</span></div>
            <div class="kv-item"><span class="kv-key">Likes globais</span><span class="kv-value">${fmtNum(marketplace.total_likes)}</span></div>
            <div class="kv-item"><span class="kv-key">Atualizado em</span><span class="kv-value">${escapeHtml(fmtDate(marketplace.updated_at))}</span></div>
            <div class="kv-item"><span class="kv-key">Sessoes ativas</span><span class="kv-value">${fmtNum(counters.active_google_sessions)}</span></div>
          </div>
        </article>

        <article class="panel">
          <div class="panel-head slim">
            <h3 class="panel-title">Autenticacao admin</h3>
          </div>
          <div class="kv-grid">
            <div class="kv-item"><span class="kv-key">Login provider</span><span class="kv-value">${escapeHtml(state.adminStatus?.session?.authenticated ? 'Google + senha' : 'Google')}</span></div>
            <div class="kv-item"><span class="kv-key">Google session</span><span class="kv-value">${authGoogle?.authenticated ? 'Ativa' : 'Inativa'}</span></div>
            <div class="kv-item"><span class="kv-key">Elegivel</span><span class="kv-value">${canUnlockAdmin() ? 'Sim' : 'Nao'}</span></div>
            <div class="kv-item"><span class="kv-key">Seu papel</span><span class="kv-value">${escapeHtml(getAdminRole() || 'owner')}</span></div>
            <div class="kv-item"><span class="kv-key">API base</span><span class="kv-value break-all mono">${escapeHtml(apiBasePath)}</span></div>
            <div class="kv-item"><span class="kv-key">Google client</span><span class="kv-value break-all mono">${escapeHtml(state.googleAuthConfig?.clientId || '-')}</span></div>
          </div>
        </article>
      </section>

      <article class="panel">
        <div class="panel-head slim">
          <h3 class="panel-title">Moderadores</h3>
          <p class="panel-desc">Acesso secundario do painel com senha individual e sessao Google obrigatoria.</p>
        </div>
        ${
          ownerMode
            ? `
            <form data-form="moderator-upsert" class="form-grid">
              <input class="search-input" list="moderator-target-list" name="target" placeholder="email, google_sub ou owner_jid do usuario logado" />
              <datalist id="moderator-target-list">${targetOptions}</datalist>
              <input class="search-input" type="password" name="password" placeholder="Senha do moderador" autocomplete="new-password" />
              <button class="primary-btn" type="submit">Salvar moderador</button>
              <p class="hint">Somente usuarios que ja fizeram login Google no site podem virar moderadores.</p>
            </form>

            <div class="table-shell desktop-only">
              <table class="data-table">
                <thead>
                  <tr><th>Usuario</th><th>Status</th><th>Ultimo login</th><th>Acoes</th></tr>
                </thead>
                <tbody>
                  ${moderatorRowsDesktop || '<tr><td colspan="4" class="empty">Nenhum moderador cadastrado.</td></tr>'}
                </tbody>
              </table>
            </div>
            <div class="mobile-list mobile-only">${moderatorRowsMobile || '<div class="empty-box">Nenhum moderador cadastrado.</div>'}</div>
          `
            : '<div class="empty-box">Sessao atual de moderador. Apenas o owner pode cadastrar/remover moderadores.</div>'
        }
      </article>

      <article class="panel">
        <div class="panel-head slim">
          <h3 class="panel-title">Snapshot marketplace</h3>
          <p class="panel-desc">Dados consolidados para auditoria rapida.</p>
        </div>
        <pre class="code-block">${escapeHtml(JSON.stringify({ counters, marketplace }, null, 2))}</pre>
      </article>
    </section>
  `;
}

function renderActiveTabContent() {
  if (state.activeTab === 'users') return renderUsersTab();
  if (state.activeTab === 'packs') return renderPacksTab();
  if (state.activeTab === 'logs') return renderLogsTab();
  if (state.activeTab === 'uploads') return renderUploadsTab();
  return renderSystemTab();
}

function renderSidebar({ mobile = false } = {}) {
  const { counters } = getOverviewData();
  const countMap = {
    users: Number(counters.known_google_users || counters.known_users || 0),
    packs: Number(counters.total_packs_any_status || 0),
    logs: Number(counters.active_bans || 0),
    uploads: Number((getOverviewData().recentPacks || []).length || 0),
    system: Number(counters.active_google_sessions || 0),
  };

  const nav = `
    <nav class="nav-group">
      ${TAB_ITEMS.map((tab) => {
        const active = state.activeTab === tab.id;
        const count = countMap[tab.id] || 0;
        return `
          <button class="nav-item ${active ? 'active' : ''}" data-action="switch-tab" data-tab-id="${escapeHtml(tab.id)}">
            <span>${escapeHtml(tab.label)}</span>
            <span class="nav-count">${fmtNum(count)}</span>
          </button>
        `;
      }).join('')}
    </nav>
  `;

  if (!mobile) {
    return `
      <aside class="sidebar desktop-only">
        ${nav}
        <div class="sidebar-footer">
          <button class="subtle-btn" data-action="refresh-dashboard" ${state.busy ? 'disabled' : ''}>Atualizar dados</button>
          ${isAdminAuthenticated() ? `<button class="subtle-btn danger" data-action="logout-admin" ${state.busy ? 'disabled' : ''}>Sair do admin</button>` : ''}
        </div>
      </aside>
    `;
  }

  if (!state.sidebarOpen) return '';

  return `
    <div class="drawer" data-drawer>
      <div class="drawer-backdrop" data-action="close-sidebar"></div>
      <aside class="drawer-panel">
        <div class="drawer-head">
          <p class="panel-title">Navegacao</p>
          <button class="icon-btn" data-action="close-sidebar">✕</button>
        </div>
        ${nav}
      </aside>
    </div>
  `;
}

function renderHeader() {
  const adminUser = state.adminStatus?.session?.user || null;
  const adminRole = getAdminRole();
  const roleLabel = adminRole === 'owner' ? 'owner' : adminRole === 'moderator' ? 'moderador' : '';
  return `
    <header class="topbar">
      <div class="topbar-inner">
        <div class="topbar-left">
          <button class="icon-btn mobile-only" data-action="toggle-sidebar" aria-label="Abrir menu">☰</button>
          <span class="brand-dot"></span>
          <div>
            <p class="brand-title">OmniZap Admin</p>
            <p class="brand-sub">Painel SaaS • Moderacao</p>
          </div>
        </div>
        <div class="topbar-actions">
          <button class="ghost-btn" data-action="refresh-dashboard" ${state.busy ? 'disabled' : ''}>Atualizar</button>
          ${isAdminAuthenticated() ? `<span class="user-chip">${escapeHtml(`${roleLabel ? `${roleLabel} • ` : ''}${adminUser?.email || adminUser?.name || 'Admin'}`)}</span>` : '<span class="user-chip muted">Nao autenticado</span>'}
          ${isAdminAuthenticated() ? `<button class="ghost-btn danger" data-action="logout-admin" ${state.busy ? 'disabled' : ''}>Sair</button>` : `<button class="ghost-btn" data-action="refresh-admin-status" ${state.busy ? 'disabled' : ''}>Revalidar</button>`}
        </div>
      </div>
    </header>
  `;
}

function renderSkeletonView() {
  return `
    <section class="stack">
      <div class="metrics-grid">
        ${Array.from({ length: 4 })
          .map(
            () => `
              <article class="metric-card skeleton">
                <div class="skeleton-line w-30"></div>
                <div class="skeleton-line w-60"></div>
                <div class="skeleton-line w-80"></div>
              </article>
            `,
          )
          .join('')}
      </div>
      <section class="panel skeleton">
        <div class="skeleton-line w-50"></div>
        <div class="skeleton-line w-90"></div>
        <div class="skeleton-line w-85"></div>
      </section>
    </section>
  `;
}

function renderUnlockView() {
  const adminStatus = state.adminStatus || {};
  const google = adminStatus.google || {};
  const googleSession = google?.user ? google : { authenticated: false };
  const localGoogleCache = readLocalGoogleAuthCache();
  const hasLocalCache = Boolean(localGoogleCache?.user?.sub);
  const googleConfigEnabled = Boolean(state.googleAuthConfig?.enabled && state.googleAuthConfig?.clientId);

  return `
    <section class="stack">
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">Controle total do marketplace</h2>
            <p class="panel-desc">Autenticacao dupla: conta Google (owner ou moderador autorizado) + senha do painel.</p>
          </div>
          <a class="outline-btn" href="${escapeHtml(webPath)}">Voltar ao catalogo</a>
        </div>

        <div class="section-grid two-col">
          <article class="panel inner">
            <div class="panel-head slim">
              <h3 class="panel-title">Login Google do site</h3>
              <button class="subtle-btn" data-action="refresh-admin-status" ${state.busy ? 'disabled' : ''}>Revalidar</button>
            </div>

            ${
              googleSession?.authenticated
                ? `
                <div class="account-box">
                  <p class="row-title">${escapeHtml(googleSession.user?.name || 'Conta Google')}</p>
                  <p class="row-sub break-all">${escapeHtml(googleSession.user?.email || '')}</p>
                  <p class="row-meta">${canUnlockAdmin() ? 'Conta elegivel para admin.' : 'Conta Google logada nao esta elegivel para admin.'}</p>
                </div>
              `
                : `
                <div class="account-box warning">
                  <p class="row-title">Nenhuma sessao Google ativa no servidor.</p>
                  ${hasLocalCache ? `<p class="row-sub">Sessao local encontrada: ${escapeHtml(localGoogleCache.user?.email || localGoogleCache.user?.name || 'Conta Google')}.</p>` : '<p class="row-sub">Nao encontramos cache local de login Google.</p>'}
                  <p class="row-meta">Renove o login Google abaixo para continuar.</p>
                </div>
                ${
                  googleConfigEnabled
                    ? `
                    <div class="google-login-box">
                      <div data-google-admin-login-button class="google-login-slot"></div>
                      ${state.googleLoginUiReady ? '' : '<p class="row-meta">Carregando botao de login Google...</p>'}
                    </div>
                  `
                    : `<p class="row-meta">Login Google indisponivel no painel (${escapeHtml(state.googleAuthConfigError || 'config nao encontrada')}).</p>`
                }
              `
            }
          </article>

          <article class="panel inner">
            <div class="panel-head slim">
              <h3 class="panel-title">Senha do painel</h3>
            </div>
            <form data-form="admin-unlock" class="form-grid">
              <input class="search-input" type="password" name="password" placeholder="Digite a senha do painel" autocomplete="current-password" />
              <button class="primary-btn" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Validando...' : 'Desbloquear Painel'}</button>
              ${!canUnlockAdmin() ? '<p class="hint warning">A senha so desbloqueia apos sessao Google elegivel (owner ou moderador autorizado).</p>' : '<p class="hint">Sessao Google elegivel detectada. Informe a senha correspondente.</p>'}
            </form>
          </article>
        </div>
      </section>
    </section>
  `;
}

function renderToast() {
  if (!state.toast?.message) return '';
  const tone = state.toast.type === 'error' ? 'toast danger' : 'toast success';
  return `<div class="toast-stack"><div class="${tone}">${escapeHtml(state.toast.message)}</div></div>`;
}

function renderMainContent() {
  if (state.loading) return renderSkeletonView();
  if (!isAdminAuthenticated()) return renderUnlockView();

  return `
    <section class="stack">
      ${renderMetricCards()}
      ${renderTabs()}
      ${renderActiveTabContent()}
    </section>
  `;
}

function renderLayout() {
  root.innerHTML = `
    <div class="admin-app">
      ${renderHeader()}
      <div class="layout-wrap">
        ${renderSidebar()}
        <main class="main">
          ${state.error ? `<div class="inline-alert">${escapeHtml(state.error)}</div>` : ''}
          ${renderMainContent()}
        </main>
      </div>
      ${renderSidebar({ mobile: true })}
      ${renderToast()}
    </div>
  `;
}

function render() {
  renderLayout();
  void ensureGoogleLoginButtonRendered();
}

async function loadAdminStatus() {
  const payload = await fetchJson(`${adminApiBase}/session`);
  state.adminStatus = payload?.data || null;
}

async function loadGoogleAuthConfig() {
  try {
    const payload = await fetchJson(createConfigApiPath);
    const google = payload?.data?.auth?.google || {};
    state.googleAuthConfig = {
      enabled: Boolean(google?.enabled),
      clientId: String(google?.client_id || '').trim(),
    };
    state.googleAuthConfigError = '';
  } catch {
    state.googleAuthConfig = { enabled: false, clientId: '' };
    state.googleAuthConfigError = 'Falha ao carregar configuracao Google.';
  }
}

async function loadOverview() {
  const payload = await fetchJson(`${adminApiBase}/overview`);
  state.overview = payload?.data || null;
}

async function loadPacks(query = state.packsQuery) {
  state.packsQuery = String(query || '').trim();
  const params = new URLSearchParams();
  params.set('limit', '120');
  if (state.packsQuery) params.set('q', state.packsQuery);
  const payload = await fetchJson(`${adminApiBase}/packs?${params.toString()}`);
  state.packs = Array.isArray(payload?.data) ? payload.data : [];
}

async function loadModerators() {
  if (!canManageModerators()) {
    state.moderators = [];
    return;
  }
  const payload = await fetchJson(`${adminApiBase}/moderators`);
  state.moderators = Array.isArray(payload?.data?.moderators) ? payload.data.moderators : [];
}

async function loadSelectedPack(packKey) {
  const normalized = String(packKey || '').trim();
  if (!normalized) {
    state.selectedPackKey = '';
    state.selectedPack = null;
    return;
  }
  state.selectedPackKey = normalized;
  const payload = await fetchJson(`${adminApiBase}/packs/${encodeURIComponent(normalized)}`);
  state.selectedPack = payload?.data || null;
}

async function bootstrapDashboardData() {
  const jobs = [loadOverview(), loadPacks(state.packsQuery || '')];
  if (canManageModerators()) jobs.push(loadModerators());
  else state.moderators = [];
  await Promise.all(jobs);
  if (state.selectedPackKey) {
    await loadSelectedPack(state.selectedPackKey).catch(() => {
      state.selectedPack = null;
      state.selectedPackKey = '';
    });
  }
}

async function runTask(task, { successMessage = '', keepError = false } = {}) {
  if (state.busy) return;
  setBusy(true);
  if (!keepError) clearError();
  render();
  try {
    await task();
    if (successMessage) setToast('success', successMessage);
  } catch (error) {
    setError(error?.message || 'Falha ao executar operacao.');
  } finally {
    setBusy(false);
    render();
  }
}

async function boot() {
  state.loading = true;
  clearError();
  render();
  try {
    await Promise.all([loadAdminStatus(), loadGoogleAuthConfig()]);
    if (isAdminAuthenticated()) {
      await bootstrapDashboardData();
    }
  } catch (error) {
    setError(error?.message || 'Falha ao carregar painel admin.');
  } finally {
    state.loading = false;
    render();
  }
}

async function refreshAdminStatusOnly() {
  await runTask(
    async () => {
      await Promise.all([loadAdminStatus(), loadGoogleAuthConfig()]);
    },
    { successMessage: 'Status de autenticacao atualizado.' },
  );
}

async function refreshDashboard() {
  await runTask(
    async () => {
      await Promise.all([loadAdminStatus(), loadGoogleAuthConfig()]);
      if (!isAdminAuthenticated()) {
        state.overview = null;
        state.packs = [];
        state.moderators = [];
        state.selectedPack = null;
        state.selectedPackKey = '';
        return;
      }
      await bootstrapDashboardData();
    },
    { successMessage: 'Painel atualizado.' },
  );
}

async function loginGoogleForAdmin(credential) {
  await runTask(
    async () => {
      const payload = await fetchJson(googleSessionApiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ google_id_token: credential }),
      });
      const data = payload?.data || {};
      if (!data?.authenticated || !data?.user?.sub) {
        throw new Error('Nao foi possivel criar sessao Google do site.');
      }
      await loadAdminStatus();
    },
    { successMessage: 'Sessao Google renovada.' },
  );
}

async function unlockAdmin(password) {
  await runTask(
    async () => {
      if (!canUnlockAdmin()) {
        const google = state.adminStatus?.google || {};
        if (!google?.authenticated) {
          const local = readLocalGoogleAuthCache();
          if (local?.user?.email) {
            throw new Error(`Sua sessao Google do servidor expirou. Renove o login Google (${local.user.email}) e tente novamente.`);
          }
          throw new Error('Faca login Google no site com o email admin antes de digitar a senha.');
        }
        throw new Error('Conta Google atual nao esta elegivel para desbloquear o painel.');
      }

      const payload = await fetchJson(`${adminApiBase}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ password }),
      });
      state.adminStatus = payload?.data || null;
      state.activeTab = 'users';
      await bootstrapDashboardData();
    },
    { successMessage: 'Painel admin desbloqueado.' },
  );
}

async function logoutAdmin() {
  await runTask(
    async () => {
      await fetchJson(`${adminApiBase}/session`, { method: 'DELETE' });
      await loadAdminStatus();
      state.overview = null;
      state.packs = [];
      state.moderators = [];
      state.selectedPack = null;
      state.selectedPackKey = '';
    },
    { successMessage: 'Sessao admin encerrada.' },
  );
}

async function searchPacks(query) {
  await runTask(async () => {
    state.pagination.packs = 1;
    await loadPacks(query);
  });
}

async function openPackDetailsAdmin(packKey) {
  await runTask(async () => {
    state.activeTab = 'packs';
    await loadSelectedPack(packKey);
  });
}

async function deletePackAdmin(packKey) {
  if (!window.confirm(`Apagar pack "${packKey}"?`)) return;
  await runTask(
    async () => {
      await fetchJson(`${adminApiBase}/packs/${encodeURIComponent(packKey)}/delete`, { method: 'DELETE' });
      await loadPacks(state.packsQuery || '');
      if (state.selectedPackKey === packKey) {
        state.selectedPack = null;
        state.selectedPackKey = '';
      }
      if (state.overview) await loadOverview();
    },
    { successMessage: 'Pack removido.' },
  );
}

async function removeStickerFromPackAdmin(packKey, stickerId) {
  if (!window.confirm(`Remover sticker ${stickerId} do pack ${packKey}?`)) return;
  await runTask(
    async () => {
      await fetchJson(`${adminApiBase}/packs/${encodeURIComponent(packKey)}/stickers/${encodeURIComponent(stickerId)}/delete`, {
        method: 'DELETE',
      });
      await loadSelectedPack(packKey);
      await loadPacks(state.packsQuery || '');
      if (state.overview) await loadOverview();
    },
    { successMessage: 'Sticker removido do pack.' },
  );
}

async function forceDeleteStickerAdmin(stickerId) {
  if (!window.confirm(`Apagar sticker ${stickerId} globalmente (todas as referencias)?`)) return;
  await runTask(
    async () => {
      await fetchJson(`${adminApiBase}/stickers/${encodeURIComponent(stickerId)}/delete`, { method: 'DELETE' });
      if (state.selectedPackKey) {
        await loadSelectedPack(state.selectedPackKey).catch(() => {
          state.selectedPack = null;
        });
      }
      await loadPacks(state.packsQuery || '');
      if (state.overview) await loadOverview();
    },
    { successMessage: 'Sticker removido globalmente.' },
  );
}

async function createBanAdmin(payload) {
  await runTask(
    async () => {
      await fetchJson(`${adminApiBase}/bans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload),
      });
      await loadOverview();
    },
    { successMessage: 'Usuario banido.' },
  );
}

async function revokeBanAdmin(banId) {
  if (!window.confirm('Revogar este banimento?')) return;
  await runTask(
    async () => {
      await fetchJson(`${adminApiBase}/bans/${encodeURIComponent(banId)}/revoke`, { method: 'DELETE' });
      await loadOverview();
    },
    { successMessage: 'Banimento revogado.' },
  );
}

async function upsertModeratorAdmin(payload) {
  await runTask(
    async () => {
      await fetchJson(`${adminApiBase}/moderators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload),
      });
      await Promise.all([loadModerators(), loadOverview()]);
    },
    { successMessage: 'Moderador salvo com sucesso.' },
  );
}

async function revokeModeratorAdmin(googleSub) {
  const normalized = String(googleSub || '').trim();
  if (!normalized) return;
  if (!window.confirm('Remover acesso deste moderador?')) return;
  await runTask(
    async () => {
      await fetchJson(`${adminApiBase}/moderators/${encodeURIComponent(normalized)}`, {
        method: 'DELETE',
      });
      await Promise.all([loadModerators(), loadOverview()]);
    },
    { successMessage: 'Moderador removido.' },
  );
}

async function ensureGoogleLoginButtonRendered() {
  if (state.loading || isAdminAuthenticated()) return;
  const googleSession = state.adminStatus?.google || {};
  if (googleSession?.authenticated) return;
  const clientId = String(state.googleAuthConfig?.clientId || '').trim();
  if (!clientId || !state.googleAuthConfig?.enabled) return;

  const mount = root.querySelector('[data-google-admin-login-button]');
  if (!(mount instanceof HTMLElement)) return;

  const renderNonce = ++googleLoginRenderNonce;
  state.googleLoginUiReady = false;

  try {
    await loadScript(GOOGLE_GSI_SCRIPT_SRC);
    if (renderNonce !== googleLoginRenderNonce) return;

    const accounts = window.google?.accounts?.id;
    if (!accounts) throw new Error('SDK do Google indisponivel no navegador.');

    accounts.initialize({
      client_id: clientId,
      callback: async (response) => {
        const credential = String(response?.credential || '').trim();
        const claims = decodeJwtPayload(credential);
        if (!credential || !claims?.sub) {
          setError('Falha ao concluir login Google.');
          render();
          return;
        }
        await loginGoogleForAdmin(credential);
        render();
      },
      auto_select: false,
      cancel_on_tap_outside: true,
    });

    mount.innerHTML = '';
    const measuredWidth = Math.floor(Number(mount.clientWidth || 0));
    const buttonWidth = Math.max(220, Math.min(360, measuredWidth || 320));
    accounts.renderButton(mount, {
      type: 'standard',
      theme: 'filled_black',
      size: 'large',
      text: 'signin_with',
      shape: 'pill',
      logo_alignment: 'left',
      width: buttonWidth,
    });
    state.googleLoginUiReady = true;
  } catch (error) {
    if (renderNonce !== googleLoginRenderNonce) return;
    state.googleLoginUiReady = false;
    setError(error?.message || 'Falha ao carregar login Google no painel admin.');
  }
}

root.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  const formType = form.dataset.form;
  if (!formType) return;
  event.preventDefault();

  if (formType === 'admin-unlock') {
    const password = String(new FormData(form).get('password') || '').trim();
    if (!password) {
      setError('Informe a senha do painel admin.');
      render();
      return;
    }
    await unlockAdmin(password);
    return;
  }

  if (formType === 'users-search') {
    state.usersQuery = String(new FormData(form).get('q') || '').trim();
    state.pagination.sessions = 1;
    state.pagination.users = 1;
    render();
    return;
  }

  if (formType === 'packs-search') {
    const q = String(new FormData(form).get('q') || '').trim();
    await searchPacks(q);
    return;
  }

  if (formType === 'logs-search') {
    state.logsQuery = String(new FormData(form).get('q') || '').trim();
    state.pagination.bans = 1;
    render();
    return;
  }

  if (formType === 'moderator-upsert') {
    const fd = new FormData(form);
    const target = String(fd.get('target') || '').trim();
    const password = String(fd.get('password') || '').trim();
    if (!target) {
      setError('Informe email, google_sub ou owner_jid do moderador.');
      render();
      return;
    }
    if (password.length < 8) {
      setError('A senha do moderador deve ter no minimo 8 caracteres.');
      render();
      return;
    }
    const payload = { password };
    if (target.includes('@') && !target.endsWith('@s.whatsapp.net')) payload.email = target;
    else if (target.endsWith('@s.whatsapp.net')) payload.owner_jid = target;
    else payload.google_sub = target;
    await upsertModeratorAdmin(payload);
    form.reset();
    return;
  }

  if (formType === 'manual-ban') {
    const fd = new FormData(form);
    const payload = {
      email: String(fd.get('email') || '').trim(),
      google_sub: String(fd.get('google_sub') || '').trim(),
      owner_jid: String(fd.get('owner_jid') || '').trim(),
      reason: String(fd.get('reason') || '').trim(),
    };
    if (!payload.email && !payload.google_sub && !payload.owner_jid) {
      setError('Informe email, google_sub ou owner_jid para banir.');
      render();
      return;
    }
    await createBanAdmin(payload);
    form.reset();
    return;
  }

  if (formType === 'delete-sticker-global') {
    const stickerId = String(new FormData(form).get('sticker_id') || '').trim();
    if (!stickerId) {
      setError('Informe o sticker_id para apagar.');
      render();
      return;
    }
    await forceDeleteStickerAdmin(stickerId);
  }
});

root.addEventListener('click', async (event) => {
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (!target) return;

  const actionEl = target.closest('[data-action]');
  const clickedInsideMenu = Boolean(target.closest('[data-row-menu]'));

  if (!clickedInsideMenu && (!actionEl || actionEl.dataset.action !== 'toggle-row-menu') && state.rowMenu) {
    state.rowMenu = null;
    render();
    return;
  }

  if (!(actionEl instanceof HTMLElement)) return;

  const action = actionEl.dataset.action;
  if (!action) return;

  if (action === 'toggle-sidebar') {
    state.sidebarOpen = !state.sidebarOpen;
    render();
    return;
  }

  if (action === 'close-sidebar') {
    state.sidebarOpen = false;
    render();
    return;
  }

  if (action === 'switch-tab') {
    const tabId = String(actionEl.dataset.tabId || '').trim();
    if (TAB_ITEMS.some((tab) => tab.id === tabId)) {
      state.activeTab = tabId;
      state.sidebarOpen = false;
      state.rowMenu = null;
      render();
    }
    return;
  }

  if (action === 'refresh-dashboard') {
    await refreshDashboard();
    return;
  }

  if (action === 'refresh-admin-status') {
    await refreshAdminStatusOnly();
    return;
  }

  if (action === 'logout-admin') {
    await logoutAdmin();
    return;
  }

  if (action === 'toggle-row-menu') {
    const kind = String(actionEl.dataset.rowKind || '').trim();
    const id = String(actionEl.dataset.rowId || '').trim();
    if (!kind || !id) return;
    if (isRowMenuOpen(kind, id)) {
      state.rowMenu = null;
    } else {
      state.rowMenu = { kind, id };
    }
    render();
    return;
  }

  if (action === 'page-nav') {
    const targetKey = String(actionEl.dataset.pageTarget || '').trim();
    const nextPage = Number(actionEl.dataset.page || 1);
    if (!targetKey || !Number.isFinite(nextPage)) return;
    state.pagination[targetKey] = Math.max(1, Math.floor(nextPage));
    render();
    return;
  }

  if (action === 'open-pack-admin') {
    state.rowMenu = null;
    await openPackDetailsAdmin(actionEl.dataset.packKey || '');
    return;
  }

  if (action === 'delete-pack-admin') {
    state.rowMenu = null;
    await deletePackAdmin(actionEl.dataset.packKey || '');
    return;
  }

  if (action === 'remove-pack-sticker') {
    state.rowMenu = null;
    await removeStickerFromPackAdmin(actionEl.dataset.packKey || '', actionEl.dataset.stickerId || '');
    return;
  }

  if (action === 'delete-sticker-global-btn') {
    state.rowMenu = null;
    await forceDeleteStickerAdmin(actionEl.dataset.stickerId || '');
    return;
  }

  if (action === 'ban-user') {
    state.rowMenu = null;
    const reason = window.prompt('Motivo do banimento (opcional):', 'Violacao das regras do marketplace') || '';
    await createBanAdmin({
      email: actionEl.dataset.email || '',
      google_sub: actionEl.dataset.sub || '',
      owner_jid: actionEl.dataset.owner || '',
      reason,
    });
    return;
  }

  if (action === 'revoke-ban') {
    state.rowMenu = null;
    await revokeBanAdmin(actionEl.dataset.banId || '');
    return;
  }

  if (action === 'revoke-moderator') {
    await revokeModeratorAdmin(actionEl.dataset.googleSub || '');
  }
});

boot();
