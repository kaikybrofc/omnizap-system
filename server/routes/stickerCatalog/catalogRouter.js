import { handleCatalogAuthRoutes } from './catalogHandlers/catalogAuthHttp.js';
import { handleCatalogAdminRoutes } from './catalogHandlers/catalogAdminHttp.js';
import { handleCatalogUploadRoutes } from './catalogHandlers/catalogUploadHttp.js';
import { handleCatalogPublicRoutes } from './catalogHandlers/catalogPublicHttp.js';

const decodePathSegments = (suffix) =>
  suffix.split('/').filter(Boolean).map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });

export const createCatalogApiRouter = ({
  apiBasePath,
  orphanApiPath,
  handlers,
  sendJson,
}) => {
  if (!apiBasePath || typeof handlers !== 'object' || typeof sendJson !== 'function') {
    throw new Error('catalog_api_router_config_invalid');
  }

  return async ({ req, res, pathname, url }) => {
    const handledAuth = await handleCatalogAuthRoutes({
      req,
      res,
      pathname,
      url,
      apiBasePath,
      handlers,
      sendJson,
    });
    if (handledAuth) return true;
    if (!pathname.startsWith(apiBasePath)) return false;

    const suffix = pathname.slice(apiBasePath.length).replace(/^\/+/, '');
    const segments = decodePathSegments(suffix);

    const handledAdmin = await handleCatalogAdminRoutes({
      req,
      res,
      url,
      segments,
      handlers,
      sendJson,
    });
    if (handledAdmin) return true;

    const handledUpload = await handleCatalogUploadRoutes({
      req,
      res,
      pathname,
      url,
      segments,
      apiBasePath,
      handlers,
      sendJson,
    });
    if (handledUpload) return true;

    const handledPublic = await handleCatalogPublicRoutes({
      req,
      res,
      pathname,
      url,
      segments,
      apiBasePath,
      orphanApiPath,
      handlers,
      sendJson,
    });
    if (handledPublic) return true;

    sendJson(req, res, 404, { error: 'Rota de sticker pack nao encontrada.' });
    return true;
  };
};
