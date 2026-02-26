import { React, memo } from '../vendor/react.js';

const h = React.createElement;

function SkeletonPanelComponent() {
  const statNodes = Array.from({ length: 10 }).map((_, index) => h('div', { key: `s-${index}`, className: 'ghp-skeleton-card' }));
  const listNodes = Array.from({ length: 4 }).map((_, index) => h('li', { key: `l-${index}`, className: 'ghp-skeleton-line' }));

  return h(
    'section',
    { className: 'ghp-panel', 'aria-busy': 'true', 'aria-live': 'polite' },
    h('div', { className: 'ghp-stat-grid' }, ...statNodes),
    h(
      'div',
      { className: 'ghp-list-grid' },
      h('div', { className: 'ghp-list-card' }, h('div', { className: 'ghp-skeleton-title' }), h('ul', { className: 'ghp-list' }, ...listNodes)),
      h('div', { className: 'ghp-list-card' }, h('div', { className: 'ghp-skeleton-title' }), h('ul', { className: 'ghp-list' }, ...listNodes)),
    ),
  );
}

export const SkeletonPanel = memo(SkeletonPanelComponent);
