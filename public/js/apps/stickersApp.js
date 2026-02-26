import { React, createRoot, useEffect, useMemo, useRef, useState } from '../runtime/react-runtime.js';
import htm from 'https://esm.sh/htm@3.1.1';

const html = htm.bind(React.createElement);
const SEARCH_HISTORY_KEY = 'omnizap_stickers_search_history_v1';
const PACK_UPLOAD_TASK_KEY = 'omnizap_pack_upload_task_v1';
const GOOGLE_GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const PROFILE_ROUTE_SEGMENTS = new Set(['perfil', 'profile']);

const DEFAULT_CATEGORIES = [
  { value: '', label: '🔥 Em alta', icon: '🔥' },
  { value: 'anime', label: 'Anime', icon: '🎌' },
  { value: 'game', label: 'Games', icon: '🎮' },
  { value: 'meme', label: 'Meme', icon: '😂' },
  { value: 'nsfw', label: '+18', icon: '🔞' },
  { value: 'dark-aesthetic', label: 'Dark', icon: '🖤' },
  { value: 'texto', label: 'Texto', icon: '✍️' },
  { value: 'cartoon', label: 'Cartoon', icon: '🧸' },
  { value: 'foto-real', label: 'Foto real', icon: '📷' },
  { value: 'animal-photo', label: 'Animal', icon: '🐾' },
  { value: 'cyberpunk', label: 'Cyberpunk', icon: '⚡' },
];

const CATEGORY_META = new Map(DEFAULT_CATEGORIES.map((entry) => [entry.value, entry]));

const parseIntSafe = (value, fallback) => {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeToken = (value) =>
  String(value || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9- ]+/g, '');

const shortNum = (value) => {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};

const getPackEngagement = (pack) => {
  const engagement = pack?.engagement || {};
  const likeCount = Number(engagement.like_count || 0);
  const dislikeCount = Number(engagement.dislike_count || 0);
  const openCount = Number(engagement.open_count || 0);
  return {
    likeCount,
    dislikeCount,
    openCount,
    score: Number(engagement.score || likeCount - dislikeCount),
  };
};

const getAvatarUrl = (name) =>
  `https://api.dicebear.com/8.x/thumbs/svg?seed=${encodeURIComponent(String(name || 'omnizap'))}`;

const parseStickersLocation = (webPath = '/stickers') => {
  const path = String(window.location.pathname || '');
  const basePath = String(webPath || '/stickers').replace(/\/+$/, '') || '/stickers';
  if (path === basePath || path === `${basePath}/`) return { view: 'catalog', packKey: '' };
  const baseWithSlash = `${basePath}/`;
  if (!path.startsWith(baseWithSlash)) return { view: 'catalog', packKey: '' };
  const suffix = path.slice(baseWithSlash.length);
  if (!suffix) return { view: 'catalog', packKey: '' };

  const firstSegmentRaw = suffix.split('/')[0] || '';
  if (!firstSegmentRaw) return { view: 'catalog', packKey: '' };

  try {
    const firstSegment = decodeURIComponent(firstSegmentRaw);
    if (PROFILE_ROUTE_SEGMENTS.has(String(firstSegment || '').trim().toLowerCase())) {
      return { view: 'profile', packKey: '' };
    }
    return { view: 'pack', packKey: firstSegment };
  } catch {
    return { view: 'catalog', packKey: '' };
  }
};

const decodeJwtPayload = (jwt) => {
  const parts = String(jwt || '').split('.');
  if (parts.length < 2) return null;
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
};

const loadScript = (src) =>
  new Promise((resolve, reject) => {
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

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('Arquivo inválido.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Falha ao ler arquivo.'));
    reader.readAsDataURL(file);
  });

const moveArrayItem = (list, fromIndex, toIndex) => {
  const arr = Array.isArray(list) ? [...list] : [];
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= arr.length || toIndex >= arr.length) return arr;
  if (fromIndex === toIndex) return arr;
  const [item] = arr.splice(fromIndex, 1);
  arr.splice(toIndex, 0, item);
  return arr;
};

const parseTagsInputText = (value) =>
  String(value || '')
    .split(',')
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, 8);

const isRecent = (dateString) => {
  if (!dateString) return false;
  const created = new Date(dateString).getTime();
  if (!Number.isFinite(created)) return false;
  return Date.now() - created <= 1000 * 60 * 60 * 24 * 7;
};

const primaryTag = (item) => {
  const tags = Array.isArray(item?.tags) ? item.tags : [];
  if (!tags.length) return '';
  return String(tags[0] || '').replace(/-/g, ' ');
};

const tagLabel = (tag) => {
  const normalized = String(tag || '').toLowerCase();
  if (normalized.includes('nsfw')) return `🔞 ${String(tag).replace(/-/g, ' ').toUpperCase()}`;
  if (normalized.includes('game')) return `🎮 ${String(tag).replace(/-/g, ' ')}`;
  if (normalized.includes('anime')) return `🎌 ${String(tag).replace(/-/g, ' ')}`;
  if (normalized.includes('meme')) return `😂 ${String(tag).replace(/-/g, ' ')}`;
  return `🏷 ${String(tag).replace(/-/g, ' ')}`;
};

const readUploadTask = () => {
  try {
    const raw = localStorage.getItem(PACK_UPLOAD_TASK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

function UploadTaskWidget({ task, onClose }) {
  if (!task) return null;
  const progress = Math.max(0, Math.min(100, Number(task.progress || 0)));
  const status = String(task.status || 'running');
  const isDone = status === 'completed';
  const isError = status === 'error';
  const isPaused = status === 'paused';
  const title = isDone ? 'Pack publicado' : isError ? 'Falha na publicação' : isPaused ? 'Publicação pausada' : 'Publicando pack';
  const packUrl = String(task.packUrl || task.pack_url || '').trim();

  return html`
    <aside className="fixed bottom-4 right-4 z-[70] w-[min(92vw,360px)] rounded-2xl border border-slate-700 bg-slate-950/95 p-3 shadow-2xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-slate-100">${title}</p>
        <button type="button" onClick=${onClose} className="rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800">Fechar</button>
      </div>
      <p className="truncate text-xs text-slate-400">${task.message || `${task.current || 0}/${task.total || 0}`}</p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
        <div className=${`h-full transition-all ${isError ? 'bg-rose-400' : isDone ? 'bg-emerald-400' : isPaused ? 'bg-amber-400' : 'bg-cyan-400'}`} style=${{ width: `${progress}%` }}></div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span className="text-slate-400">${task.current || 0}/${task.total || 0}</span>
        <span className=${`${isError ? 'text-rose-300' : isDone ? 'text-emerald-300' : isPaused ? 'text-amber-300' : 'text-cyan-300'} font-semibold`}>
          ${progress}%
        </span>
      </div>
      ${(isDone || isPaused) && packUrl
        ? html`
            <div className="mt-2 flex gap-2">
              <a href=${packUrl} className="inline-flex rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-200">Abrir pack</a>
              ${isPaused
                ? html`<a href="/stickers/create/" className="inline-flex rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-amber-200">Retomar envio</a>`
                : null}
            </div>
          `
        : null}
    </aside>
  `;
}

function PackCard({ pack, index, onOpen }) {
  const isTrending = index < 4 || Number(pack?.sticker_count || 0) >= 30;
  const isNew = isRecent(pack?.created_at);
  const engagement = getPackEngagement(pack);

  return html`
    <button
      type="button"
      onClick=${() => onOpen(pack.pack_key)}
      className="group w-full text-left rounded-2xl border border-slate-800 bg-slate-900/90 shadow-soft overflow-hidden transition-all duration-200 active:scale-[0.985] md:hover:scale-[1.02] hover:-translate-y-0.5 hover:shadow-lg touch-manipulation"
    >
      <div className="relative aspect-[5/6] sm:aspect-[4/5] bg-slate-900 overflow-hidden">
        <img
          src=${pack.cover_url || 'https://iili.io/fSNGag2.png'}
          alt=${`Capa de ${pack.name}`}
          className="w-full h-full object-cover transition-transform duration-300 md:group-hover:scale-[1.05] group-active:scale-[1.02]"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/60 to-transparent"></div>
        <div className="absolute top-2 left-2 flex items-center gap-1">
          ${isTrending
            ? html`<span className="rounded-full border border-emerald-300/30 bg-emerald-400/80 backdrop-blur px-1.5 py-0.5 text-[9px] font-bold text-slate-900">Trending</span>`
            : null}
          ${isNew
            ? html`<span className="rounded-full border border-white/15 bg-black/45 backdrop-blur px-1.5 py-0.5 text-[9px] font-semibold text-slate-100">Novo</span>`
            : null}
        </div>

        <div className="absolute inset-x-0 bottom-0 p-2">
          <h3 className="font-semibold text-sm leading-5 line-clamp-2">${pack.name || 'Pack sem nome'}</h3>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-300">
            <img src=${getAvatarUrl(pack.publisher)} alt="Criador" className="w-4 h-4 rounded-full bg-slate-700" loading="lazy" />
            <span className="truncate">${pack.publisher || 'Criador não informado'}</span>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-300">
            <span>🧩 ${Number(pack.sticker_count || 0)}</span>
            <span>❤️ ${shortNum(engagement.likeCount)}</span>
            <span>⬇ ${shortNum(engagement.openCount)}</span>
          </p>
        </div>

        <div className="pointer-events-none absolute inset-x-2 bottom-2 hidden md:flex justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <span className="inline-flex h-8 w-full items-center justify-center rounded-xl border border-emerald-400/35 bg-emerald-400/12 px-3 text-xs font-semibold text-emerald-200 backdrop-blur">
            Abrir pack
          </span>
        </div>
      </div>

      <div className="px-2 pb-2 pt-1 bg-slate-900/95 md:hidden">
        <span className="inline-flex h-[34px] w-full items-center justify-center rounded-xl border border-emerald-400/30 bg-emerald-400/10 text-xs font-semibold text-emerald-200 transition group-active:brightness-110">
          Abrir pack
        </span>
      </div>
    </button>
  `;
}

function CatalogMetricCard({ label, value, icon = '📊', hint = '', bars = [], tone = 'slate' }) {
  const toneMap = {
    slate: 'border-slate-800 bg-slate-900/60',
    emerald: 'border-emerald-500/20 bg-emerald-500/5',
    cyan: 'border-cyan-500/20 bg-cyan-500/5',
    amber: 'border-amber-500/20 bg-amber-500/5',
  };
  return html`
    <article
      className=${`rounded-xl border p-2.5 ${toneMap[tone] || toneMap.slate}`}
      title=${hint || label}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm">${icon}</span>
        <div className="flex items-end gap-0.5">
          ${(Array.isArray(bars) ? bars : []).slice(0, 7).map((bar, index) => html`
            <span
              key=${index}
              className="w-1 rounded-full bg-white/15"
              style=${{ height: `${Math.max(4, Math.min(16, Number(bar || 0)))}px` }}
            ></span>
          `)}
        </div>
      </div>
      <p className="mt-1 text-base font-bold text-slate-100">${value}</p>
      <p className="text-[11px] text-slate-400">${label}</p>
      ${hint ? html`<p className="mt-0.5 text-[10px] text-slate-500">${hint}</p>` : null}
    </article>
  `;
}

function DiscoverPackRowItem({ pack, onOpen, rank = 0 }) {
  if (!pack?.pack_key) return null;
  return html`
    <button
      type="button"
      onClick=${() => onOpen(pack.pack_key)}
      className="w-full flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 px-2 py-1.5 text-left hover:bg-slate-800/90"
    >
      <img src=${pack.cover_url || 'https://iili.io/fSNGag2.png'} alt="" className="h-9 w-9 rounded-lg object-cover bg-slate-800" loading="lazy" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-slate-100">${rank > 0 ? `${rank}. ` : ''}${pack.name || 'Pack'}</span>
        <span className="block truncate text-[10px] text-slate-400">${pack.publisher || '-'} · ❤️ ${shortNum(getPackEngagement(pack).likeCount)}</span>
      </span>
      <span className="text-[10px] text-slate-500">→</span>
    </button>
  `;
}

function DiscoverPackMiniCard({ pack, onOpen }) {
  if (!pack?.pack_key) return null;
  const engagement = getPackEngagement(pack);
  return html`
    <button
      type="button"
      onClick=${() => onOpen(pack.pack_key)}
      className="group w-[170px] shrink-0 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/80 text-left"
    >
      <div className="relative h-24 bg-slate-900">
        <img src=${pack.cover_url || 'https://iili.io/fSNGag2.png'} alt="" className="h-full w-full object-cover transition-transform duration-200 group-active:scale-[1.02]" loading="lazy" />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 to-transparent"></div>
      </div>
      <div className="p-2">
        <p className="truncate text-xs font-semibold text-slate-100">${pack.name || 'Pack'}</p>
        <p className="mt-1 truncate text-[10px] text-slate-400">⬇ ${shortNum(engagement.openCount)} · ❤️ ${shortNum(engagement.likeCount)}</p>
      </div>
    </button>
  `;
}

function DiscoverCreatorMiniCard({ creator, onPick }) {
  if (!creator?.publisher) return null;
  return html`
    <button
      type="button"
      onClick=${() => onPick(creator.publisher)}
      className="w-[190px] shrink-0 rounded-xl border border-slate-800 bg-slate-900/70 p-2 text-left hover:bg-slate-800/90"
    >
      <div className="flex items-center gap-2">
        <img src=${getAvatarUrl(creator.publisher)} alt="" className="h-9 w-9 rounded-full bg-slate-800" />
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold text-slate-100">${creator.publisher}</span>
          <span className="block truncate text-[10px] text-slate-400">${creator.packCount} packs · ❤️ ${shortNum(creator.likes)}</span>
        </span>
      </div>
    </button>
  `;
}

const isShareablePack = (pack) => {
  const visibility = String(pack?.visibility || '').toLowerCase();
  const status = String(pack?.status || '').toLowerCase();
  return (visibility === 'public' || visibility === 'unlisted') && status === 'published';
};

const formatVisibilityPill = (visibility) => {
  const normalized = String(visibility || '').toLowerCase();
  if (normalized === 'public') return { label: '🌍 Público', className: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200' };
  if (normalized === 'unlisted') return { label: '🔗 Não listado', className: 'border-cyan-500/35 bg-cyan-500/10 text-cyan-200' };
  return { label: '🔒 Privado', className: 'border-slate-600 bg-slate-900/80 text-slate-300' };
};

const formatStatusPill = (status) => {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'published') return { label: '✅ Publicado', className: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200' };
  if (normalized === 'draft') return { label: '📝 Rascunho', className: 'border-amber-500/35 bg-amber-500/10 text-amber-200' };
  if (normalized === 'processing') return { label: '⚙️ Processando', className: 'border-indigo-500/35 bg-indigo-500/10 text-indigo-200' };
  if (normalized === 'uploading') return { label: '⏫ Enviando', className: 'border-sky-500/35 bg-sky-500/10 text-sky-200' };
  if (normalized === 'failed') return { label: '❌ Falhou', className: 'border-rose-500/35 bg-rose-500/10 text-rose-200' };
  return { label: `ℹ️ ${normalized || 'desconhecido'}`, className: 'border-slate-600 bg-slate-900/80 text-slate-300' };
};

function MyPackCard({ pack, onOpenPublic }) {
  const visibilityPill = formatVisibilityPill(pack?.visibility);
  const statusPill = formatStatusPill(pack?.status);
  const shareable = isShareablePack(pack) && Boolean(pack?.pack_key);
  const engagement = getPackEngagement(pack);
  const coverUrl = pack?.cover_url || 'https://iili.io/fSNGag2.png';

  return html`
    <article className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
      <div className="flex gap-3">
        <img src=${coverUrl} alt=${`Capa de ${pack?.name || 'Pack'}`} className="h-20 w-20 rounded-xl border border-slate-800 bg-slate-950 object-cover shrink-0" loading="lazy" />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="truncate text-sm font-semibold text-slate-100">${pack?.name || 'Pack sem nome'}</p>
            <p className="truncate text-[11px] text-slate-400">ID: ${pack?.pack_key || '-'}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className=${`inline-flex rounded-full border px-2 py-0.5 text-[10px] ${statusPill.className}`}>${statusPill.label}</span>
            <span className=${`inline-flex rounded-full border px-2 py-0.5 text-[10px] ${visibilityPill.className}`}>${visibilityPill.label}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
            <span>🧩 ${Number(pack?.sticker_count || 0)}</span>
            <span>👍 ${shortNum(engagement.likeCount)}</span>
            <span>👆 ${shortNum(engagement.openCount)}</span>
            <span>${pack?.updated_at ? new Date(pack.updated_at).toLocaleDateString('pt-BR') : '-'}</span>
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        ${shareable
          ? html`
              <button
                type="button"
                onClick=${() => onOpenPublic(pack.pack_key)}
                className="inline-flex h-9 items-center justify-center rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/20"
              >
                Abrir no catálogo
              </button>
            `
          : html`
              <span className="inline-flex h-9 items-center justify-center rounded-xl border border-slate-700 bg-slate-900/70 px-3 text-xs text-slate-400">
                Não visível no catálogo
              </span>
            `}
        <a
          href="/stickers/create/"
          className="inline-flex h-9 items-center justify-center rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-3 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/20"
        >
          Criar/gerenciar packs
        </a>
      </div>
    </article>
  `;
}

function ProfilePage({
  googleAuthConfig,
  googleAuth,
  googleAuthBusy,
  googleAuthError,
  googleSessionChecked,
  googleAuthUiReady,
  googleButtonRef,
  myPacks,
  myPacksLoading,
  myPacksError,
  myProfileStats,
  onBack,
  onRefresh,
  onLogout,
  onOpenPublicPack,
}) {
  const hasGoogleLogin = Boolean(googleAuth?.user?.sub);
  const googleLoginEnabled = Boolean(googleAuthConfig?.enabled && googleAuthConfig?.clientId);

  return html`
    <section className="space-y-4 pb-20 sm:pb-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick=${onBack}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
        >
          ← Voltar para catálogo
        </button>
        <button
          type="button"
          onClick=${onRefresh}
          disabled=${myPacksLoading || googleAuthBusy}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-60"
        >
          ${myPacksLoading ? 'Atualizando...' : 'Atualizar'}
        </button>
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Perfil de criador</p>
            <h1 className="mt-1 text-xl font-bold">Meus packs</h1>
            <p className="mt-1 text-sm text-slate-400">
              Faça login com Google para ver e vincular os packs criados pela sua conta.
            </p>
          </div>
          ${hasGoogleLogin
            ? html`
                <button
                  type="button"
                  onClick=${onLogout}
                  disabled=${googleAuthBusy}
                  className="inline-flex h-10 items-center rounded-xl border border-slate-700 px-3 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-60"
                >
                  ${googleAuthBusy ? 'Saindo...' : 'Sair'}
                </button>
              `
            : null}
        </div>

        <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
          ${hasGoogleLogin
            ? html`
                <div className="flex flex-wrap items-center gap-3">
                  <img
                    src=${googleAuth.user?.picture || getAvatarUrl(googleAuth.user?.name)}
                    alt="Avatar do Google"
                    className="h-12 w-12 rounded-full border border-slate-700 bg-slate-900 object-cover"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-100">${googleAuth.user?.name || 'Conta Google'}</p>
                    <p className="truncate text-xs text-slate-400">${googleAuth.user?.email || ''}</p>
                    <p className="truncate text-[11px] text-slate-500">
                      ${googleAuth.expiresAt ? `Sessão válida até ${new Date(googleAuth.expiresAt).toLocaleString('pt-BR')}` : 'Sessão ativa'}
                    </p>
                  </div>
                </div>
              `
            : html`
                <div className="space-y-3">
                  <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
                    <p className="text-sm font-semibold text-cyan-200">Entrar com Google</p>
                    <p className="mt-1 text-xs text-slate-300">
                      ${googleLoginEnabled
                        ? 'Use a mesma conta Google usada na criação de packs para carregar seus dados e packs automaticamente.'
                        : 'Login Google indisponível no momento.'}
                    </p>
                  </div>
                  ${googleLoginEnabled
                    ? html`
                        <div ref=${googleButtonRef} className="min-h-[42px] w-full max-w-[320px] overflow-hidden"></div>
                        ${!googleSessionChecked
                          ? html`<p className="text-xs text-slate-400">Verificando sessão Google...</p>`
                          : googleAuthBusy
                            ? html`<p className="text-xs text-slate-400">Conectando conta Google...</p>`
                            : !googleAuthUiReady && !googleAuthError
                              ? html`<p className="text-xs text-slate-400">Carregando login Google...</p>`
                              : null}
                      `
                    : null}
                </div>
              `}
          ${googleAuthError ? html`<p className="mt-2 text-xs text-rose-300">${googleAuthError}</p>` : null}
        </div>
      </section>

      ${myPacksError ? html`<div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">${myPacksError}</div>` : null}

      ${hasGoogleLogin
        ? html`
            <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <article className="rounded-xl border border-slate-800 bg-slate-900/70 p-3"><p className="text-[11px] text-slate-400">Total</p><p className="text-lg font-semibold">${shortNum(myProfileStats?.total || 0)}</p></article>
              <article className="rounded-xl border border-slate-800 bg-slate-900/70 p-3"><p className="text-[11px] text-slate-400">Publicados</p><p className="text-lg font-semibold">${shortNum(myProfileStats?.published || 0)}</p></article>
              <article className="rounded-xl border border-slate-800 bg-slate-900/70 p-3"><p className="text-[11px] text-slate-400">Rascunhos</p><p className="text-lg font-semibold">${shortNum(myProfileStats?.drafts || 0)}</p></article>
              <article className="rounded-xl border border-slate-800 bg-slate-900/70 p-3"><p className="text-[11px] text-slate-400">Privados</p><p className="text-lg font-semibold">${shortNum(myProfileStats?.private || 0)}</p></article>
              <article className="rounded-xl border border-slate-800 bg-slate-900/70 p-3"><p className="text-[11px] text-slate-400">Não listados</p><p className="text-lg font-semibold">${shortNum(myProfileStats?.unlisted || 0)}</p></article>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-bold">Packs criados por você</h2>
                <span className="text-xs text-slate-400">${myPacksLoading ? 'Carregando...' : `${myPacks.length} pack(s)`}</span>
              </div>
              ${myPacksLoading
                ? html`
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                      ${Array.from({ length: 6 }).map(
                        (_, index) => html`<div key=${index} className="h-40 rounded-2xl border border-slate-800 bg-slate-900/70 animate-pulse"></div>`,
                      )}
                    </div>
                  `
                : myPacks.length
                  ? html`
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                        ${myPacks.map((pack) => html`<${MyPackCard} key=${pack.id || pack.pack_key} pack=${pack} onOpenPublic=${onOpenPublicPack} />`)}
                      </div>
                    `
                  : html`
                      <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 p-6 text-center">
                        <p className="text-sm font-semibold text-slate-100">Nenhum pack encontrado para esta conta.</p>
                        <p className="mt-1 text-xs text-slate-400">Crie um pack com essa conta Google em <a href="/stickers/create/" className="text-cyan-300 underline">/stickers/create</a> e volte aqui.</p>
                      </div>
                    `}
            </section>
          `
        : null}
    </section>
  `;
}

function ToastStack({ toasts = [], onDismiss }) {
  if (!Array.isArray(toasts) || !toasts.length) return null;
  return html`
    <div className="fixed right-3 top-16 z-[90] flex w-[min(92vw,380px)] flex-col gap-2">
      ${toasts.map(
        (toast) => html`
          <div
            key=${toast.id}
            className=${`rounded-2xl border px-3 py-2.5 shadow-xl backdrop-blur ${
              toast.type === 'error'
                ? 'border-rose-500/35 bg-rose-500/15 text-rose-100'
                : toast.type === 'warning'
                  ? 'border-amber-500/35 bg-amber-500/15 text-amber-100'
                  : 'border-emerald-500/35 bg-emerald-500/15 text-emerald-100'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm leading-5">${toast.message || ''}</p>
              <button
                type="button"
                onClick=${() => onDismiss?.(toast.id)}
                className="rounded-md border border-white/10 px-1.5 py-0.5 text-[11px] text-white/70 hover:bg-white/10"
              >
                fechar
              </button>
            </div>
          </div>
        `,
      )}
    </div>
  `;
}

function ConfirmDialog({
  open = false,
  title = 'Confirmar',
  message = '',
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  busy = false,
  danger = false,
  onCancel,
  onConfirm,
}) {
  if (!open) return null;
  return html`
    <div className="fixed inset-0 z-[88] flex items-end justify-center bg-black/60 p-3 sm:items-center">
      <button type="button" className="absolute inset-0" onClick=${busy ? undefined : onCancel} aria-label="Fechar"></button>
      <div className="relative w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
        <h3 className="text-base font-bold text-slate-100">${title}</h3>
        <p className="mt-2 text-sm text-slate-300">${message}</p>
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick=${onCancel}
            disabled=${busy}
            className="h-10 rounded-xl border border-slate-700 px-4 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-60"
          >
            ${cancelLabel}
          </button>
          <button
            type="button"
            onClick=${onConfirm}
            disabled=${busy}
            className=${`h-10 rounded-xl border px-4 text-sm font-semibold disabled:opacity-60 ${
              danger
                ? 'border-rose-500/35 bg-rose-500/15 text-rose-100 hover:bg-rose-500/20'
                : 'border-emerald-500/35 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/20'
            }`}
          >
            ${busy ? 'Processando...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  `;
}

const PROFILE_PACK_ACTIONS = [
  { key: 'manage', label: '🛠️ Gerenciar pack' },
  { key: 'edit', label: '✏️ Editar pack' },
  { key: 'visibility', label: '👁️ Alterar visibilidade' },
  { key: 'duplicate', label: '📤 Duplicar pack' },
  { key: 'analytics', label: '📊 Ver analytics' },
  { key: 'delete', label: '🗑️ Apagar pack', danger: true },
];

function PackActionsSheet({ pack, open = false, busyAction = '', onClose, onAction }) {
  if (!open || !pack) return null;
  return html`
    <div className="fixed inset-0 z-[87] flex items-end justify-center bg-black/60 p-2 sm:items-center">
      <button type="button" className="absolute inset-0" onClick=${onClose} aria-label="Fechar"></button>
      <section className="relative w-full max-w-md rounded-3xl border border-slate-700 bg-slate-900 p-3 shadow-2xl">
        <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-slate-700 sm:hidden"></div>
        <div className="mb-2 flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-2.5">
          <img src=${pack.cover_url || 'https://iili.io/fSNGag2.png'} alt="" className="h-14 w-14 rounded-xl border border-slate-800 bg-slate-900 object-cover" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-100">${pack.name || 'Pack'}</p>
            <p className="truncate text-xs text-slate-400">${pack.pack_key || '-'}</p>
          </div>
        </div>
        <div className="space-y-1">
          ${PROFILE_PACK_ACTIONS.map((action) => html`
            <button
              key=${action.key}
              type="button"
              onClick=${() => onAction?.(action.key, pack)}
              disabled=${Boolean(busyAction)}
              className=${`w-full rounded-xl border px-3 py-3 text-left text-sm transition disabled:opacity-60 ${
                action.danger
                  ? 'border-rose-500/25 bg-rose-500/10 text-rose-100 hover:bg-rose-500/15'
                  : 'border-slate-700 bg-slate-950/60 text-slate-100 hover:bg-slate-800'
              }`}
            >
              <span>${busyAction === action.key ? '⏳ ' : ''}${action.label}</span>
            </button>
          `)}
        </div>
        <button type="button" onClick=${onClose} className="mt-3 h-10 w-full rounded-xl border border-slate-700 text-sm text-slate-200 hover:bg-slate-800">
          Fechar
        </button>
      </section>
    </div>
  `;
}

function PackAnalyticsModal({ open = false, pack = null, data = null, loading = false, error = '', onClose }) {
  if (!open) return null;
  const analytics = data?.analytics || null;
  const publishState = data?.publish_state || null;
  return html`
    <div className="fixed inset-0 z-[86] flex items-end justify-center bg-black/60 p-3 sm:items-center">
      <button type="button" className="absolute inset-0" onClick=${onClose} aria-label="Fechar"></button>
      <section className="relative w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Analytics</p>
            <h3 className="text-lg font-bold text-slate-100">${pack?.name || 'Pack'}</h3>
          </div>
          <button type="button" onClick=${onClose} className="h-9 rounded-lg border border-slate-700 px-3 text-sm text-slate-200 hover:bg-slate-800">Fechar</button>
        </div>

        ${loading
          ? html`<div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">${Array.from({ length: 4 }).map((_, i) => html`<div key=${i} className="h-20 animate-pulse rounded-xl border border-slate-800 bg-slate-950/50"></div>`)}</div>`
          : error
            ? html`<div className="mt-4 rounded-xl border border-rose-500/35 bg-rose-500/10 p-3 text-sm text-rose-200">${error}</div>`
            : html`
                <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                  <article className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><p className="text-[11px] text-slate-400">Downloads</p><p className="text-lg font-bold text-slate-100">⬇ ${shortNum(analytics?.downloads || 0)}</p></article>
                  <article className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><p className="text-[11px] text-slate-400">Likes</p><p className="text-lg font-bold text-slate-100">❤️ ${shortNum(analytics?.likes || 0)}</p></article>
                  <article className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><p className="text-[11px] text-slate-400">Dislikes</p><p className="text-lg font-bold text-slate-100">👎 ${shortNum(analytics?.dislikes || 0)}</p></article>
                  <article className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><p className="text-[11px] text-slate-400">Score</p><p className="text-lg font-bold text-slate-100">⭐ ${shortNum(analytics?.score || 0)}</p></article>
                </div>
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <article className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                    <p className="text-xs font-semibold text-slate-200">Últimas 24h vs 7 dias</p>
                    <div className="mt-2 space-y-1.5 text-xs text-slate-300">
                      <p>👆 Aberturas: <span className="font-semibold text-slate-100">${shortNum(analytics?.interaction_window?.open_horizon || 0)}</span> / ${shortNum(analytics?.interaction_window?.open_baseline || 0)}</p>
                      <p>❤️ Likes: <span className="font-semibold text-slate-100">${shortNum(analytics?.interaction_window?.like_horizon || 0)}</span> / ${shortNum(analytics?.interaction_window?.like_baseline || 0)}</p>
                      <p>👎 Dislikes: <span className="font-semibold text-slate-100">${shortNum(analytics?.interaction_window?.dislike_horizon || 0)}</span> / ${shortNum(analytics?.interaction_window?.dislike_baseline || 0)}</p>
                    </div>
                  </article>
                  <article className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                    <p className="text-xs font-semibold text-slate-200">Status de publicação</p>
                    <div className="mt-2 space-y-1.5 text-xs text-slate-300">
                      <p>Status: <span className="font-semibold text-slate-100">${publishState?.status || '-'}</span></p>
                      <p>Figurinhas: <span className="font-semibold text-slate-100">${shortNum(publishState?.consistency?.sticker_count || 0)}</span></p>
                      <p>Uploads falhos: <span className="font-semibold text-slate-100">${shortNum(publishState?.consistency?.failed_uploads || 0)}</span></p>
                      <p>Capa válida: <span className="font-semibold text-slate-100">${publishState?.consistency?.cover_valid ? 'sim' : 'não'}</span></p>
                    </div>
                  </article>
                </div>
              `}
      </section>
    </div>
  `;
}

function CreatorStatCard({ icon, label, value, tone = 'slate', sublabel = '' }) {
  const toneMap = {
    emerald: 'border-emerald-500/25 bg-emerald-500/8',
    cyan: 'border-cyan-500/25 bg-cyan-500/8',
    amber: 'border-amber-500/25 bg-amber-500/8',
    rose: 'border-rose-500/25 bg-rose-500/8',
    slate: 'border-slate-800 bg-slate-900/70',
    indigo: 'border-indigo-500/25 bg-indigo-500/8',
  };
  return html`
    <article className=${`rounded-2xl border p-3 ${toneMap[tone] || toneMap.slate}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xl">${icon || '📊'}</span>
        <span className="h-8 w-16 rounded-full bg-white/5"></span>
      </div>
      <p className="mt-2 text-xl font-bold text-slate-100">${value}</p>
      <p className="text-xs text-slate-300">${label}</p>
      ${sublabel ? html`<p className="mt-1 text-[11px] text-slate-500">${sublabel}</p>` : null}
    </article>
  `;
}

function CreatorPackCardPro({
  pack,
  onOpenPublic,
  onOpenActions,
  onOpenManage,
  onQuickDelete,
  actionBusy = '',
}) {
  const visibilityPill = formatVisibilityPill(pack?.visibility);
  const statusPill = formatStatusPill(pack?.status);
  const engagement = getPackEngagement(pack);
  const shareable = isShareablePack(pack) && Boolean(pack?.pack_key);
  const coverUrl = pack?.cover_url || 'https://iili.io/fSNGag2.png';
  const isCoverHidden = !pack?.cover_url && !isShareablePack(pack);

  return html`
    <article className="group overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/90 shadow-soft transition hover:-translate-y-0.5 hover:shadow-lg">
      <div className="relative">
        <img src=${coverUrl} alt=${`Capa de ${pack?.name || 'Pack'}`} className="h-28 w-full object-cover bg-slate-950 sm:h-32" loading="lazy" />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/25 to-transparent"></div>
        <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
          <span className=${`inline-flex rounded-full border px-2 py-0.5 text-[10px] ${statusPill.className}`}>${statusPill.label}</span>
          <span className=${`inline-flex rounded-full border px-2 py-0.5 text-[10px] ${visibilityPill.className}`}>${visibilityPill.label}</span>
        </div>
        <button
          type="button"
          onClick=${() => onOpenActions?.(pack)}
          className="absolute right-2 top-2 inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-700/90 bg-slate-950/80 text-slate-100 hover:bg-slate-800"
          title="Ações"
        >
          ⋮
        </button>
        ${isCoverHidden
          ? html`<div className="absolute bottom-2 left-2 rounded-full border border-slate-600 bg-slate-950/80 px-2 py-0.5 text-[10px] text-slate-300">🔒 capa oculta no catálogo</div>`
          : null}
      </div>

      <div className="p-2.5 space-y-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold text-slate-100 sm:text-[15px]">${pack?.name || 'Pack sem nome'}</h3>
          <p className="truncate text-[10px] text-slate-500">${pack?.pack_key || '-'}</p>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-slate-800 bg-slate-950/35 px-2.5 py-2">
          <p className="text-[11px] text-slate-300">🧩 ${shortNum(pack?.sticker_count || 0)}</p>
          <p className="text-[11px] text-slate-300">❤️ ${shortNum(engagement.likeCount)}</p>
          <p className="text-[11px] text-slate-300">⬇ ${shortNum(engagement.openCount)}</p>
          <p className="truncate text-[11px] text-slate-400">📅 ${pack?.updated_at ? new Date(pack.updated_at).toLocaleDateString('pt-BR') : '-'}</p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick=${() => onOpenManage?.(pack)}
            disabled=${Boolean(actionBusy)}
            className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-950/60 px-2 text-[11px] text-slate-100 hover:bg-slate-800 disabled:opacity-60"
          >
            ➕ Sticker
          </button>
          <button
            type="button"
            onClick=${() => onOpenManage?.(pack)}
            disabled=${Boolean(actionBusy)}
            className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-950/60 px-2 text-[11px] text-slate-100 hover:bg-slate-800 disabled:opacity-60"
          >
            ✏️ Editar
          </button>
          <button
            type="button"
            onClick=${() => onQuickDelete?.(pack)}
            disabled=${Boolean(actionBusy)}
            className="inline-flex h-8 items-center justify-center rounded-lg border border-rose-500/25 bg-rose-500/10 px-2 text-[11px] text-rose-100 hover:bg-rose-500/15 disabled:opacity-60"
          >
            🗑️ Excluir
          </button>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick=${() => onOpenManage?.(pack)}
            disabled=${Boolean(actionBusy)}
            className="inline-flex h-9 flex-1 items-center justify-center rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-3 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-60"
          >
            ${actionBusy === 'manage' ? 'Abrindo...' : 'Gerenciar pack'}
          </button>
          ${shareable
            ? html`
                <button
                  type="button"
                  onClick=${() => onOpenPublic?.(pack.pack_key)}
                  className="inline-flex h-9 items-center justify-center rounded-xl border border-slate-700 bg-slate-950/60 px-3 text-xs font-medium text-slate-100 hover:bg-slate-800"
                >
                  Abrir
                </button>
              `
            : html`<span className="inline-flex h-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-950/40 px-3 text-[11px] text-slate-500">Sem link público</span>`}
        </div>
      </div>
    </article>
  `;
}

function PackManagerModal({
  open = false,
  data = null,
  loading = false,
  error = '',
  busyAction = '',
  onClose,
  onRefresh,
  onSaveMetadata,
  onAddSticker,
  onRemoveSticker,
  onReplaceSticker,
  onSetCover,
  onReorder,
  onOpenAnalytics,
}) {
  const pack = data?.pack || null;
  const publishState = data?.publish_state || null;
  const analytics = data?.analytics || null;
  const items = Array.isArray(pack?.items) ? pack.items : [];

  const [name, setName] = useState('');
  const [publisher, setPublisher] = useState('');
  const [description, setDescription] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [orderIds, setOrderIds] = useState([]);
  const [draggingId, setDraggingId] = useState('');

  useEffect(() => {
    if (!pack) return;
    setName(String(pack.name || ''));
    setPublisher(String(pack.publisher || ''));
    setDescription(String(pack.description || ''));
    setTagsText(Array.isArray(pack.manual_tags) ? pack.manual_tags.join(', ') : '');
    setVisibility(String(pack.visibility || 'public'));
    setOrderIds(items.map((item) => item.sticker_id).filter(Boolean));
  }, [pack?.id, pack?.version, items.length]);

  useEffect(() => {
    if (!pack) return;
    const itemIds = items.map((item) => item.sticker_id).filter(Boolean);
    setOrderIds((prev) => {
      const current = Array.isArray(prev) ? prev.filter((id) => itemIds.includes(id)) : [];
      const missing = itemIds.filter((id) => !current.includes(id));
      return [...current, ...missing];
    });
  }, [pack?.id, items.map((item) => item.sticker_id).join('|')]);

  if (!open) return null;

  const orderMap = new Map(items.map((item) => [item.sticker_id, item]));
  const orderedItems = orderIds.map((id) => orderMap.get(id)).filter(Boolean);
  const orderDirty =
    orderedItems.length === items.length &&
    orderedItems.some((item, index) => String(item?.sticker_id || '') !== String(items[index]?.sticker_id || ''));

  return html`
    <div className="fixed inset-0 z-[85] flex items-end justify-center bg-black/65 p-2 sm:items-center sm:p-4">
      <button type="button" className="absolute inset-0" onClick=${onClose} aria-label="Fechar"></button>
      <section className="relative flex h-[min(94vh,960px)] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl">
        <header className="border-b border-slate-800 bg-slate-950/70 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-slate-400">Gerenciar pack</p>
              <h3 className="truncate text-lg font-bold text-slate-100">${pack?.name || 'Carregando...'}</h3>
              <p className="truncate text-xs text-slate-500">${pack?.pack_key || '-'}</p>
            </div>
            <div className="flex items-center gap-2">
              <label className="inline-flex h-10 cursor-pointer items-center rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/20">
                ➕ Adicionar sticker
                <input
                  type="file"
                  accept="image/*,video/mp4,video/webm,video/quicktime,video/x-m4v"
                  className="hidden"
                  onChange=${(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    onAddSticker?.(file);
                    event.target.value = '';
                  }}
                />
              </label>
              <button type="button" onClick=${onOpenAnalytics} disabled=${loading || !pack} className="h-10 rounded-xl border border-indigo-500/35 bg-indigo-500/10 px-3 text-xs font-semibold text-indigo-100 hover:bg-indigo-500/20 disabled:opacity-60">📊 Analytics</button>
              <button type="button" onClick=${onRefresh} disabled=${Boolean(busyAction) || loading} className="h-10 rounded-xl border border-slate-700 px-3 text-xs text-slate-100 hover:bg-slate-800 disabled:opacity-60">${loading ? 'Atualizando...' : 'Atualizar'}</button>
              <button type="button" onClick=${onClose} className="h-10 rounded-xl border border-slate-700 px-3 text-xs text-slate-100 hover:bg-slate-800">Fechar</button>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
          ${loading
            ? html`
                <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
                  <div className="space-y-3">${Array.from({ length: 4 }).map((_, i) => html`<div key=${i} className="h-24 animate-pulse rounded-2xl border border-slate-800 bg-slate-950/50"></div>`)}</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">${Array.from({ length: 8 }).map((_, i) => html`<div key=${i} className="aspect-square animate-pulse rounded-2xl border border-slate-800 bg-slate-950/50"></div>`)}</div>
                </div>
              `
            : error
              ? html`<div className="rounded-2xl border border-rose-500/35 bg-rose-500/10 p-3 text-sm text-rose-200">${error}</div>`
              : !pack
                ? html`<div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4 text-sm text-slate-300">Pack não carregado.</div>`
                : html`
                    <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
                      <aside className="space-y-4">
                        <section className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3 space-y-3">
                          <div className="flex gap-3">
                            <img src=${pack.cover_url || 'https://iili.io/fSNGag2.png'} alt="" className="h-20 w-20 rounded-2xl border border-slate-800 bg-slate-900 object-cover" />
                            <div className="min-w-0 space-y-1">
                              <p className="truncate text-sm font-semibold text-slate-100">${pack.name || 'Pack'}</p>
                              <p className="truncate text-[11px] text-slate-400">${pack.pack_key || '-'}</p>
                              <div className="flex flex-wrap gap-1.5">
                                <span className=${`inline-flex rounded-full border px-2 py-0.5 text-[10px] ${formatStatusPill(pack.status).className}`}>${formatStatusPill(pack.status).label}</span>
                                <span className=${`inline-flex rounded-full border px-2 py-0.5 text-[10px] ${formatVisibilityPill(pack.visibility).className}`}>${formatVisibilityPill(pack.visibility).label}</span>
                              </div>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-2"><p className="text-slate-400">Stickers</p><p className="font-semibold text-slate-100">${shortNum(pack.sticker_count || 0)}</p></div>
                            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-2"><p className="text-slate-400">Downloads</p><p className="font-semibold text-slate-100">${shortNum(analytics?.downloads || 0)}</p></div>
                            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-2"><p className="text-slate-400">Likes</p><p className="font-semibold text-slate-100">${shortNum(analytics?.likes || 0)}</p></div>
                            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-2"><p className="text-slate-400">Pronto p/ publicar</p><p className="font-semibold text-slate-100">${publishState?.consistency?.can_publish ? 'Sim' : 'Não'}</p></div>
                          </div>
                        </section>

                        <form
                          onSubmit=${(event) => {
                            event.preventDefault();
                            onSaveMetadata?.({
                              name,
                              publisher,
                              description,
                              tags: parseTagsInputText(tagsText),
                              visibility,
                            });
                          }}
                          className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3 space-y-3"
                        >
                          <div>
                            <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-400">Nome</label>
                            <input value=${name} onChange=${(e) => setName(e.target.value)} maxLength="120" className="h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-cyan-400/40" />
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-400">Publisher</label>
                            <input value=${publisher} onChange=${(e) => setPublisher(e.target.value)} maxLength="120" className="h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-cyan-400/40" />
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-400">Descrição</label>
                            <textarea value=${description} onChange=${(e) => setDescription(e.target.value)} rows="3" maxLength="1024" className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/40"></textarea>
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-400">Tags (separadas por vírgula)</label>
                            <input value=${tagsText} onChange=${(e) => setTagsText(e.target.value)} placeholder="meme, reaction, anime" className="h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-cyan-400/40" />
                            <p className="mt-1 text-[11px] text-slate-500">Salvas no metadata do pack (máx. 8).</p>
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-400">Visibilidade</label>
                            <select value=${visibility} onChange=${(e) => setVisibility(e.target.value)} className="h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-cyan-400/40">
                              <option value="public">Público</option>
                              <option value="unlisted">Não listado</option>
                              <option value="private">Privado</option>
                            </select>
                          </div>
                          <button type="submit" disabled=${Boolean(busyAction)} className="h-11 w-full rounded-xl border border-cyan-500/35 bg-cyan-500/10 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-60">
                            ${busyAction === 'saveMetadata' ? 'Salvando...' : 'Salvar alterações'}
                          </button>
                        </form>
                      </aside>

                      <section className="space-y-3 min-w-0">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h4 className="text-base font-bold text-slate-100">Stickers do pack</h4>
                            <p className="text-xs text-slate-400">Arraste para reordenar. Use ⭐ para capa, 🔁 para substituir e ❌ para remover.</p>
                          </div>
                          ${orderDirty
                            ? html`
                                <button
                                  type="button"
                                  onClick=${() => onReorder?.(orderIds)}
                                  disabled=${Boolean(busyAction)}
                                  className="h-10 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 text-xs font-semibold text-amber-100 hover:bg-amber-500/20 disabled:opacity-60"
                                >
                                  ${busyAction === 'reorder' ? 'Salvando ordem...' : 'Salvar ordem'}
                                </button>
                              `
                            : null}
                        </div>

                        ${orderedItems.length
                          ? html`
                              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                                ${orderedItems.map((item, index) => {
                                  const isCover = String(pack?.cover_sticker_id || '') === String(item?.sticker_id || '');
                                  return html`
                                    <article
                                      key=${item.sticker_id}
                                      draggable="true"
                                      onDragStart=${() => setDraggingId(item.sticker_id)}
                                      onDragOver=${(e) => e.preventDefault()}
                                      onDrop=${(e) => {
                                        e.preventDefault();
                                        const fromIndex = orderIds.findIndex((id) => id === draggingId);
                                        const toIndex = orderIds.findIndex((id) => id === item.sticker_id);
                                        if (fromIndex >= 0 && toIndex >= 0) {
                                          setOrderIds(moveArrayItem(orderIds, fromIndex, toIndex));
                                        }
                                        setDraggingId('');
                                      }}
                                      className=${`group overflow-hidden rounded-2xl border bg-slate-950/40 ${draggingId === item.sticker_id ? 'border-cyan-400/50' : 'border-slate-800'}`}
                                    >
                                      <div className="relative aspect-square bg-slate-950">
                                        <img src=${item.asset_url || 'https://iili.io/fSNGag2.png'} alt=${item.accessibility_label || 'Sticker'} className="h-full w-full object-contain" loading="lazy" />
                                        <div className="absolute left-2 top-2 rounded-full border border-slate-700 bg-slate-950/90 px-2 py-0.5 text-[10px] text-slate-200">#${index + 1}</div>
                                        ${isCover ? html`<div className="absolute right-2 top-2 rounded-full border border-amber-400/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-100">⭐ Capa</div>` : null}
                                      </div>
                                      <div className="p-2 space-y-2">
                                        <p className="truncate text-[11px] text-slate-500">${item.sticker_id}</p>
                                        <div className="grid grid-cols-2 gap-1.5">
                                          <button type="button" onClick=${() => onSetCover?.(item.sticker_id)} disabled=${Boolean(busyAction)} className="h-8 rounded-lg border border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-100 hover:bg-amber-500/15 disabled:opacity-60">⭐ Capa</button>
                                          <label className="inline-flex h-8 cursor-pointer items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2 text-[11px] text-cyan-100 hover:bg-cyan-500/15">
                                            🔁 Trocar
                                            <input
                                              type="file"
                                              accept="image/*,video/mp4,video/webm,video/quicktime,video/x-m4v"
                                              className="hidden"
                                              onChange=${(event) => {
                                                const file = event.target.files?.[0];
                                                if (!file) return;
                                                onReplaceSticker?.(item.sticker_id, file);
                                                event.target.value = '';
                                              }}
                                            />
                                          </label>
                                          <button type="button" onClick=${() => onRemoveSticker?.(item.sticker_id)} disabled=${Boolean(busyAction)} className="col-span-2 h-8 rounded-lg border border-rose-500/30 bg-rose-500/10 text-[11px] text-rose-100 hover:bg-rose-500/15 disabled:opacity-60">❌ Remover sticker</button>
                                        </div>
                                      </div>
                                    </article>
                                  `;
                                })}
                              </div>
                            `
                          : html`<div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 p-6 text-center text-sm text-slate-300">Este pack ainda não possui stickers.</div>`}
                      </section>
                    </div>
                  `}
        </div>

        <footer className="border-t border-slate-800 bg-slate-950/80 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <span>${busyAction ? `Processando: ${busyAction}` : 'Pronto para gerenciar.'}</span>
            <span>${publishState?.consistency?.can_publish ? '✅ Pack consistente para publicação' : '⚠️ Revise capa/uploads/stickers antes de publicar'}</span>
          </div>
        </footer>
      </section>
    </div>
  `;
}

function CreatorProfileDashboard({
  googleAuthConfig,
  googleAuth,
  googleAuthBusy,
  googleAuthError,
  googleSessionChecked,
  googleAuthUiReady,
  googleButtonRef,
  myPacks,
  myPacksLoading,
  myPacksError,
  myProfileStats,
  onBack,
  onRefresh,
  onLogout,
  onOpenPublicPack,
  onOpenPackActions,
  onOpenManagePack,
  onProfileAction,
  onRequestDeletePack,
  packActionBusyByKey = {},
}) {
  const [packSearch, setPackSearch] = useState('');
  const [packSort, setPackSort] = useState('recent');
  const [packFilter, setPackFilter] = useState('all');
  const hasGoogleLogin = Boolean(googleAuth?.user?.sub);
  const googleLoginEnabled = Boolean(googleAuthConfig?.enabled && googleAuthConfig?.clientId);
  const packs = Array.isArray(myPacks) ? myPacks : [];
  const totals = packs.reduce(
    (acc, pack) => {
      const engagement = getPackEngagement(pack);
      acc.downloads += Number(engagement.openCount || 0);
      acc.likes += Number(engagement.likeCount || 0);
      acc.stickers += Number(pack?.sticker_count || 0);
      if (String(pack?.status || '').toLowerCase() === 'published') {
        acc.publishedStickers += Number(pack?.sticker_count || 0);
      }
      return acc;
    },
    { downloads: 0, likes: 0, stickers: 0, publishedStickers: 0 },
  );
  const filteredSortedPacks = useMemo(() => {
    const q = normalizeToken(packSearch);
    const next = packs.filter((pack) => {
      if (packFilter !== 'all') {
        const status = String(pack?.status || '').toLowerCase();
        const visibility = String(pack?.visibility || '').toLowerCase();
        if (packFilter === 'published' && status !== 'published') return false;
        if (packFilter === 'draft' && status !== 'draft') return false;
        if (packFilter === 'private' && visibility !== 'private') return false;
        if (packFilter === 'unlisted' && visibility !== 'unlisted') return false;
      }
      if (!q) return true;
      const searchable = [
        pack?.name,
        pack?.publisher,
        pack?.pack_key,
        pack?.description,
        ...(Array.isArray(pack?.manual_tags) ? pack.manual_tags : []),
      ]
        .map((value) => normalizeToken(value))
        .join(' ');
      return searchable.includes(q);
    });

    next.sort((a, b) => {
      const ea = getPackEngagement(a);
      const eb = getPackEngagement(b);
      if (packSort === 'downloads') return eb.openCount - ea.openCount;
      if (packSort === 'likes') return eb.likeCount - ea.likeCount;
      return new Date(b?.updated_at || b?.created_at || 0).getTime() - new Date(a?.updated_at || a?.created_at || 0).getTime();
    });
    return next;
  }, [packs, packSearch, packSort, packFilter]);
  const visibleCountLabel = `${filteredSortedPacks.length}${packSearch.trim() || packFilter !== 'all' ? ` de ${packs.length}` : ''}`;
  const profileStatusChips = [
    { key: 'published', label: '🟢 Publicados', value: Number(myProfileStats?.published || 0) },
    { key: 'draft', label: '🟡 Rascunhos', value: Number(myProfileStats?.drafts || 0) },
    { key: 'private', label: '🔒 Privados', value: Number(myProfileStats?.private || 0) },
    { key: 'unlisted', label: '🔵 Não listados', value: Number(myProfileStats?.unlisted || 0) },
  ];
  const packFilterOptions = [
    { key: 'all', label: 'Todos' },
    { key: 'published', label: 'Publicados' },
    { key: 'draft', label: 'Rascunhos' },
    { key: 'private', label: 'Privados' },
    { key: 'unlisted', label: 'Não listados' },
  ];

  return html`
    <section className="space-y-3 pb-16 sm:pb-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick=${onBack} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">← Catálogo</button>
        <div className="flex items-center gap-2">
          <button type="button" onClick=${() => onProfileAction?.('edit-profile')} className="inline-flex h-10 items-center rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/20">✏️ Editar perfil</button>
          <button type="button" onClick=${() => onProfileAction?.('settings')} className="inline-flex h-10 items-center rounded-xl border border-slate-700 px-3 text-xs text-slate-200 hover:bg-slate-800">⚙️</button>
          <button type="button" onClick=${onRefresh} disabled=${myPacksLoading || googleAuthBusy} className="inline-flex h-10 items-center rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-3 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-60">${myPacksLoading ? '...' : '⟳'}</button>
        </div>
      </div>

      <section className="relative overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-900 p-3.5 sm:p-4">
        <div className="pointer-events-none absolute -right-10 -top-8 h-40 w-40 rounded-full bg-cyan-400/15 blur-3xl"></div>
        <div className="pointer-events-none absolute -left-8 bottom-0 h-32 w-32 rounded-full bg-emerald-400/10 blur-3xl"></div>
        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <img
                src=${googleAuth?.user?.picture || getAvatarUrl(googleAuth?.user?.name || 'creator')}
                alt="Avatar"
                className="h-20 w-20 rounded-2xl border border-slate-700 bg-slate-900 object-cover sm:h-24 sm:w-24"
              />
              <div className="min-w-0">
                <div className="mb-1 inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-100">✅ Criador verificado</div>
                <h1 className="truncate text-2xl font-extrabold tracking-tight text-slate-100 sm:text-3xl">${googleAuth?.user?.name || 'Meu perfil de packs'}</h1>
                <p className="truncate text-xs text-slate-400">${googleAuth?.user?.email || 'Faça login com Google para vincular seus packs.'}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">Sessão ${googleAuth?.expiresAt ? `até ${new Date(googleAuth.expiresAt).toLocaleString('pt-BR')}` : hasGoogleLogin ? 'ativa' : 'não autenticada'}</p>
              </div>
            </div>
            ${hasGoogleLogin
              ? html`<button type="button" onClick=${onLogout} disabled=${googleAuthBusy} className="inline-flex h-10 items-center rounded-xl border border-slate-700 px-3 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-60">${googleAuthBusy ? 'Saindo...' : 'Sair'}</button>`
              : null}
          </div>

          ${hasGoogleLogin
            ? html`
                <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-950/35 p-2.5">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-2.5 py-2"><p className="text-[10px] text-slate-400">Packs</p><p className="text-base font-bold text-slate-100">${shortNum(myProfileStats?.total || 0)}</p></div>
                    <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-2.5 py-2"><p className="text-[10px] text-slate-400">Downloads</p><p className="text-base font-bold text-slate-100">${shortNum(totals.downloads)}</p></div>
                    <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-2.5 py-2"><p className="text-[10px] text-slate-400">Likes</p><p className="text-base font-bold text-slate-100">${shortNum(totals.likes)}</p></div>
                    <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-2.5 py-2"><p className="text-[10px] text-slate-400">Stickers publicados</p><p className="text-base font-bold text-slate-100">${shortNum(totals.publishedStickers)}</p></div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    ${profileStatusChips.map((chip) => html`
                      <button
                        key=${chip.key}
                        type="button"
                        onClick=${() => setPackFilter((prev) => (prev === chip.key ? 'all' : chip.key))}
                        className=${`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] ${
                          packFilter === chip.key
                            ? 'border-cyan-400/35 bg-cyan-500/10 text-cyan-100'
                            : 'border-slate-700 bg-slate-900/50 text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        <span>${chip.label}</span>
                        <span className="font-semibold">${shortNum(chip.value)}</span>
                      </button>
                    `)}
                  </div>
                </div>
              `
            : null}
        </div>
      </section>

      ${!hasGoogleLogin
        ? html`
            <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
              <div className="space-y-2.5">
                <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
                  <p className="text-sm font-semibold text-cyan-200">Entrar com Google</p>
                  <p className="mt-1 text-xs text-slate-300">
                    ${googleLoginEnabled
                      ? 'Use a mesma conta Google usada na criação de packs para carregar e gerenciar tudo aqui.'
                      : 'Login Google indisponível no momento.'}
                  </p>
                </div>
                ${googleLoginEnabled
                  ? html`
                      <div ref=${googleButtonRef} className="min-h-[42px] w-full max-w-[340px] overflow-hidden"></div>
                      ${!googleSessionChecked
                        ? html`<p className="text-xs text-slate-400">Verificando sessão Google...</p>`
                        : googleAuthBusy
                          ? html`<p className="text-xs text-slate-400">Conectando conta Google...</p>`
                          : !googleAuthUiReady && !googleAuthError
                            ? html`<p className="text-xs text-slate-400">Carregando login Google...</p>`
                            : null}
                    `
                  : null}
                ${googleAuthError ? html`<p className="text-xs text-rose-300">${googleAuthError}</p>` : null}
              </div>
            </section>
          `
        : html`
            ${myPacksError ? html`<div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">${myPacksError}</div>` : null}

            <section className="space-y-2.5">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-bold text-slate-100">Packs criados por você</h2>
                    <p className="text-xs text-slate-400">Busca, ordenação e gerenciamento rápido.</p>
                  </div>
                  <span className="text-xs text-slate-400">${myPacksLoading ? 'Carregando...' : `${visibleCountLabel} pack(s)`}</span>
                </div>

                <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_180px]">
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">🔎</span>
                    <input
                      type="search"
                      value=${packSearch}
                      onChange=${(e) => setPackSearch(e.target.value)}
                      placeholder="Buscar por nome, ID, tags ou publisher..."
                      className="h-10 w-full rounded-xl border border-slate-700 bg-slate-950/60 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-cyan-400/40"
                    />
                  </div>
                  <select
                    value=${packSort}
                    onChange=${(e) => setPackSort(e.target.value)}
                    className="h-10 rounded-xl border border-slate-700 bg-slate-950/60 px-3 text-sm text-slate-100 outline-none focus:border-cyan-400/40"
                  >
                    <option value="recent">Mais recente</option>
                    <option value="downloads">Mais downloads</option>
                    <option value="likes">Mais likes</option>
                  </select>
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  ${packFilterOptions.map((option) => html`
                    <button
                      key=${option.key}
                      type="button"
                      onClick=${() => setPackFilter(option.key)}
                      className=${`h-8 rounded-full border px-2.5 text-[11px] ${
                        packFilter === option.key
                          ? 'border-cyan-400/35 bg-cyan-500/10 text-cyan-100'
                          : 'border-slate-700 bg-slate-950/50 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      ${option.label}
                    </button>
                  `)}
                </div>
              </div>

              ${myPacksLoading
                ? html`
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                      ${Array.from({ length: 6 }).map((_, index) => html`<div key=${index} className="h-56 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/70"></div>`)}
                    </div>
                  `
                : filteredSortedPacks.length
                  ? html`
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                        ${filteredSortedPacks.map((pack) => html`
                          <${CreatorPackCardPro}
                            key=${pack.id || pack.pack_key}
                            pack=${pack}
                            onOpenPublic=${onOpenPublicPack}
                            onOpenActions=${onOpenPackActions}
                            onOpenManage=${onOpenManagePack}
                            onQuickDelete=${onRequestDeletePack}
                            actionBusy=${packActionBusyByKey?.[pack.pack_key] || ''}
                          />
                        `)}
                      </div>
                    `
                  : html`
                      <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 p-5 text-center">
                        <p className="text-sm font-semibold text-slate-100">${packs.length ? 'Nenhum pack corresponde aos filtros.' : 'Nenhum pack encontrado para esta conta.'}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          ${packs.length
                            ? 'Tente limpar busca/filtros para ver seus packs.'
                            : html`Crie um pack com essa conta Google em <a href="/stickers/create/" className="text-cyan-300 underline">/stickers/create</a> e volte aqui.`}
                        </p>
                        ${packs.length
                          ? html`<button type="button" onClick=${() => { setPackSearch(''); setPackFilter('all'); }} className="mt-3 h-9 rounded-xl border border-slate-700 px-3 text-xs text-slate-100 hover:bg-slate-800">Limpar filtros</button>`
                          : null}
                      </div>
                    `}
            </section>
          `}
    </section>
  `;
}

function OrphanCard({ sticker }) {
  return html`
    <article className="group rounded-2xl border border-slate-700/80 bg-slate-800/70 shadow-soft overflow-hidden transition-all duration-200 hover:-translate-y-0.5">
      <div className="aspect-square bg-slate-900 overflow-hidden">
        <img
          src=${sticker.url || 'https://iili.io/fSNGag2.png'}
          alt="Sticker sem pack"
          className="w-full h-full object-contain transition-transform duration-300 group-hover:scale-110"
          loading="lazy"
        />
      </div>
      <div className="p-2">
        ${primaryTag(sticker)
          ? html`<span className="inline-flex rounded-full border border-slate-600 bg-slate-900/80 px-2 py-0.5 text-[10px] text-slate-300">${primaryTag(
              sticker,
            )}</span>`
          : html`<span className="inline-flex rounded-full border border-slate-600 bg-slate-900/80 px-2 py-0.5 text-[10px] text-slate-400">sticker</span>`}
      </div>
    </article>
  `;
}

function SkeletonGrid({ count = 10 }) {
  return html`
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-3">
      ${Array.from({ length: count }).map(
        (_, index) => html`
          <div key=${index} className="rounded-2xl border border-slate-700 bg-slate-800 overflow-hidden animate-pulse">
            <div className="aspect-[4/5] bg-slate-700"></div>
            <div className="p-2.5 space-y-2">
              <div className="h-3 rounded bg-slate-700"></div>
              <div className="h-3 w-2/3 rounded bg-slate-700"></div>
              <div className="h-11 rounded-xl bg-slate-700"></div>
            </div>
          </div>
        `,
      )}
    </div>
  `;
}

function EmptyState({ onClear }) {
  return html`
    <div className="rounded-2xl border border-dashed border-slate-600 bg-slate-800/60 p-10 text-center">
      <div className="text-5xl mb-2">🧩</div>
      <p className="text-slate-100 font-semibold">Nenhum pack encontrado</p>
      <p className="text-slate-400 text-sm mt-1">Tente outra busca ou remova os filtros ativos.</p>
      <button
        type="button"
        onClick=${onClear}
        className="mt-4 inline-flex items-center justify-center rounded-xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700 transition"
      >
        Limpar filtros
      </button>
    </div>
  `;
}

function StickerPreview({ item, onClose, onPrev, onNext }) {
  if (!item) return null;

  const handleCopy = async () => {
    if (!item?.asset_url) return;
    try {
      await navigator.clipboard.writeText(item.asset_url);
    } catch {}
  };

  return html`
    <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0" aria-label="Fechar preview" onClick=${onClose}></button>

      <div className="relative w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-3">
        <img src=${item.asset_url || 'https://iili.io/fSNGag2.png'} alt=${item.accessibility_label || 'Sticker'} className="w-full max-h-[70vh] object-contain rounded-xl bg-slate-950" />

        <div className="mt-3 flex items-center justify-between gap-2">
          <button type="button" onClick=${onPrev} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">← Anterior</button>
          <div className="flex items-center gap-2">
            <button type="button" onClick=${handleCopy} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Copiar link</button>
            <button type="button" onClick=${onClose} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Fechar</button>
          </div>
          <button type="button" onClick=${onNext} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Próximo →</button>
        </div>
      </div>
    </div>
  `;
}

function PackPage({ pack, relatedPacks, onBack, onOpenRelated, onLike, onDislike, reactionLoading = '' }) {
  const items = Array.isArray(pack?.items) ? pack.items : [];
  const tags = Array.isArray(pack?.tags) ? pack.tags : [];
  const cover = pack?.cover_url || items?.[0]?.asset_url || 'https://iili.io/fSNGag2.png';
  const whatsappUrl = String(pack?.whatsapp?.url || '').trim();
  const engagement = getPackEngagement(pack);
  const [previewIndex, setPreviewIndex] = useState(-1);

  const currentPreviewItem = previewIndex >= 0 ? items[previewIndex] : null;

  return html`
    <section className="space-y-5 pb-20 sm:pb-4">
      <button
        type="button"
        onClick=${onBack}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
      >
        ← Voltar para catálogo
      </button>

      <div className="rounded-2xl border border-slate-700 bg-slate-800/90 overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-0">
          <div className="bg-slate-900">
            <img src=${cover} alt=${`Capa ${pack?.name || 'Pack'}`} className="w-full aspect-square object-cover" loading="lazy" />
          </div>

          <div className="p-4 sm:p-5 space-y-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">${pack?.name || 'Pack'}</h1>
              <p className="text-sm text-slate-400 mt-1">${pack?.publisher || '-'} · ${pack?.created_at ? new Date(pack.created_at).toLocaleDateString('pt-BR') : 'sem data'}</p>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <div className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2">
                <p className="text-[10px] text-slate-400">Likes</p>
                <p className="text-sm font-semibold">👍 ${shortNum(engagement.likeCount)}</p>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2">
                <p className="text-[10px] text-slate-400">Dislikes</p>
                <p className="text-sm font-semibold">👎 ${shortNum(engagement.dislikeCount)}</p>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2">
                <p className="text-[10px] text-slate-400">Stickers</p>
                <p className="text-sm font-semibold">🧩 ${Number(pack?.sticker_count || items.length)}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-sm">
              <span className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-slate-300">
                👆 ${shortNum(engagement.openCount)} cliques
              </span>
              <button
                type="button"
                onClick=${() => onLike(pack?.pack_key)}
                disabled=${reactionLoading === 'like'}
                className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-emerald-200 transition hover:bg-emerald-500/20 disabled:opacity-60"
              >
                ${reactionLoading === 'like' ? 'Enviando...' : '👍 Curtir'}
              </button>
              <button
                type="button"
                onClick=${() => onDislike(pack?.pack_key)}
                disabled=${reactionLoading === 'dislike'}
                className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-rose-200 transition hover:bg-rose-500/20 disabled:opacity-60"
              >
                ${reactionLoading === 'dislike' ? 'Enviando...' : '👎 Não curtir'}
              </button>
            </div>

            ${tags.length
              ? html`
                  <div className="flex flex-wrap gap-2">
                    ${tags.slice(0, 8).map(
                      (tag) => html`<span key=${tag} className="inline-flex rounded-full border border-slate-600 bg-slate-900/85 px-3 py-1 text-xs text-slate-200">${tagLabel(tag)}</span>`,
                    )}
                  </div>
                `
              : null}

            ${whatsappUrl
              ? html`
                  <a
                    href=${whatsappUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="hidden sm:inline-flex w-full sm:w-auto items-center justify-center rounded-xl bg-[#25D366] px-5 py-2.5 text-sm font-bold text-[#042d17] shadow-[0_8px_24px_rgba(37,211,102,0.35)] transition hover:brightness-95"
                  >
                    📲 Adicionar no WhatsApp
                  </a>
                `
              : null}
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">Stickers do pack</h2>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 sm:gap-3">
          ${items.map(
            (item, index) => html`
              <button
                key=${item.sticker_id || item.position || index}
                type="button"
                onClick=${() => setPreviewIndex(index)}
                className="group rounded-xl border border-slate-700/70 bg-slate-800 overflow-hidden text-left"
              >
                <img
                  src=${item.asset_url || 'https://iili.io/fSNGag2.png'}
                  alt=${item.accessibility_label || 'Sticker'}
                  loading="lazy"
                  className="w-full aspect-square object-contain bg-slate-950 transition-transform duration-300 group-hover:scale-105"
                />
              </button>
            `,
          )}
        </div>
      </section>

      ${relatedPacks.length
        ? html`
            <section className="space-y-3">
              <h2 className="text-lg font-bold">Packs relacionados</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                ${relatedPacks.map(
                  (entry, index) => html`<${PackCard} key=${entry.pack_key || entry.id} pack=${entry} index=${index} onOpen=${onOpenRelated} />`,
                )}
              </div>
            </section>
          `
        : null}

      ${whatsappUrl
        ? html`
            <div className="sm:hidden fixed bottom-4 left-4 right-4 z-40">
              <a
                href=${whatsappUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="w-full inline-flex items-center justify-center rounded-xl bg-[#25D366] px-4 py-3 text-sm font-bold text-[#042d17] shadow-[0_10px_30px_rgba(37,211,102,0.35)]"
              >
                📲 Adicionar no WhatsApp
              </a>
            </div>
          `
        : null}

      ${previewIndex >= 0
        ? html`
            <${StickerPreview}
              item=${currentPreviewItem}
              onClose=${() => setPreviewIndex(-1)}
              onPrev=${() => setPreviewIndex((value) => (value <= 0 ? items.length - 1 : value - 1))}
              onNext=${() => setPreviewIndex((value) => (value >= items.length - 1 ? 0 : value + 1))}
            />
          `
        : null}
    </section>
  `;
}

function StickersApp() {
  const root = document.getElementById('stickers-react-root');
  const config = useMemo(
    () => ({
      webPath: root?.dataset.webPath || '/stickers',
      apiBasePath: root?.dataset.apiBasePath || '/api/sticker-packs',
      orphanApiPath: root?.dataset.orphanApiPath || '/api/sticker-packs/orphan-stickers',
      limit: parseIntSafe(root?.dataset.defaultLimit, 24),
      orphanLimit: parseIntSafe(root?.dataset.defaultOrphanLimit, 24),
    }),
    [root],
  );
  const initialRoute = parseStickersLocation(config.webPath);

  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [sortBy, setSortBy] = useState('popular');
  const [activeCategory, setActiveCategory] = useState('');
  const [discoverTab, setDiscoverTab] = useState('growing');
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [recentSearches, setRecentSearches] = useState([]);

  const [packs, setPacks] = useState([]);
  const [packOffset, setPackOffset] = useState(0);
  const [packHasMore, setPackHasMore] = useState(true);
  const [packsLoading, setPacksLoading] = useState(false);
  const [packsLoadingMore, setPacksLoadingMore] = useState(false);

  const [orphans, setOrphans] = useState([]);
  const [orphansLoading, setOrphansLoading] = useState(false);

  const [error, setError] = useState('');
  const [sentinel, setSentinel] = useState(null);

  const [currentView, setCurrentView] = useState(initialRoute.view || 'catalog');
  const [currentPackKey, setCurrentPackKey] = useState(initialRoute.packKey || '');
  const [currentPack, setCurrentPack] = useState(null);
  const [packLoading, setPackLoading] = useState(false);
  const [reactionLoading, setReactionLoading] = useState('');
  const [relatedPacks, setRelatedPacks] = useState([]);
  const [isScrolled, setIsScrolled] = useState(false);
  const [supportInfo, setSupportInfo] = useState(null);
  const [uploadTask, setUploadTask] = useState(null);
  const [googleAuthConfig, setGoogleAuthConfig] = useState({ enabled: false, required: false, clientId: '' });
  const [googleAuth, setGoogleAuth] = useState({ user: null, expiresAt: '' });
  const [googleAuthUiReady, setGoogleAuthUiReady] = useState(false);
  const [googleAuthError, setGoogleAuthError] = useState('');
  const [googleAuthBusy, setGoogleAuthBusy] = useState(false);
  const [googleSessionChecked, setGoogleSessionChecked] = useState(false);
  const [myPacks, setMyPacks] = useState([]);
  const [myPacksLoading, setMyPacksLoading] = useState(false);
  const [myPacksError, setMyPacksError] = useState('');
  const [myProfileStats, setMyProfileStats] = useState({
    total: 0,
    published: 0,
    drafts: 0,
    private: 0,
    unlisted: 0,
    public: 0,
  });
  const [packActionBusyByKey, setPackActionBusyByKey] = useState({});
  const [profileToasts, setProfileToasts] = useState([]);
  const [packActionsSheetPack, setPackActionsSheetPack] = useState(null);
  const [confirmDeletePack, setConfirmDeletePack] = useState(null);
  const [confirmDeleteBusy, setConfirmDeleteBusy] = useState(false);
  const [managePackOpen, setManagePackOpen] = useState(false);
  const [managePackData, setManagePackData] = useState(null);
  const [managePackLoading, setManagePackLoading] = useState(false);
  const [managePackError, setManagePackError] = useState('');
  const [managePackBusyAction, setManagePackBusyAction] = useState('');
  const [managePackTargetKey, setManagePackTargetKey] = useState('');
  const [analyticsModalOpen, setAnalyticsModalOpen] = useState(false);
  const [analyticsModalLoading, setAnalyticsModalLoading] = useState(false);
  const [analyticsModalError, setAnalyticsModalError] = useState('');
  const [analyticsModalData, setAnalyticsModalData] = useState(null);
  const [analyticsModalPack, setAnalyticsModalPack] = useState(null);
  const googleButtonRef = useRef(null);
  const googlePromptAttemptedRef = useRef(false);

  const dynamicCategoryOptions = useMemo(() => {
    const scoreByTag = new Map();
    const ensureTag = (rawTag, baseScore = 1) => {
      const tag = String(rawTag || '').trim();
      if (!tag) return;
      scoreByTag.set(tag, (scoreByTag.get(tag) || 0) + baseScore);
    };

    packs.forEach((pack) => {
      const engagement = getPackEngagement(pack);
      const scoreBoost = 1 + engagement.openCount * 0.02 + engagement.likeCount * 0.08;
      (Array.isArray(pack?.tags) ? pack.tags : []).forEach((tag) => ensureTag(tag, scoreBoost));
    });
    orphans.forEach((asset) => {
      (Array.isArray(asset?.tags) ? asset.tags : []).forEach((tag) => ensureTag(tag, 1));
    });

    const sortedTags = Array.from(scoreByTag.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([value]) => {
        const meta = CATEGORY_META.get(value) || null;
        if (meta) return { value, label: `${meta.icon} ${meta.label}`, icon: meta.icon };
        const label = value.replace(/-/g, ' ');
        return { value, label: `🏷️ ${label}`, icon: '🏷️' };
      });

    if (activeCategory && !sortedTags.some((entry) => entry.value === activeCategory)) {
      const meta = CATEGORY_META.get(activeCategory) || null;
      sortedTags.unshift(
        meta
          ? { value: activeCategory, label: `${meta.icon} ${meta.label}`, icon: meta.icon }
          : { value: activeCategory, label: `🏷️ ${activeCategory.replace(/-/g, ' ')}`, icon: '🏷️' },
      );
    }

    return [{ value: '', label: '🔥 Em alta', icon: '🔥' }, ...sortedTags];
  }, [packs, orphans, activeCategory]);

  const tagSuggestions = useMemo(() => {
    const options = new Map();

    dynamicCategoryOptions.forEach((entry) => {
      if (!entry?.value) return;
      options.set(entry.value, {
        value: entry.value,
        label: String(entry.label || entry.value).replace(/^.+?\s/, ''),
        icon: entry.icon || '🏷️',
      });
    });

    const addTag = (rawTag) => {
      const tag = String(rawTag || '').trim();
      if (!tag) return;
      if (!options.has(tag)) {
        options.set(tag, {
          value: tag,
          label: tag.replace(/-/g, ' '),
          icon: '🏷',
        });
      }
    };

    packs.forEach((pack) => {
      (Array.isArray(pack?.tags) ? pack.tags : []).forEach(addTag);
    });
    orphans.forEach((sticker) => {
      (Array.isArray(sticker?.tags) ? sticker.tags : []).forEach(addTag);
    });

    return Array.from(options.values());
  }, [dynamicCategoryOptions, packs, orphans]);

  const filteredSuggestions = useMemo(() => {
    const q = normalizeToken(query);
    if (!q) {
      return recentSearches.slice(0, 6).map((entry) => ({
        value: entry,
        label: entry,
        icon: '🕘',
      }));
    }
    return tagSuggestions
      .filter((item) => normalizeToken(item.value).includes(q) || normalizeToken(item.label).includes(q))
      .slice(0, 8);
  }, [query, tagSuggestions, recentSearches]);

  const sortedPacks = useMemo(() => {
    const list = [...packs];
    if (sortBy === 'new') {
      list.sort((a, b) => new Date(b?.created_at || b?.updated_at || 0).getTime() - new Date(a?.created_at || a?.updated_at || 0).getTime());
      return list;
    }
    if (sortBy === 'liked') {
      list.sort((a, b) => getPackEngagement(b).likeCount - getPackEngagement(a).likeCount);
      return list;
    }
    list.sort((a, b) => {
      const eb = getPackEngagement(b);
      const ea = getPackEngagement(a);
      const bScore = eb.openCount * 2 + eb.likeCount * 3 - eb.dislikeCount;
      const aScore = ea.openCount * 2 + ea.likeCount * 3 - ea.dislikeCount;
      return bScore - aScore;
    });
    return list;
  }, [packs, sortBy]);

  const categoryActiveLabel =
    dynamicCategoryOptions.find((entry) => entry.value === activeCategory)?.label?.replace(/^.+?\s/, '') || 'Todas';
  const growingNowPacks = useMemo(() => {
    return [...packs]
      .map((pack) => {
        const engagement = getPackEngagement(pack);
        const createdAt = new Date(pack?.created_at || pack?.updated_at || 0).getTime();
        const recentBonus = Date.now() - createdAt <= 1000 * 60 * 60 * 24 * 7 ? 18 : 0;
        const growth = engagement.openCount * 1.5 + engagement.likeCount * 3 - engagement.dislikeCount + recentBonus;
        return { pack, growth };
      })
      .sort((a, b) => b.growth - a.growth)
      .slice(0, 6)
      .map((entry) => entry.pack);
  }, [packs]);
  const topWeekPacks = useMemo(
    () =>
      [...packs]
        .sort((a, b) => {
          const ea = getPackEngagement(a);
          const eb = getPackEngagement(b);
          const sa = ea.openCount + ea.likeCount * 3 - ea.dislikeCount;
          const sb = eb.openCount + eb.likeCount * 3 - eb.dislikeCount;
          return sb - sa;
        })
        .slice(0, 10),
    [packs],
  );
  const featuredCreators = useMemo(() => {
    const byPublisher = new Map();
    packs.forEach((pack) => {
      const publisher = String(pack?.publisher || 'OmniZap Auto').trim();
      const current = byPublisher.get(publisher) || {
        publisher,
        packCount: 0,
        likes: 0,
        opens: 0,
        topPack: pack,
      };
      const engagement = getPackEngagement(pack);
      current.packCount += 1;
      current.likes += engagement.likeCount;
      current.opens += engagement.openCount;
      if (!current.topPack || engagement.likeCount > getPackEngagement(current.topPack).likeCount) {
        current.topPack = pack;
      }
      byPublisher.set(publisher, current);
    });
    return Array.from(byPublisher.values())
      .sort((a, b) => b.likes + b.opens - (a.likes + a.opens))
      .slice(0, 3);
  }, [packs]);
  const platformStats = useMemo(() => {
    const totals = packs.reduce(
      (acc, pack) => {
        const engagement = getPackEngagement(pack);
        acc.stickers += Number(pack?.sticker_count || 0);
        acc.opens += engagement.openCount;
        acc.likes += engagement.likeCount;
        return acc;
      },
      { stickers: 0, opens: 0, likes: 0 },
    );
    return {
      packs: packs.length,
      stickers: totals.stickers + orphans.length,
      opens: totals.opens,
      likes: totals.likes,
    };
  }, [packs, orphans.length]);
  const recentPublishedPacks = useMemo(
    () =>
      [...packs]
        .sort(
          (a, b) =>
            new Date(b?.created_at || b?.updated_at || 0).getTime() - new Date(a?.created_at || a?.updated_at || 0).getTime(),
        )
        .slice(0, 10),
    [packs],
  );
  const globalTrendBars = useMemo(() => {
    const sample = topWeekPacks.slice(0, 7).map((pack) => {
      const engagement = getPackEngagement(pack);
      return Number(engagement.openCount || 0) + Number(engagement.likeCount || 0) * 2 + 1;
    });
    const source = sample.length ? sample : [2, 4, 3, 5, 6, 4, 7];
    const max = Math.max(...source, 1);
    return source.map((value) => Math.round((value / max) * 14) + 2);
  }, [topWeekPacks]);
  const catalogMetricCards = useMemo(() => {
    const recentCount = recentPublishedPacks.slice(0, 7).length;
    return [
      {
        key: 'packs',
        label: 'Packs',
        value: shortNum(platformStats.packs),
        icon: '📦',
        tone: 'slate',
        hint: `+${recentCount} recentes`,
        bars: globalTrendBars,
      },
      {
        key: 'stickers',
        label: 'Stickers',
        value: shortNum(platformStats.stickers),
        icon: '🧩',
        tone: 'cyan',
        hint: `${shortNum(orphans.length)} sem pack`,
        bars: [...globalTrendBars].reverse(),
      },
      {
        key: 'opens',
        label: 'Cliques',
        value: shortNum(platformStats.opens),
        icon: '⬇',
        tone: 'emerald',
        hint: 'Engajamento do catálogo',
        bars: globalTrendBars.map((v, i) => Math.max(3, v - (i % 3))),
      },
      {
        key: 'likes',
        label: 'Likes',
        value: shortNum(platformStats.likes),
        icon: '❤️',
        tone: 'amber',
        hint: `+${shortNum(growingNowPacks.reduce((acc, pack) => acc + getPackEngagement(pack).likeCount, 0))} em tendência`,
        bars: globalTrendBars.map((v, i) => Math.max(3, Math.min(16, v - 2 + (i % 2)))),
      },
    ];
  }, [platformStats, recentPublishedPacks, globalTrendBars, orphans.length, growingNowPacks]);

  const hasAnyResult = packs.length > 0 || orphans.length > 0;
  const googleSessionApiPath = `${config.apiBasePath}/auth/google/session`;
  const myProfileApiPath = `${config.apiBasePath}/me`;
  const isProfileView = currentView === 'profile';
  const hasGoogleLogin = Boolean(googleAuth.user?.sub);
  const googleLoginEnabled = Boolean(googleAuthConfig.enabled && googleAuthConfig.clientId);
  const shouldRenderGoogleButton =
    isProfileView && googleLoginEnabled && !hasGoogleLogin && googleSessionChecked && !googleAuthBusy;

  const fetchJson = async (url, options = undefined) => {
    const response = await fetch(url, { credentials: 'same-origin', ...(options || {}) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || 'Falha ao carregar catálogo');
    return payload;
  };

  const applyGoogleSessionData = (sessionData) => {
    if (!sessionData?.authenticated || !sessionData?.user?.sub) {
      setGoogleAuth({ user: null, expiresAt: '' });
      return false;
    }
    setGoogleAuth({
      user: {
        sub: String(sessionData.user.sub || ''),
        email: String(sessionData.user.email || ''),
        name: String(sessionData.user.name || 'Conta Google'),
        picture: String(sessionData.user.picture || ''),
      },
      expiresAt: String(sessionData.expires_at || ''),
    });
    return true;
  };

  const applyMyProfileData = (payload) => {
    const data = payload?.data || {};
    const authGoogle = data?.auth?.google || {};
    setGoogleAuthConfig({
      enabled: Boolean(authGoogle?.enabled),
      required: Boolean(authGoogle?.required),
      clientId: String(authGoogle?.client_id || '').trim(),
    });
    const authenticated = applyGoogleSessionData(data?.session || null);
    const nextPacks = Array.isArray(data?.packs) ? data.packs : [];
    setMyPacks(authenticated ? nextPacks : []);
    const stats = data?.stats && typeof data.stats === 'object' ? data.stats : {};
    setMyProfileStats({
      total: Number(stats.total || 0),
      published: Number(stats.published || 0),
      drafts: Number(stats.drafts || 0),
      private: Number(stats.private || 0),
      unlisted: Number(stats.unlisted || 0),
      public: Number(stats.public || 0),
    });
    setGoogleSessionChecked(true);
    return { authenticated };
  };

  const refreshMyProfile = async ({ silent = false } = {}) => {
    if (!silent) setMyPacksLoading(true);
    setMyPacksError('');
    setGoogleAuthError('');
    setGoogleSessionChecked(false);
    try {
      const payload = await fetchJson(myProfileApiPath);
      applyMyProfileData(payload);
    } catch (err) {
      setMyPacks([]);
      setMyProfileStats({ total: 0, published: 0, drafts: 0, private: 0, unlisted: 0, public: 0 });
      setGoogleSessionChecked(true);
      setMyPacksError(err?.message || 'Falha ao carregar perfil e packs.');
    } finally {
      if (!silent) setMyPacksLoading(false);
    }
  };

  const pushProfileToast = (message, type = 'success') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setProfileToasts((prev) => [...prev, { id, message: String(message || ''), type }].slice(-5));
    window.setTimeout(() => {
      setProfileToasts((prev) => prev.filter((item) => item.id !== id));
    }, 4200);
  };

  const dismissProfileToast = (toastId) => {
    setProfileToasts((prev) => prev.filter((item) => item.id !== toastId));
  };

  const setPackActionBusy = (packKey, action = '') => {
    if (!packKey) return;
    setPackActionBusyByKey((prev) => {
      if (!action) {
        const next = { ...prev };
        delete next[packKey];
        return next;
      }
      return { ...prev, [packKey]: action };
    });
  };

  const buildManagePackApiPath = (packKey, suffix = '') =>
    `${config.apiBasePath}/${encodeURIComponent(String(packKey || ''))}/manage${suffix}`;

  const applyManagedPackToMyList = (managedData) => {
    const pack = managedData?.pack || null;
    if (!pack?.pack_key) return;
    setMyPacks((prev) => {
      const list = Array.isArray(prev) ? [...prev] : [];
      const index = list.findIndex((entry) => String(entry?.pack_key || '') === String(pack.pack_key || ''));
      if (index >= 0) {
        list[index] = { ...list[index], ...pack };
        return list;
      }
      return [pack, ...list];
    });
  };

  const removePackFromMyList = (packKey) => {
    if (!packKey) return;
    setMyPacks((prev) => (Array.isArray(prev) ? prev.filter((entry) => String(entry?.pack_key || '') !== String(packKey)) : []));
  };

  const loadManagePackData = async (packKey, { openModal = false, silent = false } = {}) => {
    if (!packKey) return null;
    if (!silent) setManagePackLoading(true);
    setManagePackError('');
    setManagePackTargetKey(String(packKey));
    if (openModal) setManagePackOpen(true);
    try {
      const payload = await fetchJson(buildManagePackApiPath(packKey));
      const managed = payload?.data || null;
      setManagePackData(managed);
      applyManagedPackToMyList(managed);
      return managed;
    } catch (err) {
      setManagePackError(err?.message || 'Falha ao carregar gerenciador do pack.');
      throw err;
    } finally {
      if (!silent) setManagePackLoading(false);
    }
  };

  const openManagePackByKey = async (packKey) => {
    if (!packKey) return;
    setPackActionBusy(packKey, 'manage');
    setPackActionsSheetPack(null);
    try {
      await loadManagePackData(packKey, { openModal: true });
    } catch (err) {
      pushProfileToast(err?.message || 'Falha ao abrir gerenciador do pack.', 'error');
      setManagePackOpen(false);
    } finally {
      setPackActionBusy(packKey, '');
    }
  };

  const closeManagePackModal = () => {
    setManagePackOpen(false);
    setManagePackBusyAction('');
    setManagePackError('');
  };

  const refreshManagePackData = async () => {
    if (!managePackTargetKey) return;
    try {
      await loadManagePackData(managePackTargetKey, { openModal: true });
    } catch {}
  };

  const applyManagedMutationResult = async (payloadData, { successMessage = '' } = {}) => {
    const managed = payloadData?.pack ? payloadData : payloadData?.data?.pack ? payloadData.data : payloadData;
    if (managed?.pack) {
      setManagePackData(managed);
      applyManagedPackToMyList(managed);
    }
    await refreshMyProfile({ silent: true }).catch(() => {});
    if (successMessage) pushProfileToast(successMessage, 'success');
    return managed;
  };

  const openAnalyticsModalForPack = async (pack) => {
    if (!pack?.pack_key) return;
    setAnalyticsModalPack(pack);
    setAnalyticsModalOpen(true);
    setAnalyticsModalError('');
    setAnalyticsModalLoading(true);
    try {
      const payload = await fetchJson(buildManagePackApiPath(pack.pack_key, '/analytics'));
      setAnalyticsModalData(payload?.data || null);
    } catch (err) {
      setAnalyticsModalError(err?.message || 'Falha ao carregar analytics do pack.');
    } finally {
      setAnalyticsModalLoading(false);
    }
  };

  const closeAnalyticsModal = () => {
    setAnalyticsModalOpen(false);
    setAnalyticsModalError('');
    setAnalyticsModalLoading(false);
  };

  const mergeEngagementInPack = (pack, engagement) => {
    if (!pack || !engagement) return pack;
    return {
      ...pack,
      engagement: {
        ...(pack.engagement || {}),
        ...engagement,
      },
    };
  };

  const applyPackEngagement = (packKey, engagement) => {
    if (!packKey || !engagement) return;
    setPacks((prev) => prev.map((entry) => (entry?.pack_key === packKey ? mergeEngagementInPack(entry, engagement) : entry)));
    setRelatedPacks((prev) =>
      prev.map((entry) => (entry?.pack_key === packKey ? mergeEngagementInPack(entry, engagement) : entry)),
    );
    setCurrentPack((prev) => (prev?.pack_key === packKey ? mergeEngagementInPack(prev, engagement) : prev));
  };

  const registerPackInteraction = async (packKey, action, { silent = false } = {}) => {
    if (!packKey || !['open', 'like', 'dislike'].includes(action)) return null;
    try {
      const payload = await fetchJson(`${config.apiBasePath}/${encodeURIComponent(packKey)}/${action}`, { method: 'POST' });
      const engagement = payload?.data?.engagement || null;
      if (engagement) applyPackEngagement(packKey, engagement);
      return engagement;
    } catch (err) {
      if (!silent) setError(err?.message || 'Falha ao registrar interação');
      return null;
    }
  };

  const buildParams = ({ q, category, limit, offset, includeVisibility = false }) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (category) params.set('categories', category);
    params.set('limit', String(limit));
    if (Number.isFinite(offset)) params.set('offset', String(offset));
    if (includeVisibility) params.set('visibility', 'public');
    return params;
  };

  const loadPacks = async ({ reset = false } = {}) => {
    if (reset) {
      setPacksLoading(true);
      setPackOffset(0);
      setPackHasMore(true);
    } else {
      if (packsLoadingMore || !packHasMore) return;
      setPacksLoadingMore(true);
    }

    setError('');
    try {
      const nextOffset = reset ? 0 : packOffset;
      const params = buildParams({
        q: appliedQuery,
        category: activeCategory,
        limit: config.limit,
        offset: nextOffset,
        includeVisibility: true,
      });

      const payload = await fetchJson(`${config.apiBasePath}?${params.toString()}`);
      const data = Array.isArray(payload?.data) ? payload.data : [];
      const hasMore = Boolean(payload?.pagination?.has_more);
      const next = Number(payload?.pagination?.next_offset);

      setPacks((prev) => (reset ? data : prev.concat(data)));
      setPackHasMore(hasMore);
      setPackOffset(Number.isFinite(next) ? next : (reset ? data.length : nextOffset + data.length));
    } catch (err) {
      setError(err?.message || 'Falha ao carregar packs');
      if (reset) setPacks([]);
    } finally {
      if (reset) setPacksLoading(false);
      else setPacksLoadingMore(false);
    }
  };

  const loadOrphans = async () => {
    setOrphansLoading(true);
    try {
      const params = buildParams({
        q: appliedQuery,
        category: activeCategory,
        limit: config.orphanLimit,
      });
      const payload = await fetchJson(`${config.orphanApiPath}?${params.toString()}`);
      setOrphans(Array.isArray(payload?.data) ? payload.data : []);
    } catch {
      setOrphans([]);
    } finally {
      setOrphansLoading(false);
    }
  };

  const loadPackDetail = async (packKey) => {
    if (!packKey) return;
    setPackLoading(true);
    setCurrentPack(null);
    setRelatedPacks([]);
    setError('');

    try {
      const payload = await fetchJson(`${config.apiBasePath}/${encodeURIComponent(packKey)}`);
      const pack = payload?.data || null;
      setCurrentPack(pack);
      void registerPackInteraction(packKey, 'open', { silent: true });

      const q = String(pack?.publisher || '').trim();
      const relatedParams = new URLSearchParams();
      relatedParams.set('visibility', 'public');
      relatedParams.set('limit', '12');
      if (q) relatedParams.set('q', q);
      else if (Array.isArray(pack?.tags) && pack.tags[0]) relatedParams.set('categories', pack.tags[0]);

      const relatedPayload = await fetchJson(`${config.apiBasePath}?${relatedParams.toString()}`);
      const relatedList = (Array.isArray(relatedPayload?.data) ? relatedPayload.data : [])
        .filter((entry) => entry.pack_key && entry.pack_key !== pack?.pack_key)
        .slice(0, 8);
      setRelatedPacks(relatedList);
    } catch (err) {
      setError(err?.message || 'Não foi possível abrir o pack');
    } finally {
      setPackLoading(false);
    }
  };

  const openPack = (packKey, push = true) => {
    if (!packKey) return;
    if (push) window.history.pushState({}, '', `${config.webPath}/${encodeURIComponent(packKey)}`);
    setCurrentView('pack');
    setCurrentPackKey(packKey);
  };

  const goCatalog = (push = true) => {
    if (push) window.history.pushState({}, '', `${config.webPath}/`);
    setCurrentView('catalog');
    setCurrentPackKey('');
    setCurrentPack(null);
    setRelatedPacks([]);
  };

  const openProfile = (push = true) => {
    googlePromptAttemptedRef.current = false;
    if (push) window.history.pushState({}, '', `${config.webPath}/perfil`);
    setCurrentView('profile');
    setCurrentPackKey('');
    setCurrentPack(null);
    setRelatedPacks([]);
    setError('');
  };

  const cycleVisibilityValue = (currentVisibility) => {
    const normalized = String(currentVisibility || '').toLowerCase();
    if (normalized === 'public') return 'unlisted';
    if (normalized === 'unlisted') return 'private';
    return 'public';
  };

  const openPackActionsSheet = (pack) => {
    if (!pack?.pack_key) return;
    setPackActionsSheetPack(pack);
  };

  const closePackActionsSheet = () => {
    setPackActionsSheetPack(null);
  };

  const runPackQuickMutation = async (packKey, actionName, task) => {
    if (!packKey || typeof task !== 'function') return null;
    setPackActionBusy(packKey, actionName);
    try {
      return await task();
    } finally {
      setPackActionBusy(packKey, '');
    }
  };

  const handlePackVisibilityQuickToggle = async (pack) => {
    if (!pack?.pack_key) return;
    const nextVisibility = cycleVisibilityValue(pack.visibility);
    await runPackQuickMutation(pack.pack_key, 'visibility', async () => {
      const payload = await fetchJson(buildManagePackApiPath(pack.pack_key), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ visibility: nextVisibility }),
      });
      await applyManagedMutationResult(payload?.data ? payload : { data: payload }, {
        successMessage: `Visibilidade alterada para ${nextVisibility}.`,
      });
      if (managePackOpen && String(managePackTargetKey || '') === String(pack.pack_key)) {
        setManagePackData(payload?.data || null);
      }
    }).catch((err) => {
      pushProfileToast(err?.message || 'Falha ao alterar visibilidade.', 'error');
    });
  };

  const handlePackDuplicate = async (pack) => {
    if (!pack?.pack_key) return;
    await runPackQuickMutation(pack.pack_key, 'duplicate', async () => {
      await fetchJson(buildManagePackApiPath(pack.pack_key, '/clone'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({}),
      });
      await refreshMyProfile({ silent: true });
      pushProfileToast('Pack duplicado com sucesso.', 'success');
    }).catch((err) => {
      pushProfileToast(err?.message || 'Falha ao duplicar pack.', 'error');
    });
  };

  const requestDeletePack = (pack) => {
    if (!pack?.pack_key) return;
    setConfirmDeletePack(pack);
    setConfirmDeleteBusy(false);
    closePackActionsSheet();
  };

  const handleDeletePackConfirmed = async () => {
    const pack = confirmDeletePack;
    if (!pack?.pack_key) return;
    setConfirmDeleteBusy(true);
    try {
      await fetchJson(buildManagePackApiPath(pack.pack_key), { method: 'DELETE' });
      removePackFromMyList(pack.pack_key);
      await refreshMyProfile({ silent: true });
      if (managePackOpen && String(managePackTargetKey || '') === String(pack.pack_key)) {
        closeManagePackModal();
      }
      pushProfileToast('Pack apagado com sucesso.', 'success');
      setConfirmDeletePack(null);
    } catch (err) {
      pushProfileToast(err?.message || 'Falha ao apagar pack.', 'error');
    } finally {
      setConfirmDeleteBusy(false);
    }
  };

  const handleProfileAction = (actionKey) => {
    if (actionKey === 'edit-profile') {
      pushProfileToast('Edição de perfil do criador será adicionada na próxima etapa.', 'warning');
      return;
    }
    if (actionKey === 'settings') {
      pushProfileToast('Configurações do criador ainda não têm tela dedicada.', 'warning');
      return;
    }
  };

  const handlePackActionsSheetAction = async (actionKey, pack) => {
    if (!pack?.pack_key) return;
    if (actionKey === 'manage' || actionKey === 'edit') {
      await openManagePackByKey(pack.pack_key);
      return;
    }
    if (actionKey === 'visibility') {
      closePackActionsSheet();
      await handlePackVisibilityQuickToggle(pack);
      return;
    }
    if (actionKey === 'duplicate') {
      closePackActionsSheet();
      await handlePackDuplicate(pack);
      return;
    }
    if (actionKey === 'analytics') {
      closePackActionsSheet();
      await openAnalyticsModalForPack(pack);
      return;
    }
    if (actionKey === 'delete') {
      requestDeletePack(pack);
    }
  };

  const runManagePackMutation = async (actionName, task, successMessage = '') => {
    if (!managePackTargetKey) return null;
    setManagePackBusyAction(actionName);
    setManagePackError('');
    try {
      const result = await task();
      if (result?.data?.pack || result?.pack) {
        const managed = result?.data?.pack ? result.data : result;
        setManagePackData(managed);
        applyManagedPackToMyList(managed);
      }
      await refreshMyProfile({ silent: true });
      if (successMessage) pushProfileToast(successMessage, 'success');
      return result;
    } catch (err) {
      setManagePackError(err?.message || 'Falha ao atualizar pack.');
      pushProfileToast(err?.message || 'Falha ao atualizar pack.', 'error');
      throw err;
    } finally {
      setManagePackBusyAction('');
    }
  };

  const handleManageSaveMetadata = async (values) => {
    if (!managePackTargetKey) return;
    await runManagePackMutation(
      'saveMetadata',
      async () =>
        fetchJson(buildManagePackApiPath(managePackTargetKey), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({
            name: values?.name,
            publisher: values?.publisher,
            description: values?.description,
            tags: Array.isArray(values?.tags) ? values.tags : [],
            visibility: values?.visibility,
          }),
        }),
      'Pack atualizado.',
    ).catch(() => {});
  };

  const handleManageAddSticker = async (file) => {
    if (!managePackTargetKey || !file) return;
    try {
      const stickerDataUrl = await readFileAsDataUrl(file);
      await runManagePackMutation(
        'addSticker',
        async () =>
          fetchJson(buildManagePackApiPath(managePackTargetKey, '/stickers'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ sticker_data_url: stickerDataUrl }),
          }),
        'Sticker adicionado ao pack.',
      );
    } catch (err) {
      pushProfileToast(err?.message || 'Falha ao adicionar sticker.', 'error');
    }
  };

  const handleManageSetCover = async (stickerId) => {
    if (!managePackTargetKey || !stickerId) return;
    await runManagePackMutation(
      'setCover',
      async () =>
        fetchJson(buildManagePackApiPath(managePackTargetKey, '/cover'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ sticker_id: stickerId }),
        }),
      'Capa atualizada.',
    ).catch(() => {});
  };

  const handleManageRemoveSticker = async (stickerId) => {
    if (!managePackTargetKey || !stickerId) return;
    await runManagePackMutation(
      'removeSticker',
      async () => fetchJson(`${buildManagePackApiPath(managePackTargetKey, '/stickers')}/${encodeURIComponent(stickerId)}`, { method: 'DELETE' }),
      'Sticker removido do pack.',
    ).catch(() => {});
  };

  const handleManageReplaceSticker = async (stickerId, file) => {
    if (!managePackTargetKey || !stickerId || !file) return;
    try {
      const stickerDataUrl = await readFileAsDataUrl(file);
      await runManagePackMutation(
        'replaceSticker',
        async () =>
          fetchJson(`${buildManagePackApiPath(managePackTargetKey, '/stickers')}/${encodeURIComponent(stickerId)}/replace`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ sticker_data_url: stickerDataUrl }),
          }),
        'Sticker substituído com sucesso.',
      );
    } catch (err) {
      pushProfileToast(err?.message || 'Falha ao substituir sticker.', 'error');
    }
  };

  const handleManageReorder = async (orderStickerIds) => {
    if (!managePackTargetKey || !Array.isArray(orderStickerIds) || !orderStickerIds.length) return;
    await runManagePackMutation(
      'reorder',
      async () =>
        fetchJson(buildManagePackApiPath(managePackTargetKey, '/reorder'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ order_sticker_ids: orderStickerIds }),
        }),
      'Ordem dos stickers salva.',
    ).catch(() => {});
  };

  const handleLike = async (packKey) => {
    if (!packKey) return;
    setReactionLoading('like');
    await registerPackInteraction(packKey, 'like');
    setReactionLoading('');
  };

  const handleDislike = async (packKey) => {
    if (!packKey) return;
    setReactionLoading('dislike');
    await registerPackInteraction(packKey, 'dislike');
    setReactionLoading('');
  };

  useEffect(() => {
    const applyRoute = () => {
      const route = parseStickersLocation(config.webPath);
      if (route.view === 'profile') {
        openProfile(false);
        return;
      }
      if (route.view === 'pack' && route.packKey) {
        setCurrentView('pack');
        setCurrentPackKey(route.packKey);
        return;
      }
      goCatalog(false);
    };

    applyRoute();

    const onPopState = () => {
      applyRoute();
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [config.webPath]);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
      const parsed = JSON.parse(raw || '[]');
      if (Array.isArray(parsed)) {
        setRecentSearches(parsed.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, 8));
      }
    } catch {}
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && String(event.key || '').toLowerCase() === 'k') {
        event.preventDefault();
        const input = document.querySelector('input[type="search"]');
        if (input && typeof input.focus === 'function') input.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    let mounted = true;
    fetchJson(`${config.apiBasePath}/support`)
      .then((payload) => {
        if (!mounted) return;
        setSupportInfo(payload?.data || null);
      })
      .catch(() => {
        if (!mounted) return;
        setSupportInfo(null);
      });
    return () => {
      mounted = false;
    };
  }, [config.apiBasePath]);

  useEffect(() => {
    if (currentView === 'pack' && currentPackKey) {
      void loadPackDetail(currentPackKey);
      return;
    }
    if (currentView !== 'catalog') return;
    void loadPacks({ reset: true });
    void loadOrphans();
  }, [appliedQuery, activeCategory, currentView, currentPackKey]);

  useEffect(() => {
    if (currentView !== 'catalog' || currentPackKey) return undefined;
    const timer = setInterval(() => {
      void loadPacks({ reset: true });
      void loadOrphans();
    }, 60 * 1000);
    return () => clearInterval(timer);
  }, [currentView, currentPackKey, appliedQuery, activeCategory]);

  useEffect(() => {
    if (currentView !== 'catalog' || !sentinel || !packHasMore || packsLoading || packsLoadingMore || currentPackKey) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadPacks({ reset: false });
        }
      },
      { rootMargin: '220px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, packHasMore, packsLoading, packsLoadingMore, packOffset, appliedQuery, activeCategory, currentView, currentPackKey]);

  useEffect(() => {
    const sync = () => setUploadTask(readUploadTask());
    sync();

    const interval = setInterval(sync, 1000);
    const onStorage = (event) => {
      if (event?.key === PACK_UPLOAD_TASK_KEY) {
        sync();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      clearInterval(interval);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    if (!isProfileView) {
      googlePromptAttemptedRef.current = false;
      return;
    }
    void refreshMyProfile();
  }, [isProfileView, myProfileApiPath]);

  useEffect(() => {
    const clearGoogleButton = () => {
      if (googleButtonRef.current) googleButtonRef.current.innerHTML = '';
      try {
        window.google?.accounts?.id?.cancel?.();
      } catch {
        // ignore sdk cleanup errors
      }
    };

    if (!shouldRenderGoogleButton) {
      clearGoogleButton();
      return;
    }
    if (!googleButtonRef.current) return;

    let cancelled = false;
    setGoogleAuthUiReady(false);
    setGoogleAuthError('');

    loadScript(GOOGLE_GSI_SCRIPT_SRC)
      .then(() => {
        if (cancelled) return;
        const accounts = window.google?.accounts?.id;
        if (!accounts) throw new Error('SDK do Google não disponível.');

        accounts.initialize({
          client_id: googleAuthConfig.clientId,
          callback: (response) => {
            const credential = String(response?.credential || '').trim();
            const claims = decodeJwtPayload(credential);
            if (!credential || !claims?.sub) {
              setGoogleAuthError('Falha ao concluir login Google.');
              return;
            }
            setGoogleAuthBusy(true);
            fetchJson(googleSessionApiPath, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json; charset=utf-8' },
              body: JSON.stringify({ google_id_token: credential }),
            })
              .then(async () => {
                googlePromptAttemptedRef.current = true;
                const profilePayload = await fetchJson(myProfileApiPath);
                applyMyProfileData(profilePayload);
                setMyPacksError('');
              })
              .catch((sessionError) => {
                setGoogleAuthError(sessionError?.message || 'Falha ao salvar sessão Google.');
              })
              .finally(() => setGoogleAuthBusy(false));
          },
          auto_select: false,
          cancel_on_tap_outside: true,
        });

        if (googleButtonRef.current) {
          googleButtonRef.current.innerHTML = '';
          const measuredWidth = Math.floor(Number(googleButtonRef.current.clientWidth || 0));
          const buttonWidth = Math.max(180, Math.min(320, measuredWidth || 320));
          accounts.renderButton(googleButtonRef.current, {
            type: 'standard',
            theme: 'filled_black',
            size: 'large',
            text: 'signin_with',
            shape: 'pill',
            logo_alignment: 'left',
            width: buttonWidth,
          });
        }

        if (!googlePromptAttemptedRef.current) {
          googlePromptAttemptedRef.current = true;
          try {
            accounts.prompt(() => {});
          } catch {
            // prompt may be blocked by browser/privacy settings
          }
        }

        setGoogleAuthUiReady(true);
      })
      .catch((sdkError) => {
        if (cancelled) return;
        setGoogleAuthError(sdkError?.message || 'Falha ao carregar login Google.');
      });

    return () => {
      cancelled = true;
      clearGoogleButton();
    };
  }, [shouldRenderGoogleButton, googleAuthConfig.clientId, googleSessionApiPath, myProfileApiPath]);

  const handleGoogleLogout = async () => {
    setGoogleAuthBusy(true);
    setGoogleAuthError('');
    try {
      await fetchJson(googleSessionApiPath, { method: 'DELETE' });
    } catch {
      // still refresh local state after logout attempts
    } finally {
      setGoogleAuthBusy(false);
    }
    googlePromptAttemptedRef.current = false;
    await refreshMyProfile({ silent: false });
  };

  const onSubmit = (event) => {
    event.preventDefault();
    setShowAutocomplete(false);
    const next = query.trim();
    setAppliedQuery(next);
    if (next) {
      const nextHistory = [next, ...recentSearches.filter((entry) => entry !== next)].slice(0, 8);
      setRecentSearches(nextHistory);
      try {
        localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(nextHistory));
      } catch {}
    }
  };

  const applySuggestion = (item) => {
    const value = String(item?.value || '').trim();
    if (!value) return;
    setQuery(value);
    setAppliedQuery(value);
    if (dynamicCategoryOptions.some((entry) => entry.value === value)) {
      setActiveCategory(value);
    }
    setShowAutocomplete(false);
  };

  const clearFilters = () => {
    setQuery('');
    setAppliedQuery('');
    setActiveCategory('');
  };

  return html`
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <style>
        ${`@keyframes fadeInCard { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .fade-card { animation: fadeInCard 260ms ease both; }
        .line-clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .chips-scroll { scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; scroll-behavior: smooth; scrollbar-width: none; }
        .chips-scroll::-webkit-scrollbar { display: none; }
        .chip-item { scroll-snap-align: start; }`}
      </style>

      <header className=${`sticky top-0 z-30 border-b border-slate-800 bg-slate-950/95 backdrop-blur transition-shadow ${
        isScrolled ? 'shadow-[0_8px_24px_rgba(2,6,23,0.45)]' : ''
      }`}>
        <div className="max-w-7xl mx-auto h-14 px-3 flex items-center gap-2.5">
          <a href="/" className="shrink-0 flex items-center gap-2">
            <img src="https://iili.io/FC3FABe.jpg" alt="OmniZap" className="w-7 h-7 rounded-full border border-slate-700" />
            <span className="hidden sm:inline text-sm font-semibold">OmniZap</span>
          </a>

          ${currentView === 'catalog'
            ? html`
                <form onSubmit=${onSubmit} className="flex-1 relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">🔎</span>
                    <input
                      type="search"
                      value=${query}
                    onChange=${(e) => setQuery(e.target.value)}
                    onFocus=${() => setShowAutocomplete(true)}
                    onBlur=${() => setTimeout(() => setShowAutocomplete(false), 120)}
                    onKeyDown=${(event) => {
                      if (event.key === 'Escape') {
                        setShowAutocomplete(false);
                      }
                    }}
                      placeholder="Buscar packs..."
                      className="w-full h-9 sm:h-10 rounded-2xl border border-slate-800 bg-slate-900 pl-[34px] sm:pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/15"
                    />
                  ${showAutocomplete && filteredSuggestions.length
                    ? html`
                        <div className="absolute z-40 mt-2 w-full rounded-2xl border border-slate-800 bg-slate-900 shadow-xl overflow-hidden">
                          ${filteredSuggestions.map(
                            (item) => html`
                              <button
                                key=${item.value}
                                type="button"
                                onClick=${() => applySuggestion(item)}
                                className="w-full px-3 py-2.5 text-left text-sm text-slate-200 hover:bg-slate-800 flex items-center justify-between gap-2 border-b border-slate-800 last:border-b-0"
                              >
                                <span className="inline-flex items-center gap-2">
                                  <span>${item.icon || '🏷'}</span>
                                  <span className="truncate">${item.label}</span>
                                </span>
                                <span className="text-xs text-slate-400 truncate">${item.value}</span>
                              </button>
                            `,
                          )}
                        </div>
                      `
                    : null}
                </form>
              `
            : html`<div className="flex-1"></div>`}

          <div className="flex items-center gap-2">
            <button
              type="button"
              className=${`text-xs rounded-lg border px-3 py-2 ${
                isProfileView
                  ? 'border-amber-400/40 bg-amber-400/10 text-amber-200'
                  : 'border-amber-500/30 bg-amber-500/5 text-amber-200 hover:bg-amber-500/10'
              }`}
              onClick=${() => openProfile(true)}
              title="Meu perfil e packs"
            >
              <span className="sm:hidden">👤</span>
              <span className="hidden sm:inline">Meus Packs</span>
            </button>
            <a
              className="text-xs rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-cyan-200 hover:bg-cyan-500/20"
              href="/stickers/create/"
              title="Criar pack"
            >
              <span className="sm:hidden">➕</span>
              <span className="hidden sm:inline">✨ Criar pack agora</span>
            </a>
            ${supportInfo?.url
              ? html`
                  <a
                    className="text-xs rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-emerald-200 hover:bg-emerald-500/20"
                    href=${supportInfo.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    title="Suporte no WhatsApp"
                  >
                    <span className="sm:hidden">💬</span>
                    <span className="hidden sm:inline">Suporte</span>
                  </a>
                `
              : null}
            <div className="hidden sm:flex items-center gap-2">
            <a className="text-xs rounded-lg border border-slate-700 px-3 py-2 text-slate-300 hover:bg-slate-800" href="/api-docs/">API</a>
            <a className="text-xs rounded-lg border border-slate-700 px-3 py-2 text-slate-300 hover:bg-slate-800" href="https://github.com/Kaikygr/omnizap-system" target="_blank" rel="noreferrer noopener">GitHub</a>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 py-2.5 sm:py-3 space-y-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        ${error
          ? html`<div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">${error}</div>`
          : null}

        ${isProfileView
          ? html`
              <${CreatorProfileDashboard}
                googleAuthConfig=${googleAuthConfig}
                googleAuth=${googleAuth}
                googleAuthBusy=${googleAuthBusy}
                googleAuthError=${googleAuthError}
                googleSessionChecked=${googleSessionChecked}
                googleAuthUiReady=${googleAuthUiReady}
                googleButtonRef=${googleButtonRef}
                myPacks=${myPacks}
                myPacksLoading=${myPacksLoading}
                myPacksError=${myPacksError}
                myProfileStats=${myProfileStats}
                onBack=${goCatalog}
                onRefresh=${() => refreshMyProfile()}
                onLogout=${handleGoogleLogout}
                onOpenPublicPack=${openPack}
                onOpenPackActions=${openPackActionsSheet}
                onOpenManagePack=${(pack) => openManagePackByKey(pack?.pack_key || '')}
                onProfileAction=${handleProfileAction}
                onRequestDeletePack=${requestDeletePack}
                packActionBusyByKey=${packActionBusyByKey}
              />
            `
          : currentPackKey
            ? html`
              ${packLoading
                ? html`<div className="rounded-2xl border border-slate-700 bg-slate-800/70 p-4 text-sm text-slate-300">Carregando pack...</div>`
                : html`<${PackPage}
                    pack=${currentPack}
                    relatedPacks=${relatedPacks}
                    onBack=${goCatalog}
                    onOpenRelated=${openPack}
                    onLike=${handleLike}
                    onDislike=${handleDislike}
                    reactionLoading=${reactionLoading}
                  />`}
            `
            : html`
              <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-4">
                <aside className="hidden lg:block">
                  <div className="sticky top-[72px] space-y-2.5 rounded-2xl border border-slate-800 bg-slate-900/80 p-2.5">
                    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-300">Filtros</h3>
                        <button
                          type="button"
                          onClick=${clearFilters}
                          className="h-8 rounded-lg border border-slate-700 px-2 text-[11px] text-slate-200 hover:bg-slate-800"
                        >
                          Limpar
                        </button>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">${packs.length}${packHasMore ? '+' : ''} packs · ${orphans.length} sem pack</p>
                    </div>

                    <details open className="rounded-xl border border-slate-800 bg-slate-950/40 p-2">
                      <summary className="cursor-pointer list-none text-xs font-semibold text-slate-200">
                        Ordenar catálogo
                      </summary>
                      <div className="mt-2 space-y-1.5">
                        <button onClick=${() => setSortBy('popular')} className=${`w-full h-9 rounded-xl border text-xs ${sortBy === 'popular' ? 'border-emerald-400 bg-emerald-400/10 text-emerald-200' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}>🔥 Mais populares</button>
                        <button onClick=${() => setSortBy('new')} className=${`w-full h-9 rounded-xl border text-xs ${sortBy === 'new' ? 'border-emerald-400 bg-emerald-400/10 text-emerald-200' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}>🆕 Mais recentes</button>
                        <button onClick=${() => setSortBy('liked')} className=${`w-full h-9 rounded-xl border text-xs ${sortBy === 'liked' ? 'border-emerald-400 bg-emerald-400/10 text-emerald-200' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}>👍 Mais curtidos</button>
                      </div>
                    </details>

                    ${supportInfo?.url
                      ? html`
                          <a
                            href=${supportInfo.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="w-full h-9 inline-flex items-center justify-center rounded-xl border border-emerald-500/35 bg-emerald-500/10 text-xs text-emerald-200 hover:bg-emerald-500/20"
                          >
                            💬 Suporte no WhatsApp
                          </a>
                        `
                      : null}
                  </div>
                </aside>

                <div className="space-y-3 min-w-0">
                  <section className="space-y-2 min-w-0">
                    <div className="relative min-w-0">
                      <div className="absolute left-0 top-0 bottom-0 w-5 bg-gradient-to-r from-slate-950 to-transparent pointer-events-none z-10"></div>
                      <div className="absolute right-0 top-0 bottom-0 w-5 bg-gradient-to-l from-slate-950 to-transparent pointer-events-none z-10"></div>
                      <div className="chips-scroll flex max-w-full gap-1.5 overflow-x-auto pb-1 pr-1">
                        ${dynamicCategoryOptions.map(
                          (item) => html`
                            <button
                              key=${item.value || 'all'}
                              type="button"
                              onClick=${() => setActiveCategory(item.value)}
                              className=${`chip-item h-8 whitespace-nowrap rounded-full px-3 text-[11px] border transition ${
                                activeCategory === item.value
                                  ? 'bg-emerald-400 text-slate-900 border-emerald-300 font-semibold shadow-[0_0_0_2px_rgba(16,185,129,0.18)]'
                                  : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
                              }`}
                            >
                              ${item.label}
                            </button>
                          `,
                        )}
                      </div>
                    </div>
                  </section>

                  ${packs.length
                    ? html`
                        <section className="space-y-2">
                          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="text-[11px] uppercase tracking-wide text-slate-400">Descobrir</p>
                                <h3 className="text-sm font-semibold text-slate-100">Curadoria do marketplace</h3>
                                <p className="text-[11px] text-slate-500">Mais packs visíveis acima da dobra, com descoberta compacta.</p>
                              </div>
                              <a href="/stickers/create/" className="inline-flex h-8 items-center rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/20">
                                ✨ Criar pack agora
                              </a>
                            </div>

                            <div className="mt-2 flex flex-wrap gap-1.5">
                              ${[
                                { key: 'growing', label: '🔥 Crescendo' },
                                { key: 'top', label: '🏆 Top 10' },
                                { key: 'creators', label: '⭐ Criadores' },
                              ].map((tab) => html`
                                <button
                                  key=${tab.key}
                                  type="button"
                                  onClick=${() => setDiscoverTab(tab.key)}
                                  className=${`h-8 rounded-full border px-2.5 text-[11px] ${
                                    discoverTab === tab.key
                                      ? 'border-cyan-400/35 bg-cyan-500/10 text-cyan-100'
                                      : 'border-slate-700 bg-slate-950/40 text-slate-300 hover:bg-slate-800'
                                  }`}
                                >
                                  ${tab.label}
                                </button>
                              `)}
                            </div>

                            <div className="mt-2 hidden lg:block">
                              ${discoverTab === 'growing'
                                ? html`
                                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
                                      ${growingNowPacks.slice(0, 6).map((entry) => html`<${DiscoverPackRowItem} key=${`grow-${entry.pack_key}`} pack=${entry} onOpen=${openPack} />`)}
                                    </div>
                                  `
                                : discoverTab === 'top'
                                  ? html`
                                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
                                        ${topWeekPacks.slice(0, 8).map((entry, idx) => html`<${DiscoverPackRowItem} key=${`top-${entry.pack_key}`} pack=${entry} onOpen=${openPack} rank=${idx + 1} />`)}
                                      </div>
                                    `
                                  : html`
                                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
                                        ${featuredCreators.map((creator) => html`
                                          <button
                                            key=${creator.publisher}
                                            onClick=${() => {
                                              setQuery(creator.publisher);
                                              setAppliedQuery(creator.publisher);
                                            }}
                                            className="w-full flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 px-2 py-1.5 text-left hover:bg-slate-800/90"
                                          >
                                            <img src=${getAvatarUrl(creator.publisher)} alt="" className="w-9 h-9 rounded-full bg-slate-800" />
                                            <span className="min-w-0 flex-1">
                                              <span className="block truncate text-xs font-medium text-slate-100">${creator.publisher}</span>
                                              <span className="block truncate text-[10px] text-slate-400">${creator.packCount} packs · ❤️ ${shortNum(creator.likes)} · ⬇ ${shortNum(creator.opens)}</span>
                                            </span>
                                            <span className="text-[10px] text-slate-500">filtrar</span>
                                          </button>
                                        `)}
                                      </div>
                                    `}
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            ${catalogMetricCards.map((card) => html`<${CatalogMetricCard} key=${card.key} label=${card.label} value=${card.value} icon=${card.icon} hint=${card.hint} bars=${card.bars} tone=${card.tone} />`)}
                          </div>

                          <div className="lg:hidden space-y-2">
                            <section className="space-y-1.5">
                              <div className="flex items-center justify-between">
                                <h4 className="text-xs font-semibold text-slate-200">🔥 Em alta agora</h4>
                                <button type="button" onClick=${() => setDiscoverTab('growing')} className="text-[10px] text-cyan-300">ver lista</button>
                              </div>
                              <div className="flex gap-2 overflow-x-auto pb-1">
                                ${growingNowPacks.slice(0, 8).map((entry) => html`<${DiscoverPackMiniCard} key=${`mobile-grow-${entry.pack_key}`} pack=${entry} onOpen=${openPack} />`)}
                              </div>
                            </section>
                            <section className="space-y-1.5">
                              <div className="flex items-center justify-between">
                                <h4 className="text-xs font-semibold text-slate-200">🆕 Recém publicados</h4>
                                <button type="button" onClick=${() => setSortBy('new')} className="text-[10px] text-cyan-300">ordenar</button>
                              </div>
                              <div className="flex gap-2 overflow-x-auto pb-1">
                                ${recentPublishedPacks.slice(0, 8).map((entry) => html`<${DiscoverPackMiniCard} key=${`mobile-new-${entry.pack_key}`} pack=${entry} onOpen=${openPack} />`)}
                              </div>
                            </section>
                            <section className="space-y-1.5">
                              <div className="flex items-center justify-between">
                                <h4 className="text-xs font-semibold text-slate-200">👑 Criadores populares</h4>
                                <button type="button" onClick=${() => setDiscoverTab('creators')} className="text-[10px] text-cyan-300">ver lista</button>
                              </div>
                              <div className="flex gap-2 overflow-x-auto pb-1">
                                ${featuredCreators.map((creator) => html`
                                  <${DiscoverCreatorMiniCard}
                                    key=${`mobile-creator-${creator.publisher}`}
                                    creator=${creator}
                                    onPick=${(publisher) => {
                                      setQuery(publisher);
                                      setAppliedQuery(publisher);
                                    }}
                                  />
                                `)}
                              </div>
                            </section>
                          </div>

                          <div className="hidden lg:block rounded-2xl border border-emerald-500/20 bg-gradient-to-r from-emerald-500/10 to-cyan-500/5 p-2.5">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-xs font-semibold text-emerald-100">Quer aparecer em destaque?</p>
                                <p className="text-[11px] text-slate-300">Publique seu pack e melhore capa/tags para ganhar mais cliques.</p>
                              </div>
                              <a href="/stickers/create/" className="inline-flex h-8 items-center rounded-lg border border-emerald-400/35 bg-emerald-500/10 px-3 text-[11px] font-semibold text-emerald-100 hover:bg-emerald-500/20">
                                Publicar pack
                              </a>
                            </div>
                          </div>
                        </section>
                      `
                    : null}

                  ${packs.length
                    ? html`
                        <section className="space-y-3 min-w-0">
                          <div className="flex items-end justify-between gap-3">
                            <div>
                              <h2 className="text-lg sm:text-xl font-bold">Packs</h2>
                              <p className="text-xs text-slate-400">${sortedPacks.length}${packHasMore ? '+' : ''} resultados · ${categoryActiveLabel}</p>
                            </div>
                            <div className="hidden md:flex items-center gap-2">
                              <span className="text-xs text-slate-400">Ordenar por</span>
                              <select
                                value=${sortBy}
                                onChange=${(event) => setSortBy(event.target.value)}
                                className="h-8 rounded-xl border border-slate-700 bg-slate-900 px-3 text-xs text-slate-200 outline-none"
                              >
                                <option value="popular">Mais populares</option>
                                <option value="new">Mais recentes</option>
                                <option value="liked">Mais curtidos</option>
                              </select>
                            </div>
                          </div>
                          <div className="grid min-w-0 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5 sm:gap-3">
                            ${sortedPacks.map((pack, index) => html`<div key=${pack.pack_key || pack.id} className="fade-card"><${PackCard} pack=${pack} index=${index} onOpen=${openPack} /></div>`)}
                          </div>
                          <div ref=${setSentinel} className="h-8 flex items-center justify-center text-xs text-slate-500">
                            ${packsLoadingMore ? 'Carregando mais packs...' : packHasMore ? 'Role para carregar mais' : 'Fim da lista'}
                          </div>
                        </section>
                      `
                    : null}

                  ${packsLoading ? html`<${SkeletonGrid} count=${10} />` : null}
                  ${!packsLoading && !hasAnyResult ? html`<${EmptyState} onClear=${clearFilters} />` : null}

                  <section className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h2 className="text-base sm:text-lg font-bold">Stickers sem pack</h2>
                      <span className="text-xs text-slate-400">${orphans.length} resultados</span>
                    </div>

                    ${orphansLoading
                      ? html`<div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-8 gap-2.5 sm:gap-3">${Array.from({ length: 16 }).map(
                          (_, i) => html`<div key=${i} className="rounded-2xl border border-slate-700 bg-slate-800 animate-pulse aspect-square"></div>`,
                        )}</div>`
                      : html`
                          <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-8 gap-2.5 sm:gap-3">
                            ${orphans.map((item) => html`<div key=${item.id} className="fade-card"><${OrphanCard} sticker=${item} /></div>`)}
                          </div>
                        `}
                  </section>
                </div>
              </div>
            `}
      </main>
      <${UploadTaskWidget}
        task=${uploadTask}
        onClose=${() => {
          try {
            localStorage.removeItem(PACK_UPLOAD_TASK_KEY);
          } catch {}
          setUploadTask(null);
        }}
      />
      <${PackActionsSheet}
        open=${Boolean(packActionsSheetPack)}
        pack=${packActionsSheetPack}
        busyAction=${packActionsSheetPack ? packActionBusyByKey?.[packActionsSheetPack.pack_key] || '' : ''}
        onClose=${closePackActionsSheet}
        onAction=${handlePackActionsSheetAction}
      />
      <${PackManagerModal}
        open=${managePackOpen}
        data=${managePackData}
        loading=${managePackLoading}
        error=${managePackError}
        busyAction=${managePackBusyAction}
        onClose=${closeManagePackModal}
        onRefresh=${refreshManagePackData}
        onSaveMetadata=${handleManageSaveMetadata}
        onAddSticker=${handleManageAddSticker}
        onRemoveSticker=${handleManageRemoveSticker}
        onReplaceSticker=${handleManageReplaceSticker}
        onSetCover=${handleManageSetCover}
        onReorder=${handleManageReorder}
        onOpenAnalytics=${() => openAnalyticsModalForPack(managePackData?.pack || null)}
      />
      <${PackAnalyticsModal}
        open=${analyticsModalOpen}
        pack=${analyticsModalPack}
        data=${analyticsModalData}
        loading=${analyticsModalLoading}
        error=${analyticsModalError}
        onClose=${closeAnalyticsModal}
      />
      <${ConfirmDialog}
        open=${Boolean(confirmDeletePack)}
        title="Apagar pack"
        message=${confirmDeletePack ? `Tem certeza que deseja apagar o pack "${confirmDeletePack.name || confirmDeletePack.pack_key}"? Essa ação remove o pack do seu painel.` : ''}
        confirmLabel="Apagar pack"
        cancelLabel="Cancelar"
        danger=${true}
        busy=${confirmDeleteBusy}
        onCancel=${() => (confirmDeleteBusy ? null : setConfirmDeletePack(null))}
        onConfirm=${handleDeletePackConfirmed}
      />
      <${ToastStack} toasts=${profileToasts} onDismiss=${dismissProfileToast} />
    </div>
  `;
}

const rootEl = document.getElementById('stickers-react-root');
if (rootEl) {
  createRoot(rootEl).render(html`<${StickersApp} />`);
}
