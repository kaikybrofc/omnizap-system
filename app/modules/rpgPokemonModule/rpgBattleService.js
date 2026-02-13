import { getEffectText, getAbility, getEvolutionChain, getFlavorText, getLocalizedGenus, getLocalizedName, getMove, getNature, getPokemon, getPokemonImage, getSpecies, getType } from '../../services/pokeApiService.js';
import logger from '../../utils/logger/loggerModule.js';

const MIN_LEVEL = 1;
const MAX_LEVEL = 100;
const MIN_WILD_LEVEL = 2;
const DEFAULT_CAPTURE_RATE = 120;
const DEFAULT_WILD_MAX_ID = Math.max(1025, Number(process.env.RPG_WILD_MAX_POKE_ID) || 1025);
const MOVE_SAMPLE_LIMIT = Math.max(12, Number(process.env.RPG_MOVE_SAMPLE_LIMIT) || 24);
const DEFAULT_SHINY_CHANCE = 0.01;
const RAW_SHINY_CHANCE = Number(process.env.RPG_SHINY_CHANCE ?? DEFAULT_SHINY_CHANCE);
const SHINY_CHANCE = Number.isFinite(RAW_SHINY_CHANCE) ? Math.max(0, Math.min(1, RAW_SHINY_CHANCE)) : DEFAULT_SHINY_CHANCE;
const MAX_BIOME_LOOKUP_ATTEMPTS = Math.max(2, Number(process.env.RPG_BIOME_LOOKUP_ATTEMPTS) || 6);
const MAX_SPECIES_FILTER_ATTEMPTS = Math.max(2, Number(process.env.RPG_SPECIES_FILTER_ATTEMPTS) || 5);
const LEGENDARY_SPAWN_CHANCE = Math.max(0.005, Math.min(1, Number(process.env.RPG_LEGENDARY_SPAWN_CHANCE) || 0.06));
const MYTHICAL_SPAWN_CHANCE = Math.max(0.001, Math.min(1, Number(process.env.RPG_MYTHICAL_SPAWN_CHANCE) || 0.03));
const MAX_ENCOUNTER_LEVEL_DIFF = 1;

const PHYSICAL_CLASS = 'physical';
const SPECIAL_CLASS = 'special';
const STATUS_CLASS = 'status';
const MOVESET_SIZE = 4;
const MOVESET_BACKUP_CANDIDATES = ['struggle'];
const MOVESET_NEUTRAL_FALLBACK_NAME = 'neutral-strike';

const BASE_STAT_NAMES = ['hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed'];
const STAT_STAGE_KEYS = ['attack', 'defense', 'specialAttack', 'specialDefense', 'speed', 'accuracy', 'evasion'];
const MIN_STAT_STAGE = -6;
const MAX_STAT_STAGE = 6;
const PARALYSIS_SKIP_CHANCE = 0.25;
const FREEZE_THAW_CHANCE = 0.2;
const CONFUSION_SELF_HIT_CHANCE = 0.33;
const CONFUSION_MIN_TURNS = 1;
const CONFUSION_MAX_TURNS = 4;
const SLEEP_MIN_TURNS = 1;
const SLEEP_MAX_TURNS = 3;
const BURN_DAMAGE_RATIO = 1 / 16;
const POISON_DAMAGE_RATIO = 1 / 8;
const TOXIC_BASE_DAMAGE_RATIO = 1 / 16;
const BATTLE_DAMAGE_SCALE = Math.max(0.35, Math.min(1.25, Number(process.env.RPG_BATTLE_DAMAGE_SCALE) || 0.68));
const BATTLE_DAMAGE_MAX_HP_RATIO = Math.max(0.2, Math.min(0.95, Number(process.env.RPG_BATTLE_DAMAGE_MAX_HP_RATIO) || 0.5));
const BATTLE_DAMAGE_SUPER_EFFECTIVE_BONUS_RATIO = Math.max(
  0,
  Math.min(0.45, Number(process.env.RPG_BATTLE_DAMAGE_SUPER_EFFECTIVE_BONUS_RATIO) || 0.2),
);
const BATTLE_DAMAGE_ULTRA_EFFECTIVE_BONUS_RATIO = Math.max(
  0,
  Math.min(0.5, Number(process.env.RPG_BATTLE_DAMAGE_ULTRA_EFFECTIVE_BONUS_RATIO) || 0.25),
);

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

const toInt = (value, fallback = 0) => {
  const parsed = Math.trunc(toNumber(value, fallback));
  return Number.isFinite(parsed) ? parsed : fallback;
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

const normalizeStatKey = (name) => {
  const key = String(name || '')
    .trim()
    .toLowerCase();
  if (key === 'special-attack') return 'specialAttack';
  if (key === 'special-defense') return 'specialDefense';
  if (key === 'attack') return 'attack';
  if (key === 'defense') return 'defense';
  if (key === 'speed') return 'speed';
  if (key === 'accuracy') return 'accuracy';
  if (key === 'evasion') return 'evasion';
  return null;
};

const hashString = (value) => {
  const raw = String(value || '');
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 31 + raw.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const normalizeAilmentKey = (value) => {
  const key = String(value || '')
    .trim()
    .toLowerCase();
  if (!key) return null;
  if (key === 'paralysis' || key === 'paralyze' || key === 'par') return 'paralysis';
  if (key === 'burn' || key === 'brn') return 'burn';
  if (key === 'poison' || key === 'psn') return 'poison';
  if (key === 'toxic' || key === 'bad-poison') return 'toxic';
  if (key === 'sleep' || key === 'slp') return 'sleep';
  if (key === 'freeze' || key === 'frz') return 'freeze';
  if (key === 'confusion' || key === 'confuse' || key === 'conf') return 'confusion';
  return null;
};

const stageMultiplier = (stage) => {
  const safeStage = clamp(toPositiveInt(Math.abs(stage), 0), 0, 6);
  if (stage >= 0) return (2 + safeStage) / 2;
  return 2 / (2 + safeStage);
};

const shouldApplyChance = (chancePercent) => {
  const chance = clamp(toNumber(chancePercent, 0), 0, 100);
  if (chance <= 0) return false;
  if (chance >= 100) return true;
  return Math.random() * 100 < chance;
};

const createDefaultStatStages = () => ({
  attack: 0,
  defense: 0,
  specialAttack: 0,
  specialDefense: 0,
  speed: 0,
  accuracy: 0,
  evasion: 0,
});

const buildStatusEffectList = (pokemon = {}) => {
  const effects = [];
  const nonVolatile = normalizeAilmentKey(pokemon?.nonVolatileStatus);
  if (nonVolatile) effects.push(nonVolatile);
  if (toPositiveInt(pokemon?.confusionTurns, 0) > 0) effects.push('confusion');
  return effects;
};

const syncPokemonCombatState = (pokemon = {}) => {
  if (!pokemon || typeof pokemon !== 'object') return pokemon;
  const maxHpRaw = toInt(pokemon?.maxHp, NaN);
  const currentHpRaw = toInt(pokemon?.currentHp, NaN);
  pokemon.maxHp = Number.isFinite(maxHpRaw) && maxHpRaw > 0 ? maxHpRaw : Math.max(1, Number.isFinite(currentHpRaw) ? currentHpRaw : 1);
  pokemon.currentHp = Number.isFinite(currentHpRaw) ? clamp(currentHpRaw, 0, pokemon.maxHp) : pokemon.maxHp;

  const sourceStages = pokemon?.statStages && typeof pokemon.statStages === 'object' ? pokemon.statStages : {};
  const nextStages = createDefaultStatStages();
  for (const key of STAT_STAGE_KEYS) {
    nextStages[key] = clamp(toInt(sourceStages[key], 0), MIN_STAT_STAGE, MAX_STAT_STAGE);
  }
  pokemon.statStages = nextStages;
  pokemon.nonVolatileStatus = normalizeAilmentKey(pokemon?.nonVolatileStatus);
  pokemon.sleepTurns = toPositiveInt(pokemon?.sleepTurns, 0);
  pokemon.toxicCounter = Math.max(1, toPositiveInt(pokemon?.toxicCounter, 1));
  pokemon.confusionTurns = toPositiveInt(pokemon?.confusionTurns, 0);
  pokemon.statusEffects = buildStatusEffectList(pokemon);
  return pokemon;
};

const resolveStatStage = (pokemon = {}, statKey) => {
  if (!STAT_STAGE_KEYS.includes(statKey)) return 0;
  return clamp(toInt(pokemon?.statStages?.[statKey], 0), MIN_STAT_STAGE, MAX_STAT_STAGE);
};

const applyStatStageDelta = (pokemon = {}, statKey, delta) => {
  if (!STAT_STAGE_KEYS.includes(statKey)) return 0;
  syncPokemonCombatState(pokemon);
  const current = resolveStatStage(pokemon, statKey);
  const desired = clamp(current + toInt(delta, 0), MIN_STAT_STAGE, MAX_STAT_STAGE);
  pokemon.statStages[statKey] = desired;
  return desired - current;
};

const clearNonVolatileStatus = (pokemon = {}) => {
  syncPokemonCombatState(pokemon);
  pokemon.nonVolatileStatus = null;
  pokemon.sleepTurns = 0;
  pokemon.toxicCounter = 1;
  pokemon.statusEffects = buildStatusEffectList(pokemon);
};

const setNonVolatileStatus = (pokemon = {}, statusKey) => {
  const normalized = normalizeAilmentKey(statusKey);
  if (!normalized || normalized === 'confusion') return false;
  syncPokemonCombatState(pokemon);
  if (pokemon.nonVolatileStatus) return false;
  pokemon.nonVolatileStatus = normalized;
  if (normalized === 'sleep') {
    pokemon.sleepTurns = randomInt(SLEEP_MIN_TURNS, SLEEP_MAX_TURNS);
  } else {
    pokemon.sleepTurns = 0;
  }
  pokemon.toxicCounter = normalized === 'toxic' ? 1 : 1;
  pokemon.statusEffects = buildStatusEffectList(pokemon);
  return true;
};

const setConfusionStatus = (pokemon = {}) => {
  syncPokemonCombatState(pokemon);
  if (pokemon.confusionTurns > 0) return false;
  pokemon.confusionTurns = randomInt(CONFUSION_MIN_TURNS, CONFUSION_MAX_TURNS);
  pokemon.statusEffects = buildStatusEffectList(pokemon);
  return true;
};

const resolveEffectiveStat = ({ pokemon, statKey, applyBurnPenalty = false }) => {
  syncPokemonCombatState(pokemon);
  const base = Math.max(1, toPositiveInt(pokemon?.stats?.[statKey], 1));
  const stage = resolveStatStage(pokemon, statKey);
  let effective = Math.max(1, Math.round(base * stageMultiplier(stage)));

  if (statKey === 'attack' && applyBurnPenalty && pokemon?.nonVolatileStatus === 'burn') {
    effective = Math.max(1, Math.round(effective * 0.5));
  }
  if (statKey === 'speed' && pokemon?.nonVolatileStatus === 'paralysis') {
    effective = Math.max(1, Math.round(effective * 0.5));
  }

  return effective;
};

const resolveEffectiveAccuracy = ({ move, attacker, defender }) => {
  const baseAccuracy = clamp(toPositiveInt(move?.accuracy, 100), 1, 100);
  const accuracyStage = resolveStatStage(attacker, 'accuracy');
  const evasionStage = resolveStatStage(defender, 'evasion');
  const accuracyMultiplier = stageMultiplier(accuracyStage);
  const evasionMultiplier = stageMultiplier(evasionStage);
  return clamp(Math.round(baseAccuracy * (accuracyMultiplier / Math.max(0.1, evasionMultiplier))), 1, 100);
};

const isAilmentBlockedByType = (pokemon = {}, ailmentKey) => {
  const types = Array.isArray(pokemon?.types)
    ? pokemon.types
        .map((entry) =>
          String(entry || '')
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean)
    : [];

  if (ailmentKey === 'burn' && types.includes('fire')) return true;
  if ((ailmentKey === 'poison' || ailmentKey === 'toxic') && (types.includes('poison') || types.includes('steel'))) return true;
  if (ailmentKey === 'paralysis' && types.includes('electric')) return true;
  if (ailmentKey === 'freeze' && types.includes('ice')) return true;
  return false;
};

const formatStageLabel = (statKey) => {
  if (statKey === 'attack') return 'Ataque';
  if (statKey === 'defense') return 'Defesa';
  if (statKey === 'specialAttack') return 'Ataque Especial';
  if (statKey === 'specialDefense') return 'Defesa Especial';
  if (statKey === 'speed') return 'Velocidade';
  if (statKey === 'accuracy') return 'Precisão';
  if (statKey === 'evasion') return 'Evasão';
  return statKey;
};

const applyNatureAndAbilityModifiers = ({ stats, natureData = null, abilityKey = null }) => {
  const next = { ...stats };
  const increased = normalizeStatKey(natureData?.increased_stat?.name);
  const decreased = normalizeStatKey(natureData?.decreased_stat?.name);

  if (increased && next[increased]) {
    next[increased] = Math.max(1, Math.round(next[increased] * 1.1));
  }

  if (decreased && next[decreased]) {
    next[decreased] = Math.max(1, Math.round(next[decreased] * 0.9));
  }

  const abilityToken = String(abilityKey || '')
    .trim()
    .toLowerCase();
  if (abilityToken) {
    const modKeys = ['attack', 'defense', 'specialAttack', 'specialDefense', 'speed'];
    const selectedKey = modKeys[hashString(abilityToken) % modKeys.length];
    next[selectedKey] = Math.max(1, Math.round(next[selectedKey] * 1.05));
  }

  return next;
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
  const effectMeta = move?.effectMeta && typeof move.effectMeta === 'object' ? move.effectMeta : {};
  const rawStatChanges = Array.isArray(move?.statChanges) ? move.statChanges : Array.isArray(effectMeta.statChanges) ? effectMeta.statChanges : [];
  const statChanges = rawStatChanges
    .map((entry) => {
      const key = normalizeStatKey(entry?.stat || entry?.name || entry?.stat?.name);
      const change = toInt(entry?.change, 0);
      if (!key || !Number.isFinite(change) || change === 0) return null;
      return { stat: key, change: clamp(change, -3, 3) };
    })
    .filter(Boolean);
  const normalizedAilment = normalizeAilmentKey(move?.ailment || effectMeta?.ailment);
  const normalizedTarget = String(move?.target || effectMeta?.target || '').trim().toLowerCase();
  const rawAilmentChance = toNumber(move?.ailmentChance ?? effectMeta?.ailmentChance, NaN);
  const rawStatChance = toNumber(move?.statChance ?? effectMeta?.statChance, NaN);
  const ailmentChance = Number.isFinite(rawAilmentChance)
    ? clamp(rawAilmentChance, 0, 100)
    : normalizedAilment && damageClass === STATUS_CLASS
      ? 100
      : 0;
  const rawHealing = toNumber(move?.healing ?? effectMeta?.healing, 0);
  const rawDrain = toNumber(move?.drain ?? effectMeta?.drain, 0);

  return {
    id: toPositiveInt(move?.id, 0),
    name: moveName,
    displayName: capitalize(moveName),
    power,
    accuracy,
    pp: toPositiveInt(move?.pp, 35),
    damageClass: [PHYSICAL_CLASS, SPECIAL_CLASS, STATUS_CLASS].includes(damageClass) ? damageClass : STATUS_CLASS,
    type,
    typeDamage: {
      doubleTo: Array.isArray(move?.typeDamage?.doubleTo) ? move.typeDamage.doubleTo : [],
      halfTo: Array.isArray(move?.typeDamage?.halfTo) ? move.typeDamage.halfTo : [],
      noTo: Array.isArray(move?.typeDamage?.noTo) ? move.typeDamage.noTo : [],
    },
    effectMeta: {
      target: normalizedTarget || null,
      statChanges,
      statChance: Number.isFinite(rawStatChance) ? clamp(rawStatChance, 0, 100) : 100,
      ailment: normalizedAilment,
      ailmentChance,
      healing: clamp(rawHealing, 0, 100),
      drain: clamp(rawDrain, -100, 100),
    },
    shortEffect: String(move?.shortEffect || '').trim() || null,
    loreText: String(move?.loreText || '').trim() || null,
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
      target: moveData?.target?.name,
      statChanges: (moveData?.stat_changes || []).map((entry) => ({
        stat: entry?.stat?.name,
        change: entry?.change,
      })),
      statChance: moveData?.meta?.stat_chance ?? moveData?.effect_chance ?? null,
      ailment: moveData?.meta?.ailment?.name || null,
      ailmentChance: moveData?.meta?.ailment_chance ?? moveData?.effect_chance ?? null,
      healing: moveData?.meta?.healing ?? 0,
      drain: moveData?.meta?.drain ?? 0,
      shortEffect: getEffectText(moveData?.effect_entries, { preferLong: false }),
      loreText: getFlavorText(moveData?.flavor_text_entries),
    },
    0,
  );
};

const ensureFourMoves = async (moves) => {
  const normalized = (moves || []).map((move, index) => normalizeMove(move, index)).slice(0, MOVESET_SIZE);

  if (!normalized.length) {
    normalized.push(await loadMoveSnapshot('struggle'));
  }

  while (normalized.length < MOVESET_SIZE) {
    normalized.push({ ...normalized[normalized.length % normalized.length] });
  }

  return normalized.slice(0, MOVESET_SIZE);
};

const buildMoveCandidateList = (pokemonData) => {
  const fromPokemon = (pokemonData?.moves || []).map((entry) => entry?.move?.name).filter(Boolean);
  const unique = new Set();
  const merged = [];
  const reserveForFallback = Math.max(0, MOVESET_BACKUP_CANDIDATES.length);
  const maxFromPokemon = Math.max(1, MOVE_SAMPLE_LIMIT - reserveForFallback);

  [...fromPokemon.slice(0, maxFromPokemon), ...MOVESET_BACKUP_CANDIDATES].forEach((name) => {
    const key = String(name || '')
      .trim()
      .toLowerCase();
    if (!key || unique.has(key)) return;
    unique.add(key);
    merged.push(key);
  });

  return merged.slice(0, MOVE_SAMPLE_LIMIT);
};

const resolvePokemonTypeList = (pokemonData) => {
  return (pokemonData?.types || [])
    .sort((a, b) => toPositiveInt(a?.slot, 0) - toPositiveInt(b?.slot, 0))
    .map((entry) => entry?.type?.name)
    .filter(Boolean)
    .map((name) => String(name).toLowerCase());
};

const isOffensiveMove = (move) => {
  return toPositiveInt(move?.power, 0) > 0 && String(move?.damageClass || '').toLowerCase() !== STATUS_CLASS;
};

const normalizeMoveType = (move) =>
  String(move?.type || '')
    .trim()
    .toLowerCase();

const calcOffensiveMoveScore = ({ move, pokemonTypeSet, penalizeNormal = false }) => {
  const power = Math.max(0, toPositiveInt(move?.power, 0));
  const accuracy = clamp(toPositiveInt(move?.accuracy, 100), 1, 100);
  let score = power * (accuracy / 100);
  const moveType = normalizeMoveType(move);
  if (moveType && pokemonTypeSet.has(moveType)) score *= 1.2;
  if (penalizeNormal && moveType === 'normal') score *= 0.1;
  return score;
};

const calcSupportMoveScore = (move) => {
  const accuracy = clamp(toPositiveInt(move?.accuracy, 100), 1, 100);
  const meta = move?.effectMeta || {};
  let score = accuracy / 100;
  if (meta?.ailment) score += 2.5;
  if (Array.isArray(meta?.statChanges) && meta.statChanges.length) score += 2;
  if (Math.abs(toNumber(meta?.healing, 0)) > 0) score += 1.5;
  if (Math.abs(toNumber(meta?.drain, 0)) > 0) score += 1;
  return score;
};

const compareByScoreDesc = (a, b) => {
  if (b.score !== a.score) return b.score - a.score;
  const bPower = toPositiveInt(b.move?.power, 0);
  const aPower = toPositiveInt(a.move?.power, 0);
  if (bPower !== aPower) return bPower - aPower;
  return toPositiveInt(b.move?.accuracy, 100) - toPositiveInt(a.move?.accuracy, 100);
};

const sortOffensiveMovesByScore = ({ moves = [], pokemonTypeSet, penalizeNormal = false }) => {
  return moves
    .map((move) => ({
      move,
      score: calcOffensiveMoveScore({
        move,
        pokemonTypeSet,
        penalizeNormal,
      }),
    }))
    .sort(compareByScoreDesc)
    .map((entry) => entry.move);
};

const sortSupportMovesByScore = (moves = []) => {
  return moves
    .map((move) => ({
      move,
      score: calcSupportMoveScore(move),
    }))
    .sort(compareByScoreDesc)
    .map((entry) => entry.move);
};

const countNormalOffensiveMoves = (moves = []) => {
  return moves.filter((move) => isOffensiveMove(move) && normalizeMoveType(move) === 'normal').length;
};

const buildNeutralFallbackMove = (suffix = '') =>
  normalizeMove(
    {
      id: 0,
      name: suffix ? `${MOVESET_NEUTRAL_FALLBACK_NAME}-${suffix}` : MOVESET_NEUTRAL_FALLBACK_NAME,
      power: 50,
      accuracy: 100,
      pp: 35,
      damageClass: PHYSICAL_CLASS,
      type: 'neutral',
      typeDamage: {
        doubleTo: [],
        halfTo: [],
        noTo: [],
      },
      target: 'selected-pokemon',
      shortEffect: 'Golpe neutro de segurança para evitar travamento por imunidade.',
    },
    0,
  );

const resolveBlockedTypesByNoDamageIntersection = (offensiveMoves = []) => {
  if (!offensiveMoves.length) return [];
  const first = offensiveMoves[0];
  const firstNoTo = new Set(Array.isArray(first?.typeDamage?.noTo) ? first.typeDamage.noTo : []);
  const blocked = new Set(firstNoTo);

  offensiveMoves.slice(1).forEach((move) => {
    const noTo = new Set(Array.isArray(move?.typeDamage?.noTo) ? move.typeDamage.noTo : []);
    for (const blockedType of Array.from(blocked)) {
      if (!noTo.has(blockedType)) {
        blocked.delete(blockedType);
      }
    }
  });

  return Array.from(blocked);
};

const findFirstIndex = (items = [], predicate) => {
  for (let index = 0; index < items.length; index += 1) {
    if (predicate(items[index], index)) return index;
  }
  return -1;
};

const pickReplacementIndexForMove = ({ selected = [], pokemonTypeSet, keepOneStab = false }) => {
  const supportIndex = findFirstIndex(selected, (move) => !isOffensiveMove(move));
  if (supportIndex >= 0) return supportIndex;

  const offensiveIndexes = selected
    .map((move, index) => ({ move, index }))
    .filter((entry) => isOffensiveMove(entry.move));
  if (!offensiveIndexes.length) return selected.length - 1;

  const stabIndexes = offensiveIndexes.filter((entry) => pokemonTypeSet.has(normalizeMoveType(entry.move)));
  const canReplace = offensiveIndexes.filter((entry) => !(keepOneStab && stabIndexes.length <= 1 && stabIndexes[0]?.index === entry.index));
  const candidates = canReplace.length ? canReplace : offensiveIndexes;

  candidates.sort((left, right) => {
    const leftScore = calcOffensiveMoveScore({ move: left.move, pokemonTypeSet });
    const rightScore = calcOffensiveMoveScore({ move: right.move, pokemonTypeSet });
    return leftScore - rightScore;
  });

  return candidates[0]?.index ?? selected.length - 1;
};

const tryAddMove = ({ selected, move, usedNames, allowMultipleNormal, pokemonTypeSet, forceReplace = false, keepOneStab = false }) => {
  if (!move) return false;
  const moveName = String(move?.name || '')
    .trim()
    .toLowerCase();
  if (!moveName || usedNames.has(moveName)) return false;

  const moveType = normalizeMoveType(move);
  const isNormalOffensive = isOffensiveMove(move) && moveType === 'normal';
  if (!allowMultipleNormal && isNormalOffensive && countNormalOffensiveMoves(selected) >= 1) {
    return false;
  }

  if (selected.length < MOVESET_SIZE && !forceReplace) {
    selected.push(move);
    usedNames.add(moveName);
    return true;
  }

  const replaceIndex = pickReplacementIndexForMove({
    selected,
    pokemonTypeSet,
    keepOneStab,
  });
  if (replaceIndex < 0) return false;
  const previousName = String(selected[replaceIndex]?.name || '')
    .trim()
    .toLowerCase();
  selected[replaceIndex] = move;
  if (previousName) usedNames.delete(previousName);
  usedNames.add(moveName);
  return true;
};

const pickBestCoverageCandidate = ({ selectedOffensive = [], offensivePool = [], usedNames, pokemonTypeSet, allowMultipleNormal, stabType = null }) => {
  const blockedTypes = resolveBlockedTypesByNoDamageIntersection(selectedOffensive);
  const candidates = offensivePool.filter((move) => {
    const name = String(move?.name || '')
      .trim()
      .toLowerCase();
    if (!name || usedNames.has(name)) return false;
    if (!allowMultipleNormal && normalizeMoveType(move) === 'normal' && countNormalOffensiveMoves(selectedOffensive) >= 1) return false;
    return true;
  });

  let best = null;
  for (const move of candidates) {
    const moveType = normalizeMoveType(move);
    const base = calcOffensiveMoveScore({
      move,
      pokemonTypeSet,
      penalizeNormal: !allowMultipleNormal && countNormalOffensiveMoves(selectedOffensive) >= 1,
    });
    let score = base;
    if (stabType && moveType && moveType !== stabType) score += 35;
    if (moveType && moveType !== 'normal') score += 8;

    let unblockCount = 0;
    let neutralCount = 0;
    for (const defType of blockedTypes) {
      const multiplier = resolveTypeMultiplier(move, [defType]);
      if (multiplier > 0) {
        unblockCount += 1;
        if (multiplier === 1) neutralCount += 1;
      }
    }

    score += unblockCount * 45;
    score += neutralCount * 25;

    if (!best || score > best.score) {
      best = { move, score };
    }
  }

  return best?.move || null;
};

const pickBattleMoves = async (pokemonData) => {
  const candidateNames = buildMoveCandidateList(pokemonData);
  const pokemonTypes = resolvePokemonTypeList(pokemonData);
  const pokemonTypeSet = new Set(pokemonTypes);
  const loadedMoves = [];

  for (const moveName of candidateNames) {
    try {
      const move = await loadMoveSnapshot(moveName);
      loadedMoves.push(move);
    } catch (error) {
      logger.debug('Movimento ignorado no carregamento do RPG Pokemon.', {
        moveName,
        error: error.message,
      });
    }
  }

  const offensivePool = loadedMoves.filter((move) => isOffensiveMove(move));
  const supportPool = loadedMoves.filter((move) => !isOffensiveMove(move));
  const hasNonNormalOffensive = offensivePool.some((move) => normalizeMoveType(move) !== 'normal');
  const isPureNormal = pokemonTypes.length === 1 && pokemonTypes[0] === 'normal';
  const allowMultipleNormal = isPureNormal && !hasNonNormalOffensive;

  const selected = [];
  const usedNames = new Set();

  const stabPool = sortOffensiveMovesByScore({
    moves: offensivePool.filter((move) => pokemonTypeSet.has(normalizeMoveType(move))),
    pokemonTypeSet,
  });
  const bestStab = stabPool[0] || null;
  const selectedStab = tryAddMove({
    selected,
    move: bestStab,
    usedNames,
    allowMultipleNormal,
    pokemonTypeSet,
  });
  const stabType = selectedStab ? normalizeMoveType(bestStab) : null;

  const selectedOffensiveNow = selected.filter((move) => isOffensiveMove(move));
  const bestCoverage = pickBestCoverageCandidate({
    selectedOffensive: selectedOffensiveNow.length ? selectedOffensiveNow : stabPool.slice(0, 1),
    offensivePool,
    usedNames,
    pokemonTypeSet,
    allowMultipleNormal,
    stabType,
  });
  tryAddMove({
    selected,
    move: bestCoverage,
    usedNames,
    allowMultipleNormal,
    pokemonTypeSet,
  });

  const supportCandidates = sortSupportMovesByScore(supportPool);
  const bestUtility = supportCandidates.find((move) => {
    const moveName = String(move?.name || '')
      .trim()
      .toLowerCase();
    return moveName && !usedNames.has(moveName);
  });
  tryAddMove({
    selected,
    move: bestUtility,
    usedNames,
    allowMultipleNormal,
    pokemonTypeSet,
  });

  const scoredOffensive = sortOffensiveMovesByScore({
    moves: offensivePool,
    pokemonTypeSet,
  });
  for (const move of scoredOffensive) {
    if (selected.length >= MOVESET_SIZE) break;
    tryAddMove({
      selected,
      move,
      usedNames,
      allowMultipleNormal,
      pokemonTypeSet,
      keepOneStab: stabPool.length > 0,
    });
  }

  for (const move of supportCandidates) {
    if (selected.length >= MOVESET_SIZE) break;
    tryAddMove({
      selected,
      move,
      usedNames,
      allowMultipleNormal,
      pokemonTypeSet,
    });
  }

  if (stabPool.length > 0 && !selected.some((move) => isOffensiveMove(move) && pokemonTypeSet.has(normalizeMoveType(move)))) {
    tryAddMove({
      selected,
      move: stabPool[0],
      usedNames,
      allowMultipleNormal,
      pokemonTypeSet,
      forceReplace: true,
      keepOneStab: false,
    });
  }

  let selectedOffensive = selected.filter((move) => isOffensiveMove(move));
  if (!selectedOffensive.length) {
    const bestOffensive = scoredOffensive[0] || buildNeutralFallbackMove();
    tryAddMove({
      selected,
      move: bestOffensive,
      usedNames,
      allowMultipleNormal: true,
      pokemonTypeSet,
      forceReplace: selected.length >= MOVESET_SIZE,
    });
    selectedOffensive = selected.filter((move) => isOffensiveMove(move));
  }

  let blockedTypes = resolveBlockedTypesByNoDamageIntersection(selectedOffensive);
  if (blockedTypes.length) {
    const breaker = pickBestCoverageCandidate({
      selectedOffensive,
      offensivePool,
      usedNames,
      pokemonTypeSet,
      allowMultipleNormal,
      stabType,
    });
    if (breaker) {
      tryAddMove({
        selected,
        move: breaker,
        usedNames,
        allowMultipleNormal,
        pokemonTypeSet,
        forceReplace: selected.length >= MOVESET_SIZE,
        keepOneStab: stabPool.length > 0,
      });
    }
    selectedOffensive = selected.filter((move) => isOffensiveMove(move));
    blockedTypes = resolveBlockedTypesByNoDamageIntersection(selectedOffensive);
  }

  if (blockedTypes.length) {
    const neutralFallback = buildNeutralFallbackMove();
    tryAddMove({
      selected,
      move: neutralFallback,
      usedNames,
      allowMultipleNormal: true,
      pokemonTypeSet,
      forceReplace: selected.length >= MOVESET_SIZE,
      keepOneStab: stabPool.length > 0,
    });
  }

  if (!allowMultipleNormal) {
    let neutralIndex = 1;
    while (countNormalOffensiveMoves(selected) > 1) {
      const replaceIndex = findFirstIndex(selected, (move) => isOffensiveMove(move) && normalizeMoveType(move) === 'normal');
      if (replaceIndex < 0) break;
      const replacement = buildNeutralFallbackMove(`normal-limit-${neutralIndex}`);
      const previousName = String(selected[replaceIndex]?.name || '')
        .trim()
        .toLowerCase();
      if (previousName) usedNames.delete(previousName);
      selected[replaceIndex] = replacement;
      usedNames.add(replacement.name);
      neutralIndex += 1;
    }
  }

  let neutralFillIndex = 1;
  while (selected.length < MOVESET_SIZE) {
    const neutralFallback = buildNeutralFallbackMove(`fill-${neutralFillIndex}`);
    tryAddMove({
      selected,
      move: neutralFallback,
      usedNames,
      allowMultipleNormal: true,
      pokemonTypeSet,
    });
    neutralFillIndex += 1;
  }

  return ensureFourMoves(selected);
};

const isStoredMoveValid = (move) => {
  if (!move || typeof move !== 'object') return false;
  const name = String(move.name || '').trim();
  const type = String(move.type || '').trim();
  return Boolean(name && type);
};

const resolveMoveSet = async (pokemonData, storedMoves = null) => {
  const normalizedStored = Array.isArray(storedMoves)
    ? storedMoves
        .filter(isStoredMoveValid)
        .map((move, index) => normalizeMove(move, index))
        .slice(0, 4)
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

const resolveDamageCapByEffectiveness = ({ multiplier, defenderMaxHp }) => {
  if (multiplier <= 0) return 0;

  let ratio = BATTLE_DAMAGE_MAX_HP_RATIO;
  if (multiplier >= 2) ratio += BATTLE_DAMAGE_SUPER_EFFECTIVE_BONUS_RATIO;
  if (multiplier >= 4) ratio += BATTLE_DAMAGE_ULTRA_EFFECTIVE_BONUS_RATIO;

  return Math.max(1, Math.floor(defenderMaxHp * Math.min(1, ratio)));
};

const resolveMoveEffectTarget = (move) => {
  const targetKey = String(move?.effectMeta?.target || '')
    .trim()
    .toLowerCase();
  if (!targetKey) return 'opponent';
  if (targetKey.includes('user') || targetKey.includes('ally')) return 'self';
  return 'opponent';
};

const formatAilmentLabel = (ailmentKey) => {
  if (ailmentKey === 'burn') return 'queimado';
  if (ailmentKey === 'poison') return 'envenenado';
  if (ailmentKey === 'toxic') return 'envenenado gravemente';
  if (ailmentKey === 'paralysis') return 'paralisado';
  if (ailmentKey === 'sleep') return 'adormeceu';
  if (ailmentKey === 'freeze') return 'congelado';
  if (ailmentKey === 'confusion') return 'confuso';
  return 'afetado';
};

const calculateConfusionSelfDamage = (pokemon = {}) => {
  const level = clamp(toPositiveInt(pokemon?.level, 1), MIN_LEVEL, MAX_LEVEL);
  const attackStat = resolveEffectiveStat({ pokemon, statKey: 'attack', applyBurnPenalty: false });
  const defenseStat = resolveEffectiveStat({ pokemon, statKey: 'defense', applyBurnPenalty: false });
  const baseDamage = (((2 * level) / 5 + 2) * 40 * (attackStat / Math.max(1, defenseStat))) / 50 + 2;
  const finalDamage = Math.max(1, Math.floor(baseDamage * randomFloat(0.85, 1)));
  pokemon.currentHp = clamp(toPositiveInt(pokemon.currentHp, 0) - finalDamage, 0, toPositiveInt(pokemon.maxHp, 1));
  return finalDamage;
};

const processTurnStartStatus = ({ actor, actorLabel }) => {
  syncPokemonCombatState(actor);
  const logs = [];

  if (toPositiveInt(actor?.currentHp, 0) <= 0) {
    return { canAct: false, logs };
  }

  const nonVolatile = normalizeAilmentKey(actor?.nonVolatileStatus);
  if (nonVolatile === 'sleep') {
    if (actor.sleepTurns <= 0) {
      actor.sleepTurns = randomInt(SLEEP_MIN_TURNS, SLEEP_MAX_TURNS);
    }
    actor.sleepTurns = Math.max(0, actor.sleepTurns - 1);
    if (actor.sleepTurns > 0) {
      logs.push(`${actorLabel} está dormindo e não conseguiu agir.`);
      actor.statusEffects = buildStatusEffectList(actor);
      return { canAct: false, logs };
    }
    clearNonVolatileStatus(actor);
    logs.push(`${actorLabel} acordou.`);
  }

  if (normalizeAilmentKey(actor?.nonVolatileStatus) === 'freeze') {
    if (shouldApplyChance(FREEZE_THAW_CHANCE * 100)) {
      clearNonVolatileStatus(actor);
      logs.push(`${actorLabel} descongelou.`);
    } else {
      logs.push(`${actorLabel} está congelado e não conseguiu agir.`);
      actor.statusEffects = buildStatusEffectList(actor);
      return { canAct: false, logs };
    }
  }

  if (normalizeAilmentKey(actor?.nonVolatileStatus) === 'paralysis' && shouldApplyChance(PARALYSIS_SKIP_CHANCE * 100)) {
    logs.push(`${actorLabel} está paralisado e não conseguiu agir.`);
    actor.statusEffects = buildStatusEffectList(actor);
    return { canAct: false, logs };
  }

  if (actor.confusionTurns > 0) {
    actor.confusionTurns = Math.max(0, actor.confusionTurns - 1);
    if (shouldApplyChance(CONFUSION_SELF_HIT_CHANCE * 100)) {
      const selfDamage = calculateConfusionSelfDamage(actor);
      logs.push(`${actorLabel} está confuso e se feriu em *${selfDamage}* de dano.`);
      if (toPositiveInt(actor.currentHp, 0) <= 0) {
        logs.push(`${actorLabel} desmaiou.`);
      }
      if (actor.confusionTurns <= 0) {
        logs.push(`${actorLabel} não está mais confuso.`);
      }
      actor.statusEffects = buildStatusEffectList(actor);
      return { canAct: false, logs };
    }
    if (actor.confusionTurns <= 0) {
      logs.push(`${actorLabel} não está mais confuso.`);
    }
  }

  actor.statusEffects = buildStatusEffectList(actor);
  return { canAct: true, logs };
};

const applyResidualDamageToPokemon = ({ pokemon, label, logs = [] }) => {
  syncPokemonCombatState(pokemon);
  if (toPositiveInt(pokemon?.currentHp, 0) <= 0) return;

  const maxHp = Math.max(1, toPositiveInt(pokemon?.maxHp, 1));
  const status = normalizeAilmentKey(pokemon?.nonVolatileStatus);
  let damage = 0;
  let causeText = '';

  if (status === 'burn') {
    damage = Math.max(1, Math.floor(maxHp * BURN_DAMAGE_RATIO));
    causeText = 'queimadura';
  } else if (status === 'poison') {
    damage = Math.max(1, Math.floor(maxHp * POISON_DAMAGE_RATIO));
    causeText = 'veneno';
  } else if (status === 'toxic') {
    const toxicCounter = Math.max(1, toPositiveInt(pokemon.toxicCounter, 1));
    damage = Math.max(1, Math.floor(maxHp * TOXIC_BASE_DAMAGE_RATIO * toxicCounter));
    pokemon.toxicCounter = toxicCounter + 1;
    causeText = 'veneno severo';
  }

  if (damage <= 0) return;
  pokemon.currentHp = clamp(toPositiveInt(pokemon.currentHp, 0) - damage, 0, maxHp);
  logs.push(`${label} sofreu *${damage}* de dano por ${causeText}.`);
  if (toPositiveInt(pokemon.currentHp, 0) <= 0) {
    logs.push(`${label} desmaiou.`);
  }
};

const applyEndTurnResidualEffects = ({ snapshot, logs = [], myLabel = 'Seu Pokémon', enemyLabel = 'Inimigo' }) => {
  applyResidualDamageToPokemon({
    pokemon: snapshot?.my,
    label: myLabel,
    logs,
  });
  applyResidualDamageToPokemon({
    pokemon: snapshot?.enemy,
    label: enemyLabel,
    logs,
  });
};

const applyMoveStatChanges = ({ attacker, defender, move, attackerLabel, defenderLabel, logs = [] }) => {
  const changes = Array.isArray(move?.effectMeta?.statChanges) ? move.effectMeta.statChanges : [];
  if (!changes.length) return;
  const statChance = clamp(toNumber(move?.effectMeta?.statChance, 100), 0, 100);
  if (!shouldApplyChance(statChance)) return;

  const effectTarget = resolveMoveEffectTarget(move);
  const targetPokemon = effectTarget === 'self' ? attacker : defender;
  const targetLabel = effectTarget === 'self' ? attackerLabel : defenderLabel;

  for (const change of changes) {
    const statKey = normalizeStatKey(change?.stat);
    const delta = toInt(change?.change, 0);
    if (!statKey || delta === 0) continue;
    const applied = applyStatStageDelta(targetPokemon, statKey, delta);
    if (applied === 0) {
      logs.push(`${targetLabel} não pode ter ${formatStageLabel(statKey)} alterado além do limite.`);
      continue;
    }
    logs.push(
      `${targetLabel} ${applied > 0 ? 'aumentou' : 'reduziu'} ${formatStageLabel(statKey)} em ${Math.abs(applied)} estágio(s).`,
    );
  }
};

const applyMoveAilment = ({ attacker, defender, move, attackerLabel, defenderLabel, logs = [] }) => {
  const ailment = normalizeAilmentKey(move?.effectMeta?.ailment);
  if (!ailment) return;

  const rawChance = toNumber(move?.effectMeta?.ailmentChance, 0);
  const defaultChance = ailment && String(move?.damageClass || '').toLowerCase() === STATUS_CLASS ? 100 : 0;
  const chance = rawChance > 0 ? clamp(rawChance, 0, 100) : defaultChance;
  if (!shouldApplyChance(chance)) return;

  const effectTarget = resolveMoveEffectTarget(move);
  const targetPokemon = effectTarget === 'self' ? attacker : defender;
  const targetLabel = effectTarget === 'self' ? attackerLabel : defenderLabel;
  syncPokemonCombatState(targetPokemon);
  if (toPositiveInt(targetPokemon?.currentHp, 0) <= 0) return;

  if (ailment === 'confusion') {
    const appliedConfusion = setConfusionStatus(targetPokemon);
    if (appliedConfusion) {
      logs.push(`${targetLabel} ficou confuso.`);
    } else {
      logs.push(`${targetLabel} já está confuso.`);
    }
    return;
  }

  if (isAilmentBlockedByType(targetPokemon, ailment)) {
    logs.push(`${targetLabel} é imune a ${formatAilmentLabel(ailment)}.`);
    return;
  }

  const applied = setNonVolatileStatus(targetPokemon, ailment);
  if (applied) {
    logs.push(`${targetLabel} ficou ${formatAilmentLabel(ailment)}.`);
  } else {
    logs.push(`${targetLabel} já possui uma condição de status.`);
  }
};

const applyMoveRecoveryAndRecoil = ({ attacker, move, damageDone = 0, attackerLabel, logs = [] }) => {
  syncPokemonCombatState(attacker);
  if (toPositiveInt(attacker?.currentHp, 0) <= 0) return;

  const maxHp = Math.max(1, toPositiveInt(attacker?.maxHp, 1));
  const healingPct = clamp(toNumber(move?.effectMeta?.healing, 0), 0, 100);
  if (healingPct > 0) {
    const healAmount = Math.max(1, Math.floor(maxHp * (healingPct / 100)));
    const before = toPositiveInt(attacker.currentHp, 0);
    attacker.currentHp = clamp(before + healAmount, 0, maxHp);
    const recovered = Math.max(0, attacker.currentHp - before);
    if (recovered > 0) {
      logs.push(`${attackerLabel} recuperou *${recovered}* de HP.`);
    }
  }

  const drainPct = clamp(toNumber(move?.effectMeta?.drain, 0), -100, 100);
  if (drainPct > 0 && damageDone > 0) {
    const healAmount = Math.max(1, Math.floor(damageDone * (drainPct / 100)));
    const before = toPositiveInt(attacker.currentHp, 0);
    attacker.currentHp = clamp(before + healAmount, 0, maxHp);
    const recovered = Math.max(0, attacker.currentHp - before);
    if (recovered > 0) {
      logs.push(`${attackerLabel} drenou energia e recuperou *${recovered}* de HP.`);
    }
  }

  if (drainPct < 0 && damageDone > 0) {
    const recoil = Math.max(1, Math.floor(damageDone * (Math.abs(drainPct) / 100)));
    attacker.currentHp = clamp(toPositiveInt(attacker.currentHp, 0) - recoil, 0, maxHp);
    logs.push(`${attackerLabel} sofreu *${recoil}* de dano de recuo.`);
    if (toPositiveInt(attacker.currentHp, 0) <= 0) {
      logs.push(`${attackerLabel} desmaiou.`);
    }
  }
};

const applyDamage = ({ attacker, defender, move }) => {
  syncPokemonCombatState(attacker);
  syncPokemonCombatState(defender);
  const accuracyRoll = randomInt(1, 100);
  const accuracy = resolveEffectiveAccuracy({ move, attacker, defender });
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
  const attackStat =
    damageClass === SPECIAL_CLASS
      ? resolveEffectiveStat({ pokemon: attacker, statKey: 'specialAttack', applyBurnPenalty: false })
      : resolveEffectiveStat({ pokemon: attacker, statKey: 'attack', applyBurnPenalty: true });
  const defenseStat =
    damageClass === SPECIAL_CLASS
      ? resolveEffectiveStat({ pokemon: defender, statKey: 'specialDefense', applyBurnPenalty: false })
      : resolveEffectiveStat({ pokemon: defender, statKey: 'defense', applyBurnPenalty: false });

  const level = clamp(toPositiveInt(attacker?.level, 1), MIN_LEVEL, MAX_LEVEL);
  const baseDamage = (((2 * level) / 5 + 2) * power * (attackStat / Math.max(1, defenseStat))) / 50 + 2;
  const stab = Array.isArray(attacker?.types) && attacker.types.includes(move?.type) ? 1.2 : 1;
  const multiplier = resolveTypeMultiplier(move, defender?.types || []);
  const randomFactor = randomFloat(0.85, 1);
  const defenderMaxHp = Math.max(1, toPositiveInt(defender?.maxHp, 1));
  const damageCap = resolveDamageCapByEffectiveness({ multiplier, defenderMaxHp });

  let finalDamage = Math.floor(baseDamage * stab * multiplier * randomFactor * BATTLE_DAMAGE_SCALE);
  if (multiplier > 0) {
    finalDamage = Math.min(Math.max(1, finalDamage), damageCap);
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
  syncPokemonCombatState(attacker);
  syncPokemonCombatState(defender);
  const result = applyDamage({ attacker, defender, move });
  const lines = [];

  if (!result.hit) {
    return [`${attackerLabel} usou *${move.displayName}* e errou.`];
  }

  const moveClass = String(move?.damageClass || PHYSICAL_CLASS).toLowerCase();
  if (moveClass === STATUS_CLASS) {
    lines.push(`${attackerLabel} usou *${move.displayName}*.`);
  } else if (result.damage <= 0) {
    lines.push(`${attackerLabel} usou *${move.displayName}*, mas não causou dano.`);
  } else {
    lines.push(`${attackerLabel} usou *${move.displayName}* e causou *${result.damage}* de dano.`);
    const effectText = formatTypeEffectText(result.multiplier);
    if (effectText) lines.push(effectText);
  }

  applyMoveStatChanges({
    attacker,
    defender,
    move,
    attackerLabel,
    defenderLabel,
    logs: lines,
  });
  applyMoveAilment({
    attacker,
    defender,
    move,
    attackerLabel,
    defenderLabel,
    logs: lines,
  });
  applyMoveRecoveryAndRecoil({
    attacker,
    move,
    damageDone: result.damage,
    attackerLabel,
    logs: lines,
  });

  if (defender.currentHp <= 0) {
    lines.push(`${defenderLabel} desmaiou.`);
  }

  return lines;
};

const cloneSnapshot = (snapshot) => JSON.parse(JSON.stringify(snapshot));

const resolveActionOrder = (snapshot, playerMoveIndex, enemyMoveIndex) => {
  syncPokemonCombatState(snapshot?.my);
  syncPokemonCombatState(snapshot?.enemy);
  const mySpeed = resolveEffectiveStat({ pokemon: snapshot?.my, statKey: 'speed' });
  const enemySpeed = resolveEffectiveStat({ pokemon: snapshot?.enemy, statKey: 'speed' });

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

const parsePokemonLookupFromAreaEntry = (entry) => {
  const url = entry?.pokemon?.url;
  const idFromUrl = extractIdFromUrl(url);
  if (Number.isFinite(idFromUrl) && idFromUrl > 0) {
    return idFromUrl;
  }

  const name = String(entry?.pokemon?.name || '')
    .trim()
    .toLowerCase();
  if (name) return name;
  return null;
};

const pickPokemonFromEncounterPool = async (encounterPool = []) => {
  const lookups = (Array.isArray(encounterPool) ? encounterPool : [])
    .map((entry) => {
      if (typeof entry === 'number') return entry;
      if (typeof entry === 'string') return entry.trim().toLowerCase();
      return parsePokemonLookupFromAreaEntry(entry);
    })
    .filter(Boolean);

  if (!lookups.length) return null;

  const selectedLookup = lookups[randomInt(0, lookups.length - 1)];
  try {
    const pokemonData = await getPokemon(selectedLookup);
    return pokemonData || null;
  } catch (error) {
    logger.warn('Falha ao resolver Pokémon por encounter_pool.', {
      selectedLookup,
      error: error.message,
    });
    return null;
  }
};

const pickPokemonByPreferredTypes = async (preferredTypes = []) => {
  const normalizedTypes = (Array.isArray(preferredTypes) ? preferredTypes : [])
    .map((type) =>
      String(type || '')
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);

  if (!normalizedTypes.length) return null;

  for (let attempt = 0; attempt < MAX_BIOME_LOOKUP_ATTEMPTS; attempt += 1) {
    const selectedType = normalizedTypes[randomInt(0, normalizedTypes.length - 1)];
    try {
      const typeData = await getType(selectedType);
      const pokemonIds = (typeData?.pokemon || []).map(parsePokemonIdFromTypeEntry).filter((id) => Number.isFinite(id) && id > 0 && id <= DEFAULT_WILD_MAX_ID);

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

const shouldAcceptSpeciesForEncounter = ({ speciesData, preferredHabitats = [] }) => {
  const normalizedHabitats = (Array.isArray(preferredHabitats) ? preferredHabitats : [])
    .map((habitat) =>
      String(habitat || '')
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);

  const habitatName = String(speciesData?.habitat?.name || '')
    .trim()
    .toLowerCase();
  const isLegendary = Boolean(speciesData?.is_legendary);
  const isMythical = Boolean(speciesData?.is_mythical);

  if (isMythical && Math.random() > MYTHICAL_SPAWN_CHANCE) return false;
  if (isLegendary && Math.random() > LEGENDARY_SPAWN_CHANCE) return false;

  if (!normalizedHabitats.length) return true;
  if (!habitatName) return Math.random() <= 0.5;
  if (normalizedHabitats.includes(habitatName)) return true;
  return Math.random() <= 0.35;
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

  return Boolean(detail?.item || detail?.held_item || detail?.known_move || detail?.known_move_type || detail?.location || detail?.party_species || detail?.party_type || detail?.trade_species || detail?.needs_overworld_rain || detail?.turn_upside_down || String(detail?.time_of_day || '').trim() || hasValue(detail?.min_happiness) || hasValue(detail?.min_affection) || hasValue(detail?.min_beauty) || hasValue(detail?.gender) || hasValue(detail?.relative_physical_stats));
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

const resolveEligibleEvolutionByItem = (chainNode, itemKey) => {
  const normalizedItem = String(itemKey || '')
    .trim()
    .toLowerCase();
  if (!normalizedItem) return null;

  const candidates = [];
  for (const nextNode of chainNode?.evolves_to || []) {
    const details = Array.isArray(nextNode?.evolution_details) ? nextNode.evolution_details : [];
    for (const detail of details) {
      const triggerName = String(detail?.trigger?.name || '').toLowerCase();
      if (triggerName !== 'use-item') continue;
      const requiredItem = String(detail?.item?.name || '')
        .trim()
        .toLowerCase();
      if (!requiredItem || requiredItem !== normalizedItem) continue;
      candidates.push(nextNode);
    }
  }

  return candidates[0] || null;
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

export const buildPokemonSnapshot = async ({ pokemonData, speciesData = null, level, currentHp = null, ivs = null, storedMoves = null, natureData = null, abilityData = null, isShiny = false }) => {
  const safeLevel = clamp(toPositiveInt(level, 5), MIN_LEVEL, MAX_LEVEL);
  const resolvedIvs = normalizeIvs(ivs || createRandomIvs());
  const baseStats = getBaseStats(pokemonData);

  const maxHp = calculateMaxHp({
    baseHp: baseStats.hp,
    ivHp: resolvedIvs.hp,
    level: safeLevel,
  });

  const baseCalculatedStats = {
    attack: calculateStat({ base: baseStats.attack, iv: resolvedIvs.attack, level: safeLevel }),
    defense: calculateStat({ base: baseStats.defense, iv: resolvedIvs.defense, level: safeLevel }),
    specialAttack: calculateStat({ base: baseStats.specialAttack, iv: resolvedIvs.specialAttack, level: safeLevel }),
    specialDefense: calculateStat({ base: baseStats.specialDefense, iv: resolvedIvs.specialDefense, level: safeLevel }),
    speed: calculateStat({ base: baseStats.speed, iv: resolvedIvs.speed, level: safeLevel }),
  };
  const abilityKey =
    String(abilityData?.name || '')
      .trim()
      .toLowerCase() || null;
  const stats = applyNatureAndAbilityModifiers({
    stats: baseCalculatedStats,
    natureData,
    abilityKey,
  });

  const types = (pokemonData?.types || [])
    .sort((a, b) => toPositiveInt(a?.slot, 0) - toPositiveInt(b?.slot, 0))
    .map((entry) => entry?.type?.name)
    .filter(Boolean)
    .map((name) => String(name).toLowerCase());

  const moves = await resolveMoveSet(pokemonData, storedMoves);
  const speciesId = extractIdFromUrl(pokemonData?.species?.url) || toPositiveInt(speciesData?.id, 0);
  const localizedName = getLocalizedName(speciesData?.names, pokemonData?.name);
  const localizedGenus = getLocalizedGenus(speciesData?.genera);
  const flavorText = getFlavorText(speciesData?.flavor_text_entries);
  const abilityEffectText = getEffectText(abilityData?.effect_entries, { preferLong: false });
  const resolvedCurrentHp = currentHp === null || currentHp === undefined ? maxHp : clamp(toPositiveInt(currentHp, maxHp), 0, maxHp);

  return {
    pokeId: toPositiveInt(pokemonData?.id, 0),
    name: String(pokemonData?.name || 'unknown').toLowerCase(),
    displayName: capitalize(localizedName || pokemonData?.name),
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
    growthRate:
      String(speciesData?.growth_rate?.name || '')
        .trim()
        .toLowerCase() || null,
    habitat:
      String(speciesData?.habitat?.name || '')
        .trim()
        .toLowerCase() || null,
    isLegendary: Boolean(speciesData?.is_legendary),
    isMythical: Boolean(speciesData?.is_mythical),
    genus: localizedGenus || null,
    flavorText: flavorText || null,
    nature: natureData
      ? {
          key:
            String(natureData?.name || '')
              .trim()
              .toLowerCase() || null,
          name: capitalize(natureData?.name),
        }
      : null,
    ability: abilityData
      ? {
          key: abilityKey,
          name: capitalize(abilityData?.name),
          effectText: abilityEffectText || null,
        }
      : null,
  };
};

export const buildPlayerBattleSnapshot = async ({ playerPokemonRow }) => {
  const pokemonData = await getPokemon(playerPokemonRow.poke_id);
  let speciesData = null;
  try {
    const speciesLookup = pokemonData?.species?.name || extractIdFromUrl(pokemonData?.species?.url);
    if (speciesLookup) {
      speciesData = await getSpecies(speciesLookup);
    }
  } catch (error) {
    logger.debug('Species ignorada no snapshot do jogador.', {
      pokeId: playerPokemonRow?.poke_id,
      error: error.message,
    });
  }

  let natureData = null;
  if (playerPokemonRow?.nature_key) {
    try {
      natureData = await getNature(playerPokemonRow.nature_key);
    } catch (error) {
      logger.debug('Nature ignorada no snapshot do jogador.', {
        natureKey: playerPokemonRow.nature_key,
        error: error.message,
      });
    }
  }
  let abilityData = null;
  const abilityLookup = playerPokemonRow?.ability_key || playerPokemonRow?.ability_name || null;
  if (abilityLookup) {
    try {
      abilityData = await getAbility(abilityLookup);
    } catch (error) {
      logger.debug('Ability ignorada no snapshot do jogador.', {
        abilityLookup,
        error: error.message,
      });
      abilityData = { name: abilityLookup };
    }
  }

  return buildPokemonSnapshot({
    pokemonData,
    speciesData,
    level: playerPokemonRow.level,
    currentHp: playerPokemonRow.current_hp,
    ivs: playerPokemonRow.ivs_json,
    storedMoves: playerPokemonRow.moves_json,
    natureData,
    abilityData,
    isShiny: Boolean(playerPokemonRow.is_shiny),
  });
};

export const createWildEncounter = async ({ playerLevel, preferredTypes = [], preferredHabitats = [], encounterPool = [] }) => {
  const referenceLevel = clamp(toPositiveInt(playerLevel, 1), MIN_LEVEL, MAX_LEVEL);
  const minLevel = clamp(referenceLevel - MAX_ENCOUNTER_LEVEL_DIFF, MIN_WILD_LEVEL, MAX_LEVEL);
  const maxLevel = clamp(referenceLevel + MAX_ENCOUNTER_LEVEL_DIFF, minLevel, MAX_LEVEL);
  const wildLevel = randomInt(minLevel, maxLevel);
  const isShiny = Math.random() <= SHINY_CHANCE;

  let selectedPokemon = null;
  let selectedSpecies = null;

  for (let attempt = 0; attempt < MAX_SPECIES_FILTER_ATTEMPTS; attempt += 1) {
    let candidate = (await pickPokemonFromEncounterPool(encounterPool)) || (await pickPokemonByPreferredTypes(preferredTypes));

    if (!candidate) {
      const wildId = randomInt(1, DEFAULT_WILD_MAX_ID);
      try {
        candidate = await getPokemon(wildId);
      } catch {
        candidate = await getPokemon(25);
      }
    }

    const speciesId = extractIdFromUrl(candidate?.species?.url) || candidate?.id;
    if (!speciesId) continue;

    const speciesData = await getSpecies(speciesId);
    if (!shouldAcceptSpeciesForEncounter({ speciesData, preferredHabitats })) {
      continue;
    }

    selectedPokemon = candidate;
    selectedSpecies = speciesData;
    break;
  }

  if (!selectedPokemon) {
    selectedPokemon = await getPokemon(25);
    const fallbackSpeciesId = extractIdFromUrl(selectedPokemon?.species?.url) || selectedPokemon?.id;
    selectedSpecies = await getSpecies(fallbackSpeciesId);
  }

  const abilities = (selectedPokemon?.abilities || []).filter((entry) => !entry?.is_hidden);
  const abilityEntry = abilities.length ? abilities[randomInt(0, abilities.length - 1)] : selectedPokemon?.abilities?.[0];
  const abilityKey =
    String(abilityEntry?.ability?.name || '')
      .trim()
      .toLowerCase() || null;
  let abilityData = null;
  if (abilityKey) {
    try {
      abilityData = await getAbility(abilityKey);
    } catch (error) {
      logger.debug('Ability ignorada no encontro selvagem.', {
        abilityKey,
        error: error.message,
      });
    }
  }
  let natureData = null;
  try {
    natureData = await getNature(randomInt(1, 25));
  } catch (error) {
    logger.debug('Nature aleatória indisponível no encontro.', {
      error: error.message,
    });
  }

  const enemySnapshot = await buildPokemonSnapshot({
    pokemonData: selectedPokemon,
    speciesData: selectedSpecies,
    level: wildLevel,
    currentHp: null,
    ivs: createRandomIvs(),
    natureData,
    abilityData,
    isShiny,
  });

  return {
    enemySnapshot,
    speciesData: selectedSpecies,
    isShiny,
  };
};

export const resolveBattleTurn = ({ battleSnapshot, playerMoveSlot }) => {
  const snapshot = cloneSnapshot(battleSnapshot);
  const logs = [];
  syncPokemonCombatState(snapshot?.my);
  syncPokemonCombatState(snapshot?.enemy);

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

    const isPlayerAction = action.actor === 'my';
    const attacker = isPlayerAction ? snapshot.my : snapshot.enemy;
    const defender = isPlayerAction ? snapshot.enemy : snapshot.my;
    const attackerLabel = isPlayerAction ? `Seu ${snapshot.my.displayName}` : ` ${snapshot.enemy.displayName}`.trim();
    const defenderLabel = isPlayerAction ? ` ${snapshot.enemy.displayName}`.trim() : `Seu ${snapshot.my.displayName}`;

    const preMoveStatus = processTurnStartStatus({
      actor: attacker,
      actorLabel: attackerLabel,
    });
    logs.push(...preMoveStatus.logs);
    if (!preMoveStatus.canAct) continue;

    const move = Array.isArray(attacker?.moves) ? attacker.moves[action.moveIndex] : null;
    logs.push(
      ...performAction({
        attacker,
        defender,
        move,
        attackerLabel,
        defenderLabel,
      }),
    );
  }

  if (!resolveWinner(snapshot)) {
    applyEndTurnResidualEffects({
      snapshot,
      logs,
      myLabel: `Seu ${snapshot?.my?.displayName || 'Pokémon'}`,
      enemyLabel: `${snapshot?.enemy?.displayName || 'Inimigo'}`,
    });
  }

  return {
    snapshot,
    logs,
    winner: resolveWinner(snapshot),
    validTurn: true,
  };
};

export const resolveSingleAttack = ({ attackerSnapshot, defenderSnapshot, moveSlot = 1, attackerLabel = 'Atacante', defenderLabel = 'Defensor' }) => {
  const attacker = cloneSnapshot(attackerSnapshot || {});
  const defender = cloneSnapshot(defenderSnapshot || {});
  syncPokemonCombatState(attacker);
  syncPokemonCombatState(defender);
  const logs = [];

  const moves = Array.isArray(attacker?.moves) ? attacker.moves : [];
  const selectedIndex = clamp(toPositiveInt(moveSlot, 1) - 1, 0, 3);
  const selectedMove = moves[selectedIndex];

  if (!selectedMove) {
    return {
      attacker,
      defender,
      logs: ['Movimento inválido. Use 1, 2, 3 ou 4.'],
      damage: 0,
      validMove: false,
    };
  }

  const preMoveStatus = processTurnStartStatus({
    actor: attacker,
    actorLabel: attackerLabel,
  });
  logs.push(...preMoveStatus.logs);
  if (!preMoveStatus.canAct) {
    if (!resolveWinner({ my: attacker, enemy: defender })) {
      applyEndTurnResidualEffects({
        snapshot: { my: attacker, enemy: defender },
        logs,
        myLabel: attackerLabel,
        enemyLabel: defenderLabel,
      });
    }
    return {
      attacker,
      defender,
      logs,
      damage: 0,
      validMove: true,
    };
  }

  const beforeHp = toPositiveInt(defender.currentHp, 0);
  const actionLogs = performAction({
    attacker,
    defender,
    move: selectedMove,
    attackerLabel,
    defenderLabel,
  });
  logs.push(...actionLogs);
  const afterHp = toPositiveInt(defender.currentHp, 0);

  if (!resolveWinner({ my: attacker, enemy: defender })) {
    applyEndTurnResidualEffects({
      snapshot: { my: attacker, enemy: defender },
      logs,
      myLabel: attackerLabel,
      enemyLabel: defenderLabel,
    });
  }

  return {
    attacker,
    defender,
    logs,
    damage: Math.max(0, beforeHp - afterHp),
    validMove: true,
  };
};

export const resolveCaptureAttempt = ({ battleSnapshot }) => {
  const snapshot = cloneSnapshot(battleSnapshot);
  syncPokemonCombatState(snapshot?.my);
  syncPokemonCombatState(snapshot?.enemy);
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

  const captureBonus = clamp(toNumber(snapshot?.my?.captureBonus, 0), 0, 1);
  const guaranteedCapture = Boolean(snapshot?.my?.guaranteedCapture);
  const hpFactor = clamp((enemy.maxHp - enemy.currentHp) / Math.max(1, enemy.maxHp), 0, 1);
  const captureRateFactor = clamp(toPositiveInt(enemy.captureRate, DEFAULT_CAPTURE_RATE) / 255, 0, 1);
  const chance = guaranteedCapture ? 1 : clamp(0.1 + hpFactor * 0.6 + captureRateFactor * 0.25 + captureBonus, 0.05, 0.95);
  const success = guaranteedCapture || Math.random() <= chance;

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
    const enemyLabel = ` ${snapshot.enemy.displayName}`.trim();
    const preMoveStatus = processTurnStartStatus({
      actor: snapshot.enemy,
      actorLabel: enemyLabel,
    });
    logs.push(...preMoveStatus.logs);

    if (preMoveStatus.canAct) {
      const enemyMoveIndex = pickEnemyMoveIndex(snapshot);
      const enemyMove = snapshot.enemy.moves[enemyMoveIndex];
      logs.push(
        ...performAction({
          attacker: snapshot.enemy,
          defender: snapshot.my,
          move: enemyMove,
          attackerLabel: enemyLabel,
          defenderLabel: `Seu ${snapshot.my.displayName}`,
        }),
      );
    }
  }

  if (!resolveWinner(snapshot)) {
    applyEndTurnResidualEffects({
      snapshot,
      logs,
      myLabel: `Seu ${snapshot?.my?.displayName || 'Pokémon'}`,
      enemyLabel: `${snapshot?.enemy?.displayName || 'Inimigo'}`,
    });
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

export const buildMoveSnapshotByName = async (idOrName) => {
  return loadMoveSnapshot(idOrName);
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

export const resolveEvolutionByItem = async ({ pokeId, itemKey }) => {
  const normalizedItem = String(itemKey || '')
    .trim()
    .toLowerCase();
  if (!normalizedItem) return null;

  const currentPokemon = await getPokemon(pokeId);
  const currentSpeciesId = extractIdFromUrl(currentPokemon?.species?.url) || toPositiveInt(currentPokemon?.id, 0);
  if (!currentSpeciesId) return null;

  const speciesData = await getSpecies(currentSpeciesId);
  const chainId = buildEvolutionChainId(speciesData);
  if (!chainId) return null;

  const chainData = await getEvolutionChain(chainId);
  const currentNode = findEvolutionNodeBySpeciesName(chainData?.chain, currentPokemon?.species?.name || currentPokemon?.name);
  if (!currentNode) return null;

  const nextNode = resolveEligibleEvolutionByItem(currentNode, normalizedItem);
  if (!nextNode) return null;

  const nextSpeciesId = resolveSpeciesIdFromNode(nextNode);
  const nextLookup = nextSpeciesId || String(nextNode?.species?.name || '').toLowerCase();
  if (!nextLookup) return null;

  const evolvedPokemon = await getPokemon(nextLookup);
  return {
    from: {
      pokeId: toPositiveInt(currentPokemon?.id, 0),
      name: capitalize(currentPokemon?.name),
    },
    to: {
      pokeId: toPositiveInt(evolvedPokemon?.id, 0),
      name: capitalize(evolvedPokemon?.name),
    },
    pokemonData: evolvedPokemon,
  };
};

export const listBaseStatNames = () => [...BASE_STAT_NAMES];
