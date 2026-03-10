import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';
import { formatDateTime, formatPhone } from './userProfile/actions.js';

const html = htm.bind(React.createElement);

const DEFAULT_API_BASE_PATH = '/api';
const DEFAULT_LOGIN_PATH = '/login';
const DEFAULT_FALLBACK_AVATAR = '/assets/images/brand-logo-128.webp';

const TABS = [
  { key: 'summary', label: 'Visão Geral', icon: '📊' },
  { key: 'account', label: 'Segurança', icon: '🔒' },
  { key: 'support', label: 'Suporte', icon: '💬' },
];

const UserApp = ({ config }) => {
  const [activeTab, setActiveTab] = useState('summary');
  const [isLoading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [session, setSession] = useState(null);

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
      el.style.setProperty('--reveal-delay', `${i * 60}ms`);
      if (observer) {
        observer.observe(el);
      } else {
        el.classList.add('is-visible');
      }
    });

    return () => {
      if (observer) observer.disconnect();
    };
  }, [activeTab, isLoading]);

  useEffect(() => {
    // Simulando carregamento de dados para o layout novo
    const loadData = async () => {
      try {
        const res = await fetch(`${config.apiBasePath}/me?view=summary`, { credentials: 'include' });
        const payload = await res.json();
        if (payload?.data) {
          setSummary(payload.data.account);
          setSession(payload.data.session);
        }
      } catch (err) {
        console.error('Failed to load user data', err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [config.apiBasePath]);

  const authInfo = useMemo(() => {
    if (!session?.user) return { href: '/login/', label: 'Entrar', image: null };
    return {
      href: '/user/',
      label: session.user.name?.split(' ')[0] || 'Perfil',
      image: session.user.picture || DEFAULT_FALLBACK_AVATAR,
    };
  }, [session]);

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
              <button onClick=${() => window.location.assign('/login/')} className="btn btn-ghost btn-sm h-9 min-h-0 gap-2 rounded-xl border border-base-300 hover:border-error hover:text-error transition-all px-3 font-bold text-[10px] uppercase">Sair</button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 lg:py-12">
        <div className="grid lg:grid-cols-[280px_1fr] gap-8 items-start">
          <!-- Sidebar Navigation -->
          <aside data-reveal="fade-right" className="space-y-6">
            <div className="glass-card rounded-3xl p-6 text-center space-y-4">
              <div className="relative inline-block">
                <img src=${authInfo.image} className="w-20 h-20 rounded-2xl border-2 border-primary/20 p-1 object-cover mx-auto" />
                <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-success border-2 border-base-100 rounded-full"></div>
              </div>
              <div>
                <h2 className="text-lg font-black tracking-tight">${session?.user?.name || 'Carregando...'}</h2>
                <p className="text-xs text-base-content/40 font-bold uppercase tracking-widest">${summary?.plan_label || 'Plano Free'}</p>
              </div>
            </div>

            <nav className="glass-card rounded-3xl p-2 space-y-1">
              ${TABS.map(
                (tab) => html`
                  <button onClick=${() => setActiveTab(tab.key)} className=${`w-full flex items-center gap-3 px-4 py-3 rounded-2xl font-bold text-sm transition-all ${activeTab === tab.key ? 'bg-primary text-primary-content shadow-lg shadow-primary/20' : 'hover:bg-base-200 text-base-content/60'}`}>
                    <span className="text-lg">${tab.icon}</span>
                    ${tab.label}
                  </button>
                `,
              )}
            </nav>
          </aside>

          <!-- Content Area -->
          <div className="space-y-6">
            <div data-reveal="fade-up" className="space-y-2">
              <h1 className="text-3xl font-black tracking-tight text-balance">Minha <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">Conta</span></h1>
              <p className="text-base-content/50 text-sm font-medium">Gerencie suas preferências e configurações de segurança.</p>
            </div>

            <div data-reveal="fade-up" className="glass-card rounded-[2.5rem] p-6 lg:p-10 min-h-[400px]">
              ${isLoading
                ? html`
                    <div className="flex flex-col items-center justify-center h-full space-y-4 py-20">
                      <span className="loading loading-ring loading-lg text-primary"></span>
                      <p className="text-xs font-bold uppercase tracking-widest text-base-content/30">Sincronizando dados...</p>
                    </div>
                  `
                : html`
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                      ${activeTab === 'summary' &&
                      html`
                        <div className="grid gap-6">
                          <div className="grid sm:grid-cols-2 gap-4">
                            <div className="p-6 rounded-3xl bg-base-200/50 border border-base-300 space-y-1">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">Status do Bot</p>
                              <p className="text-xl font-black text-success flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-success animate-pulse"></span>
                                Conectado
                              </p>
                            </div>
                            <div className="p-6 rounded-3xl bg-base-200/50 border border-base-300 space-y-1">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">Número Vinculado</p>
                              <p className="text-xl font-black">${summary?.owner_phone ? `+${formatPhone(summary.owner_phone)}` : 'Não vinculado'}</p>
                            </div>
                          </div>

                          <div className="p-8 rounded-[2rem] bg-primary/5 border border-primary/10 space-y-4">
                            <h3 className="font-black text-lg">Informações do Perfil</h3>
                            <div className="grid sm:grid-cols-2 gap-y-4 gap-x-8">
                              <div>
                                <p className="text-[10px] font-bold uppercase text-base-content/30 tracking-wider">E-mail</p>
                                <p className="text-sm font-bold opacity-80">${session?.user?.email}</p>
                              </div>
                              <div>
                                <p className="text-[10px] font-bold uppercase text-base-content/30 tracking-wider">Último Acesso</p>
                                <p className="text-sm font-bold opacity-80">${formatDateTime(summary?.last_seen_at) || 'Recentemente'}</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      `}
                      ${activeTab === 'account' &&
                      html`
                        <div className="space-y-8">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-2xl bg-secondary/10 flex items-center justify-center text-2xl">🔒</div>
                            <div>
                              <h3 className="text-xl font-black">Segurança da Senha</h3>
                              <p className="text-sm text-base-content/50">Mantenha sua conta protegida com uma senha forte.</p>
                            </div>
                          </div>

                          <form className="grid sm:grid-cols-2 gap-4 max-w-2xl">
                            <div className="form-control">
                              <label className="label"><span className="label-text font-bold text-xs">Nova Senha</span></label>
                              <input type="password" placeholder="••••••••" className="input input-bordered rounded-2xl bg-base-200/50" />
                            </div>
                            <div className="form-control">
                              <label className="label"><span className="label-text font-bold text-xs">Confirmar Senha</span></label>
                              <input type="password" placeholder="••••••••" className="input input-bordered rounded-2xl bg-base-200/50" />
                            </div>
                            <div className="sm:col-span-2 pt-4">
                              <button className="btn btn-primary rounded-2xl px-12">Atualizar Senha</button>
                            </div>
                          </form>
                        </div>
                      `}
                      ${activeTab === 'support' &&
                      html`
                        <div className="text-center max-w-lg mx-auto py-12 space-y-8">
                          <div className="w-20 h-20 rounded-[2rem] bg-primary/10 flex items-center justify-center text-4xl mx-auto">💬</div>
                          <div className="space-y-2">
                            <h3 className="text-2xl font-black">Precisa de ajuda?</h3>
                            <p className="text-base-content/60">Nosso time de suporte está disponível via WhatsApp para resolver qualquer problema técnico.</p>
                          </div>
                          <a href="https://wa.me/559591122954" target="_blank" className="btn btn-success btn-lg rounded-2xl shadow-xl shadow-success/20 w-full font-black"> Falar no WhatsApp </a>
                        </div>
                      `}
                    </div>
                  `}
            </div>
          </div>
        </div>
      </main>

      <!-- Footer Minimal -->
      <footer className="py-12 border-t border-base-200 mt-auto">
        <div className="container mx-auto px-4 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-base-content/20">© 2026 OMNIZAP SYSTEM · USER DASHBOARD V2</p>
        </div>
      </footer>
    </div>
  `;
};

const rootElement = document.getElementById('user-react-root');
if (rootElement) {
  const config = {
    apiBasePath: rootElement.dataset.apiBasePath || DEFAULT_API_BASE_PATH,
    loginPath: rootElement.dataset.loginPath || DEFAULT_LOGIN_PATH,
    fallbackAvatar: DEFAULT_FALLBACK_AVATAR,
  };
  createRoot(rootElement).render(html`<${UserApp} config=${config} />`);
}
