import { React, createRoot } from './vendor/react.js';
import { GithubProjectPanel } from './components/GithubProjectPanel.js';

const h = React.createElement;

const rootEl = document.getElementById('github-project-panel-root');

if (rootEl) {
  const owner = rootEl.dataset.owner || 'kaikybrofc';
  const repo = rootEl.dataset.repo || 'omnizap-system';
  const endpoint = rootEl.dataset.endpoint || '/api/sticker-packs/project-summary';

  const root = createRoot(rootEl);
  root.render(h(GithubProjectPanel, { owner, repo, endpoint }));
}
