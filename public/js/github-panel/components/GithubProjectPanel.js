import { React, useMemo, useCallback } from '../vendor/react.js';
import { useGithubRepoData } from '../useGithubRepoData.js';
import { StatCard } from './StatCard.js';
import { CommitList } from './CommitList.js';
import { ReleaseList } from './ReleaseList.js';
import { SkeletonPanel } from './SkeletonPanel.js';
import { ErrorState } from './ErrorState.js';

const h = React.createElement;

const fmtDate = (value) => {
  const time = Date.parse(String(value || ''));
  if (!Number.isFinite(time)) return 'n/d';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(time));
};

const toInt = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
};

export function GithubProjectPanel({ owner, repo, endpoint }) {
  const { data, loading, error, lastUpdatedAt, refresh } = useGithubRepoData({ owner, repo, endpoint });

  const statCards = useMemo(() => {
    if (!data) return [];

    const languages = Array.isArray(data.languages) ? data.languages.map((entry) => entry.name).join(', ') : '';

    return [
      { label: 'Repositório', value: data.repository || `${owner}/${repo}`, detail: data.description || 'Sem descrição.', iconClass: 'fa-brands fa-github' },
      { label: 'Stars', value: String(toInt(data.stars)), detail: 'Popularidade do projeto', iconClass: 'fa-solid fa-star' },
      { label: 'Forks', value: String(toInt(data.forks)), detail: 'Repositórios derivados', iconClass: 'fa-solid fa-code-fork' },
      { label: 'Issues abertas', value: String(toInt(data.open_issues)), detail: 'Demandas em aberto', iconClass: 'fa-solid fa-circle-exclamation' },
      { label: 'PRs abertos', value: String(toInt(data.open_prs)), detail: 'Mudanças em revisão', iconClass: 'fa-solid fa-code-pull-request' },
      { label: 'Linguagem principal', value: data.language || 'n/d', detail: languages || 'Sem linguagens mapeadas', iconClass: 'fa-solid fa-code' },
      { label: 'Licença', value: data.license || 'n/d', detail: 'Modelo de uso do projeto', iconClass: 'fa-solid fa-scale-balanced' },
      { label: 'Branch padrão', value: data.default_branch || 'n/d', detail: 'Base principal de desenvolvimento', iconClass: 'fa-solid fa-code-branch' },
      { label: 'Último push', value: fmtDate(data.pushed_at), detail: 'Atualização mais recente no repositório', iconClass: 'fa-solid fa-upload' },
      {
        label: 'Última release',
        value: data.latest_release?.tag || data.latest_release?.name || 'Sem release',
        detail: data.latest_release?.published_at ? fmtDate(data.latest_release.published_at) : 'Sem data de publicação',
        iconClass: 'fa-solid fa-tag',
      },
    ];
  }, [data, owner, repo]);

  const handleRetry = useCallback(() => {
    refresh();
  }, [refresh]);

  if (loading && !data) {
    return h(SkeletonPanel);
  }

  if (error && !data) {
    return h(ErrorState, {
      message: error.message,
      isRateLimited: Boolean(error.rateLimited),
      onRetry: handleRetry,
    });
  }

  return h(
    'section',
    { className: 'ghp-panel' },
    h(
      'header',
      { className: 'ghp-header' },
      h('h3', { className: 'ghp-title' }, 'Projeto no GitHub'),
      h(
        'div',
        { className: 'ghp-header-actions' },
        h('span', { className: 'ghp-updated' }, `Atualizado: ${fmtDate(lastUpdatedAt)}`),
        h(
          'a',
          {
            href: data?.html_url || `https://github.com/${owner}/${repo}`,
            target: '_blank',
            rel: 'noreferrer noopener',
            className: 'ghp-repo-link',
            'aria-label': 'Abrir repositório no GitHub',
          },
          'Abrir repositório',
        ),
      ),
    ),
    error
      ? h('p', { className: 'ghp-inline-warning', role: 'status' }, error.rateLimited ? 'Limite da API do GitHub atingido; exibindo cache local.' : 'Exibindo último snapshot disponível.')
      : null,
    h('div', { className: 'ghp-stat-grid' }, ...statCards.map((card) => h(StatCard, { key: card.label, ...card }))),
    h(
      'div',
      { className: 'ghp-list-grid' },
      h('section', { className: 'ghp-list-card' }, h('h4', { className: 'ghp-list-title' }, 'Últimos Commits'), h(CommitList, { items: data?.latest_commits || [], formatDate: fmtDate })),
      h('section', { className: 'ghp-list-card' }, h('h4', { className: 'ghp-list-title' }, 'Últimas Releases'), h(ReleaseList, { items: data?.latest_releases || [], formatDate: fmtDate })),
    ),
  );
}
