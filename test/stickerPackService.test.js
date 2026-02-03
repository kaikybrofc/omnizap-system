import test from 'node:test';
import assert from 'node:assert/strict';

import { createStickerPackService } from '../app/modules/stickerPackModule/stickerPackService.js';

const createInMemoryRepositories = () => {
  const packs = new Map();
  const itemsByPack = new Map();

  const clonePack = (pack) => ({ ...pack });
  const getPackItems = (packId) => (itemsByPack.get(packId) || []).map((item) => ({ ...item }));

  const packRepository = {
    async createStickerPack(pack) {
      packs.set(pack.id, {
        ...pack,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
        version: pack.version || 1,
      });
      return clonePack(packs.get(pack.id));
    },

    async listStickerPacksByOwner(ownerJid, { limit = 50 } = {}) {
      return Array.from(packs.values())
        .filter((pack) => pack.owner_jid === ownerJid && !pack.deleted_at)
        .sort((a, b) => b.updated_at - a.updated_at)
        .slice(0, limit)
        .map((pack) => ({
          ...clonePack(pack),
          sticker_count: getPackItems(pack.id).length,
        }));
    },

    async findStickerPackByOwnerAndIdentifier(ownerJid, identifier) {
      const normalized = String(identifier || '').toLowerCase();
      const found = Array.from(packs.values()).find(
        (pack) =>
          pack.owner_jid === ownerJid &&
          !pack.deleted_at &&
          (pack.id === identifier || pack.pack_key === identifier || pack.name.toLowerCase() === normalized),
      );

      if (!found) return null;
      return {
        ...clonePack(found),
        sticker_count: getPackItems(found.id).length,
      };
    },

    async updateStickerPackFields(packId, fields) {
      const current = packs.get(packId);
      if (!current) return null;
      const next = {
        ...current,
        ...fields,
        version: current.version + 1,
        updated_at: new Date(),
      };
      packs.set(packId, next);
      return clonePack(next);
    },

    async softDeleteStickerPack(packId) {
      const current = packs.get(packId);
      if (!current) return null;
      const next = {
        ...current,
        deleted_at: new Date(),
        version: current.version + 1,
        updated_at: new Date(),
      };
      packs.set(packId, next);
      return clonePack(next);
    },

    async ensureUniquePackKey(packKey) {
      return !Array.from(packs.values()).some((pack) => pack.pack_key === packKey);
    },

    async bumpStickerPackVersion(packId) {
      const current = packs.get(packId);
      if (!current) return null;
      const next = {
        ...current,
        version: current.version + 1,
        updated_at: new Date(),
      };
      packs.set(packId, next);
      return clonePack(next);
    },
  };

  const itemRepository = {
    async listStickerPackItems(packId) {
      return getPackItems(packId).sort((a, b) => a.position - b.position);
    },

    async countStickerPackItems(packId) {
      return getPackItems(packId).length;
    },

    async getMaxStickerPackPosition(packId) {
      const items = getPackItems(packId);
      if (!items.length) return 0;
      return Math.max(...items.map((item) => item.position));
    },

    async createStickerPackItem(item) {
      const current = getPackItems(item.pack_id);
      current.push({ ...item });
      itemsByPack.set(item.pack_id, current);
      return { ...item };
    },

    async getStickerPackItemByStickerId(packId, stickerId) {
      return getPackItems(packId).find((item) => item.sticker_id === stickerId) || null;
    },

    async getStickerPackItemByPosition(packId, position) {
      return getPackItems(packId).find((item) => item.position === position) || null;
    },

    async removeStickerPackItemByStickerId(packId, stickerId) {
      const current = getPackItems(packId);
      const found = current.find((item) => item.sticker_id === stickerId) || null;
      itemsByPack.set(
        packId,
        current.filter((item) => item.sticker_id !== stickerId),
      );
      return found;
    },

    async shiftStickerPackPositionsAfter(packId, removedPosition) {
      const current = getPackItems(packId);
      const next = current.map((item) =>
        item.position > removedPosition
          ? {
              ...item,
              position: item.position - 1,
            }
          : item,
      );
      itemsByPack.set(packId, next);
    },

    async bulkUpdateStickerPackPositions(packId, orderStickerIds) {
      const current = getPackItems(packId);
      const map = new Map(current.map((item) => [item.sticker_id, item]));
      const next = orderStickerIds
        .map((stickerId, index) => {
          const item = map.get(stickerId);
          if (!item) return null;
          return {
            ...item,
            position: index + 1,
          };
        })
        .filter(Boolean);
      itemsByPack.set(packId, next);
    },
  };

  return { packRepository, itemRepository };
};

const createService = () => {
  const repositories = createInMemoryRepositories();

  return createStickerPackService({
    packRepository: repositories.packRepository,
    itemRepository: repositories.itemRepository,
    runInTransaction: async (handler) => handler(null),
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  });
};

test('create pack and list by owner', async () => {
  const service = createService();

  const created = await service.createPack({
    ownerJid: '5511999999999@s.whatsapp.net',
    name: 'Memes BR',
    publisher: 'Kaiky',
    description: 'Pack de testes',
  });

  assert.equal(created.name, 'Memes BR');
  assert.equal(created.items.length, 0);

  const packs = await service.listPacks({ ownerJid: '5511999999999@s.whatsapp.net' });
  assert.equal(packs.length, 1);
  assert.equal(packs[0].name, 'Memes BR');
});

test('add and remove stickers from pack', async () => {
  const service = createService();

  const pack = await service.createPack({
    ownerJid: '5521999999999@s.whatsapp.net',
    name: 'Pack Ops',
    publisher: 'Owner',
  });

  const addedFirst = await service.addStickerToPack({
    ownerJid: '5521999999999@s.whatsapp.net',
    identifier: pack.pack_key,
    asset: { id: 'asset-1' },
  });

  assert.equal(addedFirst.items.length, 1);
  assert.equal(addedFirst.cover_sticker_id, 'asset-1');

  const addedSecond = await service.addStickerToPack({
    ownerJid: '5521999999999@s.whatsapp.net',
    identifier: pack.pack_key,
    asset: { id: 'asset-2' },
  });

  assert.equal(addedSecond.items.length, 2);

  const removed = await service.removeStickerFromPack({
    ownerJid: '5521999999999@s.whatsapp.net',
    identifier: pack.pack_key,
    selector: '1',
  });

  assert.equal(removed.removed.sticker_id, 'asset-1');
  assert.equal(removed.pack.items.length, 1);
  assert.equal(removed.pack.items[0].sticker_id, 'asset-2');
});

test('set cover for an existing sticker', async () => {
  const service = createService();

  const pack = await service.createPack({
    ownerJid: '5531999999999@s.whatsapp.net',
    name: 'Cover Pack',
    publisher: 'Owner',
  });

  await service.addStickerToPack({
    ownerJid: '5531999999999@s.whatsapp.net',
    identifier: pack.pack_key,
    asset: { id: 'asset-a' },
  });

  await service.addStickerToPack({
    ownerJid: '5531999999999@s.whatsapp.net',
    identifier: pack.pack_key,
    asset: { id: 'asset-b' },
  });

  const updated = await service.setPackCover({
    ownerJid: '5531999999999@s.whatsapp.net',
    identifier: pack.pack_key,
    stickerId: 'asset-b',
  });

  assert.equal(updated.cover_sticker_id, 'asset-b');
});

test('clone and delete pack keep owner isolation', async () => {
  const service = createService();

  const base = await service.createPack({
    ownerJid: '5541999999999@s.whatsapp.net',
    name: 'Base Pack',
    publisher: 'Owner',
  });

  await service.addStickerToPack({
    ownerJid: '5541999999999@s.whatsapp.net',
    identifier: base.pack_key,
    asset: { id: 'asset-z' },
  });

  const cloned = await service.clonePack({
    ownerJid: '5541999999999@s.whatsapp.net',
    identifier: base.pack_key,
    newName: 'Base Pack Clone',
  });

  assert.equal(cloned.items.length, 1);
  assert.equal(cloned.name, 'Base Pack Clone');

  await service.deletePack({
    ownerJid: '5541999999999@s.whatsapp.net',
    identifier: base.pack_key,
  });

  const packs = await service.listPacks({ ownerJid: '5541999999999@s.whatsapp.net' });
  assert.equal(packs.length, 1);
  assert.equal(packs[0].name, 'Base Pack Clone');
});
////