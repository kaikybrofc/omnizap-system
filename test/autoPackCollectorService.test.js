import test from 'node:test';
import assert from 'node:assert/strict';

import { createAutoPackCollector } from '../app/modules/stickerPackModule/autoPackCollectorService.js';
import { StickerPackError, STICKER_PACK_ERROR_CODES } from '../app/modules/stickerPackModule/stickerPackErrors.js';
import { sanitizeText } from '../app/modules/stickerPackModule/stickerPackUtils.js';

const fakeBuffer = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x20, 0x0e, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a, 0x01, 0x00, 0x01, 0x00,
]);

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

const autoPackBaseName = sanitizeText(process.env.STICKER_PACK_AUTO_PACK_NAME || 'Pack', 120, { allowEmpty: false }) || 'Pack';

test('auto collector skips when disabled', async () => {
  const collector = createAutoPackCollector({
    enabled: false,
    logger: silentLogger,
    stickerPackService: {},
    saveStickerAssetFromBuffer: async () => ({ id: 'asset-1' }),
  });

  const result = await collector.addStickerToAutoPack({
    ownerJid: '5511999999999@s.whatsapp.net',
    senderName: 'Kaiky',
    stickerBuffer: fakeBuffer,
  });

  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'disabled');
});

test('auto collector creates pack when owner has no pack', async () => {
  const calls = [];
  let createdPayload = null;

  const collector = createAutoPackCollector({
    logger: silentLogger,
    saveStickerAssetFromBuffer: async () => ({ id: 'asset-1' }),
    stickerPackService: {
      listPacks: async () => [],
      createPack: async (payload) => {
        createdPayload = payload;
        return {
          id: 'pack-1',
          ...payload,
          publisher: payload.publisher,
        };
      },
      addStickerToPack: async (payload) => {
        calls.push(payload);
        return {
          id: 'pack-1',
          items: [{ sticker_id: 'asset-1' }],
        };
      },
    },
  });

  const result = await collector.addStickerToAutoPack({
    ownerJid: '5511999999999@s.whatsapp.net',
    senderName: 'Kaiky',
    stickerBuffer: fakeBuffer,
  });

  assert.equal(result.status, 'added');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].identifier, 'pack-1');
  assert.equal(calls[0].asset.id, 'asset-1');
  assert.equal(createdPayload.name, `${autoPackBaseName}-1`);
});

test('auto collector ignores duplicate sticker', async () => {
  const collector = createAutoPackCollector({
    logger: silentLogger,
    saveStickerAssetFromBuffer: async () => ({ id: 'asset-1' }),
    stickerPackService: {
      listPacks: async () => [{ id: 'pack-1', name: 'Main Pack' }],
      addStickerToPack: async () => {
        throw new StickerPackError(STICKER_PACK_ERROR_CODES.DUPLICATE_STICKER, 'duplicado');
      },
    },
  });

  const result = await collector.addStickerToAutoPack({
    ownerJid: '5511999999999@s.whatsapp.net',
    senderName: 'Kaiky',
    stickerBuffer: fakeBuffer,
  });

  assert.equal(result.status, 'duplicate');
  assert.equal(result.pack.id, 'pack-1');
});

test('auto collector creates rollover pack when limit is reached', async () => {
  let addAttempt = 0;
  let createdPayload = null;

  const collector = createAutoPackCollector({
    logger: silentLogger,
    saveStickerAssetFromBuffer: async () => ({ id: 'asset-1' }),
    stickerPackService: {
      listPacks: async () => [{ id: 'pack-1', name: `${autoPackBaseName}-1`, visibility: 'private', publisher: 'Kaiky' }],
      createPack: async (payload) => {
        createdPayload = payload;
        return { id: 'pack-2', ...payload };
      },
      addStickerToPack: async ({ identifier }) => {
        addAttempt += 1;
        if (addAttempt === 1) {
          throw new StickerPackError(STICKER_PACK_ERROR_CODES.PACK_LIMIT_REACHED, 'limite');
        }
        return {
          id: identifier,
          items: [{ sticker_id: 'asset-1' }],
        };
      },
    },
  });

  const result = await collector.addStickerToAutoPack({
    ownerJid: '5511999999999@s.whatsapp.net',
    senderName: 'Kaiky',
    stickerBuffer: fakeBuffer,
  });

  assert.equal(result.status, 'added');
  assert.equal(result.pack.id, 'pack-2');
  assert.equal(addAttempt, 2);
  assert.equal(createdPayload.name, `${autoPackBaseName}-2`);
});

test('auto collector skips duplicated index and chooses next available suffix', async () => {
  let addAttempt = 0;
  let createdPayload = null;

  const collector = createAutoPackCollector({
    logger: silentLogger,
    saveStickerAssetFromBuffer: async () => ({ id: 'asset-1' }),
    stickerPackService: {
      listPacks: async () => [
        { id: 'pack-1', name: autoPackBaseName, visibility: 'private', publisher: 'Kaiky' },
        { id: 'pack-2', name: `${autoPackBaseName}-2`, visibility: 'private', publisher: 'Kaiky' },
        { id: 'pack-3', name: `${autoPackBaseName}-3`, visibility: 'private', publisher: 'Kaiky' },
      ],
      createPack: async (payload) => {
        createdPayload = payload;
        return { id: 'pack-4', ...payload };
      },
      addStickerToPack: async ({ identifier }) => {
        addAttempt += 1;
        if (addAttempt === 1) {
          throw new StickerPackError(STICKER_PACK_ERROR_CODES.PACK_LIMIT_REACHED, 'limite');
        }
        return {
          id: identifier,
          items: [{ sticker_id: 'asset-1' }],
        };
      },
    },
  });

  const result = await collector.addStickerToAutoPack({
    ownerJid: '5511999999999@s.whatsapp.net',
    senderName: 'Kaiky',
    stickerBuffer: fakeBuffer,
  });

  assert.equal(result.status, 'added');
  assert.equal(result.pack.id, 'pack-4');
  assert.equal(createdPayload.name, `${autoPackBaseName}-4`);
});
