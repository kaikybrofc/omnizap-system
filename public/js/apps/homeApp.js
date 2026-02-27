import { React, createRoot, useEffect } from '../runtime/react-runtime.js';

const h = React.createElement;

function HomeEffects() {
  useEffect(() => {
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
      return;
    }

    const shortNum = (value) =>
      new Intl.NumberFormat('pt-BR', {
        notation: value >= 1000 ? 'compact' : 'standard',
        maximumFractionDigits: value >= 1000 ? 1 : 0,
      }).format(Math.max(0, Number(value) || 0));

    const fallbackThumb = 'https://iili.io/FC3FABe.jpg';

    const renderPreview = (packs) => {
      previewGrid.innerHTML = '';
      if (!Array.isArray(packs) || !packs.length) {
        previewStatus.textContent = 'Sem packs em destaque no momento.';
        return;
      }

      previewStatus.textContent = `${packs.length} packs sugeridos agora`;
      packs.slice(0, 6).forEach((pack) => {
        const card = document.createElement('a');
        card.className = 'market-pack';
        card.href = pack.web_url || `/stickers/${encodeURIComponent(pack.pack_key || '')}`;
        card.innerHTML =
          `<img class="market-pack-thumb" loading="lazy" src="${pack.cover_url || fallbackThumb}" alt="${String(
            pack.name || 'Pack',
          ).replace(/"/g, '&quot;')}">` +
          '<div class="market-pack-body">' +
          `<p class="market-pack-name">${pack.name || 'Pack sem nome'}</p>` +
          `<p class="market-pack-meta">${shortNum(pack.sticker_count || 0)} stickers · ${shortNum(
            pack?.engagement?.open_count || 0,
          )} aberturas</p>` +
          '</div>';
        previewGrid.appendChild(card);
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

        proofPacks.textContent = shortNum(stats.packs_total || 0);
        proofStickers.textContent = shortNum(stats.stickers_total || 0);
        proofDownloads.textContent = shortNum(stats.downloads_total || 0);
        renderPreview(trending);
      } catch {
        proofPacks.textContent = 'n/d';
        proofStickers.textContent = 'n/d';
        proofDownloads.textContent = 'n/d';
        proofUsers.textContent = 'n/d';
        proofGroups.textContent = 'n/d';
        proofSystem.textContent = 'n/d';
        previewStatus.textContent = 'Não foi possível carregar o preview agora.';
      }
    };

    loadMarketplaceData();
  }, []);

  useEffect(() => {
    const summaryEl = document.getElementById('rank-summary');
    const listEl = document.getElementById('rank-list');
    if (!summaryEl || !listEl) return;

    const formatDate = (value) => {
      const time = Date.parse(String(value || ''));
      if (!Number.isFinite(time)) return 'n/d';
      return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(time));
    };

    const renderFallback = (message) => {
      summaryEl.textContent = message || 'Ranking indisponível no momento.';
      listEl.innerHTML =
        '<li class=\"rank-item\"><span class=\"rank-name\">Sem dados no momento</span><span class=\"rank-value\">--</span></li>';
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
        avatar.src = row.avatar_url || 'https://iili.io/FC3FABe.jpg';
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

    loadRanking();
    const intervalId = setInterval(loadRanking, 10 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, []);

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
    const proofUsers = document.getElementById('proof-users');
    const proofGroups = document.getElementById('proof-groups');
    const proofSystem = document.getElementById('proof-system');
    if (!cpuEl || !memEl || !uptimeEl || !obsEl) return;

    const shortNum = (value) =>
      new Intl.NumberFormat('pt-BR', {
        notation: Number(value) >= 1000 ? 'compact' : 'standard',
        maximumFractionDigits: Number(value) >= 1000 ? 1 : 0,
      }).format(Math.max(0, Number(value) || 0));

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

        if (proofUsers) proofUsers.textContent = shortNum(platform.total_users || 0);
        if (proofGroups) proofGroups.textContent = shortNum(platform.total_groups || 0);
        if (proofSystem) {
          proofSystem.textContent = formatSystemStatusLabel(systemStatus);
          const card = proofSystem.closest('.proof-card');
          if (card) card.dataset.status = systemStatus;
        }
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
