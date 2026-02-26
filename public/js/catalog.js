(() => {
  const root = document.getElementById('catalog-root');
  if (!root) return;

  const parseIntSafe = (value, fallback) => {
    const parsed = Number.parseInt(String(value || ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
  };

  const CONFIG = {
    apiBasePath: root.dataset.apiBasePath || '/api/sticker-packs',
    orphanApiPath: root.dataset.orphanApiPath || '/api/sticker-packs/orphan-stickers',
    webPath: root.dataset.webPath || '/stickers',
    dataPublicPath: root.dataset.dataPublicPath || '/data',
    initialPackKey: String(root.dataset.initialPackKey || '').trim() || null,
    defaultLimit: parseIntSafe(root.dataset.defaultLimit, 24),
    defaultOrphanLimit: parseIntSafe(root.dataset.defaultOrphanLimit, 120),
  };

  const state = {
    q: '',
    visibility: 'public',
    packs: {
      offset: 0,
      limit: CONFIG.defaultLimit,
      hasMore: true,
      loading: false,
      items: [],
    },
    orphan: {
      page: 1,
      limit: CONFIG.defaultOrphanLimit,
      totalPages: 1,
      totalItems: 0,
      loading: false,
      items: [],
    },
    panelPagination: {
      page: 1,
      perPage: 100,
      totalPages: 1,
    },
    selectedPack: null,
  };

  const els = {
    form: document.getElementById('search-form'),
    search: document.getElementById('search-input'),
    visibility: document.getElementById('visibility-input'),
    status: document.getElementById('status'),
    grid: document.getElementById('grid'),
    more: document.getElementById('load-more'),
    orphanStatus: document.getElementById('orphan-status'),
    orphanGrid: document.getElementById('orphan-grid'),
    orphanPagination: document.getElementById('orphan-pagination'),
    orphanPrev: document.getElementById('orphan-prev'),
    orphanNext: document.getElementById('orphan-next'),
    orphanPageInfo: document.getElementById('orphan-page-info'),
    orphanMore: document.getElementById('orphan-load-more'),
    panelPagination: document.getElementById('panel-pagination'),
    panelPrev: document.getElementById('panel-prev'),
    panelNext: document.getElementById('panel-next'),
    panelPageInfo: document.getElementById('panel-page-info'),
    panel: document.getElementById('panel'),
    panelTitle: document.getElementById('panel-title'),
    panelSub: document.getElementById('panel-subtitle'),
    panelChip: document.getElementById('panel-chip'),
    panelError: document.getElementById('panel-error'),
    panelClose: document.getElementById('panel-close'),
    copy: document.getElementById('copy-link'),
    stickers: document.getElementById('stickers'),
  };

  if (
    !els.form ||
    !els.search ||
    !els.visibility ||
    !els.status ||
    !els.grid ||
    !els.more ||
    !els.orphanStatus ||
    !els.orphanGrid ||
    !els.orphanPrev ||
    !els.orphanNext ||
    !els.orphanPageInfo ||
    !els.panel ||
    !els.panelTitle ||
    !els.panelSub ||
    !els.panelChip ||
    !els.panelError ||
    !els.panelPrev ||
    !els.panelNext ||
    !els.panelPageInfo ||
    !els.copy ||
    !els.stickers
  ) {
    return;
  }

  const panelModal = window.bootstrap?.Modal
    ? window.bootstrap.Modal.getOrCreateInstance(els.panel)
    : null;

  let shouldReplaceStateOnHide = false;

  els.panelPrev.disabled = true;
  els.panelNext.disabled = true;
  els.orphanPrev.disabled = true;
  els.orphanNext.disabled = true;
  if (els.orphanMore) els.orphanMore.hidden = true;

  const toApi = (path, searchParams) => {
    const url = new URL(path, window.location.origin);
    if (searchParams) {
      Object.entries(searchParams).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      });
    }
    return url.toString();
  };

  const setStatus = (text) => {
    els.status.textContent = text || '';
  };

  const setOrphanStatus = (text) => {
    els.orphanStatus.textContent = text || '';
  };

  const fetchJson = async (url) => {
    const response = await fetch(url);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = (data && data.error) || 'Falha ao carregar dados.';
      throw new Error(message);
    }
    return data;
  };

  const clearPanelError = () => {
    els.panelError.hidden = true;
    els.panelError.textContent = '';
  };

  const setThumbFallback = (thumbWrap) => {
    thumbWrap.textContent = '';
    const fallback = document.createElement('div');
    fallback.className = 'pack-thumb-fallback';
    fallback.textContent = 'Sem capa disponivel';
    thumbWrap.appendChild(fallback);
  };

  const appendMetaLine = (container, leftText, rightText) => {
    const left = document.createElement('span');
    left.textContent = leftText;
    const right = document.createElement('span');
    right.textContent = rightText;
    container.append(left, right);
  };

  const shortStickerId = (value) => {
    const normalized = String(value || '').replace(/[^a-zA-Z0-9]/g, '');
    return normalized.slice(0, 5) || '-----';
  };

  const renderCard = (pack) => {
    const col = document.createElement('div');
    col.className = 'col-12 col-sm-6 col-md-4 col-lg-3';

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card h-100 text-start bg-dark text-light shadow-sm pack-card';
    card.setAttribute('aria-label', 'Abrir pack ' + pack.name);

    const cardBody = document.createElement('div');
    cardBody.className = 'card-body d-flex flex-column gap-2';

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'pack-thumb';

    if (pack.cover_url) {
      const image = document.createElement('img');
      image.loading = 'lazy';
      image.alt = 'Capa do pack ' + pack.name;
      image.src = pack.cover_url;
      image.addEventListener('error', () => setThumbFallback(thumbWrap));
      thumbWrap.appendChild(image);
    } else {
      setThumbFallback(thumbWrap);
    }

    const title = document.createElement('h3');
    title.className = 'card-title h6 mb-0';
    title.textContent = pack.name;

    const metaTop = document.createElement('p');
    metaTop.className = 'pack-meta mb-0 d-flex justify-content-between gap-2';
    appendMetaLine(metaTop, pack.publisher, pack.sticker_count + ' itens');

    const metaBottom = document.createElement('p');
    metaBottom.className = 'pack-meta mb-0 d-flex justify-content-between gap-2';
    appendMetaLine(metaBottom, pack.visibility, pack.pack_key);

    cardBody.append(thumbWrap, title, metaTop, metaBottom);
    card.appendChild(cardBody);
    card.addEventListener('click', () => openPack(pack.pack_key, { pushState: true }));

    col.appendChild(card);
    return col;
  };

  const renderGrid = () => {
    els.grid.innerHTML = '';
    state.packs.items.forEach((pack) => {
      els.grid.appendChild(renderCard(pack));
    });
  };

  const renderOrphanSticker = (sticker) => {
    const col = document.createElement('div');
    col.className = 'col-6 col-md-3 col-lg-2';

    const wrapper = document.createElement('article');
    wrapper.className = 'orphan-card card h-100';

    const body = document.createElement('div');
    body.className = 'card-body p-2';

    if (sticker.url) {
      const image = document.createElement('img');
      image.loading = 'lazy';
      image.alt = 'Sticker sem pack ' + sticker.id;
      image.src = sticker.url;
      body.appendChild(image);
    } else {
      const fallback = document.createElement('div');
      fallback.className = 'pack-thumb-fallback';
      fallback.textContent = 'Arquivo nao acessivel';
      body.appendChild(fallback);
    }

    const meta = document.createElement('p');
    meta.className = 'orphan-meta mb-0 mt-2';
    meta.textContent = 'ID: ' + shortStickerId(sticker.id);
    meta.title = sticker.id || '';
    body.appendChild(meta);

    wrapper.appendChild(body);
    col.appendChild(wrapper);
    return col;
  };

  const renderOrphanGrid = () => {
    els.orphanGrid.innerHTML = '';
    state.orphan.items.forEach((sticker) => {
      els.orphanGrid.appendChild(renderOrphanSticker(sticker));
    });
  };

  const updateMoreButton = () => {
    els.more.hidden = !state.packs.hasMore;
    els.more.disabled = state.packs.loading;
    els.more.textContent = state.packs.loading ? 'Carregando...' : 'Carregar mais';
  };

  const updateOrphanPaginationControls = () => {
    const totalPages = Math.max(1, Number(state.orphan.totalPages) || 1);
    const totalItems = Math.max(0, Number(state.orphan.totalItems) || 0);
    const page = Math.max(1, Math.min(totalPages, Number(state.orphan.page) || 1));
    state.orphan.page = page;

    els.orphanPrev.disabled = page <= 1 || state.orphan.loading;
    els.orphanNext.disabled = page >= totalPages || state.orphan.loading;
    els.orphanPageInfo.textContent = 'Pagina ' + page + ' de ' + totalPages + ' - ' + totalItems + ' figurinhas';
  };

  const listPacks = async ({ reset = false } = {}) => {
    if (state.packs.loading) return;
    state.packs.loading = true;
    updateMoreButton();
    setStatus(reset ? 'Buscando packs...' : 'Carregando mais packs...');

    if (reset) {
      state.packs.offset = 0;
      state.packs.items = [];
    }

    try {
      const payload = await fetchJson(
        toApi(CONFIG.apiBasePath, {
          q: state.q,
          visibility: state.visibility,
          limit: state.packs.limit,
          offset: state.packs.offset,
        }),
      );

      const packs = Array.isArray(payload.data) ? payload.data : [];
      state.packs.items = reset ? packs : state.packs.items.concat(packs);
      state.packs.offset = (payload.pagination && payload.pagination.next_offset) || state.packs.items.length;
      state.packs.hasMore = Boolean(payload.pagination && payload.pagination.has_more);

      renderGrid();

      if (!state.packs.items.length) {
        setStatus('Nenhum pack encontrado com os filtros atuais.');
      } else {
        setStatus(state.packs.items.length + ' pack(s) carregado(s).');
      }
    } catch (error) {
      setStatus(error.message || 'Nao foi possivel listar os packs agora.');
    } finally {
      state.packs.loading = false;
      updateMoreButton();
    }
  };

  const listOrphanStickers = async ({ reset = false } = {}) => {
    if (state.orphan.loading) return;
    state.orphan.loading = true;
    updateOrphanPaginationControls();
    setOrphanStatus('Buscando figurinhas sem pack...');

    if (reset) {
      state.orphan.page = 1;
      state.orphan.items = [];
    }

    try {
      const currentPage = Math.max(1, Number(state.orphan.page) || 1);
      const currentLimit = Math.max(1, Number(state.orphan.limit) || 1);
      const offset = (currentPage - 1) * currentLimit;

      const payload = await fetchJson(
        toApi(CONFIG.orphanApiPath, {
          q: state.q,
          limit: currentLimit,
          offset,
        }),
      );

      const stickers = Array.isArray(payload.data) ? payload.data : [];
      const totalItems = Math.max(0, Number(payload?.pagination?.total || 0));
      const totalPages = Math.max(1, Number(payload?.pagination?.total_pages || Math.ceil(totalItems / currentLimit) || 1));

      state.orphan.items = stickers;
      state.orphan.totalItems = totalItems;
      state.orphan.totalPages = totalPages;
      state.orphan.page = Math.max(1, Math.min(totalPages, currentPage));

      renderOrphanGrid();

      if (!state.orphan.items.length) {
        setOrphanStatus('Nenhuma figurinha sem pack encontrada.');
      } else {
        const from = offset + 1;
        const to = offset + state.orphan.items.length;
        setOrphanStatus('Mostrando ' + from + '-' + to + ' de ' + state.orphan.totalItems + ' figurinha(s) sem pack.');
      }
    } catch (error) {
      setOrphanStatus(error.message || 'Nao foi possivel listar figurinhas sem pack.');
    } finally {
      state.orphan.loading = false;
      updateOrphanPaginationControls();
    }
  };

  const updatePanelPaginationControls = (totalItems) => {
    const safeTotal = Math.max(0, Number(totalItems) || 0);
    const totalPages = Math.max(1, Math.ceil(safeTotal / state.panelPagination.perPage));
    state.panelPagination.totalPages = totalPages;

    if (state.panelPagination.page > totalPages) {
      state.panelPagination.page = totalPages;
    }
    if (state.panelPagination.page < 1) {
      state.panelPagination.page = 1;
    }

    els.panelPrev.disabled = state.panelPagination.page <= 1;
    els.panelNext.disabled = state.panelPagination.page >= totalPages;
    els.panelPageInfo.textContent =
      'Pagina ' + state.panelPagination.page + ' de ' + totalPages + ' - ' + safeTotal + ' stickers';
  };

  const renderPanelStickersPage = () => {
    const pack = state.selectedPack;
    const items = Array.isArray(pack?.items) ? pack.items : [];
    const perPage = state.panelPagination.perPage;

    updatePanelPaginationControls(items.length);

    const start = (state.panelPagination.page - 1) * perPage;
    const end = start + perPage;
    const pageItems = items.slice(start, end);

    els.stickers.innerHTML = '';

    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'text-secondary mb-0';
      empty.textContent = 'Este pack nao possui stickers disponiveis.';
      els.stickers.appendChild(empty);
      return;
    }

    pageItems.forEach((item) => {
      const col = document.createElement('div');
      col.className = 'col-6 col-sm-4 col-md-3 col-lg-2';

      const wrapper = document.createElement('div');
      wrapper.className = 'sticker-tile';

      const image = document.createElement('img');
      image.loading = 'lazy';
      image.alt = item.accessibility_label || 'Sticker #' + item.position;
      image.src = item.asset_url;

      wrapper.appendChild(image);
      col.appendChild(wrapper);
      els.stickers.appendChild(col);
    });
  };

  const resetPanel = () => {
    state.selectedPack = null;
    state.panelPagination.page = 1;
    state.panelPagination.totalPages = 1;
    els.panelTitle.textContent = 'Pack';
    els.panelSub.textContent = '';
    els.panelChip.textContent = '';
    els.stickers.innerHTML = '';
    els.panelPageInfo.textContent = 'Pagina 1 de 1 - 0 stickers';
    els.panelPrev.disabled = true;
    els.panelNext.disabled = true;
    clearPanelError();
  };

  const showPanel = () => {
    if (panelModal) {
      panelModal.show();
      return;
    }
    els.panel.classList.add('show');
    els.panel.style.display = 'block';
    els.panel.removeAttribute('aria-hidden');
  };

  const closePanel = ({ replaceState = false } = {}) => {
    shouldReplaceStateOnHide = replaceState;
    if (panelModal) {
      panelModal.hide();
      return;
    }

    els.panel.classList.remove('show');
    els.panel.style.display = 'none';
    els.panel.setAttribute('aria-hidden', 'true');
    resetPanel();
    if (replaceState) {
      history.replaceState({}, '', CONFIG.webPath);
    }
  };

  const renderPack = (pack) => {
    state.selectedPack = pack || null;
    state.panelPagination.page = 1;

    els.panelTitle.textContent = pack.name || 'Pack';
    els.panelSub.textContent = (pack.publisher || '-') + ' | ' + (pack.description || 'Sem descricao');
    els.panelChip.textContent = pack.sticker_count + ' itens | ' + pack.visibility + ' | ' + pack.pack_key;
    renderPanelStickersPage();

    showPanel();
  };

  const openPack = async (packKey, { pushState = false } = {}) => {
    const sanitizedKey = String(packKey || '').trim();
    if (!sanitizedKey) return;

    clearPanelError();
    els.panelTitle.textContent = 'Carregando...';
    els.panelSub.textContent = '';
    els.panelChip.textContent = '';
    els.stickers.innerHTML = '';
    showPanel();

    try {
      const payload = await fetchJson(toApi(CONFIG.apiBasePath + '/' + encodeURIComponent(sanitizedKey)));
      state.selectedPack = payload.data || null;
      if (!state.selectedPack) {
        throw new Error('Pack nao encontrado.');
      }

      renderPack(state.selectedPack);
      if (pushState) {
        history.pushState({}, '', CONFIG.webPath + '/' + encodeURIComponent(sanitizedKey));
      }
    } catch (error) {
      els.panelError.hidden = false;
      els.panelError.textContent = error.message || 'Nao foi possivel abrir este pack.';
    }
  };

  els.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    state.q = els.search.value.trim();
    state.visibility = els.visibility.value;
    await Promise.all([listPacks({ reset: true }), listOrphanStickers({ reset: true })]);
  });

  els.more.addEventListener('click', async () => {
    await listPacks({ reset: false });
  });

  els.orphanPrev.addEventListener('click', async () => {
    if (state.orphan.page <= 1) return;
    state.orphan.page -= 1;
    await listOrphanStickers();
  });

  els.orphanNext.addEventListener('click', async () => {
    if (state.orphan.page >= state.orphan.totalPages) return;
    state.orphan.page += 1;
    await listOrphanStickers();
  });

  els.panelPrev.addEventListener('click', () => {
    if (state.panelPagination.page <= 1) return;
    state.panelPagination.page -= 1;
    renderPanelStickersPage();
  });

  els.panelNext.addEventListener('click', () => {
    if (state.panelPagination.page >= state.panelPagination.totalPages) return;
    state.panelPagination.page += 1;
    renderPanelStickersPage();
  });

  els.panelClose.addEventListener('click', () => {
    closePanel({ replaceState: true });
  });

  els.copy.addEventListener('click', async () => {
    if (!state.selectedPack) return;

    const url = window.location.origin + CONFIG.webPath + '/' + encodeURIComponent(state.selectedPack.pack_key);
    try {
      await navigator.clipboard.writeText(url);
      els.copy.textContent = 'Link copiado';
      setTimeout(() => {
        els.copy.textContent = 'Copiar link do pack';
      }, 1800);
    } catch {
      els.copy.textContent = 'Falha ao copiar';
    }
  });

  if (panelModal) {
    els.panel.addEventListener('hidden.bs.modal', () => {
      resetPanel();

      if (shouldReplaceStateOnHide || window.location.pathname.startsWith(CONFIG.webPath + '/')) {
        history.replaceState({}, '', CONFIG.webPath);
      }

      shouldReplaceStateOnHide = false;
    });
  }

  window.addEventListener('popstate', () => {
    const path = window.location.pathname;
    if (!path.startsWith(CONFIG.webPath + '/')) {
      closePanel();
      return;
    }

    let key = '';
    try {
      key = decodeURIComponent(path.slice((CONFIG.webPath + '/').length).split('/')[0] || '');
    } catch {
      key = '';
    }

    if (key) {
      openPack(key, { pushState: false });
    }
  });

  (async () => {
    await Promise.all([listPacks({ reset: true }), listOrphanStickers({ reset: true })]);

    if (CONFIG.initialPackKey) {
      openPack(CONFIG.initialPackKey, { pushState: false });
    }
  })();
})();
