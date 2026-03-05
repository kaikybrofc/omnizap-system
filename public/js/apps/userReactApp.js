import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';
import {
  buildLoginRedirectPath,
  buildSupportWhatsAppUrl,
  buildWhatsAppUrl,
  formatDateTime,
  formatPhone,
  getSessionStatusLabel,
  normalizeDigits,
} from './userProfile/actions.js';

const html = htm.bind(React.createElement);

const DEFAULT_API_BASE_PATH = '/api/sticker-packs';
const DEFAULT_LOGIN_PATH = '/login';
const DEFAULT_TERMS_URL = '/termos-de-uso/';
const DEFAULT_PRIVACY_URL = '/termos-de-uso/#politica-de-privacidade';
const DEFAULT_FALLBACK_AVATAR = '/assets/images/brand-logo-128.webp';
const DEFAULT_SUPPORT_TEXT = 'Ol\u00e1! Preciso de suporte no OmniZap.';

const TABS = [
  { key: 'summary', label: 'Resumo' },
  { key: 'account', label: 'Conta' },
  { key: 'support', label: 'Suporte' },
];

const normalizeBasePath = (value, fallback) => {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  if (withSlash.length > 1 && withSlash.endsWith('/')) return withSlash.slice(0, -1);
  return withSlash || fallback;
};

const normalizeUrlPath = (value, fallback) => {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  return raw;
};

const resolveLogoutPath = (loginPath) => {
  const safe = String(loginPath || '/login').trim() || '/login';
  return safe.endsWith('/') ? safe : `${safe}/`;
};

const resolveAuthenticatedSession = (payload) => {
  const session = payload?.data?.session || null;
  return session && session.authenticated ? session : null;
};

const createUserApi = (apiBasePath) => {
  const sessionPath = `${apiBasePath}/auth/google/session`;
  const profilePath = `${apiBasePath}/me`;
  const botContactPath = `${apiBasePath}/bot-contact`;
  const supportPath = `${apiBasePath}/support`;

  const fetchJson = async (url, init = {}) => {
    const response = await fetch(url, {
      credentials: 'include',
      ...init,
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const error = new Error(payload?.error || `Falha HTTP ${response.status}`);
      error.statusCode = response.status;
      throw error;
    }

    return payload || {};
  };

  return {
    fetchSummary: () => fetchJson(`${profilePath}?view=summary`, { method: 'GET' }),
    fetchBotContact: () => fetchJson(botContactPath, { method: 'GET' }),
    fetchSupport: () => fetchJson(supportPath, { method: 'GET' }),
    logout: () => fetchJson(sessionPath, { method: 'DELETE' }),
  };
};

const resolveSummaryView = (payload, fallbackAvatar) => {
  const data = payload?.data || {};
  const session = data?.session || {};
  const user = session?.user || {};
  const account = data?.account || {};
  const ownerPhone = String(session?.owner_phone || '').trim();
  const ownerJid = String(data?.owner_jid || session?.owner_jid || '').trim();

  return {
    avatar: String(user?.picture || '').trim() || fallbackAvatar,
    name: String(user?.name || '').trim() || 'Conta Google',
    email: String(user?.email || '').trim() || 'E-mail n\u00e3o dispon\u00edvel',
    whatsapp: ownerPhone
      ? `WhatsApp vinculado: +${formatPhone(ownerPhone)}`
      : ownerJid
        ? `Owner vinculado: ${ownerJid}`
        : 'WhatsApp ainda n\u00e3o vinculado.',
    plan: account?.plan_label || 'Conta padr\u00e3o',
    status: account?.status === 'active' ? 'Ativa' : 'Pendente',
    lastLogin: formatDateTime(account?.last_login_at || account?.last_seen_at),
    expiresAt: formatDateTime(session?.expires_at),
    ownerJid: ownerJid || 'N\u00e3o informado',
    sessionStatus: getSessionStatusLabel(session),
  };
};

const toneClassMap = {
  loading: 'alert-info',
  success: 'alert-success',
  warning: 'alert-warning',
};

const UserApp = ({ config }) => {
  const api = useMemo(() => createUserApi(config.apiBasePath), [config.apiBasePath]);

  const [activeTab, setActiveTab] = useState('summary');
  const [isMobile, setMobile] = useState(Boolean(window.matchMedia?.('(max-width: 1020px)')?.matches));
  const [isSidebarOpen, setSidebarOpen] = useState(Boolean(!window.matchMedia?.('(max-width: 1020px)')?.matches));
  const [isLoadingSummary, setLoadingSummary] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [isLogoutBusy, setLogoutBusy] = useState(false);
  const [status, setStatus] = useState({
    tone: 'loading',
    message: 'Validando sess\u00e3o e carregando resumo da conta...',
  });
  const [errorMessage, setErrorMessage] = useState('');
  const [summary, setSummary] = useState({
    avatar: config.fallbackAvatar,
    name: 'Conta Google',
    email: 'E-mail n\u00e3o dispon\u00edvel',
    whatsapp: 'WhatsApp ainda n\u00e3o vinculado.',
    plan: 'Conta padr\u00e3o',
    status: 'Pendente',
    lastLogin: 'N\u00e3o informado',
    expiresAt: 'N\u00e3o informado',
    ownerJid: 'N\u00e3o informado',
    sessionStatus: 'Sess\u00e3o n\u00e3o autenticada',
  });
  const [support, setSupport] = useState({
    phone: '',
    text: DEFAULT_SUPPORT_TEXT,
  });
  const [links, setLinks] = useState({
    botUrl: buildWhatsAppUrl('', '/menu'),
    supportUrl: config.termsUrl,
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia?.('(max-width: 1020px)');
    if (!mediaQuery) return undefined;

    const applyViewport = () => {
      const mobile = Boolean(mediaQuery.matches);
      setMobile(mobile);
      setSidebarOpen(!mobile);
    };

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
    if (!isMobile) {
      document.body.style.overflow = '';
      return undefined;
    }

    const onKeyDown = (event) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };

    document.body.style.overflow = isSidebarOpen ? 'hidden' : '';
    if (isSidebarOpen) window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isMobile, isSidebarOpen]);

  useEffect(() => {
    let active = true;

    const loadProfile = async () => {
      setLoadingSummary(true);
      setErrorMessage('');
      setStatus({
        tone: 'loading',
        message: 'Validando sess\u00e3o e carregando resumo da conta...',
      });

      try {
        const summaryPayload = await api.fetchSummary();
        if (!active) return;

        const session = resolveAuthenticatedSession(summaryPayload);
        if (!session || !session?.user?.sub) {
          window.location.assign(buildLoginRedirectPath(config.loginPath));
          return;
        }

        setSummary(resolveSummaryView(summaryPayload, config.fallbackAvatar));
        setStatus({
          tone: 'success',
          message: 'Resumo da conta carregado com sucesso.',
        });

        const [botResult, supportResult] = await Promise.allSettled([api.fetchBotContact(), api.fetchSupport()]);
        if (!active) return;

        let botUrl = buildWhatsAppUrl('', '/menu');
        if (botResult.status === 'fulfilled') {
          const botData = botResult.value?.data || {};
          const botPhone = normalizeDigits(botData?.phone || '');
          const preferredMenuUrl = String(botData?.urls?.menu || '').trim();
          botUrl = preferredMenuUrl || buildWhatsAppUrl(botPhone, '/menu');
        }

        let supportUrl = config.termsUrl;
        let supportPhone = '';
        let supportText = DEFAULT_SUPPORT_TEXT;
        if (supportResult.status === 'fulfilled') {
          const supportData = supportResult.value?.data || {};
          supportPhone = normalizeDigits(supportData?.phone || '');
          supportText = String(supportData?.text || '').trim() || DEFAULT_SUPPORT_TEXT;
          const preferredSupportUrl = String(supportData?.url || '').trim();
          supportUrl = preferredSupportUrl || buildSupportWhatsAppUrl(supportPhone, supportText) || config.termsUrl;
        } else {
          supportText = 'Contato de suporte indispon\u00edvel no momento.';
        }

        setLinks({
          botUrl,
          supportUrl,
        });
        setSupport({
          phone: supportPhone,
          text: supportText,
        });
      } catch (error) {
        if (!active) return;
        setStatus({
          tone: 'warning',
          message: 'N\u00e3o foi poss\u00edvel concluir a leitura dos dados.',
        });
        setErrorMessage(error?.message || 'Falha ao carregar resumo da conta.');
      } finally {
        if (active) setLoadingSummary(false);
      }
    };

    void loadProfile();

    return () => {
      active = false;
    };
  }, [api, config.fallbackAvatar, config.loginPath, config.termsUrl, reloadKey]);

  const closeSidebarOnMobile = () => {
    if (isMobile) setSidebarOpen(false);
  };

  const handleTabSelect = (tabKey) => {
    setActiveTab(tabKey);
    closeSidebarOnMobile();
  };

  const handleRetry = () => {
    setReloadKey((current) => current + 1);
  };

  const handleLogout = async () => {
    if (isLogoutBusy) return;
    setLogoutBusy(true);
    try {
      await api.logout();
    } catch {
      // no-op
    }
    window.location.assign(resolveLogoutPath(config.loginPath));
  };

  return html`
    <div className="relative min-h-screen text-base-content">
      <header className="sticky top-0 z-50 border-b border-base-300 bg-base-100/90 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-3 py-2 sm:px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              className="btn btn-square h-10 min-h-0 border border-base-300 bg-base-200/70 lg:hidden"
              aria-label="Abrir menu lateral"
              aria-expanded=${isSidebarOpen ? 'true' : 'false'}
              onClick=${() => setSidebarOpen((open) => !open)}
            >
              ${isSidebarOpen ? '\u2715' : '\u2630'}
            </button>
            <a className="btn btn-ghost h-10 min-h-0 max-w-[74vw] justify-start gap-2 px-2 text-sm normal-case sm:max-w-none" href="/">
              <img src="/assets/images/brand-logo-128.webp" alt="OmniZap" className="h-8 w-8 rounded-full border border-base-300 object-cover" loading="lazy" decoding="async" />
              <span className="truncate font-bold tracking-wide">OmniZap System</span>
            </a>
          </div>

          <nav className="hidden items-center gap-2 lg:flex" aria-label="Navega\u00e7\u00e3o da conta">
            <a className="btn btn-ghost btn-sm" href="/user/">\u00c1rea do Usu\u00e1rio</a>
            <a className="btn btn-ghost btn-sm" href=${config.termsUrl} target="_blank" rel="noreferrer noopener">Termos</a>
            <a className="btn btn-ghost btn-sm" href=${config.privacyUrl} target="_blank" rel="noreferrer noopener">Privacidade</a>
            <button type="button" className="btn btn-error btn-sm" onClick=${handleLogout} disabled=${isLogoutBusy}>
              ${isLogoutBusy ? 'Encerrando...' : 'Encerrar sess\u00e3o'}
            </button>
          </nav>
        </div>
      </header>

      ${isMobile && isSidebarOpen
        ? html`<button type="button" className="fixed inset-0 z-40 bg-slate-950/60" aria-label="Fechar menu lateral" onClick=${() => setSidebarOpen(false)}></button>`
        : null}

      <main className="mx-auto w-full max-w-7xl px-3 pb-24 pt-5 sm:px-4 sm:pb-14 sm:pt-6 lg:px-6">
        <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside
            className=${`z-50 rounded-2xl border border-base-300 bg-base-100/95 p-3 shadow-xl backdrop-blur sm:p-4 ${
              isMobile
                ? `fixed inset-y-3 left-3 w-[min(84vw,320px)] transform overflow-y-auto transition-transform ${
                    isSidebarOpen ? 'translate-x-0' : '-translate-x-[120%]'
                  }`
                : 'sticky top-24 h-fit'
            }`}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-base-content/70">Navega\u00e7\u00e3o</p>
              <button type="button" className="btn btn-ghost btn-xs lg:hidden" onClick=${() => setSidebarOpen(false)}>Fechar</button>
            </div>

            <div className="space-y-2">
              ${TABS.map(
                (tab) => html`
                  <button
                    type="button"
                    className=${`btn w-full justify-start ${activeTab === tab.key ? 'btn-primary' : 'btn-outline'}`}
                    aria-selected=${activeTab === tab.key ? 'true' : 'false'}
                    onClick=${() => handleTabSelect(tab.key)}
                  >
                    ${tab.label}
                  </button>
                `,
              )}
            </div>

            <div className="divider my-3"></div>

            <div className="grid gap-2">
              <a className="btn btn-success w-full justify-start" href=${links.botUrl} target="_blank" rel="noreferrer noopener">Abrir bot no WhatsApp</a>
              <a className="btn btn-outline w-full justify-start" href=${links.supportUrl} target="_blank" rel="noreferrer noopener">Falar com suporte</a>
            </div>

            <div className="divider my-3"></div>

            <p className="text-xs leading-relaxed text-base-content/65">
              Use os atalhos para abrir o bot ou falar com o suporte quando precisar.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <a className="link link-info text-xs" href=${config.termsUrl} target="_blank" rel="noreferrer noopener">Termos de Servi\u00e7o</a>
              <a className="link link-info text-xs" href=${config.privacyUrl} target="_blank" rel="noreferrer noopener">Pol\u00edtica de Privacidade</a>
            </div>
          </aside>

          <section className="rounded-2xl border border-base-300 bg-base-100/80 p-3 shadow-xl sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-info">Painel do usu\u00e1rio</p>
                <h1 className="mt-1 text-2xl font-black sm:text-3xl">Minha Conta</h1>
                <p className="mt-1 text-sm text-base-content/70">Resumo da sua conta e canais diretos de suporte.</p>
              </div>
              <div className="flex w-full gap-2 sm:w-auto lg:hidden">
                <a className="btn btn-outline flex-1 sm:flex-none" href="/">Voltar ao in\u00edcio</a>
                <button type="button" className="btn btn-error flex-1 sm:flex-none" onClick=${handleLogout} disabled=${isLogoutBusy}>
                  ${isLogoutBusy ? 'Encerrando...' : 'Sair'}
                </button>
              </div>
            </div>

            <div className="mb-4 grid gap-2">
              <div role="status" className=${`alert ${toneClassMap[status.tone] || 'alert-info'} text-sm`}>
                <span>${status.message}</span>
              </div>
              ${errorMessage
                ? html`
                    <div role="alert" className="alert alert-error text-sm">
                      <span>${errorMessage}</span>
                    </div>
                    <button type="button" className="btn btn-outline w-full sm:w-auto" onClick=${handleRetry}>Tentar novamente</button>
                  `
                : null}
            </div>

            ${activeTab === 'summary'
              ? html`
                  <div className="space-y-4">
                    <section className="rounded-xl border border-base-300 bg-base-200/70 p-3 sm:p-4">
                      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                        <img
                          src=${summary.avatar}
                          alt="Avatar do usu\u00e1rio"
                          className="h-16 w-16 rounded-xl border border-base-300 object-cover sm:h-20 sm:w-20"
                          onError=${(event) => {
                            const image = event.currentTarget;
                            image.src = config.fallbackAvatar;
                          }}
                        />
                        <div className="min-w-0 space-y-1">
                          <p className=${`text-xl font-black sm:text-2xl ${isLoadingSummary ? 'skeleton h-7 w-44 text-transparent' : ''}`}>${isLoadingSummary ? 'Carregando' : summary.name}</p>
                          <p className=${`text-sm text-base-content/75 ${isLoadingSummary ? 'skeleton h-5 w-56 text-transparent' : ''}`}>${isLoadingSummary ? 'email@exemplo.com' : summary.email}</p>
                          <p className=${`text-sm text-base-content/75 ${isLoadingSummary ? 'skeleton h-5 w-64 text-transparent' : ''}`}>${isLoadingSummary ? 'WhatsApp vinculado' : summary.whatsapp}</p>
                        </div>
                      </div>
                    </section>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <article className="rounded-xl border border-base-300 bg-base-200/70 p-3">
                        <p className="text-xs font-bold uppercase tracking-wide text-base-content/60">Plano</p>
                        <p className=${`mt-1 text-base font-semibold ${isLoadingSummary ? 'skeleton h-6 w-32 text-transparent' : ''}`}>${isLoadingSummary ? '--' : summary.plan}</p>
                      </article>
                      <article className="rounded-xl border border-base-300 bg-base-200/70 p-3">
                        <p className="text-xs font-bold uppercase tracking-wide text-base-content/60">Status</p>
                        <p className=${`mt-1 text-base font-semibold ${isLoadingSummary ? 'skeleton h-6 w-24 text-transparent' : ''}`}>${isLoadingSummary ? '--' : summary.status}</p>
                      </article>
                      <article className="rounded-xl border border-base-300 bg-base-200/70 p-3">
                        <p className="text-xs font-bold uppercase tracking-wide text-base-content/60">\u00daltimo login</p>
                        <p className=${`mt-1 text-base font-semibold ${isLoadingSummary ? 'skeleton h-6 w-36 text-transparent' : ''}`}>${isLoadingSummary ? '--' : summary.lastLogin}</p>
                      </article>
                      <article className="rounded-xl border border-base-300 bg-base-200/70 p-3">
                        <p className="text-xs font-bold uppercase tracking-wide text-base-content/60">Sess\u00e3o expira em</p>
                        <p className=${`mt-1 text-base font-semibold ${isLoadingSummary ? 'skeleton h-6 w-36 text-transparent' : ''}`}>${isLoadingSummary ? '--' : summary.expiresAt}</p>
                      </article>
                    </div>
                  </div>
                `
              : null}

            ${activeTab === 'account'
              ? html`
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <article className="rounded-xl border border-base-300 bg-base-200/70 p-3">
                        <p className="text-xs font-bold uppercase tracking-wide text-base-content/60">Status da sess\u00e3o</p>
                        <p className=${`mt-1 text-base font-semibold ${isLoadingSummary ? 'skeleton h-6 w-36 text-transparent' : ''}`}>${isLoadingSummary ? '--' : summary.sessionStatus}</p>
                      </article>
                      <article className="rounded-xl border border-base-300 bg-base-200/70 p-3">
                        <p className="text-xs font-bold uppercase tracking-wide text-base-content/60">Owner vinculado</p>
                        <p className=${`mt-1 text-base font-semibold ${isLoadingSummary ? 'skeleton h-6 w-40 text-transparent' : ''}`}>${isLoadingSummary ? '--' : summary.ownerJid}</p>
                      </article>
                      <article className="rounded-xl border border-base-300 bg-base-200/70 p-3">
                        <p className="text-xs font-bold uppercase tracking-wide text-base-content/60">\u00daltimo login</p>
                        <p className=${`mt-1 text-base font-semibold ${isLoadingSummary ? 'skeleton h-6 w-36 text-transparent' : ''}`}>${isLoadingSummary ? '--' : summary.lastLogin}</p>
                      </article>
                      <article className="rounded-xl border border-base-300 bg-base-200/70 p-3">
                        <p className="text-xs font-bold uppercase tracking-wide text-base-content/60">Expira\u00e7\u00e3o da sess\u00e3o</p>
                        <p className=${`mt-1 text-base font-semibold ${isLoadingSummary ? 'skeleton h-6 w-36 text-transparent' : ''}`}>${isLoadingSummary ? '--' : summary.expiresAt}</p>
                      </article>
                    </div>
                    <p className="text-sm text-base-content/70">
                      Ao usar o login voc\u00ea concorda com os termos e regras de privacidade do projeto.
                    </p>
                    <div className="flex flex-wrap gap-3 text-sm">
                      <a className="link link-info" href=${config.termsUrl} target="_blank" rel="noreferrer noopener">Termos de Servi\u00e7o</a>
                      <a className="link link-info" href=${config.privacyUrl} target="_blank" rel="noreferrer noopener">Pol\u00edtica de Privacidade</a>
                    </div>
                  </div>
                `
              : null}

            ${activeTab === 'support'
              ? html`
                  <div className="space-y-4">
                    <p className="text-sm text-base-content/70">Canal oficial para d\u00favidas sobre login e uso geral do OmniZap.</p>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <article className="rounded-xl border border-base-300 bg-base-200/70 p-3">
                        <p className="text-xs font-bold uppercase tracking-wide text-base-content/60">Contato</p>
                        <p className=${`mt-1 text-base font-semibold ${isLoadingSummary ? 'skeleton h-6 w-36 text-transparent' : ''}`}>
                          ${isLoadingSummary ? '--' : support.phone ? `+${formatPhone(support.phone)}` : 'N\u00e3o informado'}
                        </p>
                      </article>
                      <article className="rounded-xl border border-base-300 bg-base-200/70 p-3">
                        <p className="text-xs font-bold uppercase tracking-wide text-base-content/60">Mensagem padr\u00e3o</p>
                        <p className=${`mt-1 text-base font-semibold ${isLoadingSummary ? 'skeleton h-6 w-40 text-transparent' : ''}`}>
                          ${isLoadingSummary ? '--' : support.text}
                        </p>
                      </article>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <a className="btn btn-success w-full" href=${links.supportUrl} target="_blank" rel="noreferrer noopener">Abrir suporte no WhatsApp</a>
                      <a className="btn btn-outline w-full" href=${config.termsUrl} target="_blank" rel="noreferrer noopener">Ver novos Termos</a>
                    </div>
                  </div>
                `
              : null}

            <p className="mt-5 text-center text-xs text-base-content/60">
              OmniZap System · ${String(new Date().getFullYear())}
            </p>
          </section>
        </div>
      </main>
    </div>
  `;
};

const rootElement = document.getElementById('user-react-root');

if (rootElement) {
  const config = {
    apiBasePath: normalizeBasePath(rootElement.dataset.apiBasePath, DEFAULT_API_BASE_PATH),
    loginPath: normalizeBasePath(rootElement.dataset.loginPath, DEFAULT_LOGIN_PATH),
    termsUrl: normalizeUrlPath(rootElement.dataset.termsUrl, DEFAULT_TERMS_URL),
    privacyUrl: normalizeUrlPath(rootElement.dataset.privacyUrl, DEFAULT_PRIVACY_URL),
    fallbackAvatar: normalizeUrlPath(rootElement.dataset.fallbackAvatar, DEFAULT_FALLBACK_AVATAR),
  };

  const root = createRoot(rootElement);
  root.render(html`<${UserApp} config=${config} />`);
}
