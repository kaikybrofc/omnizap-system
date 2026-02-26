import { React, memo } from '../vendor/react.js';

const h = React.createElement;

function CommitListComponent({ items, formatDate }) {
  if (!Array.isArray(items) || items.length === 0) {
    return h('div', { className: 'ghp-empty' }, 'Nenhum commit recente encontrado.');
  }

  return h(
    'ul',
    { className: 'ghp-list', 'aria-label': 'Lista de commits recentes' },
    ...items.map((commit, index) =>
      h(
        'li',
        { key: (commit.sha || 'commit') + String(index), className: 'ghp-list-item' },
        h(
          'a',
          {
            href: commit.html_url || '#',
            target: '_blank',
            rel: 'noreferrer noopener',
            className: 'ghp-list-link',
            'aria-label': `Abrir commit ${commit.sha || ''} no GitHub`,
          },
          `${commit.sha || '---'} - ${commit.message || 'Sem mensagem'}`,
        ),
        h('p', { className: 'ghp-list-meta' }, `${commit.author || 'autor desconhecido'} · ${formatDate(commit.date)}`),
      ),
    ),
  );
}

export const CommitList = memo(CommitListComponent);
