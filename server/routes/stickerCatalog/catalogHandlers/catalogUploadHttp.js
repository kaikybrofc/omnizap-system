const METHOD_NOT_ALLOWED_BODY = { error: 'Metodo nao permitido.' };

const isPublishStateMethod = (method) => method === 'GET' || method === 'HEAD' || method === 'POST';

export const handleCatalogUploadRoutes = async ({ req, res, pathname, url, segments, apiBasePath, handlers, sendJson }) => {
  if (pathname === `${apiBasePath}/create`) {
    if (req.method !== 'POST') {
      sendJson(req, res, 405, METHOD_NOT_ALLOWED_BODY);
      return true;
    }
    await handlers.handleCreatePackRequest(req, res);
    return true;
  }

  if (segments.length === 2 && segments[1] === 'manage') {
    await handlers.handleManagedPackRequest(req, res, segments[0]);
    return true;
  }

  if (segments.length === 3 && segments[1] === 'manage' && segments[2] === 'clone') {
    await handlers.handleManagedPackCloneRequest(req, res, segments[0]);
    return true;
  }

  if (segments.length === 3 && segments[1] === 'manage' && segments[2] === 'cover') {
    await handlers.handleManagedPackCoverRequest(req, res, segments[0]);
    return true;
  }

  if (segments.length === 3 && segments[1] === 'manage' && segments[2] === 'reorder') {
    await handlers.handleManagedPackReorderRequest(req, res, segments[0]);
    return true;
  }

  if (segments.length === 3 && segments[1] === 'manage' && segments[2] === 'analytics') {
    await handlers.handleManagedPackAnalyticsRequest(req, res, segments[0]);
    return true;
  }

  if (segments.length === 3 && segments[1] === 'manage' && segments[2] === 'stickers') {
    await handlers.handleManagedPackStickerCreateRequest(req, res, segments[0]);
    return true;
  }

  if (segments.length === 4 && segments[1] === 'manage' && segments[2] === 'stickers') {
    await handlers.handleManagedPackStickerDeleteRequest(req, res, segments[0], segments[3]);
    return true;
  }

  if (segments.length === 5 && segments[1] === 'manage' && segments[2] === 'stickers' && segments[4] === 'replace') {
    await handlers.handleManagedPackStickerReplaceRequest(req, res, segments[0], segments[3]);
    return true;
  }

  if (segments.length === 2 && segments[1] === 'publish-state') {
    if (!isPublishStateMethod(req.method || '')) {
      sendJson(req, res, 405, METHOD_NOT_ALLOWED_BODY);
      return true;
    }
    await handlers.handlePackPublishStateRequest(req, res, segments[0], url);
    return true;
  }

  if (segments.length === 2 && segments[1] === 'finalize') {
    if (req.method !== 'POST') {
      sendJson(req, res, 405, METHOD_NOT_ALLOWED_BODY);
      return true;
    }
    await handlers.handleFinalizePackRequest(req, res, segments[0]);
    return true;
  }

  if (segments.length === 2 && segments[1] === 'stickers-upload') {
    if (req.method !== 'POST') {
      sendJson(req, res, 405, METHOD_NOT_ALLOWED_BODY);
      return true;
    }
    await handlers.handleUploadStickerToPackRequest(req, res, segments[0]);
    return true;
  }

  return false;
};
