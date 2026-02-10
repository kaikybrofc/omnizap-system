import test from 'node:test';
import assert from 'node:assert/strict';

import { createWildEncounter, resolveBattleTurn, resolveCaptureAttempt, resolveEvolutionByLevel, resolveSingleAttack } from './rpgBattleService.js';

const PREFERRED_MOVE_NAMES = ['tackle', 'quick-attack', 'scratch', 'pound', 'ember', 'water-gun', 'vine-whip', 'bite', 'gust', 'swift', 'struggle'];

const ensurePokeApiCache = () => {
  if (!(globalThis.__omnizapPokeApiCache instanceof Map)) {
    globalThis.__omnizapPokeApiCache = new Map();
  }
  return globalThis.__omnizapPokeApiCache;
};

const setCache = (cache, key, data) => {
  cache.set(key, {
    data,
    expiresAt: Date.now() + 60 * 60 * 1000,
  });
};

const buildTypeData = ({ pokemonIds = [] } = {}) => ({
  damage_relations: {
    double_damage_to: [],
    half_damage_to: [],
    no_damage_to: [],
  },
  pokemon: pokemonIds.map((id) => ({
    pokemon: {
      name: `poke-${id}`,
      url: `https://pokeapi.co/api/v2/pokemon/${id}/`,
    },
  })),
});

const buildMoveData = (name, type = 'normal', power = 40) => ({
  id: Math.max(1, name.length * 17),
  name,
  power,
  accuracy: 100,
  pp: 35,
  damage_class: { name: power > 0 ? 'physical' : 'status' },
  type: { name: type },
});

const buildPokemonData = ({
  id,
  name,
  speciesId = id,
  primaryType = 'normal',
  moves = PREFERRED_MOVE_NAMES,
  hp = 45,
  attack = 49,
  defense = 49,
  specialAttack = 65,
  specialDefense = 65,
  speed = 45,
}) => ({
  id,
  name,
  species: {
    name,
    url: `https://pokeapi.co/api/v2/pokemon-species/${speciesId}/`,
  },
  types: [{ slot: 1, type: { name: primaryType } }],
  stats: [
    { base_stat: hp, stat: { name: 'hp' } },
    { base_stat: attack, stat: { name: 'attack' } },
    { base_stat: defense, stat: { name: 'defense' } },
    { base_stat: specialAttack, stat: { name: 'special-attack' } },
    { base_stat: specialDefense, stat: { name: 'special-defense' } },
    { base_stat: speed, stat: { name: 'speed' } },
  ],
  moves: moves.map((moveName) => ({ move: { name: moveName } })),
  sprites: {
    front_default: `https://img.local/${id}-front.png`,
    front_shiny: `https://img.local/${id}-shiny.png`,
    other: {
      'official-artwork': {
        front_default: `https://img.local/${id}-artwork.png`,
      },
    },
  },
});

const seedCorePokemonData = (cache) => {
  setCache(cache, 'pokemon:1', buildPokemonData({ id: 1, name: 'bulbasaur', primaryType: 'grass', speed: 45 }));
  setCache(cache, 'pokemon:4', buildPokemonData({ id: 4, name: 'charmander', primaryType: 'fire', speed: 65 }));
  setCache(cache, 'pokemon:5', buildPokemonData({ id: 5, name: 'charmeleon', primaryType: 'fire', speciesId: 5, speed: 80 }));
  setCache(cache, 'pokemon:6', buildPokemonData({ id: 6, name: 'charizard', primaryType: 'fire', speciesId: 6, speed: 100 }));
  setCache(cache, 'pokemon:25', buildPokemonData({ id: 25, name: 'pikachu', primaryType: 'electric', speed: 90 }));

  setCache(cache, 'species:1', {
    id: 1,
    capture_rate: 45,
    evolution_chain: { url: 'https://pokeapi.co/api/v2/evolution-chain/1/' },
  });
  setCache(cache, 'species:4', {
    id: 4,
    capture_rate: 45,
    evolution_chain: { url: 'https://pokeapi.co/api/v2/evolution-chain/2/' },
  });
  setCache(cache, 'species:25', {
    id: 25,
    capture_rate: 190,
    evolution_chain: { url: 'https://pokeapi.co/api/v2/evolution-chain/10/' },
  });

  setCache(cache, 'evolution-chain:2', {
    chain: {
      species: { name: 'charmander', url: 'https://pokeapi.co/api/v2/pokemon-species/4/' },
      evolves_to: [
        {
          species: { name: 'charmeleon', url: 'https://pokeapi.co/api/v2/pokemon-species/5/' },
          evolution_details: [{ trigger: { name: 'level-up' }, min_level: 16 }],
          evolves_to: [
            {
              species: { name: 'charizard', url: 'https://pokeapi.co/api/v2/pokemon-species/6/' },
              evolution_details: [{ trigger: { name: 'level-up' }, min_level: 36 }],
              evolves_to: [],
            },
          ],
        },
      ],
    },
  });
};

const seedCoreTypeAndMoveData = (cache) => {
  setCache(cache, 'type:grass', buildTypeData({ pokemonIds: [1] }));
  setCache(cache, 'type:electric', buildTypeData({ pokemonIds: [25] }));
  setCache(cache, 'type:normal', buildTypeData());
  setCache(cache, 'type:fire', buildTypeData());
  setCache(cache, 'type:water', buildTypeData());
  setCache(cache, 'type:flying', buildTypeData());
  setCache(cache, 'type:dark', buildTypeData());

  for (const moveName of PREFERRED_MOVE_NAMES) {
    setCache(cache, `move:${moveName}`, buildMoveData(moveName, 'normal', moveName === 'struggle' ? 50 : 40));
  }

  for (let id = 1; id <= 25; id += 1) {
    setCache(cache, `nature:${id}`, {
      id,
      name: `nature-${id}`,
      increased_stat: null,
      decreased_stat: null,
    });
  }
};

const withRandomSequence = async (values, fn) => {
  const originalRandom = Math.random;
  let index = 0;

  Math.random = () => {
    if (!values.length) return 0.5;
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return value;
  };

  try {
    return await fn();
  } finally {
    Math.random = originalRandom;
  }
};

test(
  'fluxo crítico: explorar -> batalha -> capturar deve ser executável com snapshot válido',
  { concurrency: false },
  async () => {
    const cache = ensurePokeApiCache();
    cache.clear();
    seedCoreTypeAndMoveData(cache);
    seedCorePokemonData(cache);

    const encounter = await withRandomSequence([0.4, 0.8, 0.0, 0.0], async () =>
      createWildEncounter({
        playerLevel: 8,
        preferredTypes: ['grass'],
      }),
    );

    assert.equal(encounter.enemySnapshot.pokeId, 1);
    assert.equal(encounter.enemySnapshot.isShiny, false);

    const battleSnapshot = {
      my: {
        displayName: 'Pikachu',
        level: 12,
        currentHp: 55,
        maxHp: 55,
        types: ['electric'],
        stats: {
          attack: 80,
          defense: 60,
          specialAttack: 80,
          specialDefense: 60,
          speed: 110,
        },
        moves: [
          {
            displayName: 'Tackle',
            name: 'tackle',
            power: 40,
            accuracy: 100,
            damageClass: 'physical',
            type: 'normal',
            typeDamage: { doubleTo: [], halfTo: [], noTo: [] },
          },
          {
            displayName: 'Tackle',
            name: 'tackle',
            power: 40,
            accuracy: 100,
            damageClass: 'physical',
            type: 'normal',
            typeDamage: { doubleTo: [], halfTo: [], noTo: [] },
          },
          {
            displayName: 'Tackle',
            name: 'tackle',
            power: 40,
            accuracy: 100,
            damageClass: 'physical',
            type: 'normal',
            typeDamage: { doubleTo: [], halfTo: [], noTo: [] },
          },
          {
            displayName: 'Tackle',
            name: 'tackle',
            power: 40,
            accuracy: 100,
            damageClass: 'physical',
            type: 'normal',
            typeDamage: { doubleTo: [], halfTo: [], noTo: [] },
          },
        ],
      },
      enemy: encounter.enemySnapshot,
    };

    const turnResult = await withRandomSequence([0.0, 0.0, 0.0, 0.0], async () =>
      resolveBattleTurn({
        battleSnapshot,
        playerMoveSlot: 1,
      }),
    );

    assert.equal(turnResult.validTurn, true);
    assert.ok(turnResult.logs.length > 0);

    turnResult.snapshot.enemy.currentHp = 1;
    turnResult.snapshot.my.currentHp = Math.max(1, turnResult.snapshot.my.currentHp);

    const captureResult = await withRandomSequence([0.0], async () =>
      resolveCaptureAttempt({
        battleSnapshot: turnResult.snapshot,
      }),
    );

    assert.equal(captureResult.validAction, true);
    assert.equal(captureResult.success, true);
    assert.equal(captureResult.winner, 'player');
  },
);

test(
  'deve marcar encontro como shiny e usar sprite shiny quando o roll atender a chance',
  { concurrency: false },
  async () => {
    const cache = ensurePokeApiCache();
    cache.clear();
    seedCoreTypeAndMoveData(cache);
    seedCorePokemonData(cache);

    const encounter = await withRandomSequence([0.4, 0.0, 0.0, 0.0], async () =>
      createWildEncounter({
        playerLevel: 10,
        preferredTypes: ['grass'],
      }),
    );

    assert.equal(encounter.isShiny, true);
    assert.equal(encounter.enemySnapshot.isShiny, true);
    assert.equal(encounter.enemySnapshot.imageUrl, 'https://img.local/1-shiny.png');
  },
);

test(
  'bioma deve priorizar spawn por tipo preferencial',
  { concurrency: false },
  async () => {
    const cache = ensurePokeApiCache();
    cache.clear();
    seedCoreTypeAndMoveData(cache);
    seedCorePokemonData(cache);

    const encounter = await withRandomSequence([0.6, 0.9, 0.0, 0.0], async () =>
      createWildEncounter({
        playerLevel: 10,
        preferredTypes: ['electric'],
      }),
    );

    assert.equal(encounter.enemySnapshot.pokeId, 25);
    assert.ok(encounter.enemySnapshot.types.includes('electric'));
  },
);

test(
  'evolução automática por nível deve seguir evolution-chain da PokéAPI',
  { concurrency: false },
  async () => {
    const cache = ensurePokeApiCache();
    cache.clear();
    seedCoreTypeAndMoveData(cache);
    seedCorePokemonData(cache);

    const atLevel16 = await resolveEvolutionByLevel({
      pokeId: 4,
      level: 16,
    });
    assert.equal(atLevel16?.from?.pokeId, 4);
    assert.equal(atLevel16?.to?.pokeId, 5);
    assert.equal(atLevel16?.to?.name, 'Charmeleon');

    const atLevel40 = await resolveEvolutionByLevel({
      pokeId: 4,
      level: 40,
    });
    assert.equal(atLevel40?.to?.pokeId, 6);
    assert.equal(atLevel40?.to?.name, 'Charizard');
  },
);

test('ataque único deve aplicar dano e reduzir HP do alvo', () => {
  const attacker = {
    displayName: 'Pikachu',
    level: 15,
    types: ['electric'],
    stats: {
      attack: 70,
      defense: 55,
      specialAttack: 65,
      specialDefense: 55,
      speed: 90,
    },
    moves: [
      {
        displayName: 'Tackle',
        name: 'tackle',
        power: 40,
        accuracy: 100,
        damageClass: 'physical',
        type: 'normal',
        typeDamage: { doubleTo: [], halfTo: [], noTo: [] },
      },
    ],
  };
  const defender = {
    displayName: 'Bulbasaur',
    level: 12,
    currentHp: 80,
    maxHp: 80,
    types: ['grass'],
    stats: {
      attack: 55,
      defense: 60,
      specialAttack: 55,
      specialDefense: 60,
      speed: 50,
    },
    moves: [],
  };

  const result = resolveSingleAttack({
    attackerSnapshot: attacker,
    defenderSnapshot: defender,
    moveSlot: 1,
    attackerLabel: 'Pikachu',
    defenderLabel: 'Bulbasaur',
  });

  assert.equal(result.validMove, true);
  assert.ok(result.damage >= 1);
  assert.ok(result.defender.currentHp < 80);
});
