import { createStickerCatalogAdminBanService } from './adminBanService.js';
import { createStickerCatalogAdminHandlers } from './adminPanelHandlers.js';

export const createStickerCatalogAdminBanContext = (dependencies = {}) => {
  const service = createStickerCatalogAdminBanService(dependencies);
  const { listAdminBans, createAdminBanRecord, revokeAdminBanRecord, assertGoogleIdentityNotBanned } = service;

  return {
    service,
    listAdminBans,
    createAdminBanRecord,
    revokeAdminBanRecord,
    assertGoogleIdentityNotBanned,
  };
};

export const createStickerCatalogAdminHandlersContext = (dependencies = {}) => createStickerCatalogAdminHandlers(dependencies);
