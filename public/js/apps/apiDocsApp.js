import { React, createRoot } from '../runtime/react-runtime.js';

const h = React.createElement;

function Card({ title, code }) {
  return h('section', { className: 'card' }, h('h2', null, title), h('pre', null, h('code', null, code)));
}

function ApiDocsApp() {
  return h(
    'main',
    { className: 'wrap' },
    h('div', { className: 'top' }, h('a', { href: '/' }, 'Home'), h('a', { href: '/stickers/' }, 'Stickers')),
    h('h1', null, 'OmniZap API Docs'),
    h('p', null, 'API pública para o catálogo de sticker packs e assets.'),
    h(Card, { title: 'Base URL', code: 'https://omnizap.shop/api/sticker-packs' }),
    h(Card, { title: 'Listar packs', code: 'GET /api/sticker-packs?q=&visibility=public|unlisted|all&limit=&offset=' }),
    h(Card, { title: 'Listar stickers sem pack', code: 'GET /api/sticker-packs/orphan-stickers?q=&limit=&offset=' }),
    h(Card, { title: 'Detalhes de pack', code: 'GET /api/sticker-packs/:packKey' }),
    h(Card, { title: 'Imagem de sticker', code: 'GET /api/sticker-packs/:packKey/stickers/:stickerId.webp\nGET /data/stickers/:owner/:file.webp' }),
    h(Card, { title: 'Resumo de métricas do sistema', code: 'GET /api/sticker-packs/system-summary' }),
    h(Card, { title: 'Resumo do projeto no GitHub', code: 'GET /api/sticker-packs/project-summary' }),
    h(Card, {
      title: 'Exemplo cURL',
      code:
        'curl -sS "https://omnizap.shop/api/sticker-packs?visibility=public&limit=5"\n' +
        'curl -sS "https://omnizap.shop/api/sticker-packs/orphan-stickers?limit=20&offset=0"\n' +
        'curl -sS "https://omnizap.shop/api/sticker-packs/system-summary"\n' +
        'curl -sS "https://omnizap.shop/api/sticker-packs/project-summary"',
    }),
  );
}

const rootEl = document.getElementById('api-docs-react-root');
if (rootEl) {
  const root = createRoot(rootEl);
  root.render(h(ApiDocsApp));
}
