const FALLBACK_THUMB_URL = '/assets/images/brand-logo-128.webp';
const HOME_BOOTSTRAP_ENDPOINT = '/api/sticker-packs/home-bootstrap';
const SVG_NS = 'http://www.w3.org/2000/svg';
const SOCIAL_PROOF_REFRESH_MS = 15_000;
let homeBootstrapPayloadPromise = null;

const loadHomeBootstrapPayload = async () => {
  const response = await fetch(HOME_BOOTSTRAP_ENDPOINT, { credentials: 'include' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return payload?.data || {};
};

const fetchHomeBootstrapPayload = async ({ forceRefresh = false } = {}) => {
  if (forceRefresh) {
    const freshData = await loadHomeBootstrapPayload();
    homeBootstrapPayloadPromise = Promise.resolve(freshData);
    return freshData;
  }

  if (!homeBootstrapPayloadPromise) {
    homeBootstrapPayloadPromise = loadHomeBootstrapPayload().catch((error) => {
      homeBootstrapPayloadPromise = null;
      throw error;
    });
  }
  return homeBootstrapPayloadPromise;
};

const createIcon = (iconId, className = 'icon') => {
  const wrapper = document.createElement('span');
  wrapper.className = className;
  wrapper.setAttribute('aria-hidden', 'true');

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('focusable', 'false');

  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${iconId}`);

  svg.appendChild(use);
  wrapper.appendChild(svg);
  return wrapper;
};

const shortNum = (value) =>
  new Intl.NumberFormat('pt-BR', {
    notation: Number(value) >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: Number(value) >= 1000 ? 1 : 0,
  }).format(Math.max(0, Number(value) || 0));

const animateCountUp = (element, value, durationMs = 780) => {
  if (!element) return;

  const target = Math.max(0, Number(value) || 0);
  if (!Number.isFinite(target)) {
    element.textContent = shortNum(0);
    return;
  }

  if (typeof requestAnimationFrame !== 'function' || typeof performance === 'undefined') {
    element.textContent = shortNum(target);
    element.dataset.value = String(target);
    return;
  }

  const previous = Number(element.dataset.value || 0);
  const start = Number.isFinite(previous) ? previous : 0;
  const delta = target - start;
  const startAt = performance.now();

  const tick = (now) => {
    const progress = Math.min(1, (now - startAt) / durationMs);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = start + delta * eased;
    element.textContent = shortNum(current);
    if (progress < 1) {
      requestAnimationFrame(tick);
      return;
    }
    element.dataset.value = String(target);
  };

  requestAnimationFrame(tick);
};

const runAfterLoadIdle = (callback, { delayMs = 0, timeoutMs = 1800 } = {}) => {
  let cancelled = false;
  let timeoutId = null;
  let idleId = null;
  let loadHandler = null;

  const run = () => {
    if (cancelled) return;
    callback();
  };

  const schedule = () => {
    if (cancelled) return;

    const invoke = () => {
      if (cancelled) return;
      if (delayMs > 0) {
        timeoutId = window.setTimeout(run, delayMs);
        return;
      }
      run();
    };

    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(invoke, { timeout: timeoutMs });
      return;
    }

    timeoutId = window.setTimeout(invoke, Math.min(240, delayMs || 120));
  };

  if (document.readyState === 'complete') {
    schedule();
  } else {
    loadHandler = () => schedule();
    window.addEventListener('load', loadHandler, { once: true });
  }

  return () => {
    cancelled = true;
    if (timeoutId !== null) window.clearTimeout(timeoutId);
    if (idleId !== null && typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(idleId);
    }
    if (loadHandler) {
      window.removeEventListener('load', loadHandler);
    }
  };
};

const initNavToggle = () => {
  const toggle = document.getElementById('nav-toggle');
  const nav = document.getElementById('main-nav');
  if (!toggle || !nav) return null;

  const closeMenu = () => {
    nav.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  };

  const onClick = (event) => {
    if (toggle.classList.contains('nav-toggle-login')) {
      if (event) event.preventDefault();
      closeMenu();
      const loginUrl = String(toggle.dataset.loginUrl || '/login/').trim() || '/login/';
      window.location.assign(loginUrl);
      return;
    }
    if (toggle.classList.contains('nav-toggle-user')) {
      if (event) event.preventDefault();
      closeMenu();
      const profileUrl = String(toggle.dataset.profileUrl || '/user/').trim() || '/user/';
      window.location.assign(profileUrl);
      return;
    }
    const isOpen = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  };

  const onNavClick = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const link = target.closest('a[href]');
    if (!link) return;

    closeMenu();
  };

  toggle.addEventListener('click', onClick);
  nav.addEventListener('click', onNavClick);

  return () => {
    toggle.removeEventListener('click', onClick);
    nav.removeEventListener('click', onNavClick);
  };
};

const initAuthSession = () => {
  const authLink = document.getElementById('nav-auth-link');
  const schedulerLink = document.getElementById('nav-scheduler-link');
  const navToggle = document.getElementById('nav-toggle');
  if (!authLink) return null;

  const mobileQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 920px)') : null;
  let currentSessionData = null;
  let isAuthenticated = false;
  const isMobileViewport = () => {
    const byMedia = Boolean(mobileQuery?.matches);
    const viewportWidth = Math.max(Number(window.innerWidth || 0), Number(document.documentElement?.clientWidth || 0));
    return byMedia || (viewportWidth > 0 && viewportWidth <= 920);
  };
  const schedulerDefaultHref = String(schedulerLink?.getAttribute('href') || '#beneficios').trim() || '#beneficios';
  const schedulerDefaultLabel = String(schedulerLink?.textContent || 'Benefícios').trim() || 'Benefícios';
  const navToggleDefaultLabel = String(navToggle?.textContent || '☰').trim() || '☰';

  const clearChildren = (node) => {
    while (node.firstChild) node.removeChild(node.firstChild);
  };

  const setSchedulerDefaultState = () => {
    if (!schedulerLink) return;
    schedulerLink.classList.remove('nav-user-chip');
    schedulerLink.href = schedulerDefaultHref;
    schedulerLink.removeAttribute('title');
    schedulerLink.removeAttribute('aria-label');
    clearChildren(schedulerLink);
    schedulerLink.append(document.createTextNode(schedulerDefaultLabel));
  };

  const setToggleDefaultState = () => {
    if (!navToggle) return;
    navToggle.classList.remove('nav-toggle-user', 'nav-toggle-login');
    delete navToggle.dataset.profileUrl;
    delete navToggle.dataset.loginUrl;
    navToggle.setAttribute('aria-label', 'Abrir menu');
    navToggle.setAttribute('aria-controls', 'main-nav');
    navToggle.setAttribute('aria-expanded', 'false');
    clearChildren(navToggle);
    navToggle.append(document.createTextNode(navToggleDefaultLabel));
  };

  const setToggleLoginState = () => {
    if (!navToggle) return;
    navToggle.classList.remove('nav-toggle-user');
    navToggle.classList.add('nav-toggle-login');
    delete navToggle.dataset.profileUrl;
    navToggle.dataset.loginUrl = '/login/';
    navToggle.setAttribute('aria-label', 'Entrar');
    navToggle.removeAttribute('aria-controls');
    navToggle.removeAttribute('aria-expanded');
    clearChildren(navToggle);
    navToggle.append(document.createTextNode('Entrar'));
  };

  const setSchedulerAsUserBubble = (sessionData) => {
    if (!schedulerLink) return;

    const profile = sessionData?.user || {};
    const resolvedName = String(profile?.name || profile?.email || 'Conta Google').trim() || 'Conta Google';
    const resolvedPhoto = String(profile?.picture || '').trim() || FALLBACK_THUMB_URL;

    schedulerLink.classList.add('nav-user-chip');
    schedulerLink.href = '/user/';
    schedulerLink.title = `${resolvedName} (sessão ativa)`;
    schedulerLink.setAttribute('aria-label', `Sessão ativa de ${resolvedName}`);
    clearChildren(schedulerLink);

    const avatarBubble = document.createElement('span');
    avatarBubble.className = 'nav-user-avatar-bubble';

    const photo = document.createElement('img');
    photo.className = 'nav-user-photo';
    photo.src = resolvedPhoto;
    photo.alt = `Foto de ${resolvedName}`;
    photo.loading = 'lazy';
    photo.decoding = 'async';
    photo.width = 34;
    photo.height = 34;
    photo.onerror = () => {
      photo.src = FALLBACK_THUMB_URL;
    };
    avatarBubble.appendChild(photo);
    schedulerLink.append(avatarBubble);
  };

  const setToggleAsUserBubble = (sessionData) => {
    if (!navToggle) return;

    const profile = sessionData?.user || {};
    const resolvedName = String(profile?.name || profile?.email || 'Conta Google').trim() || 'Conta Google';
    const resolvedPhoto = String(profile?.picture || '').trim() || FALLBACK_THUMB_URL;

    navToggle.classList.remove('nav-toggle-login');
    navToggle.classList.add('nav-toggle-user');
    navToggle.dataset.profileUrl = '/user/';
    delete navToggle.dataset.loginUrl;
    navToggle.setAttribute('aria-label', `Abrir perfil de ${resolvedName}`);
    navToggle.removeAttribute('aria-controls');
    navToggle.removeAttribute('aria-expanded');
    clearChildren(navToggle);

    const photo = document.createElement('img');
    photo.className = 'nav-toggle-photo';
    photo.src = resolvedPhoto;
    photo.alt = `Foto de ${resolvedName}`;
    photo.loading = 'lazy';
    photo.decoding = 'async';
    photo.width = 40;
    photo.height = 40;
    photo.onerror = () => {
      photo.src = FALLBACK_THUMB_URL;
    };
    navToggle.append(photo);
  };

  const applyLoggedOutLayout = () => {
    setSchedulerDefaultState();
    if (isMobileViewport()) {
      authLink.classList.add('nav-mobile-hidden');
      setToggleLoginState();
      return;
    }
    authLink.classList.remove('nav-mobile-hidden');
    setToggleDefaultState();
  };

  const setLoginState = () => {
    currentSessionData = null;
    isAuthenticated = false;
    authLink.classList.remove('nav-user-chip');
    authLink.classList.remove('nav-mobile-hidden');
    authLink.href = '/login/';
    authLink.removeAttribute('title');
    authLink.removeAttribute('aria-label');
    clearChildren(authLink);

    const icon = createIcon('icon-login');

    authLink.append(icon, document.createTextNode('Entrar'));
    applyLoggedOutLayout();
  };

  const applyLoggedLayout = () => {
    if (!currentSessionData) return;

    const sessionData = currentSessionData;
    const profile = sessionData?.user || {};
    const resolvedName = String(profile?.name || profile?.email || 'Conta Google').trim() || 'Conta Google';
    const resolvedPhoto = String(profile?.picture || '').trim() || FALLBACK_THUMB_URL;

    authLink.classList.add('nav-user-chip');
    authLink.href = '/user/';
    authLink.title = `${resolvedName} (sessão ativa)`;
    authLink.setAttribute('aria-label', `Sessão ativa de ${resolvedName}`);
    clearChildren(authLink);

    const avatarBubble = document.createElement('span');
    avatarBubble.className = 'nav-user-avatar-bubble';

    const photo = document.createElement('img');
    photo.className = 'nav-user-photo';
    photo.src = resolvedPhoto;
    photo.alt = `Foto de ${resolvedName}`;
    photo.loading = 'lazy';
    photo.decoding = 'async';
    photo.width = 34;
    photo.height = 34;
    photo.onerror = () => {
      photo.src = FALLBACK_THUMB_URL;
    };
    avatarBubble.appendChild(photo);
    authLink.append(avatarBubble);

    if (isMobileViewport()) {
      setSchedulerAsUserBubble(sessionData);
      setToggleAsUserBubble(sessionData);
      authLink.classList.add('nav-mobile-hidden');
      return;
    }

    authLink.classList.remove('nav-mobile-hidden');
    setSchedulerDefaultState();
    setToggleDefaultState();
  };

  const setLoggedState = (sessionData) => {
    currentSessionData = sessionData || null;
    isAuthenticated = true;
    applyLoggedLayout();
  };

  const onViewportChange = () => {
    if (isAuthenticated) {
      applyLoggedLayout();
      return;
    }
    applyLoggedOutLayout();
  };

  if (mobileQuery && typeof mobileQuery.addEventListener === 'function') {
    mobileQuery.addEventListener('change', onViewportChange);
  } else if (mobileQuery && typeof mobileQuery.addListener === 'function') {
    mobileQuery.addListener(onViewportChange);
  }
  window.addEventListener('resize', onViewportChange);

  const stopBootstrap = runAfterLoadIdle(
    () => {
      fetchHomeBootstrapPayload()
        .then((bootstrapData) => {
          const sessionData = bootstrapData?.session || {};
          if (!sessionData?.authenticated || !sessionData?.user?.sub) {
            setLoginState();
            return;
          }
          setLoggedState(sessionData);
        })
        .catch(() => {
          setLoginState();
        });
    },
    { delayMs: 520, timeoutMs: 1200 },
  );

  return () => {
    stopBootstrap();
    window.removeEventListener('resize', onViewportChange);
    if (mobileQuery && typeof mobileQuery.removeEventListener === 'function') {
      mobileQuery.removeEventListener('change', onViewportChange);
    } else if (mobileQuery && typeof mobileQuery.removeListener === 'function') {
      mobileQuery.removeListener(onViewportChange);
    }
  };
};

const initAddBotCtas = () => {
  const ctas = Array.from(document.querySelectorAll('[data-add-bot-cta]'));
  const floatButton = document.getElementById('wpp-float');
  if (!ctas.length && !floatButton) return null;

  const applyLink = (url) => {
    const safeUrl = String(url || '').trim();
    if (!safeUrl) return false;

    ctas.forEach((element) => {
      element.href = safeUrl;
      element.target = '_blank';
      element.rel = 'noreferrer noopener';
    });

    if (floatButton) {
      floatButton.href = safeUrl;
      floatButton.hidden = false;
    }
    return true;
  };

  return runAfterLoadIdle(
    () => {
      fetchHomeBootstrapPayload()
        .then((bootstrapData) => {
          const url = String(bootstrapData?.bot_contact?.urls?.menu || '').trim();
          const applied = applyLink(url);
          if (!applied && floatButton) {
            floatButton.hidden = true;
          }
        })
        .catch(() => {
          if (floatButton) floatButton.hidden = true;
        });
    },
    { delayMs: 480, timeoutMs: 1400 },
  );
};

const initSocialProof = () => {
  const botsOnlineEl = document.getElementById('proof-bots-online');
  const messagesTodayEl = document.getElementById('proof-messages-today');
  const spamBlockedEl = document.getElementById('proof-spam-blocked');
  const uptimeEl = document.getElementById('proof-uptime');
  const statusEl = document.getElementById('proof-status');

  if (!botsOnlineEl || !messagesTodayEl || !spamBlockedEl || !uptimeEl) return null;

  const setFallback = () => {
    botsOnlineEl.textContent = 'n/d';
    messagesTodayEl.textContent = 'n/d';
    spamBlockedEl.textContent = 'n/d';
    uptimeEl.textContent = 'n/d';
    if (statusEl) statusEl.textContent = 'bot pronto';
  };

  const normalizeStatus = (value) => {
    const normalized = String(value || '')
      .trim()
      .toLowerCase();
    if (!normalized) return 'pronto';
    if (['online', 'ok', 'healthy'].includes(normalized)) return 'online';
    if (['connecting', 'opening', 'reconnecting'].includes(normalized)) return 'conectando';
    if (['offline', 'down'].includes(normalized)) return 'instável';
    return 'pronto';
  };

  const setNumericMetric = (element, value, { animate = true } = {}) => {
    const hasValue = value !== null && value !== undefined && value !== '';
    const numeric = hasValue ? Number(value) : Number.NaN;
    if (!hasValue || !Number.isFinite(numeric)) {
      element.textContent = 'n/d';
      return;
    }
    if (!animate) {
      element.textContent = shortNum(numeric);
      element.dataset.value = String(Math.max(0, numeric));
      return;
    }
    animateCountUp(element, numeric);
  };

  const refreshMetrics = async ({ forceRefresh = false, animate = false } = {}) => {
    const bootstrapData = await fetchHomeBootstrapPayload({ forceRefresh });
    const summary = bootstrapData?.system_summary || {};
    const realtime = bootstrapData?.home_realtime || {};

    const botsOnline = Number(realtime?.bots_online);
    const messagesToday = Number(realtime?.messages_today);
    const spamBlockedToday = Number(realtime?.spam_blocked_today);
    const uptime = String(realtime?.uptime || summary?.process?.uptime || '').trim() || 'n/d';

    setNumericMetric(botsOnlineEl, botsOnline, { animate });
    setNumericMetric(messagesTodayEl, messagesToday, { animate });
    setNumericMetric(spamBlockedEl, spamBlockedToday, { animate });
    uptimeEl.textContent = uptime;

    if (statusEl) {
      statusEl.textContent = `bot ${normalizeStatus(summary?.system_status || summary?.bot?.connection_status)}`;
    }
  };

  let intervalId = null;
  const stopBootstrap = runAfterLoadIdle(
    () => {
      void refreshMetrics({ forceRefresh: false, animate: true }).catch(() => {
        setFallback();
      });
    },
    { delayMs: 620, timeoutMs: 1500 },
  );

  intervalId = window.setInterval(() => {
    void refreshMetrics({ forceRefresh: true, animate: false }).catch(() => {});
  }, SOCIAL_PROOF_REFRESH_MS);

  return () => {
    stopBootstrap();
    if (intervalId !== null) {
      window.clearInterval(intervalId);
    }
  };
};

const registerCleanup = (cleanups, cleanup) => {
  if (typeof cleanup === 'function') cleanups.push(cleanup);
};

const initHomeApp = () => {
  if (window.__omnizapHomeAppReady) return;
  window.__omnizapHomeAppReady = true;

  const cleanups = [];
  registerCleanup(cleanups, initNavToggle());
  registerCleanup(cleanups, initAuthSession());
  registerCleanup(cleanups, initAddBotCtas());
  registerCleanup(cleanups, initSocialProof());

  window.addEventListener(
    'pagehide',
    () => {
      cleanups.forEach((cleanup) => {
        try {
          cleanup();
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
