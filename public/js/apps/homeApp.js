import { React, createRoot, useEffect } from '../runtime/react-runtime.js';

const h = React.createElement;

function HomeEffects() {
  useEffect(() => {
    const toggle = document.getElementById('nav-toggle');
    const nav = document.getElementById('main-nav');
    if (!toggle || !nav) return;

    const handleClick = () => {
      const isOpen = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    };

    toggle.addEventListener('click', handleClick);
    return () => toggle.removeEventListener('click', handleClick);
  }, []);

  useEffect(() => {
    const wppButton = document.getElementById('wpp-float');
    if (!wppButton) return;

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
  }, []);

  useEffect(() => {
    const cpuEl = document.getElementById('metric-host-cpu');
    const memEl = document.getElementById('metric-host-memory');
    const uptimeEl = document.getElementById('metric-process-uptime');
    const obsEl = document.getElementById('metric-observability');
    if (!cpuEl || !memEl || !uptimeEl || !obsEl) return;

    const setFallback = () => {
      cpuEl.textContent = 'CPU host: n/d';
      memEl.textContent = 'RAM host: n/d';
      uptimeEl.textContent = 'Uptime processo: n/d';
      obsEl.textContent = 'Observabilidade: API em /api/sticker-packs';
    };

    const fmt = (value) => (Number.isFinite(value) ? value.toFixed(2) : 'n/d');

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
      })
      .catch(() => {
        setFallback();
      });
  }, []);

  return null;
}

const rootEl = document.getElementById('home-react-root');
if (rootEl) {
  const root = createRoot(rootEl);
  root.render(h(HomeEffects));
}
