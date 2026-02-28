const FALLBACK_THUMB_URL = '/assets/images/brand-logo-128.webp';

const shortNum = (value) =>
  new Intl.NumberFormat('pt-BR', {
    notation: Number(value) >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: Number(value) >= 1000 ? 1 : 0,
  }).format(Math.max(0, Number(value) || 0));

const animateCountUp = (element, value, formatter = shortNum, durationMs = 850) => {
  if (!element) return;
  const target = Math.max(0, Number(value) || 0);
  if (!Number.isFinite(target)) {
    element.textContent = formatter(0);
    return;
  }

  if (typeof requestAnimationFrame !== 'function' || typeof performance === 'undefined') {
    element.dataset.value = String(target);
    element.textContent = formatter(target);
    return;
  }

  const previous = Number(element.dataset.value || 0);
  const start = Number.isFinite(previous) ? previous : 0;
  const delta = target - start;
  const startTime = performance.now();
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  const tick = (now) => {
    const progress = Math.min(1, (now - startTime) / durationMs);
    const eased = easeOut(progress);
    const currentValue = start + delta * eased;
    element.textContent = formatter(currentValue);
    if (progress < 1) requestAnimationFrame(tick);
  };

  element.dataset.value = String(target);
  requestAnimationFrame(tick);
};

const runAfterLoadIdle = (callback, { delayMs = 0, timeoutMs = 2200 } = {}) => {
  let cancelled = false;
  let loadListener = null;
  let timeoutId = null;
  let idleId = null;

  const invoke = () => {
    if (cancelled) return;
    callback();
  };

  const schedule = () => {
    if (cancelled) return;

    const queuedInvoke = () => {
      if (cancelled) return;
      if (delayMs > 0) {
        timeoutId = window.setTimeout(invoke, delayMs);
        return;
      }
      invoke();
    };

    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(queuedInvoke, { timeout: timeoutMs });
      return;
    }

    timeoutId = window.setTimeout(queuedInvoke, Math.min(350, delayMs || 120));
  };

  if (document.readyState === 'complete') {
    schedule();
  } else {
    loadListener = () => schedule();
    window.addEventListener('load', loadListener, { once: true });
  }

  return () => {
    cancelled = true;
    if (loadListener) {
      window.removeEventListener('load', loadListener);
    }
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
    if (idleId !== null && typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(idleId);
    }
  };
};

const initMarketplacePreview = () => {
  const proofPacks = document.getElementById('proof-packs');
  const proofStickers = document.getElementById('proof-stickers');
  const proofDownloads = document.getElementById('proof-downloads');
  const proofUsers = document.getElementById('proof-users');
  const proofGroups = document.getElementById('proof-groups');
  const proofSystem = document.getElementById('proof-system');
  const previewStatus = document.getElementById('hero-preview-status');
  const previewGrid = document.getElementById('hero-pack-preview');

  if (
    !proofPacks
    || !proofStickers
    || !proofDownloads
    || !proofUsers
    || !proofGroups
    || !proofSystem
    || !previewStatus
    || !previewGrid
  ) {
    return null;
  }

  const isAutoPack = (pack) =>
    Number(pack?.is_auto_pack || pack?.auto_pack || 0) === 1 || /\[auto\]/i.test(String(pack?.name || ''));

  const renderPreviewSkeleton = (count = 6) => {
    previewGrid.innerHTML = Array.from({ length: count })
      .map(
        () =>
          '<article class="market-pack is-loading">' +
          '<div class="market-pack-skeleton-thumb"></div>' +
          '<div class="market-pack-skeleton-body">' +
          '<span class="market-pack-skeleton-line"></span>' +
          '<span class="market-pack-skeleton-line short"></span>' +
          '</div>' +
          '</article>',
      )
      .join('');
  };

  const renderPreview = (packs) => {
    previewGrid.innerHTML = '';
    if (!Array.isArray(packs) || !packs.length) {
      previewStatus.textContent = 'Sem packs em destaque no momento.';
      return;
    }

    previewStatus.textContent = `${packs.length} packs sugeridos agora`;
    packs.slice(0, 6).forEach((pack, index) => {
      const card = document.createElement('a');
      card.className = 'market-pack reveal';
      card.href = pack.web_url || `/stickers/${encodeURIComponent(pack.pack_key || '')}`;
      card.innerHTML =
        `<img class="market-pack-thumb" loading="lazy" decoding="async" fetchpriority="low" width="320" height="320" src="${pack.cover_url || FALLBACK_THUMB_URL}" alt="${String(
          pack.name || 'Pack',
        ).replace(/"/g, '&quot;')}">` +
        (isAutoPack(pack) ? '<span class="market-pack-tag">auto</span>' : '') +
        '<div class="market-pack-body">' +
        `<p class="market-pack-name">${pack.name || 'Pack sem nome'}</p>` +
        `<p class="market-pack-meta">${shortNum(pack.sticker_count || 0)} stickers · ${shortNum(
          pack?.engagement?.open_count || 0,
        )} aberturas</p>` +
        '</div>';
      card.style.transitionDelay = `${index * 40}ms`;
      previewGrid.appendChild(card);
      requestAnimationFrame(() => card.classList.add('in-view'));
    });
  };

  const loadMarketplaceData = async () => {
    try {
      const [statsResponse, intentsResponse] = await Promise.all([
        fetch('/api/sticker-packs/stats'),
        fetch('/api/sticker-packs/intents?limit=12'),
      ]);

      const statsPayload = statsResponse.ok ? await statsResponse.json() : null;
      const intentsPayload = intentsResponse.ok ? await intentsResponse.json() : null;
      const stats = statsPayload?.data || {};
      const intents = intentsPayload?.data || {};
      const trending = Array.isArray(intents?.em_alta) ? intents.em_alta : [];

      animateCountUp(proofPacks, stats.packs_total || 0);
      animateCountUp(proofStickers, stats.stickers_total || 0);
      animateCountUp(proofDownloads, stats.downloads_total || 0);
      renderPreview(trending);
    } catch {
      proofPacks.textContent = 'n/d';
      proofStickers.textContent = 'n/d';
      proofDownloads.textContent = 'n/d';
      proofUsers.textContent = 'n/d';
      proofGroups.textContent = 'n/d';
      proofSystem.textContent = 'n/d';
      previewGrid.innerHTML = '';
      previewStatus.textContent = 'Não foi possível carregar o preview agora.';
    }
  };

  renderPreviewSkeleton(6);
  return runAfterLoadIdle(() => {
    void loadMarketplaceData();
  }, { timeoutMs: 1200 });
};

const initRankingPanel = () => {
  const summaryEl = document.getElementById('rank-summary');
  const listEl = document.getElementById('rank-list');
  if (!summaryEl || !listEl) return null;

  const formatDate = (value) => {
    const time = Date.parse(String(value || ''));
    if (!Number.isFinite(time)) return 'n/d';
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(time));
  };

  const renderFallback = (message) => {
    summaryEl.textContent = message || 'Ranking indisponível no momento.';
    listEl.innerHTML = '<li class="rank-item"><span class="rank-name">Sem dados no momento</span><span class="rank-value">--</span></li>';
  };

  const renderRanking = (data) => {
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const topType = data?.top_type ? `${data.top_type} (${data.top_type_count || 0})` : 'N/D';
    summaryEl.textContent =
      `Top recentes: ${Number(data?.top_share_percent || 0).toFixed(
        2,
      )}% das ${Number(data?.total_messages || 0)} mensagens · Tipo mais usado: ${topType} · Janela: ${Number(
        data?.sample_limit || 0,
      )} msgs · Atualizado: ${formatDate(
        data?.updated_at,
      )}`;

    if (!rows.length) {
      renderFallback('Ainda não há mensagens suficientes para o ranking global.');
      return;
    }

    listEl.innerHTML = '';
    rows.forEach((row) => {
      const item = document.createElement('li');
      item.className = 'rank-item';
      const userWrap = document.createElement('span');
      userWrap.className = 'rank-user';
      const avatar = document.createElement('img');
      avatar.className = 'rank-avatar';
      avatar.alt = row.display_name || 'Usuário';
      avatar.loading = 'lazy';
      avatar.decoding = 'async';
      avatar.setAttribute('fetchpriority', 'low');
      avatar.width = 34;
      avatar.height = 34;
      avatar.src = row.avatar_url || FALLBACK_THUMB_URL;
      avatar.onerror = () => {
        avatar.src = FALLBACK_THUMB_URL;
      };
      const name = document.createElement('span');
      name.className = 'rank-name';
      name.textContent = `${row.position}. ${row.display_name || 'Desconhecido'}`;
      userWrap.append(avatar, name);
      const value = document.createElement('span');
      value.className = 'rank-value';
      value.textContent = `${Number(row.total_messages || 0)} msg · ${Number(row.percent_of_total || 0).toFixed(2)}%`;
      item.append(userWrap, value);
      listEl.appendChild(item);
    });
  };

  const loadRanking = () =>
    fetch('/api/sticker-packs/global-ranking-summary')
      .then((response) => {
        if (!response.ok) throw new Error('Falha ao carregar ranking');
        return response.json();
      })
      .then((payload) => {
        renderRanking(payload?.data || {});
      })
      .catch(() => {
        renderFallback('Ranking indisponível no momento.');
      });

  let intervalId = null;
  const cancelScheduledLoad = runAfterLoadIdle(() => {
    void loadRanking();
    intervalId = window.setInterval(() => {
      void loadRanking();
    }, 10 * 60 * 1000);
  }, { delayMs: 450, timeoutMs: 2200 });

  return () => {
    cancelScheduledLoad();
    if (intervalId !== null) {
      window.clearInterval(intervalId);
    }
  };
};

const initNavToggle = () => {
  const toggle = document.getElementById('nav-toggle');
  const nav = document.getElementById('main-nav');
  if (!toggle || !nav) return null;

  const handleClick = () => {
    const isOpen = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  };

  toggle.addEventListener('click', handleClick);
  return () => toggle.removeEventListener('click', handleClick);
};

const initAuthSession = () => {
  const authLink = document.getElementById('nav-auth-link');
  const schedulerLink = document.getElementById('nav-scheduler-link');
  const heroLoginCta = document.getElementById('hero-login-cta');
  if (!authLink) return null;

  const clearChildren = (node) => {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  };

  const showLoginButton = () => {
    document.body.classList.remove('home-authenticated');
    authLink.classList.remove('nav-user-chip');
    authLink.href = '/login/';
    authLink.removeAttribute('title');
    authLink.removeAttribute('aria-label');
    clearChildren(authLink);

    if (schedulerLink) {
      schedulerLink.hidden = false;
      schedulerLink.removeAttribute('aria-hidden');
    }

    if (heroLoginCta) {
      heroLoginCta.hidden = false;
      heroLoginCta.removeAttribute('aria-hidden');
    }

    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-right-to-bracket icon-inline';
    icon.setAttribute('aria-hidden', 'true');
    authLink.append(icon, document.createTextNode('Login'));
  };

  const showLoggedUser = (sessionData) => {
    const profile = sessionData?.user || {};
    const resolvedName = String(profile?.name || profile?.email || 'Conta Google').trim() || 'Conta Google';
    const resolvedPhoto = String(profile?.picture || '').trim() || FALLBACK_THUMB_URL;

    document.body.classList.add('home-authenticated');
    authLink.classList.add('nav-user-chip');
    authLink.href = '/user/';
    authLink.title = `${resolvedName} (sessão ativa)`;
    authLink.setAttribute('aria-label', `Sessão ativa de ${resolvedName}`);
    clearChildren(authLink);

    if (schedulerLink) {
      schedulerLink.hidden = true;
      schedulerLink.setAttribute('aria-hidden', 'true');
    }

    if (heroLoginCta) {
      heroLoginCta.hidden = true;
      heroLoginCta.setAttribute('aria-hidden', 'true');
    }

    const avatarBubble = document.createElement('span');
    avatarBubble.className = 'nav-user-avatar-bubble';

    const photo = document.createElement('img');
    photo.className = 'nav-user-photo';
    photo.src = resolvedPhoto;
    photo.alt = `Foto de ${resolvedName}`;
    photo.loading = 'lazy';
    photo.decoding = 'async';
    photo.setAttribute('fetchpriority', 'low');
    photo.width = 34;
    photo.height = 34;
    photo.onerror = () => {
      photo.src = FALLBACK_THUMB_URL;
    };
    avatarBubble.appendChild(photo);

    const nameBubble = document.createElement('span');
    nameBubble.className = 'nav-user-name-bubble';

    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-user nav-user-icon';
    icon.setAttribute('aria-hidden', 'true');

    const name = document.createElement('span');
    name.className = 'nav-user-name';
    name.textContent = resolvedName;

    nameBubble.append(icon, name);
    authLink.append(avatarBubble, nameBubble);
  };

  return runAfterLoadIdle(() => {
    fetch('/api/sticker-packs/auth/google/session', { credentials: 'include' })
      .then((response) => {
        if (!response.ok) throw new Error('Sessão indisponível');
        return response.json();
      })
      .then((payload) => {
        const sessionData = payload?.data || {};
        if (!sessionData?.authenticated || !sessionData?.user?.sub) {
          showLoginButton();
          return;
        }
        showLoggedUser(sessionData);
      })
      .catch(() => {
        showLoginButton();
      });
  }, { delayMs: 200, timeoutMs: 1400 });
};

const initWhatsappFloatingButton = () => {
  const wppButton = document.getElementById('wpp-float');
  if (!wppButton) return null;

  const command = 'iniciar';
  const normalizeDigits = (value) => String(value || '').replace(/\D+/g, '');
  const buildUrl = (phone) => `https://wa.me/${phone}?text=${encodeURIComponent(command)}`;
  const applyLink = (phone) => {
    const digits = normalizeDigits(phone);
    if (!digits) return false;
    wppButton.href = buildUrl(digits);
    wppButton.hidden = false;
    return true;
  };

  return runAfterLoadIdle(() => {
    fetch('/api/sticker-packs?visibility=public&limit=1')
      .then((response) => {
        if (!response.ok) throw new Error('Falha ao buscar bot');
        return response.json();
      })
      .then((payload) => {
        const firstPack = Array.isArray(payload?.data) ? payload.data[0] : null;
        const phone = firstPack?.whatsapp?.phone || '';
        applyLink(phone);
      })
      .catch(() => {
        wppButton.hidden = true;
      });
  }, { delayMs: 500, timeoutMs: 2400 });
};

const initSystemSummary = () => {
  const cpuEl = document.getElementById('metric-host-cpu');
  const memEl = document.getElementById('metric-host-memory');
  const uptimeEl = document.getElementById('metric-process-uptime');
  const obsEl = document.getElementById('metric-observability');
  const proofUsers = document.getElementById('proof-users');
  const proofGroups = document.getElementById('proof-groups');
  const proofSystem = document.getElementById('proof-system');
  if (!cpuEl || !memEl || !uptimeEl || !obsEl) return null;

  const normalizeStatus = (value) => {
    const normalized = String(value || '')
      .trim()
      .toLowerCase();
    if (!normalized) return 'degraded';
    if (['online', 'healthy', 'ok'].includes(normalized)) return 'online';
    if (['offline', 'down', 'disconnected'].includes(normalized)) return 'offline';
    if (['connecting', 'opening', 'reconnecting'].includes(normalized)) return 'connecting';
    return 'degraded';
  };

  const formatSystemStatusLabel = (status) => {
    if (status === 'online') return 'online';
    if (status === 'offline') return 'offline';
    if (status === 'connecting') return 'conectando';
    return 'instável';
  };

  const setFallback = () => {
    cpuEl.textContent = 'CPU host: n/d';
    memEl.textContent = 'RAM host: n/d';
    uptimeEl.textContent = 'Uptime processo: n/d';
    obsEl.textContent = 'Observabilidade: API em /api/sticker-packs';
    if (proofUsers) proofUsers.textContent = 'n/d';
    if (proofGroups) proofGroups.textContent = 'n/d';
    if (proofSystem) {
      proofSystem.textContent = 'n/d';
      const card = proofSystem.closest('.proof-card');
      if (card) card.dataset.status = 'degraded';
    }
  };

  const fmt = (value) => (Number.isFinite(value) ? value.toFixed(2) : 'n/d');

  return runAfterLoadIdle(() => {
    fetch('/api/sticker-packs/system-summary')
      .then((response) => {
        if (!response.ok) throw new Error('Falha ao carregar métricas');
        return response.json();
      })
      .then((payload) => {
        const data = payload && payload.data ? payload.data : {};
        const host = data.host || {};
        const process = data.process || {};
        const observability = data.observability || {};
        const platform = data.platform || {};
        const bot = data.bot || {};
        const systemStatus = normalizeStatus(data.system_status || bot.connection_status);

        cpuEl.textContent = 'CPU host: ' + fmt(Number(host.cpu_percent)) + '%';
        memEl.textContent =
          'RAM host: ' +
          String(host.memory_used || 'n/d') +
          ' / ' +
          String(host.memory_total || 'n/d') +
          ' (' +
          fmt(Number(host.memory_percent)) +
          '%)';
        uptimeEl.textContent = 'Uptime processo: ' + String(process.uptime || 'n/d');

        const lag = Number(observability.lag_p99_ms);
        const dbTotal = observability.db_total;
        const dbSlow = observability.db_slow;
        obsEl.textContent =
          'Lag p99: ' +
          (Number.isFinite(lag) ? lag.toFixed(2) + 'ms' : 'n/d') +
          ' | DB slow: ' +
          (Number.isFinite(Number(dbSlow)) && Number.isFinite(Number(dbTotal)) ? String(dbSlow) + '/' + String(dbTotal) : 'n/d');

        if (proofUsers) animateCountUp(proofUsers, platform.total_users || 0);
        if (proofGroups) animateCountUp(proofGroups, platform.total_groups || 0);
        if (proofSystem) {
          proofSystem.textContent = formatSystemStatusLabel(systemStatus);
          const card = proofSystem.closest('.proof-card');
          if (card) card.dataset.status = systemStatus;
        }
      })
      .catch(() => {
        setFallback();
      });
  }, { delayMs: 650, timeoutMs: 2600 });
};

const initRevealAnimations = () => {
  const rawTargets = Array.from(
    document.querySelectorAll(
      '.market-preview, .section-title, .grid .card, .api, .rank-panel, .final-cta, .hero-stats .chip',
    ),
  );
  if (!rawTargets.length) return null;

  const viewportHeight = window.innerHeight || 0;
  const revealTargets = rawTargets.filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.top > viewportHeight * 0.7;
  });
  if (!revealTargets.length) return null;

  revealTargets.forEach((element) => element.classList.add('reveal'));
  if (typeof IntersectionObserver !== 'function') {
    revealTargets.forEach((element) => element.classList.add('in-view'));
    return null;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        }
      });
    },
    {
      root: null,
      threshold: 0.14,
      rootMargin: '0px 0px -8% 0px',
    },
  );

  revealTargets.forEach((element) => observer.observe(element));
  return () => observer.disconnect();
};

const registerCleanup = (cleanups, cleanupFn) => {
  if (typeof cleanupFn === 'function') {
    cleanups.push(cleanupFn);
  }
};

const initHomeApp = () => {
  if (window.__omnizapHomeAppReady) return;
  window.__omnizapHomeAppReady = true;

  const cleanups = [];
  registerCleanup(cleanups, initMarketplacePreview());
  registerCleanup(cleanups, initRankingPanel());
  registerCleanup(cleanups, initNavToggle());
  registerCleanup(cleanups, initAuthSession());
  registerCleanup(cleanups, initWhatsappFloatingButton());
  registerCleanup(cleanups, initSystemSummary());
  registerCleanup(cleanups, initRevealAnimations());

  window.addEventListener(
    'pagehide',
    () => {
      cleanups.forEach((cleanupFn) => {
        try {
          cleanupFn();
        } catch {
          // no-op
        }
      });
    },
    { once: true },
  );
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initHomeApp, { once: true });
} else {
  initHomeApp();
}
