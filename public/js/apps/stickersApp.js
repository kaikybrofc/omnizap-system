import { React, createRoot, useEffect } from '../runtime/react-runtime.js';

const h = React.createElement;

function StickersApp() {
  useEffect(() => {
    import('../catalog.js');
  }, []);
  return null;
}

const rootEl = document.getElementById('stickers-react-root');
if (rootEl) {
  const root = createRoot(rootEl);
  root.render(h(StickersApp));
}
