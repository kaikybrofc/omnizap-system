import { useCallback, useEffect, useRef, useState } from './vendor/react.js';

const CACHE_PREFIX = 'omnizap:github-summary:';
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const RETRY_DELAY_MS = 900;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const toErrorObject = (error, statusCode = null, rateLimited = false) => ({
  message: error?.message || 'Falha ao carregar dados do projeto.',
  statusCode,
  rateLimited,
});

export function useGithubRepoData({ owner, repo, endpoint = '/api/sticker-packs/project-summary', ttlMs = DEFAULT_TTL_MS }) {
  const cacheKey = CACHE_PREFIX + String(owner || '') + '/' + String(repo || '');
  const abortRef = useRef(null);

  const [state, setState] = useState({
    data: null,
    loading: true,
    error: null,
    lastUpdatedAt: null,
  });

  const readCache = useCallback(() => {
    try {
      const raw = sessionStorage.getItem(cacheKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.data || !parsed?.storedAt) return null;
      return parsed;
    } catch {
      return null;
    }
  }, [cacheKey]);

  const writeCache = useCallback(
    (data) => {
      try {
        sessionStorage.setItem(
          cacheKey,
          JSON.stringify({
            data,
            storedAt: Date.now(),
          }),
        );
      } catch {
        // noop
      }
    },
    [cacheKey],
  );

  const fetchWithRetry = useCallback(async () => {
    const doFetch = async () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }

      const controller = new AbortController();
      abortRef.current = controller;

      const response = await fetch(endpoint, { signal: controller.signal });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        const error = new Error(payload?.error || 'Falha ao carregar dados do projeto.');
        error.statusCode = response.status;
        error.rateLimited = response.status === 429;
        throw error;
      }

      return payload?.data || null;
    };

    try {
      return await doFetch();
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      const status = Number(error?.statusCode) || 0;
      const retryable = status === 429 || status >= 500 || status === 0;
      if (!retryable) throw error;
      await sleep(RETRY_DELAY_MS);
      return doFetch();
    }
  }, [endpoint]);

  const refresh = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) {
        setState((prev) => ({ ...prev, loading: true, error: null }));
      }

      try {
        const data = await fetchWithRetry();
        if (!data) {
          throw new Error('Resposta vazia da API.');
        }

        writeCache(data);
        setState({
          data,
          loading: false,
          error: null,
          lastUpdatedAt: Date.now(),
        });
      } catch (error) {
        if (error?.name === 'AbortError') return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: toErrorObject(error, error?.statusCode || null, Boolean(error?.rateLimited)),
        }));
      }
    },
    [fetchWithRetry, writeCache],
  );

  useEffect(() => {
    const cached = readCache();
    const now = Date.now();

    if (cached?.data) {
      setState({
        data: cached.data,
        loading: false,
        error: null,
        lastUpdatedAt: Number(cached.storedAt) || now,
      });

      const isExpired = now - Number(cached.storedAt || 0) > ttlMs;
      if (isExpired) {
        refresh({ silent: true });
      }
    } else {
      refresh();
    }

    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [readCache, refresh, ttlMs]);

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    lastUpdatedAt: state.lastUpdatedAt,
    refresh,
  };
}
