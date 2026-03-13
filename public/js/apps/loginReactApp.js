import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';

const html = htm.bind(React.createElement);

const GOOGLE_GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const DEFAULT_TERMS_URL = '/termos-de-uso/';
const DEFAULT_PRIVACY_URL = '/politica-de-privacidade/';
const DEFAULT_AUP_URL = '/aup/';
const DEFAULT_API_BASE_PATH = '/api';
const DEFAULT_PANEL_PATH = '/user/';
const DEFAULT_WHATSAPP_LOGIN_TRIGGER = 'iniciar';
const FALLBACK_THUMB_URL = '/assets/images/brand-logo-128.webp';

const LEGAL_DOCS = [
  { href: DEFAULT_TERMS_URL, label: 'Termos' },
  { href: DEFAULT_PRIVACY_URL, label: 'Privacidade' },
  { href: DEFAULT_AUP_URL, label: 'AUP' },
];

const normalizeDigits = (value) => String(value || '').replace(/\D+/g, '');

const formatPhone = (digits) => {
  const value = normalizeDigits(digits);
  if (!value) return '';
  if (value.length <= 4) return value;
  return `${value.slice(0, 2)} ${value.slice(2, -4)}-${value.slice(-4)}`.trim();
};

const normalizeRoutePath = (value, fallback = DEFAULT_PANEL_PATH) => {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  if (!raw.startsWith('/')) return fallback;
  if (/^\/\//.test(raw)) return fallback;
  return raw;
};

const readWhatsAppHintFromSearch = (search) => {
  const params = new URLSearchParams(search || '');
  const phone = normalizeDigits(params.get('wa') || '');
  const ts = String(params.get('wa_ts') || '').trim();
  const sig = String(params.get('wa_sig') || '').trim();
  return {
    hasPayload: Boolean(phone || ts || sig),
    phone,
    ts,
    sig,
  };
};

const resolveLoginConfig = (rootElement) => {
  const apiBasePath = String(rootElement?.dataset?.apiBasePath || DEFAULT_API_BASE_PATH).trim() || DEFAULT_API_BASE_PATH;
  const panelPath = normalizeRoutePath(rootElement?.dataset?.panelPath, DEFAULT_PANEL_PATH);
  return { apiBasePath, panelPath };
};

const buildWhatsAppLoginUrl = (phoneDigits, loginText = DEFAULT_WHATSAPP_LOGIN_TRIGGER) => {
  const params = new URLSearchParams({
    text: String(loginText || DEFAULT_WHATSAPP_LOGIN_TRIGGER).trim() || DEFAULT_WHATSAPP_LOGIN_TRIGGER,
    type: 'custom_url',
    app_absent: '0',
  });
  const digits = normalizeDigits(phoneDigits);
  if (digits) {
    params.set('phone', digits);
  }
  return `https://api.whatsapp.com/send/?${params.toString()}`;
};

const isAuthenticatedSession = (sessionData) => {
  const authenticated =
    sessionData?.authenticated === true ||
    sessionData?.authenticated === 1 ||
    String(sessionData?.authenticated || '')
      .trim()
      .toLowerCase() === 'true';
  if (!authenticated) return false;
  return Boolean(sessionData?.owner_jid || sessionData?.owner_phone || sessionData?.user?.sub);
};

const buildGoogleAuthPayload = (credential, hint) => {
  const payload = {
    google_id_token: String(credential || '').trim(),
  };

  if (hint.phone) payload.wa = hint.phone;
  if (hint.ts) payload.wa_ts = hint.ts;
  if (hint.sig) payload.wa_sig = hint.sig;

  const whatsappLogin = {};
  if (hint.phone) whatsappLogin.phone = hint.phone;
  if (hint.ts) whatsappLogin.ts = hint.ts;
  if (hint.sig) whatsappLogin.sig = hint.sig;
  if (Object.keys(whatsappLogin).length > 0) {
    payload.whatsapp_login = whatsappLogin;
  }

  return payload;
};

const createLoginApi = (apiBasePath) => {
  const authSessionPath = `${apiBasePath}/auth/google/session`;
  const createConfigPath = `${apiBasePath}/create-config`;
  const botContactPath = `${apiBasePath}/bot-contact`;

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
      error.payload = payload;
      throw error;
    }
    return payload || {};
  };

  return {
    getSession: () => fetchJson(authSessionPath, { method: 'GET' }),
    createSession: (body) =>
      fetchJson(authSessionPath, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(body || {}),
      }),
    getConfig: () => fetchJson(createConfigPath, { method: 'GET' }),
    getBotContact: () => fetchJson(botContactPath, { method: 'GET' }),
  };
};

let googleScriptPromise = null;
const loadGoogleScript = () => {
  if (globalThis.google?.accounts?.id) {
    return Promise.resolve(globalThis.google.accounts.id);
  }
  if (googleScriptPromise) return googleScriptPromise;

  googleScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GOOGLE_GSI_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(globalThis.google?.accounts?.id || null), {
        once: true,
      });
      existing.addEventListener('error', () => reject(new Error('Falha ao carregar SDK Google.')), {
        once: true,
      });
      return;
    }

    const script = document.createElement('script');
    script.src = GOOGLE_GSI_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(globalThis.google?.accounts?.id || null);
    script.onerror = () => reject(new Error('Falha ao carregar SDK Google.'));
    document.head.appendChild(script);
  }).catch((error) => {
    googleScriptPromise = null;
    throw error;
  });

  return googleScriptPromise;
};

const LoginApp = ({ config }) => {
  const api = useMemo(() => createLoginApi(config.apiBasePath), [config.apiBasePath]);
  const hint = useMemo(() => readWhatsAppHintFromSearch(window.location.search), []);

  const [session, setSession] = useState(null);
  const [botPhone, setBotPhone] = useState(() => normalizeDigits(hint.phone || ''));
  const [whatsappCtaUrl, setWhatsappCtaUrl] = useState(() => buildWhatsAppLoginUrl(hint.phone || ''));
  const [errorMessage, setErrorMessage] = useState('');
  const [consentAccepted, setConsentAccepted] = useState(true);
  const [googleStatusMessage, setGoogleStatusMessage] = useState(hint.hasPayload ? 'Aguardando Google...' : '');
  const [googleReady, setGoogleReady] = useState(false);
  const [googleClientId, setGoogleClientId] = useState('');
  const [isSubmittingGoogle, setIsSubmittingGoogle] = useState(false);

  const googleButtonRef = useRef(null);

  useEffect(() => {
    let active = true;

    const loadBotContact = async () => {
      try {
        const payload = await api.getBotContact();
        const data = payload?.data || {};
        const phone = normalizeDigits(data?.phone || '');
        const loginText = String(data?.login_text || DEFAULT_WHATSAPP_LOGIN_TRIGGER).trim() || DEFAULT_WHATSAPP_LOGIN_TRIGGER;
        const loginUrl = String(data?.urls?.login || '').trim();

        if (!active) return;
        if (phone) setBotPhone(phone);
        if (loginUrl) {
          setWhatsappCtaUrl(loginUrl);
          return;
        }
        setWhatsappCtaUrl(buildWhatsAppLoginUrl(phone, loginText));
      } catch {
        if (!active) return;
        setWhatsappCtaUrl(buildWhatsAppLoginUrl(hint.phone || ''));
      }
    };

    void loadBotContact();
    return () => {
      active = false;
    };
  }, [api, hint.phone]);

  useEffect(() => {
    let active = true;
    api
      .getSession()
      .then((payload) => {
        if (!active) return;
        const sessionData = payload?.data || null;
        if (isAuthenticatedSession(sessionData)) {
          setSession(sessionData);
          // Redireciona imediatamente se já estiver autenticado
          window.location.replace(config.panelPath);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [api]);

  const finalizeGoogleCredential = useCallback(
    async (credential) => {
      const idToken = String(credential || '').trim();
      if (!idToken) {
        setErrorMessage('Nao foi possivel receber o token Google.');
        return;
      }
      if (!consentAccepted) {
        setErrorMessage('Aceite os Termos e Privacidade para continuar.');
        return;
      }

      setErrorMessage('');
      setIsSubmittingGoogle(true);
      setGoogleStatusMessage('Validando conta Google...');

      try {
        const payload = await api.createSession(buildGoogleAuthPayload(idToken, hint));
        const sessionData = payload?.data || null;
        if (!isAuthenticatedSession(sessionData)) {
          throw new Error('Nao foi possivel criar sessao Google.');
        }
        setSession(sessionData);
        setGoogleStatusMessage('Login concluido. Redirecionando...');
        window.setTimeout(() => {
          window.location.replace(config.panelPath);
        }, 120);
      } catch (error) {
        setErrorMessage(error?.message || 'Falha ao concluir login Google.');
        setGoogleStatusMessage('Falha ao validar conta Google.');
      } finally {
        setIsSubmittingGoogle(false);
      }
    },
    [api, config.panelPath, consentAccepted, hint],
  );

  useEffect(() => {
    let active = true;
    if (!hint.hasPayload) return () => {};

    const initGoogle = async () => {
      try {
        setErrorMessage('');
        setGoogleReady(false);
        setGoogleStatusMessage('Aguardando Google...');

        const configPayload = await api.getConfig();
        if (!active) return;
        const googleAuth = configPayload?.data?.auth?.google || {};
        const clientId = String(googleAuth?.client_id || '').trim();
        const enabled = Boolean(googleAuth?.enabled);

        if (!enabled || !clientId) {
          setGoogleStatusMessage('Login Google desabilitado neste ambiente.');
          return;
        }

        setGoogleClientId(clientId);
        await loadGoogleScript();
        if (!active) return;

        const googleAccounts = globalThis.google?.accounts?.id;
        const buttonElement = googleButtonRef.current;
        if (!googleAccounts || !buttonElement) {
          setGoogleStatusMessage('SDK Google nao carregado.');
          return;
        }

        googleAccounts.initialize({
          client_id: clientId,
          callback: (response) => {
            void finalizeGoogleCredential(response?.credential || '');
          },
        });

        const width = Math.max(220, Math.min(320, Math.floor(Number(buttonElement.clientWidth || 280))));
        buttonElement.innerHTML = '';
        googleAccounts.renderButton(buttonElement, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          width,
        });

        setGoogleReady(true);
        setGoogleStatusMessage('Selecione sua conta Google para continuar.');
      } catch (error) {
        if (!active) return;
        setGoogleStatusMessage('Falha ao carregar login Google.');
        setErrorMessage(error?.message || 'Nao foi possivel inicializar o Google.');
      }
    };

    void initGoogle();
    return () => {
      active = false;
    };
  }, [api, finalizeGoogleCredential, hint.hasPayload]);

  useEffect(() => {
    const observer =
      typeof globalThis.IntersectionObserver === 'function'
        ? new globalThis.IntersectionObserver(
            (entries) => {
              entries.forEach((entry) => {
                if (entry.isIntersecting) {
                  entry.target.classList.add('is-visible');
                  observer.unobserve(entry.target);
                }
              });
            },
            { threshold: 0.1 },
          )
        : null;

    document.querySelectorAll('[data-reveal]').forEach((el, i) => {
      el.style.setProperty('--reveal-delay', `${i * 80}ms`);
      if (observer) {
        observer.observe(el);
      } else {
        el.classList.add('is-visible');
      }
    });

    return () => {
      if (observer) observer.disconnect();
    };
  }, []);

  const authInfo = useMemo(() => {
    if (!session?.authenticated) return { href: '/login/', label: 'Entrar', image: null };
    return {
      href: '/user/',
      label: session.user?.name?.split(' ')[0] || 'Perfil',
      image: session.user?.picture || FALLBACK_THUMB_URL,
    };
  }, [session]);

  const botPhoneMeta = botPhone ? html`<p className="text-[11px] text-center text-base-content/45">Bot detectado: <b>+${formatPhone(botPhone)}</b></p>` : null;

  return html`
    <div className="min-h-screen bg-base-100 font-sans selection:bg-primary selection:text-primary-content">
      <header className="sticky top-0 z-50 border-b border-base-200 bg-base-100/80 backdrop-blur-xl">
        <div className="container mx-auto px-4">
          <div className="flex h-16 items-center justify-between gap-4">
            <div className="flex-1">
              <a href="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
                <img src="/assets/images/brand-logo-128.webp" className="w-8 h-8 rounded-xl shadow-sm" alt="Logo" />
                <span className="text-base sm:text-lg font-black tracking-tight">OmniZap<span className="text-primary">.</span></span>
              </a>
            </div>

            <div className="flex items-center gap-3">
              <a href=${authInfo.href} className="btn btn-ghost btn-sm h-9 min-h-0 gap-2 rounded-xl border border-base-300 hover:border-primary transition-all px-3">
                ${authInfo.image ? html`<img src=${authInfo.image} className="w-5 h-5 rounded-full object-cover" />` : null}
                <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider">${authInfo.label}</span>
              </a>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12 lg:py-20 flex flex-col items-center">
        <div className="w-full max-w-md space-y-8">
          <div data-reveal="fade-up" className="text-center space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-[10px] font-bold uppercase tracking-widest">Acesso Restrito · Criptografado</div>
            <h1 className="text-4xl font-black tracking-tight text-balance">Entrar no <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">OmniZap</span></h1>
            <p className="text-base-content/60 leading-relaxed">Conecte sua conta de forma segura para gerenciar suas comunidades e automacoes.</p>
          </div>

          <div data-reveal="fade-up" className="glass-card rounded-[2.5rem] p-8 space-y-8 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-3xl -mr-16 -mt-16"></div>

            <div className="space-y-6 relative z-10">
              ${!hint.hasPayload
                ? html`
                    <div className="space-y-4">
                      <div className="p-4 rounded-2xl bg-base-200/50 border border-base-300">
                        <p className="text-xs font-bold text-base-content/40 uppercase tracking-widest mb-2 text-center">Recomendado</p>
                        <a href=${whatsappCtaUrl} target="_blank" className="btn btn-primary btn-block rounded-2xl h-14 font-black shadow-lg shadow-primary/20 gap-3 group" rel="noreferrer noopener">
                          Entrar via WhatsApp
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 group-hover:scale-110 transition-transform" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.347-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.136 1.36.117 1.871.05.57-.075 1.758-.463 2.005-1.114.248-.651.248-1.212.173-1.327-.075-.115-.272-.19-.57-.339z" /></svg>
                        </a>
                      </div>
                      ${botPhoneMeta}
                      <p className="text-[11px] text-center text-base-content/40 leading-relaxed px-4">Abra o bot no WhatsApp e envie <b>"iniciar"</b> para receber seu link seguro de acesso.</p>
                    </div>
                  `
                : html`
                    <div className="space-y-6">
                      <div className="flex items-center gap-4 p-4 rounded-2xl bg-success/10 border border-success/20">
                        <div className="w-10 h-10 rounded-full bg-success flex items-center justify-center text-success-content">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
                        </div>
                        <div>
                          <p className="text-xs font-black uppercase tracking-widest text-success">Vinculo Detectado</p>
                          <p className="text-sm font-bold text-success/80">+${formatPhone(hint.phone)}</p>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <p className="text-xs font-bold text-base-content/40 uppercase tracking-[0.2em] text-center">Concluir com Google</p>
                        <div id="google-login-btn" ref=${googleButtonRef} className="w-full flex justify-center py-2 bg-white rounded-2xl overflow-hidden shadow-sm min-h-14"></div>
                        <p className="text-[11px] text-center text-base-content/45">${isSubmittingGoogle ? 'Finalizando login...' : googleStatusMessage}</p>
                        ${googleClientId ? html`<p className="text-[10px] text-center text-base-content/30">Google Client configurado.</p>` : null} ${!googleReady && !isSubmittingGoogle ? html`<p className="text-[10px] text-center text-base-content/35">Se o botao nao aparecer, recarregue a pagina apos alguns segundos.</p>` : null}
                      </div>

                      <div className="form-control">
                        <label className="label cursor-pointer justify-start gap-3 p-0">
                          <input type="checkbox" className="checkbox checkbox-primary checkbox-sm rounded-md" checked=${consentAccepted} onChange=${(e) => setConsentAccepted(e.target.checked)} />
                          <span className="label-text text-[11px] text-base-content/60 leading-tight"> Aceito os <a href="/termos-de-uso/" className="text-primary font-bold hover:underline">Termos</a> e <a href="/politica-de-privacidade/" className="text-primary font-bold hover:underline">Privacidade</a>. </span>
                        </label>
                      </div>
                    </div>
                  `}
              ${errorMessage
                ? html`
                    <div className="alert alert-error text-xs rounded-2xl py-3 border-none bg-error/20 text-error-content font-bold">
                      <span>${errorMessage}</span>
                    </div>
                  `
                : null}
            </div>
          </div>

          <div data-reveal="fade-up" className="grid grid-cols-3 gap-4">
            ${LEGAL_DOCS.map(
              (doc) => html`
                <a href=${doc.href} className="text-center p-3 rounded-2xl border border-base-200 hover:bg-base-200 transition-all">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">${doc.label}</span>
                </a>
              `,
            )}
          </div>
        </div>
      </main>

      <footer className="py-12 border-t border-base-200">
        <div className="container mx-auto px-4 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-base-content/20">© 2026 OMNIZAP · SECURE LOGIN V2</p>
        </div>
      </footer>
    </div>
  `;
};

const rootElement = document.getElementById('login-react-root');
if (rootElement) {
  const config = resolveLoginConfig(rootElement);
  createRoot(rootElement).render(html`<${LoginApp} config=${config} />`);
}
