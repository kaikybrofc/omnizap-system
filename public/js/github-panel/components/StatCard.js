import { React, memo } from '../vendor/react.js';

const h = React.createElement;

function StatCardComponent({ label, value, detail, iconClass }) {
  return h('article', { className: 'ghp-stat-card' }, h('header', { className: 'ghp-stat-head' }, h('span', { className: 'ghp-stat-label' }, label), iconClass ? h('i', { className: iconClass, 'aria-hidden': 'true' }) : null), h('p', { className: 'ghp-stat-value' }, value), h('p', { className: 'ghp-stat-detail', title: detail || '' }, detail || ' '));
}

export const StatCard = memo(StatCardComponent);
