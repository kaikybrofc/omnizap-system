import { setup } from 'https://esm.sh/twind@0.16.19';
import { observe } from 'https://esm.sh/twind@0.16.19/observe';

if (typeof document !== 'undefined' && !window.__omnizapTwindReady) {
  setup({ preflight: false });
  observe(document.documentElement);
  window.__omnizapTwindReady = true;
}

export {
  default as React,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  memo,
} from 'https://esm.sh/react@18.3.1';

export { createRoot } from 'https://esm.sh/react-dom@18.3.1/client';
