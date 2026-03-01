export const createStickerCatalogNonCatalogHandlers = ({ sendJson, sendText, logger, getSystemSummaryCached, systemSummaryCache, systemSummaryCacheSeconds, getReadmeSummaryCached, readmeSummaryCache, readmeSummaryCacheSeconds, getGlobalRankingSummaryCached, globalRankRefreshSeconds, globalRankCache, sanitizeRankingPayloadByBot, getActiveSocket, resolveBotUserCandidates, getMarketplaceGlobalStatsCached, marketplaceGlobalStatsCacheSeconds, marketplaceGlobalStatsCache, githubRepoInfo, githubToken, githubProjectCacheSeconds, fetchGitHubProjectSummary, buildSupportInfo, buildBotContactInfo }) => {
  const handleSystemSummaryRequest = async (req, res) => {
    try {
      const payload = await getSystemSummaryCached();
      sendJson(req, res, 200, {
        ...payload,
        meta: {
          ...(payload.meta || {}),
          cache_seconds: systemSummaryCacheSeconds,
        },
      });
    } catch (error) {
      logger.warn('Falha ao montar resumo do sistema.', {
        action: 'system_summary_error',
        error: error?.message,
      });
      if (systemSummaryCache.value) {
        sendJson(req, res, 200, {
          ...systemSummaryCache.value,
          meta: {
            ...(systemSummaryCache.value.meta || {}),
            cache_seconds: systemSummaryCacheSeconds,
            stale: true,
            error: error?.message || 'fallback_cache',
          },
        });
        return;
      }
      sendJson(req, res, 503, { error: 'Resumo do sistema indisponível no momento.' });
    }
  };

  const handleReadmeSummaryRequest = async (req, res) => {
    try {
      const payload = await getReadmeSummaryCached();
      sendJson(req, res, 200, payload);
    } catch (error) {
      logger.warn('Falha ao montar resumo markdown para README.', {
        action: 'readme_summary_error',
        error: error?.message,
      });
      if (readmeSummaryCache.value) {
        sendJson(req, res, 200, {
          ...readmeSummaryCache.value,
          meta: {
            stale: true,
            error: error?.message || 'fallback_cache',
          },
        });
        return;
      }
      sendJson(req, res, 503, { error: 'Resumo markdown indisponível no momento.' });
    }
  };

  const handleReadmeMarkdownRequest = async (req, res) => {
    try {
      const payload = await getReadmeSummaryCached();
      const markdown = String(payload?.data?.markdown || '').trim();
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.setHeader('Cache-Control', `public, max-age=${Math.min(readmeSummaryCacheSeconds, 300)}`);
      res.setHeader('X-Cache-Seconds', String(readmeSummaryCacheSeconds));
      sendText(req, res, 200, markdown ? `${markdown}\n` : '', 'text/markdown; charset=utf-8');
    } catch (error) {
      logger.warn('Falha ao renderizar markdown para README.', {
        action: 'readme_markdown_error',
        error: error?.message,
      });
      if (readmeSummaryCache.value) {
        const markdown = String(readmeSummaryCache.value?.data?.markdown || '').trim();
        res.setHeader('X-Robots-Tag', 'noindex, nofollow');
        res.setHeader('Cache-Control', `public, max-age=${Math.min(readmeSummaryCacheSeconds, 300)}`);
        res.setHeader('X-Cache-Seconds', String(readmeSummaryCacheSeconds));
        sendText(req, res, 200, markdown ? `${markdown}\n` : '', 'text/markdown; charset=utf-8');
        return;
      }
      sendText(req, res, 503, 'Resumo markdown indisponivel no momento.\n', 'text/plain; charset=utf-8');
    }
  };

  const handleGlobalRankingSummaryRequest = async (req, res) => {
    const activeSocket = getActiveSocket();
    const botUsers = resolveBotUserCandidates(activeSocket);
    try {
      const rawData = await getGlobalRankingSummaryCached();
      const data = sanitizeRankingPayloadByBot(rawData, botUsers);
      sendJson(req, res, 200, { data, meta: { cache_seconds: globalRankRefreshSeconds } });
    } catch (error) {
      logger.warn('Falha ao montar resumo do ranking global.', {
        action: 'global_ranking_summary_error',
        error: error?.message,
      });
      if (globalRankCache.value) {
        sendJson(req, res, 200, {
          data: sanitizeRankingPayloadByBot(globalRankCache.value, botUsers),
          meta: { cache_seconds: globalRankRefreshSeconds, stale: true, error: error?.message || 'fallback_cache' },
        });
        return;
      }
      sendJson(req, res, 503, { error: 'Ranking global indisponível no momento.' });
    }
  };

  const handleMarketplaceGlobalStatsRequest = async (req, res) => {
    try {
      const data = await getMarketplaceGlobalStatsCached();
      sendJson(req, res, 200, {
        ...data,
        cache_seconds: marketplaceGlobalStatsCacheSeconds,
      });
    } catch (error) {
      logger.warn('Falha ao montar stats globais do marketplace.', {
        action: 'marketplace_global_stats_error',
        error: error?.message,
      });
      if (marketplaceGlobalStatsCache.value) {
        sendJson(req, res, 200, {
          ...marketplaceGlobalStatsCache.value,
          cache_seconds: marketplaceGlobalStatsCacheSeconds,
          stale: true,
        });
        return;
      }
      sendJson(req, res, 503, { error: 'Stats globais do marketplace indisponíveis no momento.' });
    }
  };

  const handleGitHubProjectSummaryRequest = async (req, res) => {
    if (!githubRepoInfo) {
      sendJson(req, res, 500, { error: 'Configuracao de repositorio GitHub invalida.' });
      return;
    }

    try {
      const data = await fetchGitHubProjectSummary();
      sendJson(req, res, 200, {
        data,
        meta: {
          repository: githubRepoInfo.fullName,
          token_configured: Boolean(githubToken),
          cache_seconds: githubProjectCacheSeconds,
        },
      });
    } catch (error) {
      logger.warn('Falha ao consultar resumo do repositorio no GitHub.', {
        action: 'github_project_summary_error',
        repository: githubRepoInfo.fullName,
        error: error?.message,
        status_code: error?.statusCode || null,
      });
      sendJson(req, res, 502, { error: 'Falha ao consultar dados do projeto no GitHub.' });
    }
  };

  const handleSupportInfoRequest = async (req, res) => {
    const data = await buildSupportInfo();
    if (!data) {
      sendJson(req, res, 404, { error: 'Contato de suporte indisponível.' });
      return;
    }
    sendJson(req, res, 200, { data });
  };

  const handleBotContactInfoRequest = async (req, res) => {
    const data = buildBotContactInfo();
    if (!data) {
      sendJson(req, res, 404, { error: 'Contato do bot indisponivel no momento.' });
      return;
    }
    sendJson(req, res, 200, { data });
  };

  return {
    handleSystemSummaryRequest,
    handleReadmeSummaryRequest,
    handleReadmeMarkdownRequest,
    handleGlobalRankingSummaryRequest,
    handleMarketplaceGlobalStatsRequest,
    handleGitHubProjectSummaryRequest,
    handleSupportInfoRequest,
    handleBotContactInfoRequest,
  };
};
