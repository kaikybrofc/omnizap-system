import { React, createRoot, useEffect, useMemo, useState } from '../runtime/react-runtime.js';
import htm from 'https://esm.sh/htm@3.1.1';

const html = htm.bind(React.createElement);

const CATEGORY_OPTIONS = [
  { value: '', label: '🔥 Em alta' },
  { value: 'anime', label: '🎌 Anime' },
  { value: 'game', label: '🎮 Games' },
  { value: 'meme', label: '😂 Meme' },
  { value: 'nsfw', label: '🔞 +18' },
  { value: 'dark-aesthetic', label: '🖤 Dark' },
  { value: 'texto', label: '✍ Texto' },
  { value: 'cartoon', label: '🧸 Cartoon' },
  { value: 'foto-real', label: '📷 Foto real' },
  { value: 'animal-photo', label: '🐾 Animal' },
  { value: 'cyberpunk', label: '⚡ Cyberpunk' },
];

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

const getPackKeyFromLocation = () => {
  const path = window.location.pathname || '';
  const base = '/stickers/';
  if (!path.startsWith(base)) return '';
  const suffix = path.slice(base.length);
  if (!suffix) return '';
  try {
    return decodeURIComponent(suffix.split('/')[0] || '');
  } catch {
    return '';
  }
};

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

function PackCard({ pack, index, onOpen }) {
  const isTrending = index < 4 || Number(pack?.sticker_count || 0) >= 30;
  const isNew = isRecent(pack?.created_at);
  const engagement = getPackEngagement(pack);

  return html`
    <button
      type="button"
      onClick=${() => onOpen(pack.pack_key)}
      className="group w-full text-left rounded-2xl border border-slate-700/70 bg-slate-800/90 shadow-soft overflow-hidden transition-all duration-200 active:scale-[0.99] hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="relative aspect-[4/5] bg-slate-900 overflow-hidden">
        <img
          src=${pack.cover_url || 'https://iili.io/fSNGag2.png'}
          alt=${`Capa de ${pack.name}`}
          className="w-full h-[70%] object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          loading="lazy"
        />
        <div className="absolute top-2 left-2 flex items-center gap-1">
          ${isTrending ? html`<span className="rounded-full bg-emerald-400 px-2 py-0.5 text-[10px] font-bold text-slate-900">Trending</span>` : null}
          ${isNew ? html`<span className="rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-slate-100">Novo</span>` : null}
        </div>

        <div className="absolute inset-x-0 bottom-0 p-2.5 bg-gradient-to-t from-slate-900 via-slate-900/95 to-slate-900/5">
          <h3 className="font-semibold text-sm leading-5 line-clamp-2">${pack.name || 'Pack sem nome'}</h3>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-300">
            <img src=${getAvatarUrl(pack.publisher)} alt="Criador" className="w-4 h-4 rounded-full bg-slate-700" loading="lazy" />
            <span className="truncate">${pack.publisher || 'Criador não informado'}</span>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-300">
            👍 ${shortNum(engagement.likeCount)} · 👎 ${shortNum(engagement.dislikeCount)} · 🧩 ${Number(pack.sticker_count || 0)}
          </p>
        </div>
      </div>

      <div className="px-2.5 pb-2.5 pt-2 bg-slate-800/95">
        <span className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-emerald-400/35 bg-emerald-400/12 text-sm font-semibold text-emerald-200 transition group-active:brightness-110">
          Abrir pack · ${shortNum(engagement.openCount)} cliques
        </span>
      </div>
    </button>
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
      apiBasePath: root?.dataset.apiBasePath || '/api/sticker-packs',
      orphanApiPath: root?.dataset.orphanApiPath || '/api/sticker-packs/orphan-stickers',
      limit: parseIntSafe(root?.dataset.defaultLimit, 24),
      orphanLimit: parseIntSafe(root?.dataset.defaultOrphanLimit, 24),
    }),
    [root],
  );

  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('');
  const [showAutocomplete, setShowAutocomplete] = useState(false);

  const [packs, setPacks] = useState([]);
  const [packOffset, setPackOffset] = useState(0);
  const [packHasMore, setPackHasMore] = useState(true);
  const [packsLoading, setPacksLoading] = useState(false);
  const [packsLoadingMore, setPacksLoadingMore] = useState(false);

  const [orphans, setOrphans] = useState([]);
  const [orphansLoading, setOrphansLoading] = useState(false);

  const [error, setError] = useState('');
  const [sentinel, setSentinel] = useState(null);

  const [currentPackKey, setCurrentPackKey] = useState('');
  const [currentPack, setCurrentPack] = useState(null);
  const [packLoading, setPackLoading] = useState(false);
  const [reactionLoading, setReactionLoading] = useState('');
  const [relatedPacks, setRelatedPacks] = useState([]);
  const [isScrolled, setIsScrolled] = useState(false);

  const tagSuggestions = useMemo(() => {
    const options = new Map();

    CATEGORY_OPTIONS.forEach((entry) => {
      if (!entry?.value) return;
      options.set(entry.value, {
        value: entry.value,
        label: String(entry.label || entry.value).replace(/^.+?\s/, ''),
        icon: '🏷',
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
  }, [packs, orphans]);

  const filteredSuggestions = useMemo(() => {
    const q = normalizeToken(query);
    if (!q) return [];
    return tagSuggestions
      .filter((item) => normalizeToken(item.value).includes(q) || normalizeToken(item.label).includes(q))
      .slice(0, 8);
  }, [query, tagSuggestions]);

  const hasAnyResult = packs.length > 0 || orphans.length > 0;

  const fetchJson = async (url, options = undefined) => {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || 'Falha ao carregar catálogo');
    return payload;
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
    if (push) window.history.pushState({}, '', `/stickers/${encodeURIComponent(packKey)}`);
    setCurrentPackKey(packKey);
  };

  const goCatalog = (push = true) => {
    if (push) window.history.pushState({}, '', '/stickers/');
    setCurrentPackKey('');
    setCurrentPack(null);
    setRelatedPacks([]);
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
    const initial = getPackKeyFromLocation();
    if (initial) setCurrentPackKey(initial);

    const onPopState = () => {
      const key = getPackKeyFromLocation();
      if (!key) {
        goCatalog(false);
        return;
      }
      setCurrentPackKey(key);
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (currentPackKey) {
      void loadPackDetail(currentPackKey);
      return;
    }
    void loadPacks({ reset: true });
    void loadOrphans();
  }, [appliedQuery, activeCategory, currentPackKey]);

  useEffect(() => {
    if (!sentinel || !packHasMore || packsLoading || packsLoadingMore || currentPackKey) return;
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
  }, [sentinel, packHasMore, packsLoading, packsLoadingMore, packOffset, appliedQuery, activeCategory, currentPackKey]);

  const onSubmit = (event) => {
    event.preventDefault();
    setShowAutocomplete(false);
    setAppliedQuery(query.trim());
  };

  const applySuggestion = (item) => {
    const value = String(item?.value || '').trim();
    if (!value) return;
    setQuery(value);
    setAppliedQuery(value);
    if (CATEGORY_OPTIONS.some((entry) => entry.value === value)) {
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
        .chips-scroll { scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; }
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

          ${!currentPackKey
            ? html`
                <form onSubmit=${onSubmit} className="flex-1 relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔎</span>
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
                    placeholder="Buscar packs, criadores ou categorias..."
                    className="w-full h-10 rounded-2xl border border-slate-800 bg-slate-900 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/15"
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

          <div className="hidden sm:flex items-center gap-2">
            <a className="text-xs rounded-lg border border-slate-700 px-3 py-2 text-slate-300 hover:bg-slate-800" href="/api-docs/">API</a>
            <a className="text-xs rounded-lg border border-slate-700 px-3 py-2 text-slate-300 hover:bg-slate-800" href="https://github.com/Kaikygr/omnizap-system" target="_blank" rel="noreferrer noopener">GitHub</a>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 py-3 space-y-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        ${error
          ? html`<div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">${error}</div>`
          : null}

        ${currentPackKey
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
              <section className="space-y-3">
                <div className="relative">
                  <div className="absolute left-0 top-0 bottom-0 w-5 bg-gradient-to-r from-slate-950 to-transparent pointer-events-none z-10"></div>
                  <div className="absolute right-0 top-0 bottom-0 w-5 bg-gradient-to-l from-slate-950 to-transparent pointer-events-none z-10"></div>
                  <div className="chips-scroll flex gap-2 overflow-x-auto pb-1.5 pr-1">
                    ${CATEGORY_OPTIONS.map(
                      (item) => html`
                        <button
                          key=${item.value || 'all'}
                          type="button"
                          onClick=${() => setActiveCategory(item.value)}
                          className=${`chip-item h-9 whitespace-nowrap rounded-full px-3 text-xs border transition ${
                            activeCategory === item.value
                              ? 'bg-emerald-400 text-slate-900 border-emerald-400 font-semibold shadow-sm'
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

              ${packsLoading ? html`<${SkeletonGrid} count=${10} />` : null}

              ${!packsLoading && !hasAnyResult ? html`<${EmptyState} onClear=${clearFilters} />` : null}

              ${packs.length
                ? html`
                    <section className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h2 className="text-lg font-bold">Packs</h2>
                        <span className="text-xs text-slate-400">${packs.length}${packHasMore ? '+' : ''} resultados</span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                        ${packs.map((pack, index) => html`<div key=${pack.pack_key || pack.id} className="fade-card"><${PackCard} pack=${pack} index=${index} onOpen=${openPack} /></div>`)}
                      </div>
                      <div ref=${setSentinel} className="h-8 flex items-center justify-center text-xs text-slate-500">
                        ${packsLoadingMore ? 'Carregando mais packs...' : packHasMore ? 'Role para carregar mais' : 'Fim da lista'}
                      </div>
                    </section>
                  `
                : null}

              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold">Stickers sem pack</h2>
                  <span className="text-xs text-slate-400">${orphans.length} resultados</span>
                </div>

                ${orphansLoading
                  ? html`<div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-8 gap-3">${Array.from({ length: 16 }).map(
                      (_, i) => html`<div key=${i} className="rounded-2xl border border-slate-700 bg-slate-800 animate-pulse aspect-square"></div>`,
                    )}</div>`
                  : html`
                      <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-8 gap-3">
                        ${orphans.map((item) => html`<div key=${item.id} className="fade-card"><${OrphanCard} sticker=${item} /></div>`)}
                      </div>
                    `}
              </section>
            `}
      </main>
    </div>
  `;
}

const rootEl = document.getElementById('stickers-react-root');
if (rootEl) {
  createRoot(rootEl).render(html`<${StickersApp} />`);
}
