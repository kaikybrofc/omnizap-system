import assert from 'node:assert/strict';

import { initAuthCreds, proto } from '@whiskeysockets/baileys';

const creds = initAuthCreds();
assert.equal(typeof creds?.registrationId, 'number');
assert.ok(creds?.noiseKey?.private instanceof Uint8Array);

const appStateKey = proto.Message.AppStateSyncKeyData.fromObject({});
assert.ok(appStateKey && typeof appStateKey === 'object');

console.log('Baileys smoke check OK.');
