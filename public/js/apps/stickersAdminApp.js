const root = document.getElementById('stickers-admin-root');

if (!root) {
  throw new Error('stickers-admin-root não encontrado.');
}

const apiBasePath = root.dataset.apiBasePath || '/api/sticker-packs';
const webPath = root.dataset.webPath || '/stickers';
const adminApiBase = `${apiBasePath}/admin`;

const state = {
  loading: true,
  busy: false,
  adminStatus: null,
  overview: null,
  packs: [],
  selectedPackKey: '',
  selectedPack: null,
  packsQuery: '',
  error: '',
  notice: '',
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const fmtNum = (value) =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Math.max(0, Number(value || 0)));

const fmtDate = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return raw;
  return dt.toLocaleString('pt-BR');
};

const isAdminAuthenticated = () => Boolean(state.adminStatus?.session?.authenticated);
const canUnlockAdmin = () => Boolean(state.adminStatus?.eligible_google_login);

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

function setError(message) {
  state.error = String(message || '');
}

function setNotice(message) {
  state.notice = String(message || '');
  if (!state.notice) return;
  window.clearTimeout(setNotice._timer);
  setNotice._timer = window.setTimeout(() => {
    if (state.notice === message) {
      state.notice = '';
      render();
    }
  }, 3500);
}

async function loadAdminStatus() {
  const payload = await fetchJson(`${adminApiBase}/session`);
  state.adminStatus = payload?.data || null;
}

async function loadOverview() {
  const payload = await fetchJson(`${adminApiBase}/overview`);
  state.overview = payload?.data || null;
}

async function loadPacks(query = state.packsQuery) {
  state.packsQuery = String(query || '').trim();
  const params = new URLSearchParams();
  params.set('limit', '80');
  if (state.packsQuery) params.set('q', state.packsQuery);
  const payload = await fetchJson(`${adminApiBase}/packs?${params.toString()}`);
  state.packs = Array.isArray(payload?.data) ? payload.data : [];
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

async function boot() {
  state.loading = true;
  setError('');
  try {
    await loadAdminStatus();
    if (isAdminAuthenticated()) {
      await Promise.all([loadOverview(), loadPacks('')]);
    }
  } catch (error) {
    setError(error?.message || 'Falha ao carregar painel admin.');
  } finally {
    state.loading = false;
    render();
  }
}

async function runTask(task, { successMessage = '', rerender = true } = {}) {
  if (state.busy) return;
  state.busy = true;
  setError('');
  try {
    await task();
    if (successMessage) setNotice(successMessage);
  } catch (error) {
    setError(error?.message || 'Falha na operação.');
  } finally {
    state.busy = false;
    if (rerender) render();
  }
}

async function unlockAdmin(password) {
  await runTask(async () => {
    const payload = await fetchJson(`${adminApiBase}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ password }),
    });
    state.adminStatus = payload?.data || null;
    await Promise.all([loadOverview(), loadPacks('')]);
  }, { successMessage: 'Painel admin desbloqueado.' });
}

async function logoutAdmin() {
  await runTask(async () => {
    await fetchJson(`${adminApiBase}/session`, { method: 'DELETE' });
    await loadAdminStatus();
    state.overview = null;
    state.packs = [];
    state.selectedPack = null;
    state.selectedPackKey = '';
  }, { successMessage: 'Sessão admin encerrada.' });
}

async function refreshDashboard() {
  await runTask(async () => {
    await loadAdminStatus();
    if (!isAdminAuthenticated()) {
      state.overview = null;
      state.packs = [];
      state.selectedPack = null;
      return;
    }
    await Promise.all([loadOverview(), loadPacks(state.packsQuery || '')]);
    if (state.selectedPackKey) {
      await loadSelectedPack(state.selectedPackKey);
    }
  }, { successMessage: 'Painel atualizado.' });
}

async function searchPacks(query) {
  await runTask(async () => {
    await loadPacks(query);
  });
}

async function openPackDetailsAdmin(packKey) {
  await runTask(async () => {
    await loadSelectedPack(packKey);
  });
}

async function deletePackAdmin(packKey) {
  if (!window.confirm(`Apagar pack "${packKey}"?`)) return;
  await runTask(async () => {
    await fetchJson(`${adminApiBase}/packs/${encodeURIComponent(packKey)}/delete`, { method: 'DELETE' });
    await loadPacks(state.packsQuery || '');
    if (state.selectedPackKey === packKey) {
      state.selectedPack = null;
      state.selectedPackKey = '';
    }
    if (state.overview) await loadOverview();
  }, { successMessage: 'Pack removido.' });
}

async function removeStickerFromPackAdmin(packKey, stickerId) {
  if (!window.confirm(`Remover sticker ${stickerId} do pack ${packKey}?`)) return;
  await runTask(async () => {
    await fetchJson(`${adminApiBase}/packs/${encodeURIComponent(packKey)}/stickers/${encodeURIComponent(stickerId)}/delete`, {
      method: 'DELETE',
    });
    await loadSelectedPack(packKey);
    await loadPacks(state.packsQuery || '');
    if (state.overview) await loadOverview();
  }, { successMessage: 'Sticker removido do pack.' });
}

async function forceDeleteStickerAdmin(stickerId) {
  if (!window.confirm(`Apagar sticker ${stickerId} globalmente (todas as referências)?`)) return;
  await runTask(async () => {
    await fetchJson(`${adminApiBase}/stickers/${encodeURIComponent(stickerId)}/delete`, { method: 'DELETE' });
    if (state.selectedPackKey) {
      await loadSelectedPack(state.selectedPackKey).catch(() => {
        state.selectedPack = null;
      });
    }
    await loadPacks(state.packsQuery || '');
    if (state.overview) await loadOverview();
  }, { successMessage: 'Sticker removido globalmente.' });
}

async function createBanAdmin(payload) {
  await runTask(async () => {
    await fetchJson(`${adminApiBase}/bans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
    });
    if (state.overview) await loadOverview();
    await loadSelectedPack(state.selectedPackKey).catch(() => {});
  }, { successMessage: 'Usuário banido.' });
}

async function revokeBanAdmin(banId) {
  if (!window.confirm('Revogar este banimento?')) return;
  await runTask(async () => {
    await fetchJson(`${adminApiBase}/bans/${encodeURIComponent(banId)}/revoke`, { method: 'DELETE' });
    if (state.overview) await loadOverview();
  }, { successMessage: 'Banimento revogado.' });
}

function renderUnlockSection() {
  const adminStatus = state.adminStatus || {};
  const google = adminStatus.google || {};
  const googleSession = google?.user ? google : { authenticated: false };
  return `
    <section class="rounded-2xl border border-line bg-panel p-4 md:p-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[.12em] text-accent">Painel Admin</p>
          <h1 class="mt-1 text-xl font-extrabold md:text-2xl">Controle total do marketplace</h1>
          <p class="mt-1 text-sm text-slate-400">Autenticação dupla: conta Google (${escapeHtml(adminStatus.admin_email || 'ADM_EMAIL')}) + senha do painel (env).</p>
        </div>
        <a href="${escapeHtml(webPath)}" class="inline-flex h-10 items-center rounded-xl border border-line px-4 text-sm font-semibold text-slate-200 hover:bg-panelSoft">Voltar ao catálogo</a>
      </div>

      <div class="mt-4 grid gap-4 md:grid-cols-2">
        <div class="rounded-xl border border-line/80 bg-panelSoft/70 p-4">
          <p class="text-xs font-semibold uppercase tracking-[.1em] text-slate-400">Login Google do site</p>
          ${googleSession?.authenticated
            ? `
              <div class="mt-3 flex items-center gap-3">
                <img src="${escapeHtml(googleSession.user?.picture || '')}" alt="" class="h-10 w-10 rounded-full border border-line object-cover" onerror="this.style.display='none'">
                <div class="min-w-0">
                  <p class="truncate text-sm font-semibold">${escapeHtml(googleSession.user?.name || 'Conta Google')}</p>
                  <p class="truncate text-xs text-slate-400">${escapeHtml(googleSession.user?.email || '')}</p>
                </div>
              </div>
              <p class="mt-3 text-xs ${canUnlockAdmin() ? 'text-emerald-300' : 'text-rose-300'}">
                ${canUnlockAdmin() ? 'Conta elegível para admin.' : 'Conta Google logada não bate com ADM_EMAIL.'}
              </p>
            `
            : `
              <p class="mt-3 text-sm text-slate-300">Nenhuma sessão Google ativa no site.</p>
              <p class="mt-2 text-xs text-slate-400">Faça login em <a href="${escapeHtml(webPath)}/perfil" class="text-accent underline">/stickers/perfil</a> e volte para desbloquear o painel.</p>
            `}
        </div>

        <form data-form="admin-unlock" class="rounded-xl border border-line/80 bg-panelSoft/70 p-4">
          <p class="text-xs font-semibold uppercase tracking-[.1em] text-slate-400">Senha do painel</p>
          <label class="mt-3 block">
            <span class="mb-1 block text-xs text-slate-400">Senha (env ADM_PANEL ou ADM_PANEL_PASSWORD)</span>
            <input name="password" type="password" autocomplete="current-password"
              class="h-11 w-full rounded-xl border border-line bg-panel px-3 text-sm outline-none focus:border-accent"
              placeholder="Digite a senha do painel"
              ${canUnlockAdmin() ? '' : 'disabled'} />
          </label>
          <button type="submit" class="mt-3 inline-flex h-11 w-full items-center justify-center rounded-xl bg-accent px-4 text-sm font-extrabold text-slate-900 disabled:opacity-60" ${canUnlockAdmin() && !state.busy ? '' : 'disabled'}>
            ${state.busy ? 'Desbloqueando...' : 'Desbloquear Painel'}
          </button>
        </form>
      </div>
    </section>
  `;
}

function renderOverviewSection() {
  const ov = state.overview || {};
  const counters = ov.counters || {};
  const marketplace = ov.marketplace_stats || {};
  const activeSessions = Array.isArray(ov.active_sessions) ? ov.active_sessions : [];
  const users = Array.isArray(ov.users) ? ov.users : [];
  const bans = Array.isArray(ov.bans) ? ov.bans : [];
  const recentPacks = Array.isArray(ov.recent_packs) ? ov.recent_packs : [];
  const selectedPack = state.selectedPack?.pack || state.selectedPack?.data?.pack || state.selectedPack?.pack ? state.selectedPack.pack : state.selectedPack?.pack;
  const packData = state.selectedPack?.pack ? state.selectedPack : (state.selectedPack?.data ? state.selectedPack.data : state.selectedPack);
  const selectedPackItems = Array.isArray(packData?.pack?.items) ? packData.pack.items : [];

  return `
    <section class="rounded-2xl border border-line bg-panel p-4 md:p-5">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[.1em] text-accent">Administrador</p>
          <h2 class="text-lg font-extrabold md:text-xl">${escapeHtml(state.adminStatus?.session?.user?.name || 'Admin')}</h2>
          <p class="text-xs text-slate-400">${escapeHtml(state.adminStatus?.session?.user?.email || '')}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button data-action="refresh-dashboard" class="h-10 rounded-xl border border-line px-3 text-sm font-semibold hover:bg-panelSoft ${state.busy ? 'opacity-60' : ''}" ${state.busy ? 'disabled' : ''}>Atualizar</button>
          <button data-action="logout-admin" class="h-10 rounded-xl border border-rose-500/40 px-3 text-sm font-semibold text-rose-200 hover:bg-rose-500/10 ${state.busy ? 'opacity-60' : ''}" ${state.busy ? 'disabled' : ''}>Sair do admin</button>
        </div>
      </div>

      <div class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div class="rounded-xl border border-line bg-panelSoft/70 p-3"><p class="text-xs text-slate-400">Packs (ativos)</p><p class="mt-1 text-2xl font-extrabold">${fmtNum(counters.total_packs_any_status)}</p></div>
        <div class="rounded-xl border border-line bg-panelSoft/70 p-3"><p class="text-xs text-slate-400">Stickers (globais)</p><p class="mt-1 text-2xl font-extrabold">${fmtNum(counters.total_stickers_any_status || marketplace.total_stickers)}</p></div>
        <div class="rounded-xl border border-line bg-panelSoft/70 p-3"><p class="text-xs text-slate-400">Usuários logados</p><p class="mt-1 text-2xl font-extrabold">${fmtNum(counters.active_google_sessions)}</p></div>
        <div class="rounded-xl border border-line bg-panelSoft/70 p-3"><p class="text-xs text-slate-400">Banimentos ativos</p><p class="mt-1 text-2xl font-extrabold text-rose-300">${fmtNum(counters.active_bans)}</p></div>
      </div>

      <div class="mt-4 grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <div class="space-y-4">
          <section class="rounded-xl border border-line bg-panelSoft/60 p-3">
            <div class="mb-2 flex items-center justify-between">
              <h3 class="text-sm font-bold">Usuários logados (sessões Google ativas)</h3>
              <span class="text-xs text-slate-400">${fmtNum(activeSessions.length)} sessões</span>
            </div>
            <div class="max-h-72 overflow-auto rounded-lg border border-line/60">
              <table class="min-w-full text-xs">
                <thead class="bg-panel/80 text-slate-400">
                  <tr><th class="px-2 py-2 text-left">Usuário</th><th class="px-2 py-2 text-left">Último acesso</th><th class="px-2 py-2 text-left">Ações</th></tr>
                </thead>
                <tbody>
                  ${activeSessions.length
                    ? activeSessions.map((row) => `
                      <tr class="border-t border-line/40">
                        <td class="px-2 py-2 align-top">
                          <div class="font-semibold">${escapeHtml(row.name || 'Conta Google')}</div>
                          <div class="text-slate-400">${escapeHtml(row.email || '-')}</div>
                          <div class="text-[10px] text-slate-500">${escapeHtml(row.owner_jid || '')}</div>
                        </td>
                        <td class="px-2 py-2 align-top text-slate-300">${escapeHtml(fmtDate(row.last_seen_at || row.created_at))}</td>
                        <td class="px-2 py-2 align-top">
                          <button data-action="ban-user" data-email="${escapeHtml(row.email || '')}" data-sub="${escapeHtml(row.google_sub || '')}" data-owner="${escapeHtml(row.owner_jid || '')}" class="rounded-md border border-rose-500/40 px-2 py-1 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/10">Banir</button>
                        </td>
                      </tr>
                    `).join('')
                    : `<tr><td colspan="3" class="px-3 py-4 text-center text-slate-400">Nenhuma sessão ativa</td></tr>`}
                </tbody>
              </table>
            </div>
          </section>

          <section class="rounded-xl border border-line bg-panelSoft/60 p-3">
            <div class="mb-2 flex items-center justify-between">
              <h3 class="text-sm font-bold">Busca de packs / moderação</h3>
              <a href="${escapeHtml(webPath)}" target="_blank" rel="noreferrer" class="text-xs text-accent underline">Abrir catálogo</a>
            </div>
            <form data-form="packs-search" class="flex flex-col gap-2 sm:flex-row">
              <input name="q" value="${escapeHtml(state.packsQuery)}" placeholder="pack_key, nome, publisher, owner_jid"
                class="h-10 flex-1 rounded-xl border border-line bg-panel px-3 text-sm outline-none focus:border-accent" />
              <button type="submit" class="h-10 rounded-xl bg-accent px-4 text-sm font-extrabold text-slate-900 ${state.busy ? 'opacity-60' : ''}" ${state.busy ? 'disabled' : ''}>Buscar</button>
            </form>
            <div class="mt-3 max-h-80 overflow-auto rounded-lg border border-line/60">
              <table class="min-w-full text-xs">
                <thead class="bg-panel/80 text-slate-400">
                  <tr><th class="px-2 py-2 text-left">Pack</th><th class="px-2 py-2 text-left">Status</th><th class="px-2 py-2 text-left">Ações</th></tr>
                </thead>
                <tbody>
                  ${state.packs.length
                    ? state.packs.map((pack) => `
                      <tr class="border-t border-line/40 ${state.selectedPackKey === pack.pack_key ? 'bg-accent/5' : ''}">
                        <td class="px-2 py-2 align-top">
                          <div class="font-semibold">${escapeHtml(pack.name || pack.pack_key)}</div>
                          <div class="text-slate-400">${escapeHtml(pack.pack_key)}</div>
                          <div class="text-[10px] text-slate-500">${escapeHtml(pack.owner_jid || '')}</div>
                          <div class="text-[10px] text-slate-500">${fmtNum(pack.stickers_count)} stickers • ${fmtNum(pack.like_count)} likes • ${fmtNum(pack.open_count)} opens</div>
                        </td>
                        <td class="px-2 py-2 align-top text-slate-300">${escapeHtml(`${pack.visibility} / ${pack.status} / ${pack.pack_status || 'ready'}`)}</td>
                        <td class="px-2 py-2 align-top">
                          <div class="flex flex-wrap gap-1">
                            <button data-action="open-pack-admin" data-pack-key="${escapeHtml(pack.pack_key)}" class="rounded-md border border-line px-2 py-1 text-[11px] font-semibold hover:bg-panel">Detalhes</button>
                            <a href="${escapeHtml(pack.web_url)}" target="_blank" rel="noreferrer" class="rounded-md border border-line px-2 py-1 text-[11px] font-semibold hover:bg-panel">Abrir</a>
                            <button data-action="delete-pack-admin" data-pack-key="${escapeHtml(pack.pack_key)}" class="rounded-md border border-rose-500/40 px-2 py-1 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/10">Apagar</button>
                          </div>
                        </td>
                      </tr>
                    `).join('')
                    : `<tr><td colspan="3" class="px-3 py-4 text-center text-slate-400">Nenhum pack encontrado</td></tr>`}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div class="space-y-4">
          <section class="rounded-xl border border-line bg-panelSoft/60 p-3">
            <h3 class="text-sm font-bold">Banir usuário</h3>
            <p class="mt-1 text-xs text-slate-400">Pode banir por e-mail, google_sub ou owner_jid. O ban derruba sessões Google web ativas.</p>
            <form data-form="manual-ban" class="mt-3 space-y-2">
              <input name="email" placeholder="email@exemplo.com" class="h-10 w-full rounded-xl border border-line bg-panel px-3 text-sm outline-none focus:border-accent">
              <input name="google_sub" placeholder="google_sub (opcional)" class="h-10 w-full rounded-xl border border-line bg-panel px-3 text-sm outline-none focus:border-accent">
              <input name="owner_jid" placeholder="owner_jid (opcional)" class="h-10 w-full rounded-xl border border-line bg-panel px-3 text-sm outline-none focus:border-accent">
              <input name="reason" placeholder="Motivo do banimento" class="h-10 w-full rounded-xl border border-line bg-panel px-3 text-sm outline-none focus:border-accent">
              <button type="submit" class="h-10 w-full rounded-xl bg-rose-500 px-4 text-sm font-extrabold text-white ${state.busy ? 'opacity-60' : ''}" ${state.busy ? 'disabled' : ''}>Banir</button>
            </form>
          </section>

          <section class="rounded-xl border border-line bg-panelSoft/60 p-3">
            <div class="mb-2 flex items-center justify-between">
              <h3 class="text-sm font-bold">Banimentos</h3>
              <span class="text-xs text-slate-400">${fmtNum(bans.length)} ativos</span>
            </div>
            <div class="max-h-72 overflow-auto rounded-lg border border-line/60">
              ${bans.length
                ? bans.map((ban) => `
                  <div class="border-t border-line/40 px-3 py-2 first:border-t-0">
                    <div class="flex items-start justify-between gap-2">
                      <div class="min-w-0">
                        <p class="truncate text-xs font-semibold text-rose-200">${escapeHtml(ban.email || ban.owner_jid || ban.google_sub || ban.id)}</p>
                        <p class="truncate text-[11px] text-slate-400">${escapeHtml(ban.reason || 'Sem motivo')}</p>
                        <p class="truncate text-[10px] text-slate-500">${escapeHtml(ban.google_sub || '')} ${ban.owner_jid ? '• ' + escapeHtml(ban.owner_jid) : ''}</p>
                        <p class="text-[10px] text-slate-500">${escapeHtml(fmtDate(ban.created_at))}</p>
                      </div>
                      <button data-action="revoke-ban" data-ban-id="${escapeHtml(ban.id)}" class="shrink-0 rounded-md border border-line px-2 py-1 text-[11px] font-semibold hover:bg-panel">Revogar</button>
                    </div>
                  </div>
                `).join('')
                : `<div class="px-3 py-4 text-center text-xs text-slate-400">Sem banimentos ativos.</div>`}
            </div>
          </section>

          <section class="rounded-xl border border-line bg-panelSoft/60 p-3">
            <h3 class="text-sm font-bold">Stickers (ações globais)</h3>
            <form data-form="delete-sticker-global" class="mt-3 flex gap-2">
              <input name="sticker_id" placeholder="sticker_id (UUID)" class="h-10 flex-1 rounded-xl border border-line bg-panel px-3 text-sm outline-none focus:border-accent">
              <button type="submit" class="h-10 rounded-xl border border-rose-500/40 px-3 text-sm font-semibold text-rose-200 hover:bg-rose-500/10 ${state.busy ? 'opacity-60' : ''}" ${state.busy ? 'disabled' : ''}>Apagar</button>
            </form>
            <p class="mt-2 text-[11px] text-slate-400">Remove o sticker de todos os packs e apaga o asset se ficar órfão.</p>
          </section>
        </div>
      </div>

      <div class="mt-4 grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
        <section class="rounded-xl border border-line bg-panelSoft/60 p-3">
          <h3 class="text-sm font-bold">Pack selecionado</h3>
          ${packData?.pack
            ? `
              <div class="mt-3 rounded-xl border border-line/70 bg-panel/60 p-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p class="text-sm font-extrabold">${escapeHtml(packData.pack.name || packData.pack.pack_key)}</p>
                    <p class="text-xs text-slate-400">${escapeHtml(packData.pack.pack_key)} • ${escapeHtml(packData.pack.owner_jid || '')}</p>
                    <p class="text-[11px] text-slate-500">${escapeHtml(packData.pack.visibility || '')} / ${escapeHtml(packData.pack.status || '')} / ${escapeHtml(packData.pack.pack_status || 'ready')}</p>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <a href="${escapeHtml(packData.pack.web_url || `${webPath}/${packData.pack.pack_key}`)}" target="_blank" rel="noreferrer" class="inline-flex h-9 items-center rounded-lg border border-line px-3 text-xs font-semibold hover:bg-panel">Abrir</a>
                    <button data-action="delete-pack-admin" data-pack-key="${escapeHtml(packData.pack.pack_key)}" class="h-9 rounded-lg border border-rose-500/40 px-3 text-xs font-semibold text-rose-200 hover:bg-rose-500/10">Apagar pack</button>
                    <button data-action="ban-user" data-email="${escapeHtml(packData.pack.owner_email || '')}" data-owner="${escapeHtml(packData.pack.owner_jid || '')}" class="h-9 rounded-lg border border-rose-500/40 px-3 text-xs font-semibold text-rose-200 hover:bg-rose-500/10">Banir dono</button>
                  </div>
                </div>
              </div>
              <div class="mt-3 max-h-[26rem] overflow-auto rounded-lg border border-line/60">
                <table class="min-w-full text-xs">
                  <thead class="bg-panel/80 text-slate-400">
                    <tr><th class="px-2 py-2 text-left">Sticker</th><th class="px-2 py-2 text-left">Tags</th><th class="px-2 py-2 text-left">Ações</th></tr>
                  </thead>
                  <tbody>
                    ${selectedPackItems.length
                      ? selectedPackItems.map((item) => `
                        <tr class="border-t border-line/40">
                          <td class="px-2 py-2 align-top">
                            <div class="flex items-start gap-2">
                              <img src="${escapeHtml(item.asset_url || '')}" alt="" class="h-12 w-12 rounded-lg border border-line bg-panel object-cover">
                              <div class="min-w-0">
                                <p class="truncate font-semibold">${escapeHtml(item.sticker_id || '')}</p>
                                <p class="truncate text-[10px] text-slate-500">pos ${escapeHtml(item.position)}</p>
                                <p class="truncate text-[10px] text-slate-500">${escapeHtml(item.asset?.mimetype || '')}</p>
                              </div>
                            </div>
                          </td>
                          <td class="px-2 py-2 align-top text-slate-300">${Array.isArray(item.tags) && item.tags.length ? item.tags.map((tag) => `<span class="mr-1 inline-block rounded-full border border-line px-2 py-0.5 text-[10px]">${escapeHtml(tag)}</span>`).join('') : '<span class="text-slate-500">-</span>'}</td>
                          <td class="px-2 py-2 align-top">
                            <div class="flex flex-wrap gap-1">
                              <button data-action="remove-pack-sticker" data-pack-key="${escapeHtml(packData.pack.pack_key)}" data-sticker-id="${escapeHtml(item.sticker_id || '')}" class="rounded-md border border-line px-2 py-1 text-[11px] font-semibold hover:bg-panel">Remover do pack</button>
                              <button data-action="delete-sticker-global-btn" data-sticker-id="${escapeHtml(item.sticker_id || '')}" class="rounded-md border border-rose-500/40 px-2 py-1 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/10">Apagar global</button>
                            </div>
                          </td>
                        </tr>
                      `).join('')
                      : `<tr><td colspan="3" class="px-3 py-4 text-center text-slate-400">Pack sem stickers.</td></tr>`}
                  </tbody>
                </table>
              </div>
            `
            : `<p class="mt-2 text-xs text-slate-400">Selecione um pack na lista para moderar stickers e apagar o pack.</p>`}
        </section>

        <section class="rounded-xl border border-line bg-panelSoft/60 p-3">
          <h3 class="text-sm font-bold">Usuários conhecidos (Google web)</h3>
          <div class="mt-2 max-h-[32rem] overflow-auto rounded-lg border border-line/60">
            <table class="min-w-full text-xs">
              <thead class="bg-panel/80 text-slate-400">
                <tr><th class="px-2 py-2 text-left">Usuário</th><th class="px-2 py-2 text-left">Último login</th><th class="px-2 py-2 text-left">Ações</th></tr>
              </thead>
              <tbody>
                ${users.length
                  ? users.map((user) => `
                    <tr class="border-t border-line/40">
                      <td class="px-2 py-2 align-top">
                        <div class="font-semibold">${escapeHtml(user.name || 'Conta Google')}</div>
                        <div class="text-slate-400">${escapeHtml(user.email || '-')}</div>
                        <div class="text-[10px] text-slate-500">${escapeHtml(user.owner_jid || '')}</div>
                        <div class="text-[10px] text-slate-500">${escapeHtml(user.google_sub || '')}</div>
                      </td>
                      <td class="px-2 py-2 align-top text-slate-300">${escapeHtml(fmtDate(user.last_login_at || user.last_seen_at || user.updated_at))}</td>
                      <td class="px-2 py-2 align-top">
                        <button data-action="ban-user" data-email="${escapeHtml(user.email || '')}" data-sub="${escapeHtml(user.google_sub || '')}" data-owner="${escapeHtml(user.owner_jid || '')}" class="rounded-md border border-rose-500/40 px-2 py-1 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/10">Banir</button>
                      </td>
                    </tr>
                  `).join('')
                  : `<tr><td colspan="3" class="px-3 py-4 text-center text-slate-400">Sem usuários cadastrados.</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div class="mt-4 rounded-xl border border-line bg-panelSoft/60 p-3 text-xs text-slate-400">
        <p>Stats globais: packs ${fmtNum(marketplace.total_packs)} • stickers ${fmtNum(marketplace.total_stickers)} • cliques ${fmtNum(marketplace.total_clicks)} • likes ${fmtNum(marketplace.total_likes)}</p>
      </div>
    </section>
  `;
}

function renderLayout() {
  const loading = state.loading;
  const body = loading
    ? `<div class="rounded-2xl border border-line bg-panel p-8 text-center text-sm text-slate-300">Carregando painel admin...</div>`
    : isAdminAuthenticated()
      ? renderOverviewSection()
      : renderUnlockSection();

  root.innerHTML = `
    <div class="mx-auto w-full max-w-7xl px-4 py-4 md:px-6 md:py-6">
      ${state.error ? `<div class="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">${escapeHtml(state.error)}</div>` : ''}
      ${state.notice ? `<div class="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">${escapeHtml(state.notice)}</div>` : ''}
      ${body}
    </div>
  `;
}

function render() {
  renderLayout();
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

  if (formType === 'packs-search') {
    const q = String(new FormData(form).get('q') || '').trim();
    await searchPacks(q);
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
    render();
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
    return;
  }
});

root.addEventListener('click', async (event) => {
  const target = event.target instanceof HTMLElement ? event.target.closest('[data-action]') : null;
  if (!(target instanceof HTMLElement)) return;
  const action = target.dataset.action;
  if (!action) return;

  if (action === 'logout-admin') {
    await logoutAdmin();
    return;
  }
  if (action === 'refresh-dashboard') {
    await refreshDashboard();
    return;
  }
  if (action === 'open-pack-admin') {
    await openPackDetailsAdmin(target.dataset.packKey || '');
    return;
  }
  if (action === 'delete-pack-admin') {
    await deletePackAdmin(target.dataset.packKey || '');
    return;
  }
  if (action === 'remove-pack-sticker') {
    await removeStickerFromPackAdmin(target.dataset.packKey || '', target.dataset.stickerId || '');
    return;
  }
  if (action === 'delete-sticker-global-btn') {
    await forceDeleteStickerAdmin(target.dataset.stickerId || '');
    return;
  }
  if (action === 'ban-user') {
    const reason = window.prompt('Motivo do banimento (opcional):', 'Violação de regras do marketplace') || '';
    await createBanAdmin({
      email: target.dataset.email || '',
      google_sub: target.dataset.sub || '',
      owner_jid: target.dataset.owner || '',
      reason,
    });
    return;
  }
  if (action === 'revoke-ban') {
    await revokeBanAdmin(target.dataset.banId || '');
  }
});

boot();
