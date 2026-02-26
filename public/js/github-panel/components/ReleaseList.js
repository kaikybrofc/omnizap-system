import { React, memo } from '../vendor/react.js';

const h = React.createElement;

function ReleaseListComponent({ items, formatDate }) {
  if (!Array.isArray(items) || items.length === 0) {
    return h('div', { className: 'ghp-empty' }, 'Nenhuma release publicada ainda.');
  }

  return h(
    'ul',
    { className: 'ghp-list', 'aria-label': 'Lista de releases recentes' },
    ...items.map((release, index) => {
      const flags = [release.prerelease ? 'pre-release' : '', release.draft ? 'draft' : ''].filter(Boolean).join(', ');
      const releaseName = release.tag || release.name || 'release';
      const label = flags ? `${releaseName} (${flags})` : releaseName;

      return h(
        'li',
        { key: label + String(index), className: 'ghp-list-item' },
        h(
          'a',
          {
            href: release.html_url || '#',
            target: '_blank',
            rel: 'noreferrer noopener',
            className: 'ghp-list-link',
            'aria-label': `Abrir release ${releaseName} no GitHub`,
          },
          label,
        ),
        h('p', { className: 'ghp-list-meta' }, formatDate(release.published_at)),
      );
    }),
  );
}

export const ReleaseList = memo(ReleaseListComponent);
