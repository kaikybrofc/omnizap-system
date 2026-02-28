const FALLBACK_THUMB_URL = '/assets/images/brand-logo-128.webp';
const HOME_BOOTSTRAP_ENDPOINT = '/api/sticker-packs/home-bootstrap';
const SVG_NS = 'http://www.w3.org/2000/svg';
let homeBootstrapPayloadPromise = null;

const fetchHomeBootstrapPayload = async () => {
  if (!homeBootstrapPayloadPromise) {
    homeBootstrapPayloadPromise = fetch(HOME_BOOTSTRAP_ENDPOINT, { credentials: 'include' })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((payload) => payload?.data || {})
      .catch((error) => {
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

  const onClick = () => {
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
  const heroLoginCta = document.getElementById('hero-login-cta');
  const finalLoginCta = document.getElementById('final-login-cta');
  if (!authLink) return null;

  const clearChildren = (node) => {
    while (node.firstChild) node.removeChild(node.firstChild);
  };

  const setLoginState = () => {
    authLink.classList.remove('nav-user-chip');
    authLink.href = '/login/';
    authLink.removeAttribute('title');
    authLink.removeAttribute('aria-label');
    clearChildren(authLink);

    const icon = createIcon('icon-login');

    authLink.append(icon, document.createTextNode('Entrar'));

    if (heroLoginCta) {
      heroLoginCta.hidden = false;
      heroLoginCta.removeAttribute('aria-hidden');
    }
    if (finalLoginCta) {
      finalLoginCta.hidden = false;
      finalLoginCta.removeAttribute('aria-hidden');
    }
  };

  const setLoggedState = (sessionData) => {
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

    const nameBubble = document.createElement('span');
    nameBubble.className = 'nav-user-name-bubble';

    const icon = createIcon('icon-user', 'icon nav-user-icon');

    const name = document.createElement('span');
    name.className = 'nav-user-name';
    name.textContent = resolvedName;

    nameBubble.append(icon, name);
    authLink.append(avatarBubble, nameBubble);

    if (heroLoginCta) {
      heroLoginCta.hidden = true;
      heroLoginCta.setAttribute('aria-hidden', 'true');
    }
    if (finalLoginCta) {
      finalLoginCta.hidden = true;
      finalLoginCta.setAttribute('aria-hidden', 'true');
    }
  };

  return runAfterLoadIdle(
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
          const url = String(bootstrapData?.support?.url || '').trim();
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
  const packsEl = document.getElementById('proof-packs');
  const stickersEl = document.getElementById('proof-stickers');
  const groupsEl = document.getElementById('proof-groups');
  const statusEl = document.getElementById('proof-status');

  if (!packsEl || !stickersEl || !groupsEl) return null;

  const setFallback = () => {
    packsEl.textContent = 'n/d';
    stickersEl.textContent = 'n/d';
    groupsEl.textContent = 'n/d';
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

  return runAfterLoadIdle(
    () => {
      fetchHomeBootstrapPayload()
        .then((bootstrapData) => {
          const stats = bootstrapData?.stats || {};
          const summary = bootstrapData?.system_summary || {};

          animateCountUp(packsEl, Number(stats.packs_total || 0));
          animateCountUp(stickersEl, Number(stats.stickers_total || 0));
          animateCountUp(groupsEl, Number(summary?.platform?.total_groups || 0));

          if (statusEl) {
            statusEl.textContent = `bot ${normalizeStatus(summary?.system_status || summary?.bot?.connection_status)}`;
          }
        })
        .catch(() => {
          setFallback();
        });
    },
    { delayMs: 620, timeoutMs: 1500 },
  );
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
