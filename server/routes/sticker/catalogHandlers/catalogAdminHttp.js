export const handleCatalogAdminRoutes = async ({ req, res, url, segments, handlers, sendJson }) => {
  if (segments[0] !== 'admin') return false;

  if (segments.length === 2 && segments[1] === 'overview') {
    await handlers.handleAdminOverviewRequest(req, res);
    return true;
  }

  if (segments.length === 2 && segments[1] === 'users') {
    await handlers.handleAdminUsersRequest(req, res, url);
    return true;
  }

  if (segments.length === 3 && segments[1] === 'users' && segments[2] === 'force-logout') {
    await handlers.handleAdminForceLogoutRequest(req, res);
    return true;
  }

  if (segments.length === 2 && segments[1] === 'feature-flags') {
    await handlers.handleAdminFeatureFlagsRequest(req, res);
    return true;
  }

  if (segments.length === 2 && segments[1] === 'ops') {
    await handlers.handleAdminOpsActionRequest(req, res);
    return true;
  }

  if (segments.length === 2 && segments[1] === 'search') {
    await handlers.handleAdminSearchRequest(req, res, url);
    return true;
  }

  if (segments.length === 2 && segments[1] === 'export') {
    await handlers.handleAdminExportRequest(req, res, url);
    return true;
  }

  if (segments.length === 2 && segments[1] === 'moderators') {
    await handlers.handleAdminModeratorsRequest(req, res);
    return true;
  }

  if (segments.length === 3 && segments[1] === 'moderators') {
    await handlers.handleAdminModeratorDeleteRequest(req, res, segments[2]);
    return true;
  }

  if (segments.length === 2 && segments[1] === 'packs') {
    await handlers.handleAdminPacksRequest(req, res, url);
    return true;
  }

  if (segments.length === 3 && segments[1] === 'packs') {
    if (req.method === 'DELETE') {
      await handlers.handleAdminPackDeleteRequest(req, res, segments[2]);
      return true;
    }
    await handlers.handleAdminPackDetailsRequest(req, res, segments[2]);
    return true;
  }

  if (segments.length === 4 && segments[1] === 'packs' && segments[3] === 'delete') {
    await handlers.handleAdminPackDeleteRequest(req, res, segments[2]);
    return true;
  }

  if (segments.length === 5 && segments[1] === 'packs' && segments[3] === 'stickers') {
    await handlers.handleAdminPackStickerDeleteRequest(req, res, segments[2], segments[4]);
    return true;
  }

  if (segments.length === 6 && segments[1] === 'packs' && segments[3] === 'stickers' && segments[5] === 'delete') {
    await handlers.handleAdminPackStickerDeleteRequest(req, res, segments[2], segments[4]);
    return true;
  }

  if (segments.length === 3 && segments[1] === 'stickers') {
    await handlers.handleAdminGlobalStickerDeleteRequest(req, res, segments[2]);
    return true;
  }

  if (segments.length === 4 && segments[1] === 'stickers' && segments[3] === 'delete') {
    await handlers.handleAdminGlobalStickerDeleteRequest(req, res, segments[2]);
    return true;
  }

  if (segments.length === 2 && segments[1] === 'bans') {
    await handlers.handleAdminBansRequest(req, res);
    return true;
  }

  if (segments.length === 4 && segments[1] === 'bans' && segments[3] === 'revoke') {
    await handlers.handleAdminBanRevokeRequest(req, res, segments[2]);
    return true;
  }

  if (segments.length === 3 && segments[1] === 'bans') {
    await handlers.handleAdminBanRevokeRequest(req, res, segments[2]);
    return true;
  }

  sendJson(req, res, 404, { error: 'Rota admin nao encontrada.' });
  return true;
};
