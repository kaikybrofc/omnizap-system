import test from 'node:test';
import assert from 'node:assert/strict';

import { __testablesRpgPokemonDomain } from './rpgPokemonDomain.js';

const { resolveBiomeFromKey, resolveDefaultBiomeForGroup, resolveMissionRefs, buildMissionProgressZero, normalizeMissionProgress, isMissionCompleted, resolveMissionStateForRefs, resolveVictoryRewards } = __testablesRpgPokemonDomain;

test('bioma deve ser resolvido por chave e mapeamento de grupo deve ser determinístico', () => {
  const cidade = resolveBiomeFromKey('cidade');
  assert.equal(cidade?.key, 'cidade');
  assert.deepEqual(cidade?.preferredTypes, ['electric', 'normal']);

  const first = resolveDefaultBiomeForGroup('120363000000000000@g.us');
  const second = resolveDefaultBiomeForGroup('120363000000000000@g.us');
  assert.equal(first?.key, second?.key);
});

test('missões: referência diária/semanal deve usar dia UTC e início da semana na segunda', () => {
  const refs = resolveMissionRefs(new Date(Date.UTC(2026, 1, 10, 15, 30, 0)));
  assert.equal(refs.dailyRefDate, '2026-02-10');
  assert.equal(refs.weeklyRefDate, '2026-02-09');

  const sundayRefs = resolveMissionRefs(new Date(Date.UTC(2026, 1, 8, 5, 0, 0)));
  assert.equal(sundayRefs.dailyRefDate, '2026-02-08');
  assert.equal(sundayRefs.weeklyRefDate, '2026-02-02');
});

test('missões: reset diário/semanal deve limpar progresso e claimed quando muda referência', () => {
  const refs = {
    dailyRefDate: '2026-02-10',
    weeklyRefDate: '2026-02-09',
  };

  const row = {
    daily_ref_date: '2026-02-09',
    daily_progress_json: { explorar: 3, vitorias: 2, capturas: 1 },
    daily_claimed_at: '2026-02-09T20:00:00.000Z',
    weekly_ref_date: '2026-02-02',
    weekly_progress_json: { explorar: 20, vitorias: 12, capturas: 5 },
    weekly_claimed_at: '2026-02-05T20:00:00.000Z',
  };

  const result = resolveMissionStateForRefs({
    ownerJid: 'player@s.whatsapp.net',
    row,
    refs,
  });

  assert.equal(result.dirty, true);
  assert.deepEqual(result.normalized.daily_progress_json, buildMissionProgressZero());
  assert.deepEqual(result.normalized.weekly_progress_json, buildMissionProgressZero());
  assert.equal(result.normalized.daily_claimed_at, null);
  assert.equal(result.normalized.weekly_claimed_at, null);
});

test('missões: normalização e conclusão devem refletir metas preenchidas', () => {
  const normalized = normalizeMissionProgress({
    explorar: '3',
    vitorias: 2,
    capturas: 1,
  });

  assert.deepEqual(normalized, {
    explorar: 3,
    vitorias: 2,
    capturas: 1,
  });

  assert.equal(
    isMissionCompleted(normalized, {
      explorar: 3,
      vitorias: 2,
      capturas: 1,
    }),
    true,
  );
});

test('ginásio deve ter recompensa superior e item bônus em relação à batalha selvagem', () => {
  const wild = resolveVictoryRewards({
    mode: 'wild',
    enemy: { level: 10 },
  });
  const gym = resolveVictoryRewards({
    mode: 'gym',
    enemy: { level: 10 },
  });

  assert.ok(gym.playerXp > wild.playerXp);
  assert.ok(gym.pokemonXp > wild.pokemonXp);
  assert.ok(gym.gold > wild.gold);
  assert.deepEqual(gym.items, [{ key: 'pokeball', quantity: 1 }]);
});
