import { React, createRoot } from '../runtime/react-runtime.js';

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
    h(Card, {
      title: 'Exemplo cURL',
      code:
        'curl -sS "https://omnizap.shop/api/sticker-packs?visibility=public&limit=5"\n' +
        'curl -sS "https://omnizap.shop/api/sticker-packs/orphan-stickers?limit=20&offset=0"\n' +
        'curl -sS "https://omnizap.shop/api/sticker-packs/system-summary"\n' +
        'curl -sS "https://omnizap.shop/api/sticker-packs/project-summary"',
      iconClass: 'fa-solid fa-terminal',
    }),
  );
}

const rootEl = document.getElementById('api-docs-react-root');
if (rootEl) {
  const root = createRoot(rootEl);
  root.render(h(ApiDocsApp));
}
