/* global document, window, fetch */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';

const html = htm.bind(React.createElement);

const FALLBACK_THUMB_URL = '/assets/images/brand-logo-128.webp';
const HOME_BOOTSTRAP_ENDPOINT = '/api/sticker-packs/home-bootstrap';
const SOCIAL_PROOF_REFRESH_MS = 15_000;
const COUNTUP_DURATION_MS = 780;
const COUNTABLE_METRICS = ['users', 'messages', 'commands'];
const DEFAULT_METRICS = {
  users: 'n/d',
  messages: 'n/d',
  commands: 'n/d',
  latency: 'n/d',
  status: 'bot pronto',
};

const NAV_ITEMS = [
  { href: '#como-funciona', label: 'Como funciona' },
  { href: '#recursos', label: 'Recursos' },
  { href: '#comandos', label: 'Comandos' },
  { href: '#para-quem', label: 'Para quem' },
  { href: '/stickers/', label: 'Stickers' },
  { href: '#guias', label: 'Guias' },
  { href: '#faq', label: 'FAQ' },
  { id: 'nav-scheduler-link', href: '#beneficios', label: 'Benefícios' },
];

const COMMAND_BLOCKS = [
  {
    title: '🛡️ Moderação',
    items: [
      ['/ban', 'Remove membros problemáticos'],
      ['/captcha', 'Proteção contra bots'],
      ['/setgroup', 'Ativa modo restrito'],
      ['/welcome', 'Boas-vindas automáticas'],
      ['/farewell', 'Avisa quando alguém sai'],
    ],
  },
  {
    title: '🎨 Figurinhas',
    items: [
      ['/sticker', 'Cria figurinha'],
      ['/stickertext', 'Figurinha com texto'],
      ['/pack create', 'Cria pack de stickers'],
      ['/pack send', 'Envia pack no grupo'],
      ['/toimg', 'Converte figurinha em imagem'],
    ],
  },
  {
    title: '🎮 Engajamento',
    items: [
      ['/ranking', 'Ranking do grupo'],
      ['/rankingglobal', 'Ranking global'],
      ['/dado', 'Jogo de dados'],
      ['/quote', 'Cita mensagem com estilo'],
      ['/user perfil', 'Resumo do perfil'],
    ],
  },
  {
    title: '🎵 Mídia',
    items: [
      ['/play', 'Toca música'],
      ['/playvid', 'Toca vídeo'],
      ['/tiktok', 'Baixa vídeo do TikTok'],
      ['/down', 'Faz download de mídia'],
      ['/menu', 'Atalho para todos os comandos'],
    ],
  },
  {
    title: '🤖 Utilidades inteligentes',
    items: [
      ['/menu ia', 'Recursos de IA'],
      ['/autorequests', 'Respostas automáticas'],
      ['/noticias', 'Notícias no grupo'],
      ['/metadata', 'Informações técnicas'],
      ['/ping', 'Status do bot'],
    ],
  },
];

const GUIDES = [
  ['/bot-whatsapp-para-grupo/', 'Bot para grupo de WhatsApp', 'Guia de entrada rápida'],
  ['/como-moderar-grupo-whatsapp/', 'Como moderar grupo no WhatsApp', 'Fluxo prático sem sobrecarga'],
  ['/como-evitar-spam-no-whatsapp/', 'Como evitar spam no WhatsApp', 'Proteja o grupo com menos esforço'],
  ['/como-organizar-comunidade-whatsapp/', 'Como organizar comunidade no WhatsApp', 'Estrutura para escala com qualidade'],
  ['/como-automatizar-avisos-no-whatsapp/', 'Como automatizar avisos no WhatsApp', 'Recados certos no momento certo'],
  ['/como-criar-comandos-whatsapp/', 'Como criar comandos no WhatsApp', 'Padronize respostas e rotinas'],
  ['/melhor-bot-whatsapp-para-grupos/', 'Melhor bot para grupos', 'Comparativo orientado a resultado'],
  ['/bot-whatsapp-sem-programar/', 'Bot para WhatsApp sem programar', 'Automação sem setup técnico'],
];

const FAQS = [
  ['Preciso configurar algo técnico para usar o OmniZap?', 'Não. Você só adiciona o bot ao grupo, autoriza e ele já começa a funcionar com recursos automáticos.'],
  ['Em quanto tempo o bot começa a funcionar?', 'Normalmente em menos de 1 minuto após a adição e autorização no grupo.'],
  ['O OmniZap funciona para grupos e comunidades?', 'Sim. O OmniZap foi criado para facilitar moderação, avisos e organização em grupos e comunidades no WhatsApp.'],
  ['Posso usar stickers junto com o bot?', 'Sim. Os stickers fazem parte do ecossistema OmniZap e podem ser usados como recurso extra para engajamento. Veja o catálogo em /stickers/.'],
  ['Preciso entender API para começar?', 'Não para uso comum. A área de API existe para integrações avançadas e pode ser acessada em /api-docs/.'],
  ['Quantos comandos o OmniZap possui?', 'Você pode acessar mais de 50 comandos ativos no seu grupo digitando /menu ou consultando a página /comandos/.'],
];

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

const shortNum = (value) =>
  new Intl.NumberFormat('pt-BR', {
    notation: Number(value) >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: Number(value) >= 1000 ? 1 : 0,
  }).format(Math.max(0, Number(value) || 0));

const runAfterLoadIdle = (callback, { delayMs = 0, timeoutMs = 1800 } = {}) => {
  let cancelled = false;
  let timeoutId = null;
  let idleId = null;
  let loadHandler = null;

  const run = () => {
    if (!cancelled) callback();
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
    if (loadHandler) window.removeEventListener('load', loadHandler);
  };
};

const toNonNegativeNumber = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, numeric);
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

const App = () => {
  const [isNavOpen, setNavOpen] = useState(false);
  const [isMobile, setMobile] = useState(Boolean(window.matchMedia?.('(max-width: 920px)')?.matches));
  const [session, setSession] = useState(null);
  const [botMenuUrl, setBotMenuUrl] = useState('/login/');
  const [hasBotMenuLink, setHasBotMenuLink] = useState(true);
  const [metrics, setMetrics] = useState(DEFAULT_METRICS);
  const counterFramesRef = useRef({
    users: null,
    messages: null,
    commands: null,
  });
  const counterValuesRef = useRef({
    users: 0,
    messages: 0,
    commands: 0,
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia?.('(max-width: 920px)');
    if (!mediaQuery) return undefined;

    const applyViewport = () => setMobile(Boolean(mediaQuery.matches));
    applyViewport();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', applyViewport);
      return () => mediaQuery.removeEventListener('change', applyViewport);
    }

    if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(applyViewport);
      return () => mediaQuery.removeListener(applyViewport);
    }

    return undefined;
  }, []);

  useEffect(() => {
    let active = true;

    const stopCounterAnimation = (metricKey) => {
      const rafId = counterFramesRef.current[metricKey];
      if (!rafId) return;
      window.cancelAnimationFrame(rafId);
      counterFramesRef.current[metricKey] = null;
    };

    const setCounterFallback = (metricKey) => {
      stopCounterAnimation(metricKey);
      counterValuesRef.current[metricKey] = 0;
      setMetrics((current) => ({
        ...current,
        [metricKey]: 'n/d',
      }));
    };

    const setCounterImmediate = (metricKey, numericValue) => {
      stopCounterAnimation(metricKey);
      counterValuesRef.current[metricKey] = numericValue;
      setMetrics((current) => ({
        ...current,
        [metricKey]: shortNum(numericValue),
      }));
    };

    const animateCounter = (metricKey, numericValue) => {
      if (typeof window.requestAnimationFrame !== 'function' || typeof window.performance === 'undefined') {
        setCounterImmediate(metricKey, numericValue);
        return;
      }

      stopCounterAnimation(metricKey);
      const startValue = Number(counterValuesRef.current[metricKey] || 0);
      const targetValue = Math.max(0, Number(numericValue) || 0);
      const delta = targetValue - startValue;
      const startAt = window.performance.now();

      const tick = (now) => {
        const progress = Math.min(1, (now - startAt) / COUNTUP_DURATION_MS);
        const eased = 1 - Math.pow(1 - progress, 3);
        const currentValue = startValue + delta * eased;
        setMetrics((current) => ({
          ...current,
          [metricKey]: shortNum(currentValue),
        }));

        if (progress < 1) {
          counterFramesRef.current[metricKey] = window.requestAnimationFrame(tick);
          return;
        }

        counterFramesRef.current[metricKey] = null;
        counterValuesRef.current[metricKey] = targetValue;
        setMetrics((current) => ({
          ...current,
          [metricKey]: shortNum(targetValue),
        }));
      };

      counterFramesRef.current[metricKey] = window.requestAnimationFrame(tick);
    };

    const applyBootstrapData = (bootstrapData, { animateCounters = false } = {}) => {
      if (!active) return;

      const realtime = bootstrapData?.home_realtime || {};
      const summary = bootstrapData?.system_summary || {};
      const sessionData = bootstrapData?.session || null;
      const contactUrl = String(bootstrapData?.bot_contact?.urls?.menu || '').trim();
      const usersTotal = toNonNegativeNumber(realtime?.total_users);
      const messagesTotal = toNonNegativeNumber(realtime?.total_messages);
      const commandsTotal = toNonNegativeNumber(realtime?.total_commands);
      const latencyMs = toNonNegativeNumber(realtime?.system_latency_ms);

      setSession(sessionData && sessionData.authenticated && sessionData.user?.sub ? sessionData : null);
      setBotMenuUrl(contactUrl || '/login/');
      setHasBotMenuLink(Boolean(contactUrl));
      setMetrics((current) => ({
        ...current,
        status: `bot ${normalizeStatus(summary?.system_status || summary?.bot?.connection_status)}`,
        latency: latencyMs === null ? 'n/d' : `${Math.round(latencyMs)} ms`,
      }));

      const counterValues = {
        users: usersTotal,
        messages: messagesTotal,
        commands: commandsTotal,
      };

      COUNTABLE_METRICS.forEach((metricKey) => {
        const nextValue = counterValues[metricKey];
        if (nextValue === null) {
          setCounterFallback(metricKey);
          return;
        }
        if (animateCounters) {
          animateCounter(metricKey, nextValue);
          return;
        }
        setCounterImmediate(metricKey, nextValue);
      });
    };

    const runLoad = async ({ forceRefresh = false, animateCounters = false } = {}) => {
      try {
        const bootstrapData = await fetchHomeBootstrapPayload({ forceRefresh });
        applyBootstrapData(bootstrapData, { animateCounters });
      } catch {
        if (!active) return;
        setHasBotMenuLink(false);
        setMetrics((current) => ({ ...current, status: 'bot pronto' }));
      }
    };

    const stopBootstrap = runAfterLoadIdle(
      () => {
        void runLoad({ forceRefresh: false, animateCounters: true });
      },
      { delayMs: 520, timeoutMs: 1200 },
    );

    const intervalId = window.setInterval(() => {
      void runLoad({ forceRefresh: true, animateCounters: false });
    }, SOCIAL_PROOF_REFRESH_MS);

    return () => {
      active = false;
      stopBootstrap();
      window.clearInterval(intervalId);
      COUNTABLE_METRICS.forEach((metricKey) => {
        const rafId = counterFramesRef.current[metricKey];
        if (!rafId) return;
        window.cancelAnimationFrame(rafId);
        counterFramesRef.current[metricKey] = null;
      });
    };
  }, []);

  useEffect(() => {
    if (!isMobile) setNavOpen(false);
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile) {
      document.body.style.overflow = '';
      return undefined;
    }

    const onKeyDown = (event) => {
      if (event.key === 'Escape') setNavOpen(false);
    };

    document.body.style.overflow = isNavOpen ? 'hidden' : '';
    if (isNavOpen) window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isMobile, isNavOpen]);

  const authInfo = useMemo(() => {
    const authenticated = Boolean(session?.authenticated && session?.user?.sub);
    if (!authenticated) {
      return {
        href: '/login/',
        label: 'Entrar',
        image: null,
        title: 'Entrar',
      };
    }

    const name = String(session?.user?.name || session?.user?.email || 'Conta Google').trim() || 'Conta Google';
    return {
      href: '/user/',
      label: name,
      image: String(session?.user?.picture || '').trim() || FALLBACK_THUMB_URL,
      title: `${name} (sessão ativa)`,
    };
  }, [session]);

  const closeMobileNav = () => {
    if (isMobile) setNavOpen(false);
  };

  const navContainerClass = isMobile
    ? `nav ${isNavOpen ? 'grid' : 'hidden'} fixed inset-x-3 top-[4.5rem] z-50 max-h-[calc(100dvh-5.5rem)] grid-cols-1 gap-2 overflow-y-auto rounded-2xl border border-base-300 bg-base-100/98 p-3 shadow-2xl backdrop-blur`
    : 'nav flex w-full flex-wrap items-center gap-2 lg:w-auto';
  const authButtonClass = isMobile
    ? 'btn btn-primary h-11 min-h-0 justify-start gap-2 px-3 text-sm font-semibold'
    : `btn ${authInfo.image ? 'btn-circle p-0' : 'btn-primary'} justify-center`;

  return html`
    <div className="relative text-base-content">
      <header className="navbar sticky top-0 z-50 border-b border-base-300 bg-base-100/90 px-3 py-2 backdrop-blur-md sm:px-4 lg:px-6">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3">
          <div className="flex w-full min-w-0 items-center justify-between gap-2 lg:w-auto">
            <a className="btn btn-ghost h-10 min-h-0 max-w-[78vw] justify-start gap-2 px-2 text-sm normal-case sm:max-w-none sm:px-3" href="/" aria-label="OmniZap Home">
              <img src="/assets/images/brand-logo-128.webp" alt="OmniZap" width="30" height="30" decoding="async" className="h-8 w-8 rounded-full border border-base-300 object-cover" />
              <span className="truncate font-bold tracking-wide">OmniZap Bot</span>
            </a>
            <button
              id="nav-toggle"
              className="btn btn-square h-10 min-h-0 border border-base-300 bg-base-200/70 text-base-content shadow-sm hover:bg-base-200 lg:hidden"
              type="button"
              aria-expanded=${isNavOpen ? 'true' : 'false'}
              aria-controls="main-nav"
              aria-label="Abrir menu"
              onClick=${() => setNavOpen((current) => !current)}
            >
              ${isNavOpen ? '✕' : '☰'}
            </button>
          </div>

          <nav id="main-nav" className=${navContainerClass} aria-label="Navegação principal">
            ${NAV_ITEMS.map(
              (item) =>
                html`<a
                  id=${item.id || null}
                  className=${`btn ${isMobile ? 'btn-outline justify-start border-base-300 bg-base-200/50 text-sm font-semibold' : 'btn-ghost justify-center'}`}
                  href=${item.href}
                  onClick=${closeMobileNav}
                >
                  ${item.label}
                </a>`,
            )}
            <a
              id="nav-auth-link"
              className=${authButtonClass}
              href=${authInfo.href}
              title=${authInfo.title}
              aria-label=${authInfo.image && !isMobile ? authInfo.title : 'Entrar'}
              onClick=${closeMobileNav}
            >
              ${authInfo.image
                ? isMobile
                  ? html`<img className="h-7 w-7 rounded-full object-cover" src=${authInfo.image} alt=${authInfo.label} loading="lazy" decoding="async" /><span className="truncate">${authInfo.label}</span>`
                  : html`<img className="h-full w-full rounded-full object-cover" src=${authInfo.image} alt=${authInfo.label} loading="lazy" decoding="async" />`
                : html`Entrar`}
            </a>
          </nav>
        </div>
      </header>

      ${isMobile && isNavOpen
        ? html`<button type="button" className="fixed inset-0 z-40 bg-slate-950/55 lg:hidden" aria-label="Fechar menu" onClick=${closeMobileNav}></button>`
        : null}

      <main className="mx-auto w-full max-w-7xl px-3 pb-28 pt-5 sm:px-4 sm:pb-16 sm:pt-7 lg:px-6">
        <section className="hero rounded-2xl border border-base-300 bg-base-200/70 p-3 shadow-2xl sm:rounded-3xl sm:p-6" aria-labelledby="hero-title">
          <div className="hero-content flex-col gap-5 sm:gap-8 lg:flex-row lg:items-start lg:justify-between">
            <div className="w-full max-w-2xl">
              <span className="badge badge-outline badge-info mb-3 px-3 py-2 text-[11px] font-bold uppercase tracking-wide sm:px-3 sm:py-3 sm:text-xs">Bot pronto para grupos WhatsApp</span>
              <h1 id="hero-title" className="text-balance text-2xl font-black leading-tight sm:text-4xl lg:text-5xl">Adicione o bot ao seu grupo e deixe ele fazer o resto.</h1>
              <p className="mt-3 text-sm leading-relaxed text-base-content/80 sm:mt-4 sm:text-base lg:text-lg">
                Automação automática, organização de mensagens e recursos inteligentes prontos para usar. Sem configuração técnica. Sem programação. Sem complicação.
              </p>

              <div className="mt-5 grid grid-cols-1 gap-2 sm:mt-6 sm:flex sm:flex-wrap sm:gap-3">
                <a className="btn btn-success btn-md w-full sm:btn-lg sm:w-auto" data-add-bot-cta href=${botMenuUrl} target="_blank" rel="noreferrer noopener">
                  Adicionar ao Meu Grupo
                </a>
                <a className="btn btn-outline btn-info btn-md w-full sm:btn-lg sm:w-auto" href="#recursos" onClick=${closeMobileNav}>
                  Ver Recursos
                </a>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-2 sm:mt-6 sm:gap-3 lg:grid-cols-4">
                <article className="rounded-xl border border-base-300 bg-base-100 p-3 shadow">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-base-content/60 sm:text-xs">Usuários</p>
                  <p id="proof-users-total" className="mt-1 text-xl font-black sm:text-2xl">${metrics.users}</p>
                </article>
                <article className="rounded-xl border border-base-300 bg-base-100 p-3 shadow">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-base-content/60 sm:text-xs">Mensagens</p>
                  <p id="proof-messages-total" className="mt-1 text-xl font-black sm:text-2xl">${metrics.messages}</p>
                </article>
                <article className="rounded-xl border border-base-300 bg-base-100 p-3 shadow">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-base-content/60 sm:text-xs">Comandos</p>
                  <p id="proof-commands-total" className="mt-1 text-xl font-black sm:text-2xl">${metrics.commands}</p>
                </article>
                <article className="rounded-xl border border-base-300 bg-base-100 p-3 shadow">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-base-content/60 sm:text-xs">Latência</p>
                  <p id="proof-system-latency" className="mt-1 text-xl font-black sm:text-2xl">${metrics.latency}</p>
                </article>
              </div>
            </div>

            <aside className="w-full max-w-none rounded-2xl border border-base-300 bg-base-100 p-3 shadow-xl sm:p-4 lg:max-w-md">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-base-content/70 sm:text-xs">Comunidade OmniZap</p>
                <span id="proof-status" className="badge badge-success badge-outline whitespace-nowrap">${metrics.status}</span>
              </div>
              <div className="space-y-3 max-h-[260px] overflow-y-auto pr-1 sm:max-h-none sm:pr-0">
                <div className="chat chat-start">
                  <div className="chat-bubble chat-bubble-neutral text-sm sm:text-base">Pessoal, os links estão bagunçando o grupo 😅</div>
                </div>
                <div className="chat chat-end">
                  <div className="chat-bubble chat-bubble-success text-sm sm:text-base">✅ Pronto! Ativei moderação automática. Links suspeitos agora são bloqueados.</div>
                </div>
                <div className="chat chat-start">
                  <div className="chat-bubble chat-bubble-neutral text-sm sm:text-base">Consegue mandar aviso de reunião amanhã às 9h?</div>
                </div>
                <div className="chat chat-end">
                  <div className="chat-bubble chat-bubble-success text-sm sm:text-base">📣 Aviso agendado para todo o grupo. Também vou lembrar 15 minutos antes.</div>
                </div>
                <div className="chat chat-start">
                  <div className="chat-bubble chat-bubble-neutral text-sm sm:text-base">Top! E os comandos?</div>
                </div>
                <div className="chat chat-end">
                  <div className="chat-bubble chat-bubble-success text-sm sm:text-base">🤖 Já estão ativos. Digite /menu e veja mais de 50 comandos no seu grupo.</div>
                </div>
              </div>
            </aside>
          </div>
        </section>

        <section id="como-funciona" className="mt-8 scroll-mt-24 space-y-3 sm:mt-10 sm:space-y-4">
          <h2 className="text-2xl font-black sm:text-3xl">Como funciona</h2>
          <p className="text-sm text-base-content/75 sm:text-base">Ultra simples: três passos e o grupo já começa a rodar com automação.</p>
          <div className="grid gap-4 md:grid-cols-3">
            <article className="card card-compact bg-base-200 shadow sm:card-normal"><div className="card-body"><h3 className="card-title text-base sm:text-lg">1️⃣ Clique em adicionar</h3><p className="text-sm sm:text-base">Toque no botão e abra a conversa com o bot no WhatsApp.</p></div></article>
            <article className="card card-compact bg-base-200 shadow sm:card-normal"><div className="card-body"><h3 className="card-title text-base sm:text-lg">2️⃣ Autorize no grupo</h3><p className="text-sm sm:text-base">Adicione o OmniZap no grupo ou comunidade em poucos toques.</p></div></article>
            <article className="card card-compact bg-base-200 shadow sm:card-normal"><div className="card-body"><h3 className="card-title text-base sm:text-lg">3️⃣ Pronto. Já funciona</h3><p className="text-sm sm:text-base">Moderação, avisos e respostas automáticas começam imediatamente.</p></div></article>
          </div>
        </section>

        <section id="recursos" className="mt-8 scroll-mt-24 space-y-3 sm:mt-10 sm:space-y-4">
          <h2 className="text-2xl font-black sm:text-3xl">O que o bot faz por você</h2>
          <p className="text-sm text-base-content/75 sm:text-base">Tudo focado em resultado no grupo, sem linguagem técnica.</p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <article className="card card-compact bg-base-200 shadow sm:card-normal"><div className="card-body"><h3 className="card-title text-base sm:text-lg">🤖 Responde automaticamente</h3><p className="text-sm sm:text-base">Respostas rápidas para dúvidas repetidas e comandos prontos para o dia a dia.</p></div></article>
            <article className="card card-compact bg-base-200 shadow sm:card-normal"><div className="card-body"><h3 className="card-title text-base sm:text-lg">📌 Organiza o grupo</h3><p className="text-sm sm:text-base">Ajuda a manter conversas úteis e reduz o caos de mensagens perdidas.</p></div></article>
            <article className="card card-compact bg-base-200 shadow sm:card-normal"><div className="card-body"><h3 className="card-title text-base sm:text-lg">🛑 Moderação inteligente</h3><p className="text-sm sm:text-base">Bloqueia spam e comportamentos problemáticos para proteger sua comunidade.</p></div></article>
            <article className="card card-compact bg-base-200 shadow sm:card-normal"><div className="card-body"><h3 className="card-title text-base sm:text-lg">📣 Envia avisos automáticos</h3><p className="text-sm sm:text-base">Agenda recados e lembretes para que ninguém perca informações importantes.</p></div></article>
            <article className="card card-compact bg-base-200 shadow sm:card-normal"><div className="card-body"><h3 className="card-title text-base sm:text-lg">🎉 Recursos extras integrados</h3><p className="text-sm sm:text-base">Stickers, interações e utilidades prontas para aumentar o engajamento do grupo.</p></div></article>
          </div>
        </section>

        <section id="comandos" className="mt-8 scroll-mt-24 space-y-3 sm:mt-10 sm:space-y-4">
          <h2 className="text-2xl font-black sm:text-3xl">⚡ Veja tudo que o bot pode fazer no seu grupo</h2>
          <p className="text-sm text-base-content/75 sm:text-base">Comandos simples que resolvem tarefas reais do dia a dia.</p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            ${COMMAND_BLOCKS.map(
              (block) => html`
                <article className="card card-compact bg-base-200 shadow sm:card-normal">
                  <div className="card-body">
                    <h3 className="card-title text-base sm:text-lg">${block.title}</h3>
                    <ul className="space-y-1.5 text-sm text-base-content/80">
                      ${block.items.map(
                        ([command, label]) => html`<li><code className="rounded border border-base-300 bg-base-100 px-1.5 py-0.5 text-xs font-bold">${command}</code> ${label}</li>`,
                      )}
                    </ul>
                  </div>
                </article>
              `,
            )}
          </div>
          <div className="flex flex-col items-start justify-between gap-3 rounded-2xl border border-base-300 bg-base-200 p-4 sm:flex-row sm:items-center">
            <p className="text-sm font-semibold text-base-content/80">+ dezenas de outros comandos disponíveis para sua operação.</p>
            <a className="btn btn-outline btn-info w-full sm:w-auto" href="/comandos/">Ver lista completa</a>
          </div>
        </section>

        <section id="para-quem" className="mt-8 scroll-mt-24 space-y-3 sm:mt-10 sm:space-y-4">
          <h2 className="text-2xl font-black sm:text-3xl">Para quem é</h2>
          <p className="text-sm text-base-content/75 sm:text-base">Se você administra pessoas em grupo, o OmniZap foi feito para você.</p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <article className="card card-compact bg-base-200 shadow sm:card-normal"><div className="card-body"><h3 className="card-title text-base sm:text-lg">👥 Donos de comunidade</h3><p className="text-sm sm:text-base">Mantenha regras e organização sem esforço manual constante.</p></div></article>
            <article className="card card-compact bg-base-200 shadow sm:card-normal"><div className="card-body"><h3 className="card-title text-base sm:text-lg">🎬 Criadores de conteúdo</h3><p className="text-sm sm:text-base">Gerencie audiência e comunicados com mais consistência.</p></div></article>
            <article className="card card-compact bg-base-200 shadow sm:card-normal"><div className="card-body"><h3 className="card-title text-base sm:text-lg">📚 Grupos de estudo</h3><p className="text-sm sm:text-base">Centralize avisos e reduza distrações para manter foco.</p></div></article>
            <article className="card card-compact bg-base-200 shadow sm:card-normal"><div className="card-body"><h3 className="card-title text-base sm:text-lg">🛍️ Lojas online</h3><p className="text-sm sm:text-base">Automatize atendimento inicial e mensagens recorrentes.</p></div></article>
            <article className="card card-compact bg-base-200 shadow sm:card-normal"><div className="card-body"><h3 className="card-title text-base sm:text-lg">🏢 Equipes internas</h3><p className="text-sm sm:text-base">Padronize comunicação e acompanhe rotinas com agilidade.</p></div></article>
          </div>
        </section>

        <section id="beneficios" className="mt-8 scroll-mt-24 space-y-3 sm:mt-10 sm:space-y-4">
          <h2 className="text-2xl font-black sm:text-3xl">Benefícios imediatos</h2>
          <p className="text-sm text-base-content/75 sm:text-base">Você adiciona. Ele organiza.</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-2xl border border-success/40 bg-success/10 p-3 text-sm font-bold text-success-content">✅ Economiza tempo da equipe</article>
            <article className="rounded-2xl border border-success/40 bg-success/10 p-3 text-sm font-bold text-success-content">✅ Evita spam e bagunça</article>
            <article className="rounded-2xl border border-success/40 bg-success/10 p-3 text-sm font-bold text-success-content">✅ Mantém o grupo organizado</article>
            <article className="rounded-2xl border border-success/40 bg-success/10 p-3 text-sm font-bold text-success-content">✅ Deixa sua comunidade mais profissional</article>
          </div>
        </section>

        <section id="guias" className="mt-8 scroll-mt-24 space-y-3 sm:mt-10 sm:space-y-4">
          <h2 className="text-2xl font-black sm:text-3xl">Guias rápidos para seu grupo crescer organizado</h2>
          <p className="text-sm text-base-content/75 sm:text-base">Conteúdo satélite para resolver dores reais de operação e reforçar sua estratégia de comunidade.</p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            ${GUIDES.map(
              ([href, title, subtitle]) => html`
                <a className="card border border-base-300 bg-base-200 shadow transition hover:-translate-y-0.5 hover:border-info" href=${href}>
                  <div className="card-body p-3 sm:p-4">
                    <h3 className="text-sm font-extrabold leading-snug text-base-content">${title}</h3>
                    <p className="text-xs font-semibold text-base-content/70">${subtitle}</p>
                  </div>
                </a>
              `,
            )}
          </div>
        </section>

        <section id="faq" className="mt-8 scroll-mt-24 space-y-3 sm:mt-10 sm:space-y-4">
          <h2 className="text-2xl font-black sm:text-3xl">Perguntas frequentes</h2>
          <p className="text-sm text-base-content/75 sm:text-base">Tudo que você precisa para começar sem complicação.</p>
          <div className="space-y-2">
            ${FAQS.map(
              ([question, answer]) => html`
                <div className="collapse collapse-plus border border-base-300 bg-base-200">
                  <input type="checkbox" />
                  <div className="collapse-title text-sm font-extrabold sm:text-base">${question}</div>
                  <div className="collapse-content text-sm text-base-content/80">${answer}</div>
                </div>
              `,
            )}
          </div>
        </section>

        <section className="mt-10 rounded-2xl border border-primary/40 bg-gradient-to-r from-primary/30 to-secondary/30 p-5 text-center shadow-xl sm:mt-12 sm:rounded-3xl sm:p-8" aria-labelledby="cta-final-title">
          <h2 id="cta-final-title" className="text-balance text-2xl font-black leading-tight sm:text-4xl">Seu grupo mais organizado em menos de 1 minuto.</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-base-content/85 sm:text-base">Sem setup técnico. Sem curva de aprendizado. Clique e comece agora.</p>
          <div className="mt-5 sm:mt-6">
            <a className="btn btn-success btn-lg w-full sm:w-auto" data-add-bot-cta href=${botMenuUrl} target="_blank" rel="noreferrer noopener">Adicionar Bot Agora</a>
          </div>
        </section>
      </main>

      <footer className="mt-10 border-t border-base-300 py-8">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-start justify-between gap-4 px-3 text-sm text-base-content/70 sm:px-4 lg:flex-row lg:items-center lg:px-6">
          <div>OmniZap System 2026 · Bot pronto para grupos WhatsApp</div>
          <nav className="flex w-full flex-wrap gap-2 lg:w-auto" aria-label="Links de rodapé">
            <a className="btn btn-ghost btn-sm" href="/termos-de-uso/">Termos</a>
            <a className="btn btn-ghost btn-sm" href="/licenca/">Licença</a>
            <a className="btn btn-ghost btn-sm" href="/stickers/">Stickers</a>
            <a className="btn btn-ghost btn-sm" href="/comandos/">Comandos</a>
            <a className="btn btn-ghost btn-sm" href="/api-docs/">Para desenvolvedores</a>
            <a className="btn btn-ghost btn-sm" href="https://github.com/Kaikygr/omnizap-system" target="_blank" rel="noreferrer noopener">Open Source</a>
          </nav>
        </div>
      </footer>

      ${hasBotMenuLink
        ? html`
            <a
              id="wpp-float"
              className="btn btn-success btn-circle fixed bottom-3 right-3 z-30 text-2xl shadow-xl sm:right-4"
              href=${botMenuUrl}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Adicionar bot no WhatsApp"
              title="Adicionar bot"
            >
              💬
            </a>
          `
        : null}
    </div>
  `;
};

const rootElement = document.getElementById('home-react-root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(html`<${App} />`);
}
