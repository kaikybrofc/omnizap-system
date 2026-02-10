import { getEvolutionChain, getMove, getPokemon, getPokemonImage, getSpecies, getType } from '../../services/pokeApiService.js';
import logger from '../../utils/logger/loggerModule.js';

const MIN_LEVEL = 1;
const MAX_LEVEL = 100;
const MIN_WILD_LEVEL = 2;
const DEFAULT_CAPTURE_RATE = 120;
const DEFAULT_WILD_MAX_ID = Math.max(151, Number(process.env.RPG_WILD_MAX_POKE_ID) || 151);
const MOVE_SAMPLE_LIMIT = Math.max(12, Number(process.env.RPG_MOVE_SAMPLE_LIMIT) || 24);
const DEFAULT_SHINY_CHANCE = 0.01;
const RAW_SHINY_CHANCE = Number(process.env.RPG_SHINY_CHANCE ?? DEFAULT_SHINY_CHANCE);
const SHINY_CHANCE = Number.isFinite(RAW_SHINY_CHANCE) ? Math.max(0, Math.min(1, RAW_SHINY_CHANCE)) : DEFAULT_SHINY_CHANCE;
const MAX_BIOME_LOOKUP_ATTEMPTS = Math.max(2, Number(process.env.RPG_BIOME_LOOKUP_ATTEMPTS) || 6);

const PHYSICAL_CLASS = 'physical';
const SPECIAL_CLASS = 'special';
const STATUS_CLASS = 'status';

const BASE_STAT_NAMES = ['hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed'];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const randomInt = (min, max) => {
  const low = Math.ceil(min);
  const high = Math.floor(max);
  if (high <= low) return low;
  return Math.floor(Math.random() * (high - low + 1)) + low;
};

const randomFloat = (min, max) => Math.random() * (max - min) + min;

const capitalize = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return 'Desconhecido';
  return raw
    .split('-')
    .map((part) => (part ? `${part.slice(0, 1).toUpperCase()}${part.slice(1)}` : ''))
    .join(' ');
};

const extractIdFromUrl = (url) => {
  const match = String(url || '').match(/\/(\d+)\/?$/);
  return match ? Number(match[1]) : null;
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toPositiveInt = (value, fallback = 0) => {
  const parsed = Math.floor(toNumber(value, fallback));
  return parsed >= 0 ? parsed : fallback;
};

const normalizeIvs = (ivs) => {
  const source = ivs && typeof ivs === 'object' ? ivs : {};
  return {
    hp: clamp(toPositiveInt(source.hp, randomInt(8, 31)), 0, 31),
    attack: clamp(toPositiveInt(source.attack, randomInt(8, 31)), 0, 31),
    defense: clamp(toPositiveInt(source.defense, randomInt(8, 31)), 0, 31),
    specialAttack: clamp(toPositiveInt(source.specialAttack, randomInt(8, 31)), 0, 31),
    specialDefense: clamp(toPositiveInt(source.specialDefense, randomInt(8, 31)), 0, 31),
    speed: clamp(toPositiveInt(source.speed, randomInt(8, 31)), 0, 31),
  };
};

const getBaseStats = (pokemonData) => {
  const statMap = {};
  for (const stat of pokemonData?.stats || []) {
    const name = stat?.stat?.name;
    if (!name) continue;
    statMap[name] = toPositiveInt(stat?.base_stat, 1);
  }

  return {
    hp: statMap.hp || 45,
    attack: statMap.attack || 49,
    defense: statMap.defense || 49,
    specialAttack: statMap['special-attack'] || 50,
    specialDefense: statMap['special-defense'] || 50,
    speed: statMap.speed || 45,
  };
};

const calculateMaxHp = ({ baseHp, ivHp, level }) => {
  const computed = Math.floor(((2 * baseHp + ivHp) * level) / 100) + level + 10;
  return Math.max(10, computed);
};

const calculateStat = ({ base, iv, level }) => {
  const computed = Math.floor(((2 * base + iv) * level) / 100) + 5;
  return Math.max(1, computed);
};

const normalizeTypeRelations = (typeData) => {
  const relation = typeData?.damage_relations || {};
  return {
    doubleTo: (relation.double_damage_to || []).map((entry) => entry?.name).filter(Boolean),
    halfTo: (relation.half_damage_to || []).map((entry) => entry?.name).filter(Boolean),
    noTo: (relation.no_damage_to || []).map((entry) => entry?.name).filter(Boolean),
  };
};

const normalizeMove = (move, index) => {
  const power = toPositiveInt(move?.power, 0);
  const accuracy = clamp(toPositiveInt(move?.accuracy, 100), 1, 100);
  const damageClass = String(move?.damageClass || STATUS_CLASS).toLowerCase();
  const type = String(move?.type || 'normal').toLowerCase();
  const moveName = String(move?.name || `move-${index + 1}`).toLowerCase();

  return {
    id: toPositiveInt(move?.id, 0),
    name: moveName,
    displayName: capitalize(moveName),
    power,
    accuracy,
    pp: toPositiveInt(move?.pp, 35),
    damageClass: [PHYSICAL_CLASS, SPECIAL_CLASS, STATUS_CLASS].includes(damageClass)
      ? damageClass
      : STATUS_CLASS,
    type,
    typeDamage: {
      doubleTo: Array.isArray(move?.typeDamage?.doubleTo) ? move.typeDamage.doubleTo : [],
      halfTo: Array.isArray(move?.typeDamage?.halfTo) ? move.typeDamage.halfTo : [],
      noTo: Array.isArray(move?.typeDamage?.noTo) ? move.typeDamage.noTo : [],
    },
  };
};

const loadMoveSnapshot = async (idOrName) => {
  const moveData = await getMove(idOrName);
  const typeName = String(moveData?.type?.name || 'normal').toLowerCase();
  const typeData = await getType(typeName);
  const typeDamage = normalizeTypeRelations(typeData);

  return normalizeMove(
    {
      id: moveData?.id,
      name: moveData?.name,
      power: moveData?.power,
      accuracy: moveData?.accuracy,
      pp: moveData?.pp,
      damageClass: moveData?.damage_class?.name,
      type: typeName,
      typeDamage,
    },
    0,
  );
};

const ensureFourMoves = async (moves) => {
  const normalized = (moves || []).map((move, index) => normalizeMove(move, index)).slice(0, 4);

  if (!normalized.length) {
    normalized.push(await loadMoveSnapshot('struggle'));
  }

  while (normalized.length < 4) {
    normalized.push({ ...normalized[normalized.length % normalized.length] });
  }

  return normalized.slice(0, 4);
};

const buildMoveCandidateList = (pokemonData) => {
  const preferred = ['tackle', 'quick-attack', 'scratch', 'pound', 'ember', 'water-gun', 'vine-whip', 'bite', 'gust', 'swift'];
  const fromPokemon = (pokemonData?.moves || []).map((entry) => entry?.move?.name).filter(Boolean);
  const unique = new Set();
  const merged = [];

  [...preferred, ...fromPokemon].forEach((name) => {
    const key = String(name || '').trim().toLowerCase();
    if (!key || unique.has(key)) return;
    unique.add(key);
    merged.push(key);
  });

  return merged.slice(0, MOVE_SAMPLE_LIMIT);
};

const pickBattleMoves = async (pokemonData) => {
  const candidateNames = buildMoveCandidateList(pokemonData);
  const damagingMoves = [];
  const supportMoves = [];

  for (const moveName of candidateNames) {
    if (damagingMoves.length >= 4 && supportMoves.length >= 4) break;

    try {
      const move = await loadMoveSnapshot(moveName);
      if (move.power > 0 && move.damageClass !== STATUS_CLASS) {
        damagingMoves.push(move);
      } else {
        supportMoves.push(move);
      }
    } catch (error) {
      logger.debug('Movimento ignorado no carregamento do RPG Pokemon.', {
        moveName,
        error: error.message,
      });
    }
  }

  const merged = [...damagingMoves.slice(0, 4)];
  for (const move of supportMoves) {
    if (merged.length >= 4) break;
    merged.push(move);
  }

  return ensureFourMoves(merged);
};

const isStoredMoveValid = (move) => {
  if (!move || typeof move !== 'object') return false;
  const name = String(move.name || '').trim();
  const type = String(move.type || '').trim();
  return Boolean(name && type);
};

const resolveMoveSet = async (pokemonData, storedMoves = null) => {
  const normalizedStored = Array.isArray(storedMoves)
    ? storedMoves.filter(isStoredMoveValid).map((move, index) => normalizeMove(move, index)).slice(0, 4)
    : [];

  if (normalizedStored.length) {
    return ensureFourMoves(normalizedStored);
  }

  const picked = await pickBattleMoves(pokemonData);
  return ensureFourMoves(picked);
};

const resolveTypeMultiplier = (move, defenderTypes = []) => {
  const relation = move?.typeDamage || {};
  const doubleTo = new Set(Array.isArray(relation.doubleTo) ? relation.doubleTo : []);
  const halfTo = new Set(Array.isArray(relation.halfTo) ? relation.halfTo : []);
  const noTo = new Set(Array.isArray(relation.noTo) ? relation.noTo : []);

  let multiplier = 1;

  defenderTypes.forEach((defType) => {
    if (noTo.has(defType)) {
      multiplier *= 0;
      return;
    }

    if (doubleTo.has(defType)) multiplier *= 2;
    if (halfTo.has(defType)) multiplier *= 0.5;
  });

  return multiplier;
};

const applyDamage = ({ attacker, defender, move }) => {
  const accuracyRoll = randomInt(1, 100);
  const accuracy = clamp(toPositiveInt(move?.accuracy, 100), 1, 100);
  if (accuracyRoll > accuracy) {
    return {
      hit: false,
      damage: 0,
      critical: false,
      stab: 1,
      multiplier: 1,
    };
  }

  const power = toPositiveInt(move?.power, 0);
  if (power <= 0) {
    return {
      hit: true,
      damage: 0,
      critical: false,
      stab: 1,
      multiplier: 1,
    };
  }

  const damageClass = String(move?.damageClass || PHYSICAL_CLASS).toLowerCase();
  const attackStat = damageClass === SPECIAL_CLASS ? toPositiveInt(attacker?.stats?.specialAttack, 1) : toPositiveInt(attacker?.stats?.attack, 1);
  const defenseStat = damageClass === SPECIAL_CLASS ? toPositiveInt(defender?.stats?.specialDefense, 1) : toPositiveInt(defender?.stats?.defense, 1);

  const level = clamp(toPositiveInt(attacker?.level, 1), MIN_LEVEL, MAX_LEVEL);
  const baseDamage = (((((2 * level) / 5 + 2) * power * (attackStat / Math.max(1, defenseStat))) / 50) + 2);
  const stab = Array.isArray(attacker?.types) && attacker.types.includes(move?.type) ? 1.2 : 1;
  const multiplier = resolveTypeMultiplier(move, defender?.types || []);
  const randomFactor = randomFloat(0.85, 1);

  let finalDamage = Math.floor(baseDamage * stab * multiplier * randomFactor);
  if (multiplier > 0) {
    finalDamage = Math.max(1, finalDamage);
  } else {
    finalDamage = 0;
  }

  defender.currentHp = clamp(toPositiveInt(defender.currentHp, 0) - finalDamage, 0, defender.maxHp);

  return {
    hit: true,
    damage: finalDamage,
    critical: false,
    stab,
    multiplier,
  };
};

const formatTypeEffectText = (multiplier) => {
  if (multiplier === 0) return 'Não teve efeito.';
  if (multiplier >= 2) return 'Super efetivo!';
  if (multiplier > 0 && multiplier < 1) return 'Pouco efetivo.';
  return '';
};

const performAction = ({ attacker, defender, move, attackerLabel, defenderLabel }) => {
  const result = applyDamage({ attacker, defender, move });

  if (!result.hit) {
    return [`${attackerLabel} usou *${move.displayName}* e errou.`];
  }

  if (result.damage <= 0) {
    return [`${attackerLabel} usou *${move.displayName}*, mas não causou dano.`];
  }

  const lines = [`${attackerLabel} usou *${move.displayName}* e causou *${result.damage}* de dano.`];
  const effectText = formatTypeEffectText(result.multiplier);
  if (effectText) lines.push(effectText);

  if (defender.currentHp <= 0) {
    lines.push(`${defenderLabel} desmaiou.`);
  }

  return lines;
};

const cloneSnapshot = (snapshot) => JSON.parse(JSON.stringify(snapshot));

const resolveActionOrder = (snapshot, playerMoveIndex, enemyMoveIndex) => {
  const mySpeed = toPositiveInt(snapshot?.my?.stats?.speed, 1);
  const enemySpeed = toPositiveInt(snapshot?.enemy?.stats?.speed, 1);

  const playerAction = { actor: 'my', moveIndex: playerMoveIndex };
  const enemyAction = { actor: 'enemy', moveIndex: enemyMoveIndex };

  if (mySpeed === enemySpeed) {
    return Math.random() > 0.5 ? [playerAction, enemyAction] : [enemyAction, playerAction];
  }

  return mySpeed > enemySpeed ? [playerAction, enemyAction] : [enemyAction, playerAction];
};

const resolveWinner = (snapshot) => {
  if (snapshot?.enemy?.currentHp <= 0) return 'player';
  if (snapshot?.my?.currentHp <= 0) return 'enemy';
  return null;
};

const pickEnemyMoveIndex = (snapshot) => {
  const moves = Array.isArray(snapshot?.enemy?.moves) ? snapshot.enemy.moves : [];
  if (!moves.length) return 0;
  return randomInt(0, moves.length - 1);
};

const parsePokemonIdFromTypeEntry = (entry) => {
  const url = entry?.pokemon?.url;
  const idFromUrl = extractIdFromUrl(url);
  if (Number.isFinite(idFromUrl) && idFromUrl > 0) {
    return idFromUrl;
  }
  return null;
};

const pickPokemonByPreferredTypes = async (preferredTypes = []) => {
  const normalizedTypes = (Array.isArray(preferredTypes) ? preferredTypes : [])
    .map((type) => String(type || '').trim().toLowerCase())
    .filter(Boolean);

  if (!normalizedTypes.length) return null;

  for (let attempt = 0; attempt < MAX_BIOME_LOOKUP_ATTEMPTS; attempt += 1) {
    const selectedType = normalizedTypes[randomInt(0, normalizedTypes.length - 1)];
    try {
      const typeData = await getType(selectedType);
      const pokemonIds = (typeData?.pokemon || [])
        .map(parsePokemonIdFromTypeEntry)
        .filter((id) => Number.isFinite(id) && id > 0 && id <= DEFAULT_WILD_MAX_ID);

      if (!pokemonIds.length) continue;
      const chosenId = pokemonIds[randomInt(0, pokemonIds.length - 1)];
      const pokemonData = await getPokemon(chosenId);
      if (pokemonData) return pokemonData;
    } catch (error) {
      logger.warn('Falha ao resolver spawn por tipo de bioma.', {
        selectedType,
        error: error.message,
      });
    }
  }

  return null;
};

const findEvolutionNodeBySpeciesName = (chainNode, speciesName) => {
  if (!chainNode || typeof chainNode !== 'object') return null;
  const currentName = String(chainNode?.species?.name || '').toLowerCase();
  if (currentName && currentName === String(speciesName || '').toLowerCase()) {
    return chainNode;
  }

  for (const next of chainNode?.evolves_to || []) {
    const found = findEvolutionNodeBySpeciesName(next, speciesName);
    if (found) return found;
  }

  return null;
};

const isBlockedEvolutionDetail = (detail = {}) => {
  if (!detail || typeof detail !== 'object') return true;
  const hasValue = (value) => value !== null && value !== undefined;

  return Boolean(
    detail?.item ||
      detail?.held_item ||
      detail?.known_move ||
      detail?.known_move_type ||
      detail?.location ||
      detail?.party_species ||
      detail?.party_type ||
      detail?.trade_species ||
      detail?.needs_overworld_rain ||
      detail?.turn_upside_down ||
      String(detail?.time_of_day || '').trim() ||
      hasValue(detail?.min_happiness) ||
      hasValue(detail?.min_affection) ||
      hasValue(detail?.min_beauty) ||
      hasValue(detail?.gender) ||
      hasValue(detail?.relative_physical_stats),
  );
};

const resolveEligibleEvolution = (chainNode, level) => {
  const candidates = [];
  for (const nextNode of chainNode?.evolves_to || []) {
    const details = Array.isArray(nextNode?.evolution_details) ? nextNode.evolution_details : [];
    for (const detail of details) {
      const triggerName = String(detail?.trigger?.name || '').toLowerCase();
      if (triggerName && triggerName !== 'level-up') continue;
      if (isBlockedEvolutionDetail(detail)) continue;

      const minLevel = Number(detail?.min_level);
      if (!Number.isFinite(minLevel)) continue;
      if (level < minLevel) continue;

      candidates.push({
        node: nextNode,
        minLevel,
      });
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => a.minLevel - b.minLevel);
  return candidates[0];
};

const resolveSpeciesIdFromNode = (chainNode) => {
  return extractIdFromUrl(chainNode?.species?.url) || null;
};

export const createRandomIvs = () => ({
  hp: randomInt(0, 31),
  attack: randomInt(0, 31),
  defense: randomInt(0, 31),
  specialAttack: randomInt(0, 31),
  specialDefense: randomInt(0, 31),
  speed: randomInt(0, 31),
});

export const calculateRequiredXpForLevel = (level) => {
  const safeLevel = clamp(toPositiveInt(level, 1), MIN_LEVEL, MAX_LEVEL);
  return safeLevel * safeLevel * 25;
};

export const calculatePlayerLevelFromXp = (xp) => {
  const safeXp = Math.max(0, toPositiveInt(xp, 0));
  return clamp(Math.floor(Math.sqrt(safeXp / 120)) + 1, MIN_LEVEL, MAX_LEVEL);
};

export const applyPokemonXpGain = ({ currentLevel, currentXp, gainedXp }) => {
  let level = clamp(toPositiveInt(currentLevel, 1), MIN_LEVEL, MAX_LEVEL);
  const xp = Math.max(0, toPositiveInt(currentXp, 0) + Math.max(0, toPositiveInt(gainedXp, 0)));

  while (level < MAX_LEVEL && xp >= calculateRequiredXpForLevel(level + 1)) {
    level += 1;
  }

  return { level, xp };
};

export const buildPokemonSnapshot = async ({
  pokemonData,
  speciesData = null,
  level,
  currentHp = null,
  ivs = null,
  storedMoves = null,
  isShiny = false,
}) => {
  const safeLevel = clamp(toPositiveInt(level, 5), MIN_LEVEL, MAX_LEVEL);
  const resolvedIvs = normalizeIvs(ivs || createRandomIvs());
  const baseStats = getBaseStats(pokemonData);

  const maxHp = calculateMaxHp({
    baseHp: baseStats.hp,
    ivHp: resolvedIvs.hp,
    level: safeLevel,
  });

  const stats = {
    attack: calculateStat({ base: baseStats.attack, iv: resolvedIvs.attack, level: safeLevel }),
    defense: calculateStat({ base: baseStats.defense, iv: resolvedIvs.defense, level: safeLevel }),
    specialAttack: calculateStat({ base: baseStats.specialAttack, iv: resolvedIvs.specialAttack, level: safeLevel }),
    specialDefense: calculateStat({ base: baseStats.specialDefense, iv: resolvedIvs.specialDefense, level: safeLevel }),
    speed: calculateStat({ base: baseStats.speed, iv: resolvedIvs.speed, level: safeLevel }),
  };

  const types = (pokemonData?.types || [])
    .sort((a, b) => toPositiveInt(a?.slot, 0) - toPositiveInt(b?.slot, 0))
    .map((entry) => entry?.type?.name)
    .filter(Boolean)
    .map((name) => String(name).toLowerCase());

  const moves = await resolveMoveSet(pokemonData, storedMoves);
  const speciesId = extractIdFromUrl(pokemonData?.species?.url) || toPositiveInt(speciesData?.id, 0);
  const resolvedCurrentHp =
    currentHp === null || currentHp === undefined
      ? maxHp
      : clamp(toPositiveInt(currentHp, maxHp), 0, maxHp);

  return {
    pokeId: toPositiveInt(pokemonData?.id, 0),
    name: String(pokemonData?.name || 'unknown').toLowerCase(),
    displayName: capitalize(pokemonData?.name),
    level: safeLevel,
    currentHp: resolvedCurrentHp,
    maxHp,
    types,
    baseStats,
    ivs: resolvedIvs,
    stats,
    moves,
    isShiny: Boolean(isShiny),
    imageUrl: getPokemonImage(pokemonData, { shiny: isShiny }),
    sprite: pokemonData?.sprites?.front_default || null,
    speciesId,
    captureRate: toPositiveInt(speciesData?.capture_rate, DEFAULT_CAPTURE_RATE),
  };
};

export const buildPlayerBattleSnapshot = async ({ playerPokemonRow }) => {
  const pokemonData = await getPokemon(playerPokemonRow.poke_id);

  return buildPokemonSnapshot({
    pokemonData,
    level: playerPokemonRow.level,
    currentHp: playerPokemonRow.current_hp,
    ivs: playerPokemonRow.ivs_json,
    storedMoves: playerPokemonRow.moves_json,
    isShiny: Boolean(playerPokemonRow.is_shiny),
  });
};

export const createWildEncounter = async ({ playerLevel, preferredTypes = [] }) => {
  const minLevel = Math.max(MIN_WILD_LEVEL, toPositiveInt(playerLevel, 1) - 2);
  const maxLevel = clamp(minLevel + 4, minLevel, MAX_LEVEL);
  const wildLevel = randomInt(minLevel, maxLevel);
  const isShiny = Math.random() <= SHINY_CHANCE;

  let pokemonData;
  pokemonData = await pickPokemonByPreferredTypes(preferredTypes);

  if (!pokemonData) {
    const wildId = randomInt(1, DEFAULT_WILD_MAX_ID);
    try {
      pokemonData = await getPokemon(wildId);
    } catch {
      pokemonData = await getPokemon(25);
    }
  }

  const speciesId = extractIdFromUrl(pokemonData?.species?.url) || pokemonData?.id;
  const speciesData = await getSpecies(speciesId);
  const enemySnapshot = await buildPokemonSnapshot({
    pokemonData,
    speciesData,
    level: wildLevel,
    currentHp: null,
    ivs: createRandomIvs(),
    isShiny,
  });

  return {
    enemySnapshot,
    speciesData,
    isShiny,
  };
};

export const resolveBattleTurn = ({ battleSnapshot, playerMoveSlot }) => {
  const snapshot = cloneSnapshot(battleSnapshot);
  const logs = [];

  const selectedIndex = clamp(toPositiveInt(playerMoveSlot, 1) - 1, 0, 3);
  const playerMoves = Array.isArray(snapshot?.my?.moves) ? snapshot.my.moves : [];
  const enemyMoves = Array.isArray(snapshot?.enemy?.moves) ? snapshot.enemy.moves : [];

  if (!playerMoves[selectedIndex]) {
    return {
      snapshot,
      logs: ['Movimento inválido. Use /rpg atacar 1, 2, 3 ou 4.'],
      winner: resolveWinner(snapshot),
      validTurn: false,
    };
  }

  if (!enemyMoves.length) {
    return {
      snapshot,
      logs: ['O inimigo não tem movimentos válidos.'],
      winner: resolveWinner(snapshot),
      validTurn: false,
    };
  }

  const enemyMoveIndex = pickEnemyMoveIndex(snapshot);
  const orderedActions = resolveActionOrder(snapshot, selectedIndex, enemyMoveIndex);

  for (const action of orderedActions) {
    if (resolveWinner(snapshot)) break;

    if (action.actor === 'my') {
      const move = snapshot.my.moves[action.moveIndex];
      logs.push(
        ...performAction({
          attacker: snapshot.my,
          defender: snapshot.enemy,
          move,
          attackerLabel: `Seu ${snapshot.my.displayName}`,
          defenderLabel: ` ${snapshot.enemy.displayName}`.trim(),
        }),
      );
      continue;
    }

    const move = snapshot.enemy.moves[action.moveIndex];
    logs.push(
      ...performAction({
        attacker: snapshot.enemy,
        defender: snapshot.my,
        move,
        attackerLabel: ` ${snapshot.enemy.displayName}`.trim(),
        defenderLabel: `Seu ${snapshot.my.displayName}`,
      }),
    );
  }

  return {
    snapshot,
    logs,
    winner: resolveWinner(snapshot),
    validTurn: true,
  };
};

export const resolveCaptureAttempt = ({ battleSnapshot }) => {
  const snapshot = cloneSnapshot(battleSnapshot);
  const logs = [];

  const enemy = snapshot?.enemy;
  const my = snapshot?.my;

  if (!enemy || !my || enemy.currentHp <= 0) {
    return {
      snapshot,
      success: false,
      chance: 0,
      logs: ['Não há alvo válido para captura agora.'],
      winner: resolveWinner(snapshot),
      validAction: false,
    };
  }

  const hpFactor = clamp((enemy.maxHp - enemy.currentHp) / Math.max(1, enemy.maxHp), 0, 1);
  const captureRateFactor = clamp(toPositiveInt(enemy.captureRate, DEFAULT_CAPTURE_RATE) / 255, 0, 1);
  const chance = clamp(0.1 + hpFactor * 0.6 + captureRateFactor * 0.25, 0.05, 0.9);
  const success = Math.random() <= chance;

  if (success) {
    logs.push(`Você lançou uma Poké Bola e capturou *${enemy.displayName}*!`);
    return {
      snapshot,
      success: true,
      chance,
      logs,
      winner: 'player',
      validAction: true,
    };
  }

  logs.push(`A captura falhou (${Math.round(chance * 100)}% de chance).`);

  if (enemy.currentHp > 0 && my.currentHp > 0) {
    const enemyMoveIndex = pickEnemyMoveIndex(snapshot);
    const enemyMove = snapshot.enemy.moves[enemyMoveIndex];
    logs.push(
      ...performAction({
        attacker: snapshot.enemy,
        defender: snapshot.my,
        move: enemyMove,
        attackerLabel: ` ${snapshot.enemy.displayName}`.trim(),
        defenderLabel: `Seu ${snapshot.my.displayName}`,
      }),
    );
  }

  return {
    snapshot,
    success: false,
    chance,
    logs,
    winner: resolveWinner(snapshot),
    validAction: true,
  };
};

export const buildEvolutionChainId = (speciesData) => {
  const chainUrl = speciesData?.evolution_chain?.url;
  return extractIdFromUrl(chainUrl);
};

export const resolveEvolutionByLevel = async ({ pokeId, level }) => {
  const currentPokemon = await getPokemon(pokeId);
  const currentSpeciesId = extractIdFromUrl(currentPokemon?.species?.url) || toPositiveInt(currentPokemon?.id, 0);
  if (!currentSpeciesId) return null;

  const speciesData = await getSpecies(currentSpeciesId);
  const chainId = buildEvolutionChainId(speciesData);
  if (!chainId) return null;

  const chainData = await getEvolutionChain(chainId);
  let currentNode = findEvolutionNodeBySpeciesName(chainData?.chain, currentPokemon?.species?.name || currentPokemon?.name);
  if (!currentNode) return null;

  let evolvedPokemon = null;
  const evolvedFrom = currentPokemon;

  while (true) {
    const nextEvolution = resolveEligibleEvolution(currentNode, level);
    if (!nextEvolution) break;

    const nextSpeciesId = resolveSpeciesIdFromNode(nextEvolution.node);
    const nextLookup = nextSpeciesId || String(nextEvolution.node?.species?.name || '').toLowerCase();
    if (!nextLookup) break;

    try {
      evolvedPokemon = await getPokemon(nextLookup);
      currentNode = nextEvolution.node;
    } catch (error) {
      logger.warn('Falha ao carregar forma evoluida na PokéAPI.', {
        pokeId,
        nextLookup,
        error: error.message,
      });
      break;
    }
  }

  if (!evolvedPokemon) return null;

  return {
    from: {
      pokeId: toPositiveInt(evolvedFrom?.id, 0),
      name: capitalize(evolvedFrom?.name),
    },
    to: {
      pokeId: toPositiveInt(evolvedPokemon?.id, 0),
      name: capitalize(evolvedPokemon?.name),
    },
    pokemonData: evolvedPokemon,
  };
};

export const listBaseStatNames = () => [...BASE_STAT_NAMES];
