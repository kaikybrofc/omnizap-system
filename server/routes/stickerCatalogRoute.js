let stickerCatalogControllerPromise = null;

const loadStickerCatalogController = async () => {
  if (!stickerCatalogControllerPromise) {
    stickerCatalogControllerPromise = import('../controllers/stickerCatalogController.js');
  }
  return stickerCatalogControllerPromise;
};

export const getStickerCatalogRouteConfig = async () => {
  const controller = await loadStickerCatalogController();
  if (typeof controller.getStickerCatalogConfig !== 'function') return null;
  return controller.getStickerCatalogConfig();
};

export const maybeHandleStickerCatalogRoute = async (req, res, { pathname, url }) => {
  const controller = await loadStickerCatalogController();
  if (typeof controller.maybeHandleStickerCatalogRequest !== 'function') return false;
  return controller.maybeHandleStickerCatalogRequest(req, res, { pathname, url });
};
