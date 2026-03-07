const METHOD_NOT_ALLOWED_BODY = { error: 'Metodo nao permitido.' };

const isReadMethod = (method) => method === 'GET' || method === 'HEAD';
const RESERVED_NON_STICKER_SEGMENTS = new Set([
  'home-bootstrap',
  'system-summary',
  'project-summary',
  'global-ranking-summary',
  'readme-markdown',
  'support',
  'bot-contact',
]);

export const handleCatalogPublicRoutes = async ({
  req,
  res,
  pathname,
  url,
  segments,
  apiBasePath,
  orphanApiPath,
  handlers,
  sendJson,
}) => {
  if (pathname === apiBasePath) {
    if (!isReadMethod(req.method || '')) {
      sendJson(req, res, 405, METHOD_NOT_ALLOWED_BODY);
      return true;
    }
    await handlers.handleListRequest(req, res, url);
    return true;
  }

  if (pathname === `${apiBasePath}/intents`) {
    if (!isReadMethod(req.method || '')) {
      sendJson(req, res, 405, METHOD_NOT_ALLOWED_BODY);
      return true;
    }
    await handlers.handleIntentCollectionsRequest(req, res, url);
    return true;
  }

  if (pathname === `${apiBasePath}/creators`) {
    if (!isReadMethod(req.method || '')) {
      sendJson(req, res, 405, METHOD_NOT_ALLOWED_BODY);
      return true;
    }
    await handlers.handleCreatorRankingRequest(req, res, url);
    return true;
  }

  if (pathname === `${apiBasePath}/recommendations`) {
    if (!isReadMethod(req.method || '')) {
      sendJson(req, res, 405, METHOD_NOT_ALLOWED_BODY);
      return true;
    }
    await handlers.handleRecommendationsRequest(req, res, url);
    return true;
  }

  if (pathname === `${apiBasePath}/stats`) {
    if (!isReadMethod(req.method || '')) {
      sendJson(req, res, 405, METHOD_NOT_ALLOWED_BODY);
      return true;
    }
    await handlers.handleMarketplaceStatsRequest(req, res, url);
    return true;
  }

  if (pathname === `${apiBasePath}/create-config`) {
    if (!isReadMethod(req.method || '')) {
      sendJson(req, res, 405, METHOD_NOT_ALLOWED_BODY);
      return true;
    }
    await handlers.handleCreatePackConfigRequest(req, res);
    return true;
  }

  if (pathname === orphanApiPath) {
    if (!isReadMethod(req.method || '')) {
      sendJson(req, res, 405, METHOD_NOT_ALLOWED_BODY);
      return true;
    }
    await handlers.handleOrphanStickerListRequest(req, res, url);
    return true;
  }

  if (segments.length === 1 && segments[0] === 'data-files') {
    if (!isReadMethod(req.method || '')) {
      sendJson(req, res, 405, METHOD_NOT_ALLOWED_BODY);
      return true;
    }
    await handlers.handleDataFileListRequest(req, res, url);
    return true;
  }

  if (segments.length === 1 && segments[0] === 'readme-summary') {
    if (!isReadMethod(req.method || '')) {
      sendJson(req, res, 405, METHOD_NOT_ALLOWED_BODY);
      return true;
    }
    await handlers.handleReadmeSummaryRequest(req, res);
    return true;
  }

  if (segments.length === 1 && RESERVED_NON_STICKER_SEGMENTS.has(segments[0])) {
    return false;
  }

  if (segments.length === 1) {
    if (!isReadMethod(req.method || '')) {
      sendJson(req, res, 405, METHOD_NOT_ALLOWED_BODY);
      return true;
    }
    await handlers.handleDetailsRequest(req, res, segments[0], url);
    return true;
  }

  if (segments.length === 2 && ['open', 'like', 'dislike'].includes(segments[1])) {
    if (req.method !== 'POST') {
      sendJson(req, res, 405, METHOD_NOT_ALLOWED_BODY);
      return true;
    }
    await handlers.handlePackInteractionRequest(req, res, segments[0], segments[1], url);
    return true;
  }

  if (segments.length === 3 && segments[1] === 'stickers') {
    if (!isReadMethod(req.method || '')) {
      sendJson(req, res, 405, METHOD_NOT_ALLOWED_BODY);
      return true;
    }
    await handlers.handleAssetRequest(req, res, segments[0], segments[2], url);
    return true;
  }

  return false;
};
