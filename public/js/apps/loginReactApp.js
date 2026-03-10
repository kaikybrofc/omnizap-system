import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';

const html = htm.bind(React.createElement);

const DEFAULT_TERMS_URL = '/termos-de-uso/';
const DEFAULT_PRIVACY_URL = '/politica-de-privacidade/';
const DEFAULT_AUP_URL = '/aup/';
const DEFAULT_API_BASE_PATH = '/api';
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

const readWhatsAppHintFromSearch = (search) => {
  const params = new URLSearchParams(search || '');
  return {
    hasPayload: Boolean(params.get('wa')),
    phone: normalizeDigits(params.get('wa') || ''),
    ts: params.get('wa_ts') || '',
    sig: params.get('wa_sig') || '',
  };
};

const resolveLoginConfig = (rootElement) => {
  const apiBasePath = String(rootElement?.dataset?.apiBasePath || DEFAULT_API_BASE_PATH).trim() || DEFAULT_API_BASE_PATH;
  return { apiBasePath };
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

const LoginApp = ({ config }) => {
  const hint = useMemo(() => readWhatsAppHintFromSearch(window.location.search), []);
  const session = null;
  const [botPhone, setBotPhone] = useState(() => normalizeDigits(hint.phone || ''));
  const [whatsappCtaUrl, setWhatsappCtaUrl] = useState(() => buildWhatsAppLoginUrl(hint.phone || ''));
  const errorMessage = '';
  const [consentAccepted, setConsentAccepted] = useState(true);

  useEffect(() => {
    let active = true;

    const loadBotContact = async () => {
      try {
        const response = await fetch(`${config.apiBasePath}/bot-contact`, { credentials: 'include' });
        if (!response.ok) return;
        const payload = await response.json().catch(() => null);
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
  }, [config.apiBasePath, hint.phone]);

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
      <!-- Navbar -->
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
            <p className="text-base-content/60 leading-relaxed">Conecte sua conta de forma segura para gerenciar suas comunidades e automações.</p>
          </div>

          <!-- Main Login Card -->
          <div data-reveal="fade-up" className="glass-card rounded-[2.5rem] p-8 space-y-8 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-3xl -mr-16 -mt-16"></div>

            <div className="space-y-6 relative z-10">
              ${!hint.hasPayload
                ? html`
                    <!-- Step 1: WhatsApp Bridge -->
                    <div className="space-y-4">
                      <div className="p-4 rounded-2xl bg-base-200/50 border border-base-300">
                        <p className="text-xs font-bold text-base-content/40 uppercase tracking-widest mb-2 text-center">Recomendado</p>
                        <a href=${whatsappCtaUrl} target="_blank" className="btn btn-primary btn-block rounded-2xl h-14 font-black shadow-lg shadow-primary/20 gap-3 group">
                          Entrar via WhatsApp
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 group-hover:scale-110 transition-transform" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.347-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.136 1.36.117 1.871.05.57-.075 1.758-.463 2.005-1.114.248-.651.248-1.212.173-1.327-.075-.115-.272-.19-.57-.339z" /></svg>
                        </a>
                      </div>
                      ${botPhoneMeta}
                      <p className="text-[11px] text-center text-base-content/40 leading-relaxed px-4">Abra o bot no WhatsApp e envie <b>"iniciar"</b> para receber seu link seguro de acesso.</p>
                    </div>
                  `
                : html`
                    <!-- Step 2: Google Verification (After WhatsApp) -->
                    <div className="space-y-6">
                      <div className="flex items-center gap-4 p-4 rounded-2xl bg-success/10 border border-success/20">
                        <div className="w-10 h-10 rounded-full bg-success flex items-center justify-center text-success-content">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
                        </div>
                        <div>
                          <p className="text-xs font-black uppercase tracking-widest text-success">Vínculo Detectado</p>
                          <p className="text-sm font-bold text-success/80">+${formatPhone(hint.phone)}</p>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <p className="text-xs font-bold text-base-content/40 uppercase tracking-[0.2em] text-center">Concluir com Google</p>
                        <div id="google-login-btn" className="w-full flex justify-center py-2 bg-white rounded-2xl overflow-hidden shadow-sm hover:opacity-90 transition-all cursor-pointer">
                          <!-- Google button will mount here -->
                          <div className="text-black font-medium flex items-center gap-3">
                            <img src="https://www.gstatic.com/images/branding/product/1x/gsa_512dp.png" className="w-5 h-5" />
                            Aguardando Google...
                          </div>
                        </div>
                      </div>

                      <div className="form-control">
                        <label className="label cursor-pointer justify-start gap-3 p-0">
                          <input type="checkbox" className="checkbox checkbox-primary checkbox-sm rounded-md" checked=${consentAccepted} onChange=${(e) => setConsentAccepted(e.target.checked)} />
                          <span className="label-text text-[11px] text-base-content/60 leading-tight"> Aceito os <a href="/termos-de-uso/" className="text-primary font-bold hover:underline">Termos</a> e <a href="/politica-de-privacidade/" className="text-primary font-bold hover:underline">Privacidade</a>. </span>
                        </label>
                      </div>
                    </div>
                  `}
              ${errorMessage &&
              html`
                <div className="alert alert-error text-xs rounded-2xl py-3 border-none bg-error/20 text-error-content font-bold">
                  <span>${errorMessage}</span>
                </div>
              `}
            </div>
          </div>

          <!-- Help/Links -->
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

      <!-- Footer Minimal -->
      <footer className="py-12 border-t border-base-200">
        <div className="container mx-auto px-4 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-base-content/20">© 2026 OMNIZAP SYSTEM · SECURE LOGIN V2</p>
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
