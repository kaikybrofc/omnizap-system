import { React, memo } from '../vendor/react.js';

const h = React.createElement;

function ErrorStateComponent({ message, onRetry, isRateLimited }) {
  return h(
    'section',
    { className: 'ghp-error', role: 'alert' },
    h('h3', null, 'Não foi possível carregar os dados do GitHub'),
    h('p', null, message || 'Tente novamente em alguns instantes.'),
    isRateLimited ? h('p', { className: 'ghp-rate-limit' }, 'Limite de requisições do GitHub atingido. Tente novamente em breve.') : null,
    h('button', { type: 'button', className: 'ghp-retry', onClick: onRetry }, 'Tentar novamente'),
  );
}

export const ErrorState = memo(ErrorStateComponent);
