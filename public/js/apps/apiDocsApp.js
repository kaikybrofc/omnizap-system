import { React, createRoot, useEffect, useState } from '../runtime/react-runtime.js';

const h = React.createElement;

function Icon({ cls }) {
  return h('i', { className: `icon ${cls}`, 'aria-hidden': 'true' });
}

function Card({ title, code, iconClass }) {
  return h(
    'section',
    { className: 'card' },
    h('h2', null, h(Icon, { cls: iconClass || 'fa-solid fa-file-code' }), title),
    h('pre', null, h('code', null, code)),
  );
}

function SectionTitle({ iconClass, children }) {
  return h('h2', { className: 'section-title' }, h(Icon, { cls: iconClass }), children);
}

function StatusPanel() {
  const [state, setState] = useState({
    loading: true,
    ok: false,
    latencyMs: null,
    cpu: null,
    ram: null,
    uptime: null,
    error: '',
  });

  useEffect(() => {
    let active = true;

    const load = async () => {
      const start = Date.now();
      try {
        const response = await fetch('/api/sticker-packs/system-summary');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        const data = payload?.data || {};
        const host = data.host || {};
        const process = data.process || {};

        if (!active) return;
        setState({
          loading: false,
          ok: true,
          latencyMs: Date.now() - start,
          cpu: Number.isFinite(Number(host.cpu_percent)) ? `${Number(host.cpu_percent).toFixed(2)}%` : 'n/d',
          ram:
            host.memory_used && host.memory_total
              ? `${host.memory_used} / ${host.memory_total} (${Number(host.memory_percent || 0).toFixed(2)}%)`
              : 'n/d',
          uptime: process.uptime || 'n/d',
          error: '',
        });
      } catch (error) {
        if (!active) return;
        setState({
          loading: false,
          ok: false,
          latencyMs: null,
          cpu: null,
          ram: null,
          uptime: null,
          error: error?.message || 'Falha ao consultar status da API',
        });
      }
    };

    load();
    const timer = setInterval(load, 60 * 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const statusLabel = state.loading ? 'Consultando...' : state.ok ? 'Online' : 'Instável';
  const statusClass = state.loading ? 'badge badge-warn' : state.ok ? 'badge badge-ok' : 'badge badge-bad';

  return h(
    'section',
    { className: 'card' },
    h('h3', { className: 'sub-title' }, h(Icon, { cls: 'fa-solid fa-heart-pulse' }), 'Status em tempo real'),
    h('div', { className: 'status-row' }, h('span', { className: statusClass }, statusLabel), state.latencyMs ? h('span', { className: 'status-meta' }, `Latência: ${state.latencyMs}ms`) : null),
    h(
      'div',
      { className: 'status-grid' },
      h('div', { className: 'status-item' }, h('strong', null, 'CPU host'), h('span', null, state.cpu || 'n/d')),
      h('div', { className: 'status-item' }, h('strong', null, 'RAM host'), h('span', null, state.ram || 'n/d')),
      h('div', { className: 'status-item' }, h('strong', null, 'Uptime processo'), h('span', null, state.uptime || 'n/d')),
    ),
    state.error ? h('p', { className: 'status-error' }, `Falha: ${state.error}`) : null,
  );
}

function ApiDocsApp() {
  return h(
    'main',
    { className: 'wrap' },
    h(
      'div',
      { className: 'top' },
      h('a', { href: '/' }, h(Icon, { cls: 'fa-solid fa-house' }), 'Home'),
      h('a', { href: '/stickers/' }, h(Icon, { cls: 'fa-solid fa-icons' }), 'Stickers'),
      h('a', { href: '/termos-de-uso/' }, h(Icon, { cls: 'fa-solid fa-file-contract' }), 'Termos'),
      h('a', { href: '/licenca/' }, h(Icon, { cls: 'fa-solid fa-scale-balanced' }), 'Licença'),
      h('a', { href: 'https://github.com/Kaikygr/omnizap-system', target: '_blank', rel: 'noreferrer noopener' }, h(Icon, { cls: 'fa-brands fa-github' }), 'GitHub'),
    ),
    h('h1', null, h(Icon, { cls: 'fa-solid fa-code' }), 'OmniZap API Docs'),
    h('p', null, 'API pública para o catálogo de sticker packs e assets.'),
    h(SectionTitle, { iconClass: 'fa-solid fa-route' }, 'Maneiras de uso'),
    h(
      'section',
      { className: 'card' },
      h('ul', { className: 'list' },
        h('li', null, 'Uso direto no front-end web para catálogo e busca de packs.'),
        h('li', null, 'Integração server-to-server para sincronização com sistemas próprios.'),
        h('li', null, 'Consumo em bots/automação para abrir pack, baixar sticker e montar fluxos.')
      ),
    ),
    h(StatusPanel),
    h(SectionTitle, { iconClass: 'fa-solid fa-plug-circle-check' }, 'Endpoints'),
    h(Card, { title: 'Base URL', code: 'https://omnizap.shop/api/sticker-packs', iconClass: 'fa-solid fa-link' }),
    h(Card, {
      title: 'Listar packs',
      code: 'GET /api/sticker-packs?q=&visibility=public|unlisted|all&limit=&offset=',
      iconClass: 'fa-solid fa-layer-group',
    }),
    h(Card, {
      title: 'Listar stickers sem pack',
      code: 'GET /api/sticker-packs/orphan-stickers?q=&limit=&offset=',
      iconClass: 'fa-solid fa-box-open',
    }),
    h(Card, { title: 'Detalhes de pack', code: 'GET /api/sticker-packs/:packKey', iconClass: 'fa-solid fa-circle-info' }),
    h(Card, {
      title: 'Imagem de sticker',
      code: 'GET /api/sticker-packs/:packKey/stickers/:stickerId.webp\nGET /data/stickers/:owner/:file.webp',
      iconClass: 'fa-solid fa-image',
    }),
    h(Card, { title: 'Resumo de métricas do sistema', code: 'GET /api/sticker-packs/system-summary', iconClass: 'fa-solid fa-gauge-high' }),
    h(Card, { title: 'Resumo do projeto no GitHub', code: 'GET /api/sticker-packs/project-summary', iconClass: 'fa-brands fa-github' }),
    h(SectionTitle, { iconClass: 'fa-solid fa-brackets-curly' }, 'Como a API responde'),
    h(Card, {
      title: 'Padrão de resposta (sucesso)',
      code:
        '{\n' +
        '  "ok": true,\n' +
        '  "data": [ ... ],\n' +
        '  "pagination": { "limit": 24, "offset": 0, "has_more": true }\n' +
        '}',
      iconClass: 'fa-solid fa-circle-check',
    }),
    h(Card, {
      title: 'Padrão de resposta (erro)',
      code:
        '{\n' +
        '  "ok": false,\n' +
        '  "error": "mensagem descritiva do erro"\n' +
        '}',
      iconClass: 'fa-solid fa-triangle-exclamation',
    }),
    h(SectionTitle, { iconClass: 'fa-solid fa-diagram-project' }, 'Como integrar no seu sistema'),
    h(Card, {
      title: 'Passo a passo de integração',
      code:
        '1) Defina a base URL: https://omnizap.shop/api/sticker-packs\n' +
        '2) Faça um health-check inicial em /system-summary\n' +
        '3) Liste packs com /?visibility=public&limit=24\n' +
        '4) Abra detalhes com /:packKey\n' +
        '5) Baixe stickers com /:packKey/stickers/:stickerId.webp\n' +
        '6) Trate paginação usando limit/offset e has_more',
      iconClass: 'fa-solid fa-list-check',
    }),
    h(Card, {
      title: 'Exemplo cURL',
      code:
        'curl -sS "https://omnizap.shop/api/sticker-packs?visibility=public&limit=5"\n' +
        'curl -sS "https://omnizap.shop/api/sticker-packs/orphan-stickers?limit=20&offset=0"\n' +
        'curl -sS "https://omnizap.shop/api/sticker-packs/system-summary"\n' +
        'curl -sS "https://omnizap.shop/api/sticker-packs/project-summary"',
      iconClass: 'fa-solid fa-terminal',
    }),
    h(Card, {
      title: 'Exemplo JavaScript (fetch)',
      code:
        "const API_BASE = 'https://omnizap.shop/api/sticker-packs';\n\n" +
        'async function getPublicPacks() {\n' +
        "  const url = `${API_BASE}?visibility=public&limit=24&offset=0`;\n" +
        '  const response = await fetch(url);\n' +
        "  if (!response.ok) throw new Error(`HTTP ${response.status}`);\n" +
        '  const payload = await response.json();\n' +
        '  return payload?.data || [];\n' +
        '}\n\n' +
        'async function getPackDetails(packKey) {\n' +
        '  const response = await fetch(`${API_BASE}/${encodeURIComponent(packKey)}`);\n' +
        "  if (!response.ok) throw new Error(`HTTP ${response.status}`);\n" +
        '  const payload = await response.json();\n' +
        '  return payload?.data || null;\n' +
        '}\n\n' +
        '(async () => {\n' +
        '  try {\n' +
        '    const packs = await getPublicPacks();\n' +
        "    console.log('Packs encontrados:', packs.length);\n" +
        '    if (packs[0]?.pack_key) {\n' +
        '      const details = await getPackDetails(packs[0].pack_key);\n' +
        "      console.log('Primeiro pack:', details?.name, details?.pack_key);\n" +
        '    }\n' +
        '  } catch (error) {\n' +
        "    console.error('Falha ao consumir API:', error.message);\n" +
        '  }\n' +
        '})();',
      iconClass: 'fa-brands fa-js',
    }),
  );
}

const rootEl = document.getElementById('api-docs-react-root');
if (rootEl) {
  const root = createRoot(rootEl);
  root.render(h(ApiDocsApp));
}
