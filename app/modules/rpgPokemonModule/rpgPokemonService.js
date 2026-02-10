import { pool } from '../../../database/index.js';
import { isGroupJid } from '../../config/baileysConfig.js';
import logger from '../../utils/logger/loggerModule.js';
import {
  applyPokemonXpGain,
  buildPlayerBattleSnapshot,
  buildPokemonSnapshot,
  calculatePlayerLevelFromXp,
  createRandomIvs,
  createWildEncounter,
  resolveBattleTurn,
  resolveCaptureAttempt,
  resolveEvolutionByLevel,
} from './rpgBattleService.js';
import {
  addInventoryItem,
  consumeInventoryItem,
  createPlayer,
  createPlayerPokemon,
  deleteBattleStateByOwner,
  deleteExpiredBattleStatesByOwner,
  getActivePlayerPokemonForUpdate,
  getActivePlayerPokemon,
  getBattleStateByOwner,
  getBattleStateByOwnerForUpdate,
  getInventoryItemForUpdate,
  getInventoryItems,
  getGroupBiomeByJid,
  getMissionProgressByOwnerForUpdate,
  getPlayerByJid,
  getPlayerByJidForUpdate,
  getPlayerPokemonById,
  getPlayerPokemonByIdForUpdate,
  listPlayerPokemons,
  setActivePokemon,
  createMissionProgress,
  upsertGroupBiome,
  updateMissionProgress,
  updatePlayerGoldOnly,
  updatePlayerPokemonState,
  updatePlayerProgress,
  upsertBattleState,
} from './rpgPokemonRepository.js';
import {
  buildBattleAlreadyActiveText,
  buildBattleStartText,
  buildBattleTurnText,
  buildBuyErrorText,
  buildBuySuccessText,
  buildCaptureFailText,
  buildCaptureSuccessText,
  buildCaptureBlockedGymText,
  buildChooseErrorText,
  buildChooseSuccessText,
  buildCooldownText,
  buildFleeText,
  buildGenericErrorText,
  buildNeedActivePokemonText,
  buildNeedStartText,
  buildNoBattleText,
  buildPokemonFaintedText,
  buildProfileText,
  buildShopText,
  buildStartText,
  buildTeamText,
  buildBagText,
  buildMissionsText,
  buildMissionRewardText,
  buildUseItemErrorText,
  buildUsePotionSuccessText,
  buildUseItemUsageText,
} from './rpgPokemonMessages.js';
import { getPokemon } from '../../services/pokeApiService.js';
import {
  recordRpgBattleStarted,
  recordRpgCapture,
  recordRpgEvolution,
  recordRpgPlayerCreated,
  recordRpgShinyFound,
} from '../../observability/metrics.js';
import {
  BIOME_DEFINITIONS,
  BIOME_KEYS,
  DAILY_MISSION_REWARD,
  DAILY_MISSION_TARGET,
  MISSION_KEYS,
  WEEKLY_MISSION_REWARD,
  WEEKLY_MISSION_TARGET,
  buildMissionProgressZero,
  isMissionCompleted,
  normalizeMissionProgress,
  resolveBiomeFromKey,
  resolveDefaultBiomeForGroup,
  resolveMissionRefs,
  resolveMissionStateForRefs,
  resolveVictoryRewards,
} from './rpgPokemonDomain.js';

const COOLDOWN_MS = Math.max(5_000, Number(process.env.RPG_COOLDOWN_MS) || 10_000);
const BATTLE_TTL_MS = Math.max(60_000, Number(process.env.RPG_BATTLE_TTL_MS) || 5 * 60 * 1000);
const STARTER_LEVEL = Math.max(3, Number(process.env.RPG_STARTER_LEVEL) || 5);
const STARTER_POKE_IDS = [1, 4, 7, 25];
const POTION_HEAL_HP = Math.max(10, Number(process.env.RPG_POTION_HEAL_HP) || 25);
const SUPER_POTION_HEAL_HP = Math.max(POTION_HEAL_HP + 5, Number(process.env.RPG_SUPER_POTION_HEAL_HP) || 60);
const GYM_LEVEL_BONUS_MIN = 3;
const GYM_LEVEL_BONUS_MAX = 6;

const playerCooldownMap = globalThis.__omnizapRpgCooldownMap instanceof Map ? globalThis.__omnizapRpgCooldownMap : new Map();
globalThis.__omnizapRpgCooldownMap = playerCooldownMap;

const SHOP_ITEMS = [
  { key: 'pokeball', label: 'Poke Bola', price: 100, description: 'Item de captura' },
  { key: 'potion', label: 'Potion', price: 60, description: `Recupera ${POTION_HEAL_HP} HP` },
  { key: 'superpotion', label: 'Super Potion', price: 140, description: `Recupera ${SUPER_POTION_HEAL_HP} HP` },
];

const SHOP_INDEX = new Map(SHOP_ITEMS.map((item) => [item.key, item]));
const ITEM_ALIASES = new Map([
  ['pokeball', 'pokeball'],
  ['pokebola', 'pokeball'],
  ['pokeballs', 'pokeball'],
  ['pokebolas', 'pokeball'],
  ['potion', 'potion'],
  ['potions', 'potion'],
  ['pocao', 'potion'],
  ['pocoes', 'potion'],
  ['superpotion', 'superpotion'],
  ['superpotions', 'superpotion'],
  ['superpocao', 'superpotion'],
  ['superpocoes', 'superpotion'],
]);

const toInt = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const randomFromArray = (items) => items[Math.floor(Math.random() * items.length)];
const randomBetweenInt = (min, max) => {
  const low = Math.ceil(min);
  const high = Math.floor(max);
  if (high <= low) return low;
  return Math.floor(Math.random() * (high - low + 1)) + low;
};

const normalizeItemToken = (value) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

  return ITEM_ALIASES.get(normalized) || normalized;
};

const normalizeNameKey = (value) => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
};

const resolveBiomeForChat = async (chatJid, connection = null) => {
  if (!isGroupJid(chatJid)) return null;

  const stored = await getGroupBiomeByJid(chatJid, connection);
  const storedBiome = resolveBiomeFromKey(stored?.biome_key);
  if (storedBiome) return storedBiome;

  const assigned = resolveDefaultBiomeForGroup(chatJid);
  if (!assigned) return null;

  await upsertGroupBiome(
    {
      groupJid: chatJid,
      biomeKey: assigned.key,
    },
    connection,
  );

  return assigned;
};

const itemRewardLabel = (itemKey) => {
  return SHOP_INDEX.get(itemKey)?.label || itemKey;
};

const formatMissionRewardSummary = (reward, label) => {
  const itemText = (reward.items || []).map((item) => `+${item.quantity} ${itemRewardLabel(item.key)}`).join(' | ');
  const parts = [`🏆 Missão ${label} concluída!`, `+${reward.gold} gold`, `+${reward.xp} XP`];
  if (itemText) parts.push(itemText);
  return parts.join(' ');
};

const ensureMissionStateForUpdate = async ({ ownerJid, connection }) => {
  const refs = resolveMissionRefs(new Date());
  let row = await getMissionProgressByOwnerForUpdate(ownerJid, connection);

  if (!row) {
    row = await createMissionProgress(
      {
        ownerJid,
        dailyRefDate: refs.dailyRefDate,
        dailyProgressJson: buildMissionProgressZero(),
        weeklyRefDate: refs.weeklyRefDate,
        weeklyProgressJson: buildMissionProgressZero(),
      },
      connection,
    );
  }
  const { normalized, dirty } = resolveMissionStateForRefs({
    ownerJid,
    row,
    refs,
  });

  if (dirty) {
    await updateMissionProgress(
      {
        ownerJid,
        dailyRefDate: normalized.daily_ref_date,
        dailyProgressJson: normalized.daily_progress_json,
        dailyClaimedAt: normalized.daily_claimed_at,
        weeklyRefDate: normalized.weekly_ref_date,
        weeklyProgressJson: normalized.weekly_progress_json,
        weeklyClaimedAt: normalized.weekly_claimed_at,
      },
      connection,
    );
  }

  return normalized;
};

const applyMissionReward = async ({ player, ownerJid, reward, connection }) => {
  const nextXp = Math.max(0, toInt(player.xp, 0) + Math.max(0, toInt(reward.xp, 0)));
  const nextGold = Math.max(0, toInt(player.gold, 0) + Math.max(0, toInt(reward.gold, 0)));
  const nextLevel = calculatePlayerLevelFromXp(nextXp);

  await updatePlayerProgress(
    {
      jid: ownerJid,
      level: nextLevel,
      xp: nextXp,
      gold: nextGold,
    },
    connection,
  );

  for (const item of reward.items || []) {
    if (!item?.key || !Number.isFinite(Number(item?.quantity)) || Number(item.quantity) <= 0) continue;
    await addInventoryItem(
      {
        ownerJid,
        itemKey: item.key,
        quantity: Number(item.quantity),
      },
      connection,
    );
  }

  return {
    ...player,
    level: nextLevel,
    xp: nextXp,
    gold: nextGold,
  };
};

const applyMissionEvent = async ({ ownerJid, eventKey, connection }) => {
  if (!Object.values(MISSION_KEYS).includes(eventKey)) {
    return { notices: [] };
  }

  const mission = await ensureMissionStateForUpdate({ ownerJid, connection });
  const player = await getPlayerByJidForUpdate(ownerJid, connection);
  if (!player) {
    return { notices: [] };
  }

  const dailyProgress = { ...mission.daily_progress_json };
  const weeklyProgress = { ...mission.weekly_progress_json };
  dailyProgress[eventKey] = Math.max(0, toInt(dailyProgress[eventKey], 0) + 1);
  weeklyProgress[eventKey] = Math.max(0, toInt(weeklyProgress[eventKey], 0) + 1);

  let updatedPlayer = player;
  const notices = [];
  let dailyClaimedAt = mission.daily_claimed_at;
  let weeklyClaimedAt = mission.weekly_claimed_at;

  if (!dailyClaimedAt && isMissionCompleted(dailyProgress, DAILY_MISSION_TARGET)) {
    updatedPlayer = await applyMissionReward({
      player: updatedPlayer,
      ownerJid,
      reward: DAILY_MISSION_REWARD,
      connection,
    });
    dailyClaimedAt = new Date();
    notices.push(formatMissionRewardSummary(DAILY_MISSION_REWARD, 'diária'));
  }

  if (!weeklyClaimedAt && isMissionCompleted(weeklyProgress, WEEKLY_MISSION_TARGET)) {
    updatedPlayer = await applyMissionReward({
      player: updatedPlayer,
      ownerJid,
      reward: WEEKLY_MISSION_REWARD,
      connection,
    });
    weeklyClaimedAt = new Date();
    notices.push(formatMissionRewardSummary(WEEKLY_MISSION_REWARD, 'semanal'));
  }

  await updateMissionProgress(
    {
      ownerJid,
      dailyRefDate: mission.daily_ref_date,
      dailyProgressJson: dailyProgress,
      dailyClaimedAt,
      weeklyRefDate: mission.weekly_ref_date,
      weeklyProgressJson: weeklyProgress,
      weeklyClaimedAt,
    },
    connection,
  );

  return { notices, player: updatedPlayer };
};

const buildBattleChatKey = (chatJid, ownerJid) => `${chatJid}::${ownerJid}`;

const nowPlusTtlDate = () => new Date(Date.now() + BATTLE_TTL_MS);

const parseBattleSnapshot = (battleState) => {
  const snapshot = battleState?.enemy_snapshot_json;
  if (!snapshot || typeof snapshot !== 'object') return null;
  if (!snapshot.my || !snapshot.enemy) return null;
  return snapshot;
};

const getCooldownSecondsLeft = (ownerJid) => {
  const lastAt = playerCooldownMap.get(ownerJid);
  if (!lastAt) return 0;
  const diff = Date.now() - lastAt;
  if (diff >= COOLDOWN_MS) return 0;
  return Math.max(1, Math.ceil((COOLDOWN_MS - diff) / 1000));
};

const shouldApplyCooldown = (action) => {
  return ['explorar', 'ginasio', 'atacar', 'capturar', 'fugir', 'comprar', 'escolher', 'usar'].includes(action);
};

const touchCooldown = (ownerJid) => {
  playerCooldownMap.set(ownerJid, Date.now());
};

const loadPokemonDisplayData = async (pokemonRow) => {
  const snapshot = await buildPlayerBattleSnapshot({ playerPokemonRow: pokemonRow });
  return {
    id: pokemonRow.id,
    pokeId: pokemonRow.poke_id,
    name: snapshot.name,
    displayName: pokemonRow.nickname || snapshot.displayName,
    level: pokemonRow.level,
    currentHp: pokemonRow.current_hp,
    maxHp: snapshot.maxHp,
    isShiny: Boolean(pokemonRow.is_shiny),
    isActive: pokemonRow.is_active,
    imageUrl: snapshot.imageUrl || null,
  };
};

const createStarterPokemon = async ({ ownerJid, connection }) => {
  const starterId = randomFromArray(STARTER_POKE_IDS);
  const starterApi = await getPokemon(starterId);
  const starterSnapshot = await buildPokemonSnapshot({
    pokemonData: starterApi,
    level: STARTER_LEVEL,
    currentHp: null,
    ivs: createRandomIvs(),
    isShiny: false,
  });

  const created = await createPlayerPokemon(
    {
      ownerJid,
      pokeId: starterSnapshot.pokeId,
      nickname: starterSnapshot.displayName,
      level: STARTER_LEVEL,
      xp: 0,
      currentHp: starterSnapshot.maxHp,
      ivsJson: starterSnapshot.ivs,
      movesJson: starterSnapshot.moves,
      isShiny: false,
      isActive: true,
    },
    connection,
  );

  return {
    row: created,
    snapshot: starterSnapshot,
  };
};

const ensureNoExpiredBattle = async (ownerJid, connection = null) => {
  await deleteExpiredBattleStatesByOwner(ownerJid, connection);
};

const withPokemonImage = ({ text, pokemonSnapshot, caption = null, extra = {} }) => {
  const imageUrl = pokemonSnapshot?.imageUrl || null;
  if (!imageUrl) {
    return { ok: true, text, ...extra };
  }

  return {
    ok: true,
    text,
    imageUrl,
    caption: caption || text,
    ...extra,
  };
};

const shouldRenamePokemonAfterEvolution = ({ currentNickname, currentSpeciesName }) => {
  if (!currentNickname) return true;
  return normalizeNameKey(currentNickname) === normalizeNameKey(currentSpeciesName);
};

const resolveEvolutionOutcome = async ({ myPokemon, pokemonProgress, updatedBattleSnapshot }) => {
  const evolution = await resolveEvolutionByLevel({
    pokeId: myPokemon.poke_id,
    level: pokemonProgress.level,
  });

  if (!evolution || evolution?.to?.pokeId === myPokemon.poke_id) {
    return null;
  }

  const currentMaxHp = Math.max(1, toInt(updatedBattleSnapshot?.my?.maxHp, myPokemon.current_hp || 1));
  const currentHp = Math.max(0, toInt(updatedBattleSnapshot?.my?.currentHp, myPokemon.current_hp || 0));
  const hpRatio = clamp(currentHp / currentMaxHp, 0, 1);

  const evolvedSnapshot = await buildPokemonSnapshot({
    pokemonData: evolution.pokemonData,
    level: pokemonProgress.level,
    currentHp: null,
    ivs: myPokemon.ivs_json,
    storedMoves: myPokemon.moves_json,
    isShiny: Boolean(myPokemon.is_shiny),
  });

  const evolvedHp = clamp(Math.max(1, Math.round(evolvedSnapshot.maxHp * hpRatio)), 0, evolvedSnapshot.maxHp);
  const resolvedNickname = shouldRenamePokemonAfterEvolution({
    currentNickname: myPokemon.nickname,
    currentSpeciesName: evolution.from.name,
  })
    ? evolution.to.name
    : undefined;

  const updatedBattleMy = {
    ...updatedBattleSnapshot.my,
    ...evolvedSnapshot,
    id: updatedBattleSnapshot?.my?.id || myPokemon.id,
    xp: pokemonProgress.xp,
    currentHp: evolvedHp,
    level: pokemonProgress.level,
  };

  return {
    evolution,
    updatedBattleMy,
    updatePayload: {
      pokeId: evolution.to.pokeId,
      nickname: resolvedNickname,
      movesJson: evolvedSnapshot.moves,
      currentHp: evolvedHp,
      level: pokemonProgress.level,
      xp: pokemonProgress.xp,
      isShiny: Boolean(myPokemon.is_shiny),
    },
  };
};

const withTransaction = async (runner) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await runner(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const handleStart = async ({ ownerJid, commandPrefix }) => {
  const existing = await getPlayerByJid(ownerJid);
  if (existing) {
    return {
      ok: true,
      text: buildStartText({
        isNewPlayer: false,
        starterPokemon: { id: 0, name: '' },
        prefix: commandPrefix,
      }),
    };
  }

  const starterData = await withTransaction(async (connection) => {
    await createPlayer({ jid: ownerJid, level: 1, xp: 0, gold: 300 }, connection);
    const starter = await createStarterPokemon({ ownerJid, connection });
    return starter;
  });

  recordRpgPlayerCreated();

  return {
    ok: true,
    text: buildStartText({
      isNewPlayer: true,
      starterPokemon: {
        id: starterData.row?.id,
        name: starterData.snapshot.displayName,
        displayName: starterData.snapshot.displayName,
        isShiny: Boolean(starterData.snapshot?.isShiny),
      },
      prefix: commandPrefix,
    }),
  };
};

const handleProfile = async ({ ownerJid, commandPrefix }) => {
  const player = await getPlayerByJid(ownerJid);
  if (!player) {
    return {
      ok: true,
      text: buildNeedStartText(commandPrefix),
    };
  }

  const active = await getActivePlayerPokemon(ownerJid);
  let activeDisplay = null;
  let activeSnapshot = null;

  if (active) {
    try {
      const snapshot = await buildPlayerBattleSnapshot({ playerPokemonRow: active });
      activeSnapshot = snapshot;
      activeDisplay = {
        id: active.id,
        name: snapshot.name,
        displayName: active.nickname || snapshot.displayName,
        level: active.level,
        currentHp: active.current_hp,
        maxHp: snapshot.maxHp,
        isShiny: Boolean(active.is_shiny),
        imageUrl: snapshot.imageUrl || null,
      };
    } catch (error) {
      logger.warn('Falha ao montar perfil do Pokemon ativo no RPG.', {
        ownerJid,
        pokemonId: active.id,
        error: error.message,
      });
    }
  }

  const text = buildProfileText({
    player,
    activePokemon: activeDisplay,
    prefix: commandPrefix,
  });

  return withPokemonImage({
    text,
    pokemonSnapshot: activeSnapshot,
    caption: activeSnapshot
      ? `👤 ${activeDisplay.displayName} Lv.${activeDisplay.level}\nPróximo: ${commandPrefix}rpg explorar`
      : null,
  });
};

const handleTeam = async ({ ownerJid, commandPrefix }) => {
  const player = await getPlayerByJid(ownerJid);
  if (!player) {
    return {
      ok: true,
      text: buildNeedStartText(commandPrefix),
    };
  }

  const rows = await listPlayerPokemons(ownerJid);

  const hydrated = [];
  for (const row of rows) {
    try {
      hydrated.push(await loadPokemonDisplayData(row));
    } catch {
      hydrated.push({
        id: row.id,
        pokeId: row.poke_id,
        name: `pokemon-${row.poke_id}`,
        displayName: row.nickname || `Pokemon #${row.poke_id}`,
        level: row.level,
        currentHp: row.current_hp,
        maxHp: row.current_hp,
        isShiny: Boolean(row.is_shiny),
        isActive: row.is_active,
      });
    }
  }

  return {
    ok: true,
    text: buildTeamText({
      team: hydrated,
      prefix: commandPrefix,
    }),
  };
};

const handleChoose = async ({ ownerJid, selectedPokemonId, commandPrefix }) => {
  const player = await getPlayerByJid(ownerJid);
  if (!player) {
    return { ok: true, text: buildNeedStartText(commandPrefix) };
  }

  const pokemonId = toInt(selectedPokemonId, NaN);
  if (!Number.isFinite(pokemonId) || pokemonId <= 0) {
    return { ok: true, text: buildChooseErrorText(commandPrefix) };
  }

  await ensureNoExpiredBattle(ownerJid);
  const activeBattle = await getBattleStateByOwner(ownerJid);
  if (activeBattle) {
    return { ok: true, text: buildBattleAlreadyActiveText(commandPrefix) };
  }

  const target = await getPlayerPokemonById(ownerJid, pokemonId);
  if (!target) {
    return { ok: true, text: buildChooseErrorText(commandPrefix) };
  }

  await withTransaction(async (connection) => {
    await setActivePokemon(ownerJid, pokemonId, connection);
  });

  return {
    ok: true,
    text: buildChooseSuccessText({
      pokemon: {
        id: target.id,
        name: target.nickname || `Pokemon #${target.poke_id}`,
        displayName: target.nickname || `Pokemon #${target.poke_id}`,
        isShiny: Boolean(target.is_shiny),
      },
      prefix: commandPrefix,
    }),
  };
};

const handleExplore = async ({ ownerJid, chatJid, commandPrefix }) => {
  return withTransaction(async (connection) => {
    const player = await getPlayerByJidForUpdate(ownerJid, connection);
    if (!player) {
      return { ok: true, text: buildNeedStartText(commandPrefix) };
    }

    await ensureNoExpiredBattle(ownerJid, connection);
    const existingBattle = await getBattleStateByOwnerForUpdate(ownerJid, connection);
    if (existingBattle) {
      return { ok: true, text: buildBattleAlreadyActiveText(commandPrefix) };
    }

    const activePokemonRow = await getActivePlayerPokemonForUpdate(ownerJid, connection);
    if (!activePokemonRow) {
      return { ok: true, text: buildNeedActivePokemonText(commandPrefix) };
    }

    const activeBattleSnapshot = await buildPlayerBattleSnapshot({ playerPokemonRow: activePokemonRow });
    if (activeBattleSnapshot.currentHp <= 0) {
      return { ok: true, text: buildPokemonFaintedText(commandPrefix) };
    }

    const biome = await resolveBiomeForChat(chatJid, connection);
    const { enemySnapshot } = await createWildEncounter({
      playerLevel: player.level,
      preferredTypes: biome?.preferredTypes || [],
    });

    const battleSnapshot = {
      turn: 1,
      mode: 'wild',
      biome: biome
        ? {
            key: biome.key,
            label: biome.label,
          }
        : null,
      my: {
        ...activeBattleSnapshot,
        id: activePokemonRow.id,
        xp: activePokemonRow.xp,
      },
      enemy: enemySnapshot,
    };

    await upsertBattleState(
      {
        chatJid: buildBattleChatKey(chatJid, ownerJid),
        ownerJid,
        myPokemonId: activePokemonRow.id,
        battleSnapshot,
        turn: 1,
        expiresAt: nowPlusTtlDate(),
      },
      connection,
    );

    const mission = await applyMissionEvent({
      ownerJid,
      eventKey: MISSION_KEYS.EXPLORE,
      connection,
    });

    recordRpgBattleStarted();
    if (enemySnapshot.isShiny) {
      recordRpgShinyFound();
    }

    let text = buildBattleStartText({
      battleSnapshot,
      prefix: commandPrefix,
    });
    const missionText = buildMissionRewardText(mission.notices || []);
    if (missionText) {
      text = `${text}\n${missionText}`;
    }

    return withPokemonImage({
      text,
      pokemonSnapshot: battleSnapshot.enemy,
      caption: enemySnapshot.isShiny
        ? `✨ UM POKEMON SHINY APARECEU! ✨\n${battleSnapshot.enemy.displayName} Lv.${battleSnapshot.enemy.level}`
        : `🐾 Um ${battleSnapshot.enemy.displayName} Lv.${battleSnapshot.enemy.level} apareceu!\nUse ${commandPrefix}rpg atacar ou ${commandPrefix}rpg capturar`,
    });
  });
};

const resolveBiomeForGym = async ({ chatJid, connection = null }) => {
  const biome = await resolveBiomeForChat(chatJid, connection);
  if (biome) return biome;
  return BIOME_DEFINITIONS[randomFromArray(BIOME_KEYS)];
};

const handleGym = async ({ ownerJid, chatJid, commandPrefix }) => {
  return withTransaction(async (connection) => {
    const player = await getPlayerByJidForUpdate(ownerJid, connection);
    if (!player) {
      return { ok: true, text: buildNeedStartText(commandPrefix) };
    }

    await ensureNoExpiredBattle(ownerJid, connection);
    const existingBattle = await getBattleStateByOwnerForUpdate(ownerJid, connection);
    if (existingBattle) {
      return { ok: true, text: buildBattleAlreadyActiveText(commandPrefix) };
    }

    const activePokemonRow = await getActivePlayerPokemonForUpdate(ownerJid, connection);
    if (!activePokemonRow) {
      return { ok: true, text: buildNeedActivePokemonText(commandPrefix) };
    }

    const activeBattleSnapshot = await buildPlayerBattleSnapshot({ playerPokemonRow: activePokemonRow });
    if (activeBattleSnapshot.currentHp <= 0) {
      return { ok: true, text: buildPokemonFaintedText(commandPrefix) };
    }

    const biome = await resolveBiomeForGym({ chatJid, connection });
    const gymBaseLevel = clamp(toInt(player.level, 1) + randomBetweenInt(GYM_LEVEL_BONUS_MIN, GYM_LEVEL_BONUS_MAX), 1, 100);
    const { enemySnapshot } = await createWildEncounter({
      playerLevel: gymBaseLevel,
      preferredTypes: biome?.preferredTypes || [],
    });

    const gymEnemy = {
      ...enemySnapshot,
      isGymBoss: true,
      displayName: `${enemySnapshot.displayName} (Líder)`,
    };

    const battleSnapshot = {
      turn: 1,
      mode: 'gym',
      biome: biome
        ? {
            key: biome.key,
            label: biome.label,
          }
        : null,
      my: {
        ...activeBattleSnapshot,
        id: activePokemonRow.id,
        xp: activePokemonRow.xp,
      },
      enemy: gymEnemy,
    };

    await upsertBattleState(
      {
        chatJid: buildBattleChatKey(chatJid, ownerJid),
        ownerJid,
        myPokemonId: activePokemonRow.id,
        battleSnapshot,
        turn: 1,
        expiresAt: nowPlusTtlDate(),
      },
      connection,
    );

    recordRpgBattleStarted();
    if (gymEnemy.isShiny) {
      recordRpgShinyFound();
    }

    const text = buildBattleStartText({
      battleSnapshot,
      prefix: commandPrefix,
    });

    return withPokemonImage({
      text,
      pokemonSnapshot: battleSnapshot.enemy,
      caption: `🏟️ Ginasio (${biome?.label || 'Desafio'})\n${battleSnapshot.enemy.displayName} Lv.${battleSnapshot.enemy.level}`,
    });
  });
};

const handleAttack = async ({ ownerJid, moveSlot, commandPrefix }) => {
  return withTransaction(async (connection) => {
    await ensureNoExpiredBattle(ownerJid, connection);

    const battleRow = await getBattleStateByOwnerForUpdate(ownerJid, connection);
    if (!battleRow) {
      return { ok: true, text: buildNoBattleText(commandPrefix) };
    }

    const battleSnapshot = parseBattleSnapshot(battleRow);
    if (!battleSnapshot) {
      await deleteBattleStateByOwner(ownerJid, connection);
      return { ok: true, text: buildNoBattleText(commandPrefix) };
    }

    if (battleSnapshot.mode === 'gym') {
      return { ok: true, text: buildCaptureBlockedGymText(commandPrefix) };
    }

    const myPokemon = await getPlayerPokemonByIdForUpdate(ownerJid, battleRow.my_pokemon_id, connection);
    if (!myPokemon) {
      await deleteBattleStateByOwner(ownerJid, connection);
      return { ok: true, text: buildNoBattleText(commandPrefix) };
    }

    const turnResult = resolveBattleTurn({
      battleSnapshot,
      playerMoveSlot: moveSlot,
    });

    if (!turnResult.validTurn) {
      const text = buildBattleTurnText({
        logs: turnResult.logs,
        battleSnapshot,
        prefix: commandPrefix,
        rewards: null,
      });
      return {
        ...withPokemonImage({
          text,
          pokemonSnapshot: battleSnapshot.enemy || battleSnapshot.my,
          caption: `⚔️ Batalha: ${battleSnapshot.enemy?.displayName || 'Inimigo'} Lv.${battleSnapshot.enemy?.level || 1}\nUse ${commandPrefix}rpg atacar`,
        }),
      };
    }

    const updatedSnapshot = turnResult.snapshot;
    const winner = turnResult.winner;

    if (winner === 'player') {
      const rewards = resolveVictoryRewards(updatedSnapshot);
      const player = await getPlayerByJidForUpdate(ownerJid, connection);

      const pokemonProgress = applyPokemonXpGain({
        currentLevel: myPokemon.level,
        currentXp: myPokemon.xp,
        gainedXp: rewards.pokemonXp,
      });

      const playerXp = toInt(player?.xp, 0) + rewards.playerXp;
      const playerGold = Math.max(0, toInt(player?.gold, 0) + rewards.gold);
      const playerLevel = calculatePlayerLevelFromXp(playerXp);

      const evolutionOutcome = await resolveEvolutionOutcome({
        myPokemon,
        pokemonProgress,
        updatedBattleSnapshot: updatedSnapshot,
      });

      const myFinalSnapshot = evolutionOutcome?.updatedBattleMy || updatedSnapshot.my;
      const evolutionPayload = evolutionOutcome?.updatePayload || null;

      await updatePlayerPokemonState(
        {
          id: myPokemon.id,
          ownerJid,
          level: evolutionPayload?.level ?? pokemonProgress.level,
          xp: evolutionPayload?.xp ?? pokemonProgress.xp,
          currentHp: Math.max(0, toInt(myFinalSnapshot?.currentHp, myPokemon.current_hp)),
          movesJson: evolutionPayload?.movesJson ?? null,
          pokeId: evolutionPayload?.pokeId ?? null,
          ...(evolutionPayload?.nickname !== undefined ? { nickname: evolutionPayload.nickname } : {}),
        },
        connection,
      );

      await updatePlayerProgress(
        {
          jid: ownerJid,
          level: playerLevel,
          xp: playerXp,
          gold: playerGold,
        },
        connection,
      );

      for (const item of rewards.items || []) {
        if (!item?.key || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0) continue;
        await addInventoryItem(
          {
            ownerJid,
            itemKey: item.key,
            quantity: Number(item.quantity),
          },
          connection,
        );
      }
      const rewardItemNotices = (rewards.items || [])
        .filter((item) => item?.key && Number.isFinite(Number(item.quantity)) && Number(item.quantity) > 0)
        .map((item) => `🎁 Bônus: +${Number(item.quantity)} ${itemRewardLabel(item.key)}`);

      const mission = await applyMissionEvent({
        ownerJid,
        eventKey: MISSION_KEYS.WIN,
        connection,
      });

      await deleteBattleStateByOwner(ownerJid, connection);

      const finalBattleSnapshot = {
        ...updatedSnapshot,
        my: myFinalSnapshot,
      };

      const text = buildBattleTurnText({
        logs: [...turnResult.logs, ...rewardItemNotices, ...(mission.notices || [])],
        battleSnapshot: finalBattleSnapshot,
        prefix: commandPrefix,
        rewards,
        evolution: evolutionOutcome
          ? {
              fromName: evolutionOutcome.evolution.from.name,
              toName: evolutionOutcome.evolution.to.name,
            }
          : null,
      });

      const imageTarget = evolutionOutcome ? finalBattleSnapshot.my : finalBattleSnapshot.enemy;
      if (evolutionOutcome) {
        recordRpgEvolution();
      }

      return withPokemonImage({
        text,
        pokemonSnapshot: imageTarget,
        caption: evolutionOutcome
          ? `✨ ${finalBattleSnapshot.my.displayName} Lv.${finalBattleSnapshot.my.level}\nPróximo: ${commandPrefix}rpg explorar`
          : `🏆 ${finalBattleSnapshot.enemy.displayName} derrotado!\nPróximo: ${commandPrefix}rpg explorar`,
      });
    }

    if (winner === 'enemy') {
      await updatePlayerPokemonState(
        {
          id: myPokemon.id,
          ownerJid,
          level: myPokemon.level,
          xp: myPokemon.xp,
          currentHp: 0,
        },
        connection,
      );

      await deleteBattleStateByOwner(ownerJid, connection);

      const text = buildBattleTurnText({
        logs: turnResult.logs,
        battleSnapshot: updatedSnapshot,
        prefix: commandPrefix,
        rewards: null,
      });

      return withPokemonImage({
        text,
        pokemonSnapshot: updatedSnapshot.enemy || updatedSnapshot.my,
        caption: `⚔️ ${updatedSnapshot.enemy?.displayName || 'Inimigo'} Lv.${updatedSnapshot.enemy?.level || 1}\nSeu Pokémon desmaiou`,
      });
    }

    await updatePlayerPokemonState(
      {
        id: myPokemon.id,
        ownerJid,
        level: myPokemon.level,
        xp: myPokemon.xp,
        currentHp: Math.max(0, toInt(updatedSnapshot?.my?.currentHp, myPokemon.current_hp)),
      },
      connection,
    );

    await upsertBattleState(
      {
        chatJid: battleRow.chat_jid,
        ownerJid,
        myPokemonId: myPokemon.id,
        battleSnapshot: {
          ...updatedSnapshot,
          turn: toInt(battleRow.turn, 1) + 1,
        },
        turn: toInt(battleRow.turn, 1) + 1,
        expiresAt: nowPlusTtlDate(),
      },
      connection,
    );

    const text = buildBattleTurnText({
      logs: turnResult.logs,
      battleSnapshot: updatedSnapshot,
      prefix: commandPrefix,
      rewards: null,
    });

    return withPokemonImage({
      text,
      pokemonSnapshot: updatedSnapshot.enemy || updatedSnapshot.my,
      caption: `⚔️ ${updatedSnapshot.enemy?.displayName || 'Inimigo'} Lv.${updatedSnapshot.enemy?.level || 1}\nUse ${commandPrefix}rpg atacar`,
    });
  });
};

const createCapturedPokemon = async ({ ownerJid, enemySnapshot, connection }) => {
  return createPlayerPokemon(
    {
      ownerJid,
      pokeId: enemySnapshot.pokeId,
      nickname: enemySnapshot.displayName,
      level: enemySnapshot.level,
      xp: 0,
      currentHp: enemySnapshot.maxHp,
      ivsJson: enemySnapshot.ivs,
      movesJson: enemySnapshot.moves,
      isShiny: Boolean(enemySnapshot.isShiny),
      isActive: false,
    },
    connection,
  );
};

const requireInventoryItem = async ({ ownerJid, itemKey, connection }) => {
  const row = await getInventoryItemForUpdate(ownerJid, itemKey, connection);
  const quantity = toInt(row?.quantity, 0);
  if (quantity <= 0) return null;
  return { row, quantity };
};

const handleCapture = async ({ ownerJid, commandPrefix, itemKey = 'pokeball' }) => {
  return withTransaction(async (connection) => {
    await ensureNoExpiredBattle(ownerJid, connection);

    const battleRow = await getBattleStateByOwnerForUpdate(ownerJid, connection);
    if (!battleRow) {
      return { ok: true, text: buildNoBattleText(commandPrefix) };
    }

    const battleSnapshot = parseBattleSnapshot(battleRow);
    if (!battleSnapshot) {
      await deleteBattleStateByOwner(ownerJid, connection);
      return { ok: true, text: buildNoBattleText(commandPrefix) };
    }

    const myPokemon = await getPlayerPokemonByIdForUpdate(ownerJid, battleRow.my_pokemon_id, connection);
    if (!myPokemon) {
      await deleteBattleStateByOwner(ownerJid, connection);
      return { ok: true, text: buildNoBattleText(commandPrefix) };
    }

    const captureResult = resolveCaptureAttempt({ battleSnapshot });

    if (!captureResult.validAction) {
      const text = buildCaptureFailText({
        logs: captureResult.logs,
        battleSnapshot,
        prefix: commandPrefix,
      });
      return {
        ...withPokemonImage({
          text,
          pokemonSnapshot: battleSnapshot.enemy || battleSnapshot.my,
          caption: `🎯 ${battleSnapshot.enemy?.displayName || 'Alvo'} Lv.${battleSnapshot.enemy?.level || 1}\nUse ${commandPrefix}rpg atacar ou ${commandPrefix}rpg capturar`,
        }),
      };
    }

    const inventory = await requireInventoryItem({
      ownerJid,
      itemKey,
      connection,
    });

    if (!inventory) {
      return {
        ok: true,
        text: buildUseItemErrorText({ reason: 'no_item', prefix: commandPrefix }),
      };
    }

    const consumed = await consumeInventoryItem({
      ownerJid,
      itemKey,
      quantity: 1,
    }, connection);

    if (!consumed) {
      return {
        ok: true,
        text: buildUseItemErrorText({ reason: 'no_item', prefix: commandPrefix }),
      };
    }

    const updatedSnapshot = captureResult.snapshot;
    const pokeballLeft = Math.max(0, inventory.quantity - 1);

    if (captureResult.success) {
      const captured = await createCapturedPokemon({
        ownerJid,
        enemySnapshot: updatedSnapshot.enemy,
        connection,
      });

      await updatePlayerPokemonState(
        {
          id: myPokemon.id,
          ownerJid,
          level: myPokemon.level,
          xp: myPokemon.xp,
          currentHp: Math.max(0, toInt(updatedSnapshot?.my?.currentHp, myPokemon.current_hp)),
        },
        connection,
      );

      const mission = await applyMissionEvent({
        ownerJid,
        eventKey: MISSION_KEYS.CAPTURE,
        connection,
      });

      await deleteBattleStateByOwner(ownerJid, connection);
      recordRpgCapture();

      const text = buildCaptureSuccessText({
        capturedPokemon: {
          id: captured?.id,
          name: captured?.nickname || updatedSnapshot.enemy.displayName,
          displayName: captured?.nickname || updatedSnapshot.enemy.displayName,
          isShiny: Boolean(updatedSnapshot.enemy?.isShiny),
        },
        prefix: commandPrefix,
      }).concat(`\nPoke Bola restante: ${pokeballLeft}${mission.notices?.length ? `\n${mission.notices.join('\n')}` : ''}`);

      return withPokemonImage({
        text,
        pokemonSnapshot: updatedSnapshot.enemy,
        caption: `🎉 Capturou ${updatedSnapshot.enemy.displayName} Lv.${updatedSnapshot.enemy.level}!\nPróximos: ${commandPrefix}rpg time | ${commandPrefix}rpg explorar`,
      });
    }

    if (captureResult.winner === 'enemy') {
      await updatePlayerPokemonState(
        {
          id: myPokemon.id,
          ownerJid,
          level: myPokemon.level,
          xp: myPokemon.xp,
          currentHp: 0,
        },
        connection,
      );

      await deleteBattleStateByOwner(ownerJid, connection);

      const text = buildCaptureFailText({
        logs: [...captureResult.logs, `Poke Bola restante: ${pokeballLeft}`],
        battleSnapshot: updatedSnapshot,
        prefix: commandPrefix,
      });

      return withPokemonImage({
        text,
        pokemonSnapshot: updatedSnapshot.enemy || updatedSnapshot.my,
        caption: `🎯 ${updatedSnapshot.enemy?.displayName || 'Alvo'} Lv.${updatedSnapshot.enemy?.level || 1}\nA captura falhou`,
      });
    }

    await updatePlayerPokemonState(
      {
        id: myPokemon.id,
        ownerJid,
        level: myPokemon.level,
        xp: myPokemon.xp,
        currentHp: Math.max(0, toInt(updatedSnapshot?.my?.currentHp, myPokemon.current_hp)),
      },
      connection,
    );

    await upsertBattleState(
      {
        chatJid: battleRow.chat_jid,
        ownerJid,
        myPokemonId: myPokemon.id,
        battleSnapshot: {
          ...updatedSnapshot,
          turn: toInt(battleRow.turn, 1) + 1,
        },
        turn: toInt(battleRow.turn, 1) + 1,
        expiresAt: nowPlusTtlDate(),
      },
      connection,
    );

    const text = buildCaptureFailText({
      logs: [...captureResult.logs, `Poke Bola restante: ${pokeballLeft}`],
      battleSnapshot: updatedSnapshot,
      prefix: commandPrefix,
    });

    return withPokemonImage({
      text,
      pokemonSnapshot: updatedSnapshot.enemy || updatedSnapshot.my,
      caption: `🎯 ${updatedSnapshot.enemy?.displayName || 'Alvo'} Lv.${updatedSnapshot.enemy?.level || 1}\nUse ${commandPrefix}rpg atacar ou ${commandPrefix}rpg capturar`,
    });
  });
};

const resolvePotionHealAmount = (itemKey) => {
  if (itemKey === 'superpotion') return SUPER_POTION_HEAL_HP;
  return POTION_HEAL_HP;
};

const handleUsePotion = async ({ ownerJid, commandPrefix, itemKey }) => {
  return withTransaction(async (connection) => {
    const player = await getPlayerByJidForUpdate(ownerJid, connection);
    if (!player) {
      return { ok: true, text: buildNeedStartText(commandPrefix) };
    }

    const activePokemon = await getActivePlayerPokemonForUpdate(ownerJid, connection);
    if (!activePokemon) {
      return { ok: true, text: buildUseItemErrorText({ reason: 'no_active_pokemon', prefix: commandPrefix }) };
    }

    const activeSnapshot = await buildPlayerBattleSnapshot({ playerPokemonRow: activePokemon });
    const maxHp = Math.max(1, toInt(activeSnapshot.maxHp, activePokemon.current_hp || 1));
    const currentHp = clamp(toInt(activePokemon.current_hp, 0), 0, maxHp);

    if (currentHp >= maxHp) {
      return {
        ok: true,
        text: buildUseItemErrorText({ reason: 'full_hp', prefix: commandPrefix }),
      };
    }

    const inventory = await requireInventoryItem({ ownerJid, itemKey, connection });
    if (!inventory) {
      return {
        ok: true,
        text: buildUseItemErrorText({ reason: 'no_item', prefix: commandPrefix }),
      };
    }

    const healAmount = resolvePotionHealAmount(itemKey);
    const healedHp = clamp(currentHp + healAmount, 0, maxHp);
    const healedAmount = healedHp - currentHp;

    const consumed = await consumeInventoryItem({ ownerJid, itemKey, quantity: 1 }, connection);
    if (!consumed) {
      return {
        ok: true,
        text: buildUseItemErrorText({ reason: 'no_item', prefix: commandPrefix }),
      };
    }

    await updatePlayerPokemonState(
      {
        id: activePokemon.id,
        ownerJid,
        level: activePokemon.level,
        xp: activePokemon.xp,
        currentHp: healedHp,
      },
      connection,
    );

    const battleRow = await getBattleStateByOwnerForUpdate(ownerJid, connection);
    if (battleRow) {
      const battleSnapshot = parseBattleSnapshot(battleRow);
      if (battleSnapshot?.my) {
        const nextSnapshot = {
          ...battleSnapshot,
          my: {
            ...battleSnapshot.my,
            currentHp: healedHp,
            maxHp,
          },
        };

        await upsertBattleState(
          {
            chatJid: battleRow.chat_jid,
            ownerJid,
            myPokemonId: activePokemon.id,
            battleSnapshot: nextSnapshot,
            turn: toInt(battleRow.turn, 1),
            expiresAt: nowPlusTtlDate(),
          },
          connection,
        );
      }
    }

    const item = SHOP_INDEX.get(itemKey);
    return {
      ok: true,
      text: buildUsePotionSuccessText({
        itemLabel: item?.label || itemKey,
        healedAmount,
        pokemonName: activePokemon.nickname || activeSnapshot.displayName,
        currentHp: healedHp,
        maxHp,
        quantityLeft: Math.max(0, inventory.quantity - 1),
        prefix: commandPrefix,
      }),
    };
  });
};

const handleUse = async ({ ownerJid, commandPrefix, itemToken }) => {
  const normalizedItem = normalizeItemToken(itemToken);
  if (!normalizedItem) {
    return { ok: true, text: buildUseItemUsageText(commandPrefix) };
  }

  if (!SHOP_INDEX.has(normalizedItem)) {
    return { ok: true, text: buildUseItemErrorText({ reason: 'invalid_item', prefix: commandPrefix }) };
  }

  if (normalizedItem === 'pokeball') {
    const battle = await getBattleStateByOwner(ownerJid);
    if (!battle) {
      return { ok: true, text: buildUseItemErrorText({ reason: 'no_battle_for_pokeball', prefix: commandPrefix }) };
    }
    return handleCapture({ ownerJid, commandPrefix, itemKey: 'pokeball' });
  }

  if (normalizedItem === 'potion' || normalizedItem === 'superpotion') {
    return handleUsePotion({ ownerJid, commandPrefix, itemKey: normalizedItem });
  }

  return { ok: true, text: buildUseItemErrorText({ reason: 'invalid_item', prefix: commandPrefix }) };
};

const toMissionView = ({ progress, target, claimedAt }) => {
  const normalized = normalizeMissionProgress(progress);
  return {
    explorar: normalized[MISSION_KEYS.EXPLORE],
    vitorias: normalized[MISSION_KEYS.WIN],
    capturas: normalized[MISSION_KEYS.CAPTURE],
    target: {
      explorar: target[MISSION_KEYS.EXPLORE],
      vitorias: target[MISSION_KEYS.WIN],
      capturas: target[MISSION_KEYS.CAPTURE],
    },
    completed: isMissionCompleted(normalized, target),
    claimed: Boolean(claimedAt),
  };
};

const handleBag = async ({ ownerJid, commandPrefix }) => {
  const player = await getPlayerByJid(ownerJid);
  if (!player) {
    return { ok: true, text: buildNeedStartText(commandPrefix) };
  }

  const items = await getInventoryItems(ownerJid);
  const labelMap = new Map(SHOP_ITEMS.map((item) => [item.key, item.label]));
  const formattedItems = items
    .filter((item) => toInt(item.quantity, 0) > 0)
    .map((item) => ({
      key: item.item_key,
      label: labelMap.get(item.item_key) || item.item_key,
      quantity: toInt(item.quantity, 0),
    }));

  return {
    ok: true,
    text: buildBagText({
      items: formattedItems,
      gold: toInt(player.gold, 0),
      prefix: commandPrefix,
    }),
  };
};

const handleMissions = async ({ ownerJid, commandPrefix }) => {
  const player = await getPlayerByJid(ownerJid);
  if (!player) {
    return { ok: true, text: buildNeedStartText(commandPrefix) };
  }

  return withTransaction(async (connection) => {
    const mission = await ensureMissionStateForUpdate({ ownerJid, connection });
    const daily = toMissionView({
      progress: mission.daily_progress_json,
      target: DAILY_MISSION_TARGET,
      claimedAt: mission.daily_claimed_at,
    });
    const weekly = toMissionView({
      progress: mission.weekly_progress_json,
      target: WEEKLY_MISSION_TARGET,
      claimedAt: mission.weekly_claimed_at,
    });

    return {
      ok: true,
      text: buildMissionsText({
        daily,
        weekly,
        prefix: commandPrefix,
      }),
    };
  });
};

const handleFlee = async ({ ownerJid, commandPrefix }) => {
  return withTransaction(async (connection) => {
    await ensureNoExpiredBattle(ownerJid, connection);
    const battleRow = await getBattleStateByOwnerForUpdate(ownerJid, connection);
    if (!battleRow) {
      return { ok: true, text: buildNoBattleText(commandPrefix) };
    }

    await deleteBattleStateByOwner(ownerJid, connection);
    return { ok: true, text: buildFleeText(commandPrefix) };
  });
};

const handleShop = async ({ ownerJid, commandPrefix }) => {
  const player = await getPlayerByJid(ownerJid);
  if (!player) {
    return { ok: true, text: buildNeedStartText(commandPrefix) };
  }

  return {
    ok: true,
    text: buildShopText({ items: SHOP_ITEMS, prefix: commandPrefix }),
  };
};

const handleBuy = async ({ ownerJid, itemKey, quantity, commandPrefix }) => {
  const normalizedItem = String(itemKey || '').trim().toLowerCase();
  const parsedQty = toInt(quantity, NaN);

  if (!SHOP_INDEX.has(normalizedItem)) {
    return { ok: true, text: buildBuyErrorText({ reason: 'invalid_item', prefix: commandPrefix }) };
  }

  if (!Number.isFinite(parsedQty) || parsedQty <= 0 || parsedQty > 99) {
    return { ok: true, text: buildBuyErrorText({ reason: 'invalid_quantity', prefix: commandPrefix }) };
  }

  const item = SHOP_INDEX.get(normalizedItem);

  return withTransaction(async (connection) => {
    const player = await getPlayerByJidForUpdate(ownerJid, connection);
    if (!player) {
      return { ok: true, text: buildNeedStartText(commandPrefix) };
    }

    const totalPrice = item.price * parsedQty;
    const currentGold = toInt(player.gold, 0);

    if (currentGold < totalPrice) {
      return {
        ok: true,
        text: buildBuyErrorText({ reason: 'not_enough_gold', prefix: commandPrefix }),
      };
    }

    const nextGold = Math.max(0, currentGold - totalPrice);
    await updatePlayerGoldOnly({ jid: ownerJid, gold: nextGold }, connection);
    await addInventoryItem({ ownerJid, itemKey: item.key, quantity: parsedQty }, connection);

    return {
      ok: true,
      text: buildBuySuccessText({
        item,
        quantity: parsedQty,
        totalPrice,
        goldLeft: nextGold,
        prefix: commandPrefix,
      }),
    };
  });
};

export const executeRpgPokemonAction = async ({
  ownerJid,
  chatJid,
  action,
  actionArgs = [],
  commandPrefix = '/',
}) => {
  try {
    const normalizedAction = String(action || '').toLowerCase();

    if (shouldApplyCooldown(normalizedAction)) {
      const cooldownLeft = getCooldownSecondsLeft(ownerJid);
      if (cooldownLeft > 0) {
        return {
          ok: true,
          text: buildCooldownText({
            secondsLeft: cooldownLeft,
            prefix: commandPrefix,
          }),
        };
      }
    }

    let result;

    switch (normalizedAction) {
      case 'start':
        result = await handleStart({ ownerJid, commandPrefix });
        break;

      case 'perfil':
        result = await handleProfile({ ownerJid, commandPrefix });
        break;

      case 'explorar':
        result = await handleExplore({ ownerJid, chatJid, commandPrefix });
        break;

      case 'ginasio':
      case 'ginásio':
        result = await handleGym({ ownerJid, chatJid, commandPrefix });
        break;

      case 'atacar':
        result = await handleAttack({ ownerJid, moveSlot: actionArgs?.[0], commandPrefix });
        break;

      case 'capturar':
        result = await handleCapture({ ownerJid, commandPrefix, itemKey: 'pokeball' });
        break;

      case 'fugir':
        result = await handleFlee({ ownerJid, commandPrefix });
        break;

      case 'time':
        result = await handleTeam({ ownerJid, commandPrefix });
        break;

      case 'bolsa':
        result = await handleBag({ ownerJid, commandPrefix });
        break;

      case 'missoes':
      case 'missões':
        result = await handleMissions({ ownerJid, commandPrefix });
        break;

      case 'escolher':
        result = await handleChoose({ ownerJid, selectedPokemonId: actionArgs?.[0], commandPrefix });
        break;

      case 'loja':
        result = await handleShop({ ownerJid, commandPrefix });
        break;

      case 'comprar':
        result = await handleBuy({
          ownerJid,
          itemKey: actionArgs?.[0],
          quantity: actionArgs?.[1],
          commandPrefix,
        });
        break;

      case 'usar':
        result = await handleUse({
          ownerJid,
          commandPrefix,
          itemToken: actionArgs?.[0],
        });
        break;

      default:
        result = {
          ok: true,
          text: buildNeedStartText(commandPrefix),
        };
        break;
    }

    if (result?.ok && shouldApplyCooldown(normalizedAction) && normalizedAction !== 'perfil' && normalizedAction !== 'time' && normalizedAction !== 'loja') {
      touchCooldown(ownerJid);
    }

    return result;
  } catch (error) {
    logger.error('Erro ao executar ação RPG Pokemon.', {
      ownerJid,
      action,
      error: error.message,
    });

    return {
      ok: false,
      text: buildGenericErrorText(commandPrefix),
    };
  }
};
