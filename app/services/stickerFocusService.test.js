import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveStickerFocusMessageClassification } from './stickerFocusService.js';

test('resolveStickerFocusMessageClassification nao conta album como mensagem limitada', () => {
  const classification = resolveStickerFocusMessageClassification({
    messageInfo: { message: {} },
    extractedText: '[Álbum]',
    mediaEntries: [{ mediaType: 'album' }],
  });

  assert.equal(classification.isThrottleCandidate, false);
  assert.equal(classification.messageType, 'album');
  assert.equal(classification.reason, 'sticker_flow_media');
});

test('resolveStickerFocusMessageClassification nao conta albumImage como mensagem limitada', () => {
  const classification = resolveStickerFocusMessageClassification({
    messageInfo: { message: {} },
    extractedText: '[Álbum]',
    mediaEntries: [{ mediaType: 'albumImage' }],
  });

  assert.equal(classification.isThrottleCandidate, false);
  assert.equal(classification.messageType, 'albumimage');
  assert.equal(classification.reason, 'sticker_flow_media');
});

test('resolveStickerFocusMessageClassification continua limitando texto comum', () => {
  const classification = resolveStickerFocusMessageClassification({
    messageInfo: {
      message: {
        conversation: 'mensagem de texto',
      },
    },
    extractedText: 'mensagem de texto',
    mediaEntries: [],
  });

  assert.equal(classification.isThrottleCandidate, true);
  assert.equal(classification.messageType, 'text');
  assert.equal(classification.reason, 'explicit_text_payload');
});
