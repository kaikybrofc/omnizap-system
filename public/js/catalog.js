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
    catalogLoaded: false,
    visibility: 'public',
    categories: [],
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
    hero: document.getElementById('catalog-hero'),
    form: document.getElementById('search-form'),
    search: document.getElementById('search-input'),
    visibility: document.getElementById('visibility-input'),
    categories: document.getElementById('categories-input'),
    categoriesPicker: document.getElementById('categories-picker'),
    categoriesSearch: document.getElementById('categories-search'),
    categoriesChips: document.getElementById('categories-chips'),
    categoriesOptions: document.getElementById('categories-options'),
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
    useWhatsAppLink: document.getElementById('use-whatsapp-link'),
    stickers: document.getElementById('stickers'),
    packPage: document.getElementById('pack-page'),
    packPageTitle: document.getElementById('pack-page-title'),
    packPageSub: document.getElementById('pack-page-subtitle'),
    packPageChip: document.getElementById('pack-page-chip'),
    packPageStatus: document.getElementById('pack-page-status'),
    packPageGrid: document.getElementById('pack-page-stickers'),
    packPageBack: document.getElementById('pack-page-back'),
    packPageCopy: document.getElementById('pack-page-copy'),
    packPageWhatsApp: document.getElementById('pack-page-whatsapp'),
  };

  if (
    !els.hero ||
    !els.form ||
    !els.search ||
    !els.visibility ||
    !els.categories ||
    !els.categoriesPicker ||
    !els.categoriesSearch ||
    !els.categoriesChips ||
    !els.categoriesOptions ||
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
    !els.useWhatsAppLink ||
    !els.stickers ||
    !els.packPage ||
    !els.packPageTitle ||
    !els.packPageSub ||
    !els.packPageChip ||
    !els.packPageStatus ||
    !els.packPageGrid ||
    !els.packPageBack ||
    !els.packPageCopy ||
    !els.packPageWhatsApp
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

  const extractPackKeyFromPath = () => {
    const path = window.location.pathname;
    if (!path.startsWith(CONFIG.webPath + '/')) return '';
    try {
      return decodeURIComponent(path.slice((CONFIG.webPath + '/').length).split('/')[0] || '');
    } catch {
      return '';
    }
  };

  const getSelectedCategories = () =>
    Array.from(els.categories.selectedOptions || [])
      .map((option) => String(option.value || '').trim())
      .filter(Boolean);

  const normalizeCategorySearch = (value) =>
    String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

  const categoryCatalog = Array.from(els.categories.options || []).map((option) => ({
    value: String(option.value || '').trim(),
    label: String(option.textContent || option.value || '').trim(),
  }));

  const syncCategorySelect = (selectedValues) => {
    const selected = new Set((selectedValues || []).map((value) => String(value || '').trim()).filter(Boolean));
    Array.from(els.categories.options || []).forEach((option) => {
      option.selected = selected.has(String(option.value || '').trim());
    });
    state.categories = getSelectedCategories();
  };

  const renderCategoryChips = () => {
    els.categoriesChips.innerHTML = '';
    if (!state.categories.length) {
      const empty = document.createElement('span');
      empty.className = 'categories-empty';
      empty.textContent = 'Nenhuma categoria selecionada';
      els.categoriesChips.appendChild(empty);
      return;
    }

    state.categories.forEach((value) => {
      const entry = categoryCatalog.find((item) => item.value === value);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'category-chip';
      chip.dataset.value = value;
      chip.setAttribute('aria-label', 'Remover categoria ' + (entry?.label || value));
      chip.innerHTML =
        '<span class="category-chip-label">' +
        (entry?.label || value) +
        '</span><i class="fa-solid fa-xmark category-chip-remove" aria-hidden="true"></i>';
      els.categoriesChips.appendChild(chip);
    });
  };

  const renderCategoryOptions = () => {
    const query = normalizeCategorySearch(els.categoriesSearch.value);
    const selected = new Set(state.categories);
    const filtered = categoryCatalog.filter((entry) => {
      if (!entry.value) return false;
      if (!query) return true;
      return normalizeCategorySearch(entry.label).includes(query) || normalizeCategorySearch(entry.value).includes(query);
    });

    els.categoriesOptions.innerHTML = '';

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'categories-options-empty';
      empty.textContent = 'Nenhuma categoria encontrada';
      els.categoriesOptions.appendChild(empty);
      return;
    }

    filtered.forEach((entry) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'category-option' + (selected.has(entry.value) ? ' selected' : '');
      button.dataset.value = entry.value;
      button.innerHTML =
        '<span class="category-option-label">' +
        entry.label +
        '</span><i class="fa-solid fa-check category-option-check" aria-hidden="true"></i>';
      els.categoriesOptions.appendChild(button);
    });
  };

  const applyFilters = async () => {
    state.q = els.search.value.trim();
    state.visibility = els.visibility.value;
    state.categories = getSelectedCategories();
    await Promise.all([listPacks({ reset: true }), listOrphanStickers({ reset: true })]);
  };

  let filterRefreshTimer = null;
  const scheduleFilterRefresh = () => {
    if (filterRefreshTimer) {
      clearTimeout(filterRefreshTimer);
    }
    filterRefreshTimer = setTimeout(() => {
      filterRefreshTimer = null;
      void applyFilters();
    }, 120);
  };

  const toggleCategory = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized) return;
    const selected = new Set(state.categories);
    if (selected.has(normalized)) {
      selected.delete(normalized);
    } else {
      selected.add(normalized);
    }
    syncCategorySelect(Array.from(selected));
    renderCategoryChips();
    renderCategoryOptions();
    scheduleFilterRefresh();
  };

  const initCategoriesPicker = () => {
    syncCategorySelect(getSelectedCategories());
    renderCategoryChips();
    renderCategoryOptions();

    els.categoriesSearch.addEventListener('input', () => {
      renderCategoryOptions();
    });

    els.categoriesOptions.addEventListener('click', (event) => {
      const option = event.target.closest('.category-option');
      if (!option) return;
      toggleCategory(option.dataset.value);
    });

    els.categoriesChips.addEventListener('click', (event) => {
      const chip = event.target.closest('.category-chip');
      if (!chip) return;
      toggleCategory(chip.dataset.value);
    });
  };

  initCategoriesPicker();

  const showCatalogView = () => {
    els.packPage.hidden = true;
    els.hero.hidden = false;
    document.getElementById('packs-section').hidden = false;
    document.getElementById('orphan-section').hidden = false;
  };

  const showPackPageView = () => {
    els.packPage.hidden = false;
    els.hero.hidden = true;
    document.getElementById('packs-section').hidden = true;
    document.getElementById('orphan-section').hidden = true;
  };

  const setStatus = (text) => {
    els.status.textContent = text || '';
  };

  const setOrphanStatus = (text) => {
    els.orphanStatus.textContent = text || '';
  };

  const applyWhatsAppLink = (element, url) => {
    if (!element) return;
    const value = String(url || '').trim();
    if (!value) {
      element.hidden = true;
      element.removeAttribute('href');
      return;
    }
    element.hidden = false;
    element.setAttribute('href', value);
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
    fallback.textContent = 'Sem capa disponível';
    thumbWrap.appendChild(fallback);
  };

  const shortStickerId = (value) => {
    const normalized = String(value || '').replace(/[^a-zA-Z0-9]/g, '');
    return normalized.slice(0, 5) || '-----';
  };

  const toTagToken = (value) => {
    const normalized = String(value || '')
      .trim()
      .toLowerCase();
    if (!normalized) return '';

    const mapped = {
      'video game screenshot': 'game',
      'real life photo': 'foto-real',
      'anime illustration': 'anime',
      'nsfw content': 'nsfw',
    };

    if (mapped[normalized]) return mapped[normalized];

    return normalized
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 18);
  };

  const resolveTopStickerTags = (entity) => {
    const classification = entity?.asset?.classification || entity?.classification || null;
    const explicitTags = Array.isArray(entity?.tags) ? entity.tags : [];
    const classificationTags = Array.isArray(classification?.tags) ? classification.tags : [];

    const rankedFromScores = Object.entries(classification?.all_scores || {})
      .filter(([, score]) => Number.isFinite(Number(score)))
      .sort((left, right) => Number(right[1]) - Number(left[1]))
      .map(([label]) => toTagToken(label))
      .filter(Boolean);

    const merged = [...rankedFromScores, ...classificationTags, ...explicitTags]
      .map((tag) => toTagToken(tag))
      .filter(Boolean);

    return Array.from(new Set(merged)).slice(0, 3);
  };

  const buildStickerTagsOverlay = (entity) => {
    const tags = resolveTopStickerTags(entity);
    if (!tags.length) return null;

    const overlay = document.createElement('div');
    overlay.className = 'sticker-tags';
    overlay.setAttribute('aria-label', 'Tags da figurinha: ' + tags.join(', '));

    tags.forEach((tag) => {
      const chip = document.createElement('span');
      chip.className = 'sticker-tag';
      chip.textContent = tag;
      overlay.appendChild(chip);
    });

    return overlay;
  };

  const resolveTopPackTags = (pack) => {
    const explicitTags = Array.isArray(pack?.tags) ? pack.tags : [];
    const classificationTags = Array.isArray(pack?.classification?.tags) ? pack.classification.tags : [];

    const merged = [...classificationTags, ...explicitTags]
      .map((tag) => toTagToken(tag))
      .filter(Boolean);

    return Array.from(new Set(merged)).slice(0, 3);
  };

  const buildPackTagsRow = (pack) => {
    const tags = resolveTopPackTags(pack);
    if (!tags.length) return null;

    const row = document.createElement('div');
    row.className = 'pack-tags';
    row.setAttribute('aria-label', 'Categorias do pack: ' + tags.join(', '));

    tags.forEach((tag) => {
      const chip = document.createElement('span');
      chip.className = 'pack-tag';
      chip.textContent = tag;
      row.appendChild(chip);
    });

    return row;
  };

  const renderCard = (pack) => {
    const col = document.createElement('div');
    col.className = 'col-4 col-sm-6 col-md-4 col-lg-3';

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card h-100 text-start bg-dark text-light shadow-sm pack-card';
    card.setAttribute('aria-label', 'Abrir pack ' + pack.name);

    const cardBody = document.createElement('div');
    cardBody.className = 'card-body d-flex flex-column gap-2';

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'pack-thumb';

    const visibilityBadge = document.createElement('span');
    visibilityBadge.className = 'pack-visibility-badge';
    const visibility = String(pack.visibility || '').toLowerCase();
    visibilityBadge.textContent =
      visibility === 'public' ? 'Público' : visibility === 'unlisted' ? 'Não listado' : 'Privado';

    const countBadge = document.createElement('span');
    countBadge.className = 'pack-count-badge';
    countBadge.textContent = String(Number(pack.sticker_count || 0)) + ' itens';

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
    thumbWrap.append(visibilityBadge, countBadge);

    const title = document.createElement('h3');
    title.className = 'card-title h6 mb-0';
    title.textContent = pack.name;

    const quantity = document.createElement('p');
    quantity.className = 'pack-meta pack-count mb-0';
    quantity.textContent = String(Number(pack.sticker_count || 0)) + ' itens';

    const author = document.createElement('p');
    author.className = 'pack-meta pack-author mb-0';
    author.textContent = pack.publisher || 'Autor não informado';

    const tagsRow = buildPackTagsRow(pack);
    cardBody.append(thumbWrap, title, quantity, author);
    if (tagsRow) {
      cardBody.appendChild(tagsRow);
    }
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

  const rankPacksByCompleteness = (packs) => {
    if (!Array.isArray(packs)) return [];
    return [...packs].sort((left, right) => {
      const leftCount = Number(left?.sticker_count) || 0;
      const rightCount = Number(right?.sticker_count) || 0;
      const leftHasCover = left?.cover_url ? 1 : 0;
      const rightHasCover = right?.cover_url ? 1 : 0;
      const leftIsComplete = leftCount >= 30 ? 1 : 0;
      const rightIsComplete = rightCount >= 30 ? 1 : 0;

      if (rightIsComplete !== leftIsComplete) return rightIsComplete - leftIsComplete;

      if (rightCount !== leftCount) return rightCount - leftCount;
      if (rightHasCover !== leftHasCover) return rightHasCover - leftHasCover;
      return String(left?.name || '').localeCompare(String(right?.name || ''), 'pt-BR');
    });
  };

  const renderPackSkeletons = (count) => {
    els.grid.innerHTML = '';
    for (let index = 0; index < count; index += 1) {
      const col = document.createElement('div');
      col.className = 'col-4 col-sm-6 col-md-4 col-lg-3';
      col.innerHTML =
        '<div class="card h-100 bg-dark text-light shadow-sm pack-card">' +
        '<div class="card-body d-flex flex-column gap-2">' +
        '<div class="skeleton skeleton-thumb"></div>' +
        '<div class="skeleton skeleton-line"></div>' +
        '<div class="skeleton skeleton-line short"></div>' +
        '</div></div>';
      els.grid.appendChild(col);
    }
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
      fallback.textContent = 'Arquivo não acessível';
      body.appendChild(fallback);
    }

    const tagsOverlay = buildStickerTagsOverlay(sticker);
    if (tagsOverlay) body.appendChild(tagsOverlay);

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

  const renderPackPage = (pack) => {
    const items = Array.isArray(pack?.items) ? pack.items : [];
    state.selectedPack = pack || null;

    els.packPageTitle.textContent = pack?.name || 'Pack';
    els.packPageSub.textContent = (pack?.publisher || '-') + ' | ' + (pack?.description || 'Sem descrição');
    els.packPageChip.textContent =
      String(pack?.sticker_count || items.length || 0) + ' itens | ' + (pack?.visibility || '-') + ' | ' + (pack?.pack_key || '-');
    applyWhatsAppLink(els.packPageWhatsApp, pack?.whatsapp?.url);

    els.packPageGrid.innerHTML = '';
    if (!items.length) {
      els.packPageStatus.textContent = 'Este pack não possui stickers disponíveis.';
      return;
    }

    els.packPageStatus.textContent = 'Exibindo ' + items.length + ' sticker(s).';
    items.forEach((item) => {
      const col = document.createElement('div');
      col.className = 'col-6 col-sm-4 col-md-3 col-lg-2';

      const wrapper = document.createElement('div');
      wrapper.className = 'sticker-tile';

      const image = document.createElement('img');
      image.loading = 'lazy';
      image.alt = item.accessibility_label || 'Sticker #' + item.position;
      image.src = item.asset_url;

      wrapper.appendChild(image);
      const tagsOverlay = buildStickerTagsOverlay(item);
      if (tagsOverlay) wrapper.appendChild(tagsOverlay);
      col.appendChild(wrapper);
      els.packPageGrid.appendChild(col);
    });
  };

  const renderOrphanSkeletons = (count) => {
    els.orphanGrid.innerHTML = '';
    for (let index = 0; index < count; index += 1) {
      const col = document.createElement('div');
      col.className = 'col-6 col-md-3 col-lg-2';
      col.innerHTML =
        '<article class="orphan-card card h-100"><div class="card-body p-2">' +
        '<div class="skeleton skeleton-orphan"></div>' +
        '<div class="skeleton skeleton-line short mt-2"></div>' +
        '</div></article>';
      els.orphanGrid.appendChild(col);
    }
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
    els.orphanPageInfo.textContent = 'Página ' + page + ' de ' + totalPages + ' - ' + totalItems + ' figurinhas';
  };

  const listPacks = async ({ reset = false } = {}) => {
    if (state.packs.loading) return;
    state.packs.loading = true;
    updateMoreButton();
    setStatus(reset ? 'Buscando packs...' : 'Carregando mais packs...');
    if (reset) renderPackSkeletons(Math.min(state.packs.limit, 12));

    if (reset) {
      state.packs.offset = 0;
      state.packs.items = [];
    }

    try {
      const payload = await fetchJson(
        toApi(CONFIG.apiBasePath, {
          q: state.q,
          visibility: state.visibility,
          categories: state.categories.join(','),
          limit: state.packs.limit,
          offset: state.packs.offset,
        }),
      );

      const packs = Array.isArray(payload.data) ? payload.data : [];
      state.packs.items = reset ? packs : state.packs.items.concat(packs);
      state.packs.items = rankPacksByCompleteness(state.packs.items);
      state.packs.offset = (payload.pagination && payload.pagination.next_offset) || state.packs.items.length;
      state.packs.hasMore = Boolean(payload.pagination && payload.pagination.has_more);

      renderGrid();

      if (!state.packs.items.length) {
        setStatus('Nenhum pack encontrado com os filtros atuais.');
      } else {
        setStatus(state.packs.items.length + ' pack(s) carregado(s).');
      }
    } catch (error) {
      setStatus(error.message || 'Não foi possível listar os packs agora.');
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
    if (reset) renderOrphanSkeletons(Math.min(state.orphan.limit, 12));

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
          categories: state.categories.join(','),
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
      setOrphanStatus(error.message || 'Não foi possível listar figurinhas sem pack.');
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
      'Página ' + state.panelPagination.page + ' de ' + totalPages + ' - ' + safeTotal + ' stickers';
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
      empty.textContent = 'Este pack não possui stickers disponíveis.';
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
      const tagsOverlay = buildStickerTagsOverlay(item);
      if (tagsOverlay) wrapper.appendChild(tagsOverlay);
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
    els.panelPageInfo.textContent = 'Página 1 de 1 - 0 stickers';
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
    els.panelSub.textContent = (pack.publisher || '-') + ' | ' + (pack.description || 'Sem descrição');
    els.panelChip.textContent = pack.sticker_count + ' itens | ' + pack.visibility + ' | ' + pack.pack_key;
    applyWhatsAppLink(els.useWhatsAppLink, pack?.whatsapp?.url);
    renderPanelStickersPage();

    showPanel();
  };

  const openPack = async (packKey, { pushState = false } = {}) => {
    const sanitizedKey = String(packKey || '').trim();
    if (!sanitizedKey) return;
    showPackPageView();
    els.packPageTitle.textContent = 'Carregando...';
    els.packPageSub.textContent = '';
    els.packPageChip.textContent = '';
    els.packPageGrid.innerHTML = '';
    els.packPageStatus.textContent = 'Buscando informações do pack...';
    applyWhatsAppLink(els.packPageWhatsApp, '');
    applyWhatsAppLink(els.useWhatsAppLink, '');

    try {
      const payload = await fetchJson(
        toApi(CONFIG.apiBasePath + '/' + encodeURIComponent(sanitizedKey), {
          categories: state.categories.join(','),
        }),
      );
      state.selectedPack = payload.data || null;
      if (!state.selectedPack) {
        throw new Error('Pack não encontrado.');
      }

      renderPackPage(state.selectedPack);
      if (pushState) {
        history.pushState({}, '', CONFIG.webPath + '/' + encodeURIComponent(sanitizedKey));
      }
    } catch (error) {
      els.packPageStatus.textContent = error.message || 'Não foi possível abrir este pack.';
    }
  };

  els.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await applyFilters();
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

  els.packPageCopy.addEventListener('click', async () => {
    if (!state.selectedPack) return;
    const url = window.location.origin + CONFIG.webPath + '/' + encodeURIComponent(state.selectedPack.pack_key);
    try {
      await navigator.clipboard.writeText(url);
      els.packPageCopy.textContent = 'Link copiado';
      setTimeout(() => {
        els.packPageCopy.textContent = 'Copiar link do pack';
      }, 1800);
    } catch {
      els.packPageCopy.textContent = 'Falha ao copiar';
    }
  });

  els.packPageBack.addEventListener('click', async () => {
    history.pushState({}, '', CONFIG.webPath);
    showCatalogView();
    if (!state.catalogLoaded) {
      await Promise.all([listPacks({ reset: true }), listOrphanStickers({ reset: true })]);
      state.catalogLoaded = true;
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
    const key = extractPackKeyFromPath();
    if (!key) {
      showCatalogView();
      return;
    }
    openPack(key, { pushState: false });
  });

  (async () => {
    const pathPackKey = extractPackKeyFromPath();
    const initialPackKey = pathPackKey || CONFIG.initialPackKey;
    if (initialPackKey) {
      await openPack(initialPackKey, { pushState: false });
      return;
    }
    showCatalogView();
    await Promise.all([listPacks({ reset: true }), listOrphanStickers({ reset: true })]);
    state.catalogLoaded = true;
  })();
})();
