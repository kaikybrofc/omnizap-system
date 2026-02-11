import test from 'node:test';
import assert from 'node:assert/strict';

import { registerEvolutionPokedexEntry } from './rpgEvolutionUtils.js';

test('atualização de Pokédex deve ser ignorada quando não há evolução válida', async () => {
  let called = 0;
  const registerEntry = async () => {
    called += 1;
  };

  const changed = await registerEvolutionPokedexEntry({
    ownerJid: '5511999999999@s.whatsapp.net',
    evolutionOutcome: null,
    registerEntry,
  });

  assert.equal(changed, false);
  assert.equal(called, 0);
});

test('atualização de Pokédex deve registrar pokeId evoluído', async () => {
  const calls = [];
  const registerEntry = async (payload, connection) => {
    calls.push({ payload, connection });
  };

  const changed = await registerEvolutionPokedexEntry({
    ownerJid: '5511888888888@s.whatsapp.net',
    evolutionOutcome: {
      updatePayload: {
        pokeId: 6,
      },
    },
    connection: { tx: true },
    registerEntry,
  });

  assert.equal(changed, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].payload, {
    ownerJid: '5511888888888@s.whatsapp.net',
    pokeId: 6,
  });
  assert.deepEqual(calls[0].connection, { tx: true });
});
