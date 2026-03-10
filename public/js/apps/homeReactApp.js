import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';

const html = htm.bind(React.createElement);

const FALLBACK_THUMB_URL = '/assets/images/brand-logo-128.webp';
const HOME_BOOTSTRAP_ENDPOINT = '/api/home-bootstrap';
const SOCIAL_PROOF_REFRESH_MS = 15_000;
const COUNTUP_DURATION_MS = 1200;
const COUNTABLE_METRICS = ['users', 'messages', 'commands', 'packs', 'stickers'];
const REVEAL_STAGGER_MS = 60;
const MAX_REVEAL_DELAY_MS = 400;

const DEFAULT_METRICS = {
  users: '...',
  messages: '...',
  commands: '...',
  packs: '...',
  stickers: '...',
  latency: '...',
  status: 'online',
};

const NAV_ITEMS = [
  { href: '#recursos', label: 'Recursos' },
  { href: '#comandos', label: 'Comandos' },
  { href: '/stickers/', label: 'Marketplace' },
  { href: '#faq', label: 'Dúvidas' },
];

const FEATURES = [
  { title: 'IA Integrada', desc: 'Respostas inteligentes e comandos de visão computacional direto no chat.', icon: '🤖' },
  { title: 'Gestão de Packs', desc: 'Crie e organize coleções de figurinhas via web ou comandos.', icon: '🎨' },
  { title: 'Moderação Ativa', desc: 'Anti-link, captcha e proteção automática contra spam.', icon: '🛡️' },
  { title: 'Engajamento', desc: 'Rankings, jogos e sistemas de reputação para sua comunidade.', icon: '📈' },
  { title: 'Multi-Mídia', desc: 'Download de vídeos, músicas e conversões instantâneas.', icon: '🎵' },
  { title: 'Open Source', desc: 'Transparência total e evolução colaborativa pela comunidade.', icon: '🌐' },
];

const COMMAND_BLOCKS = [
  {
    title: 'Figurinhas',
    items: [
      ['/s', 'Cria figurinha'],
      ['/st', 'Figurinha rápida'],
      ['/pack create', 'Cria pack web'],
      ['/toimg', 'Sticker para imagem'],
    ],
  },
  {
    title: 'Administração',
    items: [
      ['/ban', 'Remove usuário'],
      ['/captcha', 'Ativa proteção'],
      ['/noticias', 'Broadcast de news'],
      ['/setgroup', 'Configura grupo'],
    ],
  },
  {
    title: 'Utilidades',
    items: [
      ['/play', 'Toca música'],
      ['/tiktok', 'Baixa vídeo'],
      ['/user perfil', 'Dados da conta'],
      ['/menu ia', 'Menu de IA'],
    ],
  },
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
    homeBootstrapPayloadPromise = loadHomeBootstrapPayload().catch((err) => {
      homeBootstrapPayloadPromise = null;
      throw err;
    });
  }
  return homeBootstrapPayloadPromise;
};

const shortNum = (value) =>
  new Intl.NumberFormat('pt-BR', {
    notation: Number(value) >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(Math.max(0, Number(value) || 0));

const App = () => {
  const [session, setSession] = useState(null);
  const [botMenuUrl, setBotMenuUrl] = useState('/login/');
  const [metrics, setMetrics] = useState(DEFAULT_METRICS);
  const counterValuesRef = useRef({ users: 0, messages: 0, commands: 0, packs: 0, stickers: 0 });
  const counterFramesRef = useRef({});

  useEffect(() => {
    let active = true;
    const requestAnimation = typeof globalThis.requestAnimationFrame === 'function' ? globalThis.requestAnimationFrame.bind(globalThis) : null;
    const cancelAnimation = typeof globalThis.cancelAnimationFrame === 'function' ? globalThis.cancelAnimationFrame.bind(globalThis) : null;

    const animateCounter = (key, target) => {
      if (!active || typeof requestAnimation !== 'function') {
        setMetrics((m) => ({ ...m, [key]: shortNum(target) }));
        return;
      }
      const startValue = counterValuesRef.current[key] || 0;
      const startTime = performance.now();

      const step = (now) => {
        const progress = Math.min(1, (now - startTime) / COUNTUP_DURATION_MS);
        const eased = 1 - Math.pow(1 - progress, 4); // Quart ease-out
        const current = startValue + (target - startValue) * eased;

        setMetrics((m) => ({ ...m, [key]: shortNum(current) }));

        if (progress < 1) {
          counterFramesRef.current[key] = requestAnimation(step);
        } else {
          counterValuesRef.current[key] = target;
        }
      };
      if (typeof cancelAnimation === 'function') {
        cancelAnimation(counterFramesRef.current[key]);
      }
      counterFramesRef.current[key] = requestAnimation(step);
    };

    const runLoad = async ({ forceRefresh = false } = {}) => {
      try {
        const data = await fetchHomeBootstrapPayload({ forceRefresh });
        if (!active) return;

        const realtime = data?.home_realtime || {};
        const stats = data?.marketplace_stats?.data || data?.stats || {};
        const summary = data?.system_summary || {};
        const botContact = data?.bot_contact || {};

        setSession(data?.session?.authenticated ? data.session : null);

        // Tenta resolver a URL do bot de múltiplas fontes possíveis na resposta
        const contactUrl = botContact?.urls?.menu || botContact?.url || '/login/';
        setBotMenuUrl(contactUrl);

        const targetValues = {
          users: Number(realtime?.total_users || 0),
          messages: Number(realtime?.total_messages || 0),
          commands: Number(realtime?.total_commands || 0),
          packs: Number(stats?.packs_total || stats?.total_packs || 0),
          stickers: Number(stats?.stickers_total || stats?.total_stickers || 0),
        };

        COUNTABLE_METRICS.forEach((key) => animateCounter(key, targetValues[key]));

        setMetrics((m) => ({
          ...m,
          latency: realtime?.system_latency_ms ? `${Math.round(realtime.system_latency_ms)}ms` : '...',
          status: (summary?.system_status || summary?.bot?.connection_status || 'online').toLowerCase(),
        }));
      } catch (err) {
        console.warn('Home bootstrap error', err);
      }
    };

    runLoad();
    const interval = setInterval(() => runLoad({ forceRefresh: true }), SOCIAL_PROOF_REFRESH_MS);

    // Reveal Observer
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
            { threshold: 0.1, rootMargin: '0px 0px -50px 0px' },
          )
        : null;

    document.querySelectorAll('[data-reveal]').forEach((el, i) => {
      el.style.setProperty('--reveal-delay', `${Math.min(i * REVEAL_STAGGER_MS, MAX_REVEAL_DELAY_MS)}ms`);
      if (observer) {
        observer.observe(el);
      } else {
        el.classList.add('is-visible');
      }
    });

    return () => {
      active = false;
      clearInterval(interval);
      if (observer) observer.disconnect();
    };
  }, []);

  const authInfo = useMemo(() => {
    if (!session?.user) return { href: '/login/', label: 'Entrar', image: null };
    const name = String(session.user.name || session.user.email || 'Perfil').trim();
    const firstName = name.split(/\s+/)[0] || 'Perfil';
    return {
      href: '/user/',
      label: firstName,
      image: session.user.picture || FALLBACK_THUMB_URL,
    };
  }, [session]);

  return html`
    <div className="min-h-screen bg-base-100 font-sans selection:bg-primary selection:text-primary-content">
      <!-- Navbar -->
      <header className="sticky top-0 z-50 border-b border-base-200 bg-base-100/80 backdrop-blur-xl transition-all">
        <div className="container mx-auto px-4">
          <!-- Top Row: Logo & Auth -->
          <div className="flex h-16 items-center justify-between gap-4">
            <div className="flex-1">
              <a href="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
                <img src="/assets/images/brand-logo-128.webp" className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl shadow-sm" alt="Logo" />
                <span className="text-base sm:text-lg font-black tracking-tight">OmniZap<span className="text-primary">.</span></span>
              </a>
            </div>

            <!-- Desktop Nav Items (Middle) -->
            <nav className="hidden lg:flex items-center gap-1 mx-4">${NAV_ITEMS.map((item) => html` <a href=${item.href} className="btn btn-ghost btn-sm rounded-lg font-medium text-base-content/70 hover:text-primary hover:bg-primary/5 transition-all"> ${item.label} </a> `)}</nav>

            <div className="flex items-center gap-2 sm:gap-3">
              <a href=${authInfo.href} className="btn btn-ghost btn-sm h-9 min-h-0 gap-2 rounded-xl border border-base-300 hover:border-primary transition-all px-2 sm:px-3">
                ${authInfo.image ? html`<img src=${authInfo.image} className="w-5 h-5 sm:w-6 sm:h-6 rounded-full object-cover" />` : null}
                <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider">${authInfo.label}</span>
              </a>
              <a href=${botMenuUrl} className="btn btn-primary btn-sm h-9 min-h-0 rounded-xl shadow-lg shadow-primary/20 text-[10px] sm:text-xs font-bold uppercase"> <span className="hidden xs:inline">Adicionar</span> Bot </a>
            </div>
          </div>

          <!-- Bottom Row (Mobile Only): Horizontal Scroll Links -->
          <nav className="flex lg:hidden items-center gap-2 overflow-x-auto no-scrollbar pb-3 -mx-1 px-1">${NAV_ITEMS.map((item) => html` <a href=${item.href} className="btn btn-ghost btn-xs rounded-lg font-bold text-base-content/50 whitespace-nowrap bg-base-200/50"> ${item.label} </a> `)}</nav>
        </div>
      </header>

      <main>
        <!-- Hero Section -->
        <section className="relative overflow-hidden py-12 lg:py-24">
          <div className="container mx-auto px-4 relative z-10">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div data-reveal="fade-right" className="text-center lg:text-left space-y-8">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-[11px] font-bold uppercase tracking-widest">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                  </span>
                  Sistema Operacional · ${metrics.status}
                </div>

                <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black leading-[1.1] tracking-tight text-balance">Automação profissional para seu <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">WhatsApp</span>.</h1>

                <p className="text-lg text-base-content/60 max-w-xl mx-auto lg:mx-0 leading-relaxed">O bot definitivo para gerenciar comunidades, criar figurinhas e automatizar fluxos sem precisar escrever uma linha de código.</p>

                <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                  <a href=${botMenuUrl} className="btn btn-primary btn-lg rounded-2xl shadow-xl shadow-primary/20 gap-3 group">
                    Começar Agora
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                  </a>
                  <a href="/stickers/" className="btn btn-outline btn-lg rounded-2xl border-base-300 hover:bg-base-200"> Ver Marketplace </a>
                </div>

                <div className="flex flex-wrap justify-center lg:justify-start gap-8 pt-4">
                  <div>
                    <div className="text-3xl font-black text-primary">${metrics.users}</div>
                    <div className="text-[10px] uppercase font-bold text-base-content/40 tracking-widest">Usuários Ativos</div>
                  </div>
                  <div className="w-px h-10 bg-base-200 hidden sm:block"></div>
                  <div>
                    <div className="text-3xl font-black">${metrics.messages}</div>
                    <div className="text-[10px] uppercase font-bold text-base-content/40 tracking-widest">Msgs Processadas</div>
                  </div>
                  <div className="w-px h-10 bg-base-200 hidden sm:block"></div>
                  <div>
                    <div className="text-3xl font-black text-secondary">${metrics.stickers}</div>
                    <div className="text-[10px] uppercase font-bold text-base-content/40 tracking-widest">Figurinhas</div>
                  </div>
                </div>
              </div>

              <div data-reveal="fade-left" className="relative group lg:block">
                <div className="absolute -inset-4 bg-gradient-to-r from-primary/20 to-secondary/20 rounded-[2.5rem] blur-3xl opacity-50 group-hover:opacity-100 transition-opacity"></div>
                <div className="relative bg-base-200/50 backdrop-blur-2xl rounded-[2rem] border border-base-content/5 p-6 shadow-2xl">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-error/20"></div>
                      <div className="w-3 h-3 rounded-full bg-warning/20"></div>
                      <div className="w-3 h-3 rounded-full bg-success/20"></div>
                    </div>
                    <div className="text-[10px] font-mono text-base-content/30 tracking-tighter">LATENCY: ${metrics.latency}</div>
                  </div>

                  <div className="space-y-4 font-mono text-sm sm:text-base">
                    <div className="flex gap-3">
                      <span className="text-primary font-bold">visitor:</span>
                      <span className="text-base-content/80">"Como faço stickers?"</span>
                    </div>
                    <div className="flex gap-3 bg-primary/5 p-3 rounded-xl border border-primary/10">
                      <span className="text-success font-bold">omnizap:</span>
                      <span className="text-base-content/90 italic">"Envie uma imagem com o comando /s e eu faço o resto! ✨"</span>
                    </div>
                    <div className="flex gap-3">
                      <span className="text-primary font-bold">visitor:</span>
                      <span className="text-base-content/80">"E pra moderar o grupo?"</span>
                    </div>
                    <div className="flex gap-3 bg-secondary/5 p-3 rounded-xl border border-secondary/10">
                      <span className="text-info font-bold">omnizap:</span>
                      <span className="text-base-content/90">"Use /captcha ou /ban. Proteção 24/7 ativa. 🛡️"</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- Stats Section -->
        <section id="recursos" className="py-20 bg-base-200/30">
          <div className="container mx-auto px-4">
            <div data-reveal="fade-up" className="text-center max-w-3xl mx-auto mb-16 space-y-4">
              <h2 className="text-3xl sm:text-5xl font-black tracking-tight">Recursos Potentes</h2>
              <p className="text-base-content/60 text-lg">Tudo o que você precisa para levar seu grupo ao próximo nível.</p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              ${FEATURES.map(
                (f) => html`
                  <div data-reveal="fade-up" className="group p-8 rounded-3xl bg-base-100 border border-base-200 hover:border-primary/30 transition-all hover:shadow-2xl hover:shadow-primary/5">
                    <div className="w-14 h-14 rounded-2xl bg-base-200 flex items-center justify-center text-3xl mb-6 group-hover:scale-110 group-hover:bg-primary/10 transition-all">${f.icon}</div>
                    <h3 className="text-xl font-bold mb-3">${f.title}</h3>
                    <p className="text-base-content/50 leading-relaxed text-sm">${f.desc}</p>
                  </div>
                `,
              )}
            </div>
          </div>
        </section>

        <!-- Commands Section -->
        <section id="comandos" className="py-16 sm:py-24">
          <div className="container mx-auto px-4">
            <div className="flex flex-col lg:flex-row gap-10 lg:gap-16 items-start">
              <div className="w-full lg:w-1/3 lg:sticky lg:top-32 space-y-4 sm:space-y-6 text-center lg:text-left">
                <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-balance">
                  Comandos de <br className="hidden lg:block" />
                  Resposta Rápida
                </h2>
                <p className="text-base-content/60 leading-relaxed text-sm sm:text-base max-w-xl mx-auto lg:mx-0">Interaja com o bot através de comandos intuitivos. Dezenas de ferramentas poderosas ao seu alcance.</p>
                <div className="hidden lg:block p-6 rounded-2xl bg-primary/5 border border-primary/10">
                  <div className="text-primary font-black text-xl mb-1">${metrics.commands}+</div>
                  <div className="text-[10px] uppercase font-bold tracking-widest opacity-50">Comandos Ativos</div>
                </div>
                <a href="/comandos/" className="btn btn-outline btn-block rounded-xl hidden lg:flex">Ver Todos os Comandos</a>
              </div>

              <div className="w-full lg:w-2/3 grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                ${COMMAND_BLOCKS.map(
                  (block) => html`
                    <div data-reveal="fade-up" className="bg-base-200/40 backdrop-blur-sm border border-base-300 rounded-3xl overflow-hidden">
                      <div className="p-5 sm:p-8">
                        <h3 className="text-xs sm:text-sm font-black uppercase tracking-[0.2em] text-primary/60 mb-5 sm:mb-6 flex items-center gap-2">
                          <span className="w-1 h-1 rounded-full bg-primary"></span>
                          ${block.title}
                        </h3>
                        <div className="grid gap-4 sm:gap-5">
                          ${block.items.map(
                            ([cmd, label]) => html`
                              <div className="flex items-start gap-3 group">
                                <div className="flex-1">
                                  <div className="font-mono text-sm font-bold text-base-content/90 group-hover:text-primary transition-colors">${cmd}</div>
                                  <div className="text-[11px] sm:text-xs text-base-content/40 font-medium leading-tight">${label}</div>
                                </div>
                              </div>
                            `,
                          )}
                        </div>
                      </div>
                    </div>
                  `,
                )}

                <!-- Mobile Only CTA -->
                <div className="lg:hidden mt-2">
                  <a href="/comandos/" className="btn btn-block btn-outline border-base-300 rounded-2xl h-14 font-bold"> Ver Todos os ${metrics.commands} Comandos </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- CTA Final -->
        <section className="py-24 container mx-auto px-4">
          <div data-reveal="fade-up" className="relative p-12 sm:p-20 rounded-[3rem] overflow-hidden text-center text-primary-content">
            <div className="absolute inset-0 bg-gradient-to-br from-primary to-secondary"></div>
            <div className="absolute inset-0 opacity-20 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]"></div>

            <div className="relative z-10 space-y-8">
              <h2 className="text-3xl sm:text-5xl lg:text-6xl font-black leading-tight text-balance">Pronto para transformar seu grupo?</h2>
              <p className="text-lg opacity-80 max-w-2xl mx-auto font-medium">Junte-se a milhares de administradores que já automatizaram suas comunidades com o OmniZap Bot.</p>
              <div className="pt-4">
                <a href=${botMenuUrl} className="btn btn-lg bg-base-100 border-none text-primary rounded-2xl hover:scale-105 transition-transform shadow-2xl px-12 h-16 text-lg font-black"> Adicionar Agora </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <!-- Footer -->
      <footer className="bg-base-200/50 border-t border-base-300 py-16">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-12 mb-12 text-center lg:text-left">
            <div className="col-span-2 lg:col-span-1 space-y-4">
              <div className="flex items-center justify-center lg:justify-start gap-2">
                <img src="/assets/images/brand-logo-128.webp" className="w-8 h-8 rounded-lg" />
                <span className="text-xl font-black tracking-tighter">OmniZap<span className="text-primary">.</span></span>
              </div>
              <p className="text-xs text-base-content/40 leading-relaxed">
                Plataforma Open Source de automação WhatsApp. <br />
                Feito para a comunidade brasileira.
              </p>
            </div>

            <div>
              <h4 className="font-bold text-xs uppercase tracking-widest text-base-content/30 mb-6">Plataforma</h4>
              <ul className="space-y-3 text-sm font-medium text-base-content/60">
                <li><a href="/stickers/" className="hover:text-primary transition-colors">Marketplace</a></li>
                <li><a href="/comandos/" className="hover:text-primary transition-colors">Comandos</a></li>
                <li><a href="/api-docs/" className="hover:text-primary transition-colors">API Docs</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold text-xs uppercase tracking-widest text-base-content/30 mb-6">Legal</h4>
              <ul className="space-y-3 text-sm font-medium text-base-content/60">
                <li><a href="/termos-de-uso/" className="hover:text-primary transition-colors">Termos</a></li>
                <li><a href="/politica-de-privacidade/" className="hover:text-primary transition-colors">Privacidade</a></li>
                <li><a href="/licenca/" className="hover:text-primary transition-colors">Licença</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold text-xs uppercase tracking-widest text-base-content/30 mb-6">Social</h4>
              <ul className="space-y-3 text-sm font-medium text-base-content/60">
                <li><a href="https://github.com/Kaikygr/omnizap-system" target="_blank" className="hover:text-primary transition-colors">GitHub</a></li>
                <li><a href=${botMenuUrl} className="hover:text-primary transition-colors">WhatsApp</a></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-base-content/5 pt-8 flex flex-col sm:flex-row justify-between items-center gap-4 text-[10px] font-bold uppercase tracking-[0.2em] text-base-content/30">
            <span>© 2026 OMNIZAP SYSTEM</span>
            <div className="flex items-center gap-4">
              <span>STATUS: ${metrics.status}</span>
              <span className="text-primary">•</span>
              <span>VERSION: 2.5.6</span>
            </div>
          </div>
        </div>
      </footer>

      <!-- Floating Action -->
      <a href=${botMenuUrl} target="_blank" className="btn btn-primary btn-circle fixed bottom-6 right-6 z-50 shadow-2xl shadow-primary/40 hover:scale-110 transition-transform">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
      </a>
    </div>
  `;
};

const rootElement = document.getElementById('home-react-root');
if (rootElement) {
  createRoot(rootElement).render(html`<${App} />`);
}
