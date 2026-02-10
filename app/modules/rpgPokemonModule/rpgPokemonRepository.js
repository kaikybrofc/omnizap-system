import { executeQuery, TABLES } from '../../../database/index.js';

const PLAYER_COLUMNS = 'jid, level, xp, gold, created_at, updated_at';
const PLAYER_POKEMON_COLUMNS =
  'id, owner_jid, poke_id, nickname, level, xp, current_hp, ivs_json, moves_json, nature_key, ability_key, ability_name, is_shiny, is_active, created_at';
const BATTLE_COLUMNS = 'chat_jid, owner_jid, my_pokemon_id, enemy_snapshot_json, turn, expires_at, created_at, updated_at';

const parseJson = (value, fallback) => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const normalizePlayerPokemon = (row) => {
  if (!row) return null;
  return {
    ...row,
    ivs_json: parseJson(row.ivs_json, {}),
    moves_json: parseJson(row.moves_json, []),
    is_shiny: Number(row.is_shiny) === 1,
    is_active: Number(row.is_active) === 1,
    level: Number(row.level || 1),
    xp: Number(row.xp || 0),
    current_hp: Number(row.current_hp || 0),
    poke_id: Number(row.poke_id || 0),
    nature_key: row.nature_key || null,
    ability_key: row.ability_key || null,
    ability_name: row.ability_name || null,
  };
};

const normalizeBattle = (row) => {
  if (!row) return null;
  return {
    ...row,
    turn: Number(row.turn || 1),
    enemy_snapshot_json: parseJson(row.enemy_snapshot_json, {}),
  };
};

const normalizeRaidState = (row) => {
  if (!row) return null;
  return {
    ...row,
    boss_snapshot_json: parseJson(row.boss_snapshot_json, {}),
    max_hp: Number(row.max_hp || 0),
    current_hp: Number(row.current_hp || 0),
  };
};

const normalizePvpChallenge = (row) => {
  if (!row) return null;
  return {
    ...row,
    battle_snapshot_json: parseJson(row.battle_snapshot_json, {}),
  };
};

export const getPlayerByJid = async (jid, connection = null) => {
  const rows = await executeQuery(
    `SELECT ${PLAYER_COLUMNS}
       FROM ${TABLES.RPG_PLAYER}
      WHERE jid = ?
      LIMIT 1`,
    [jid],
    connection,
  );

  return rows?.[0] || null;
};

export const getPlayerByJidForUpdate = async (jid, connection) => {
  const rows = await executeQuery(
    `SELECT ${PLAYER_COLUMNS}
       FROM ${TABLES.RPG_PLAYER}
      WHERE jid = ?
      LIMIT 1
      FOR UPDATE`,
    [jid],
    connection,
  );

  return rows?.[0] || null;
};

export const createPlayer = async ({ jid, level = 1, xp = 0, gold = 200 }, connection = null) => {
  await executeQuery(
    `INSERT INTO ${TABLES.RPG_PLAYER} (jid, level, xp, gold)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE jid = VALUES(jid)`,
    [jid, level, xp, gold],
    connection,
  );

  return getPlayerByJid(jid, connection);
};

export const updatePlayerProgress = async ({ jid, level, xp, gold }, connection = null) => {
  await executeQuery(
    `UPDATE ${TABLES.RPG_PLAYER}
        SET level = ?,
            xp = ?,
            gold = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE jid = ?`,
    [level, xp, gold, jid],
    connection,
  );
};

export const updatePlayerGoldOnly = async ({ jid, gold }, connection = null) => {
  await executeQuery(
    `UPDATE ${TABLES.RPG_PLAYER}
        SET gold = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE jid = ?`,
    [gold, jid],
    connection,
  );
};

export const createPlayerPokemon = async (
  {
    ownerJid,
    pokeId,
    nickname = null,
    level = 5,
    xp = 0,
    currentHp,
    ivsJson,
    movesJson,
    natureKey = null,
    abilityKey = null,
    abilityName = null,
    isShiny = false,
    isActive = false,
  },
  connection = null,
) => {
  const result = await executeQuery(
    `INSERT INTO ${TABLES.RPG_PLAYER_POKEMON}
      (owner_jid, poke_id, nickname, level, xp, current_hp, ivs_json, moves_json, nature_key, ability_key, ability_name, is_shiny, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ownerJid,
      pokeId,
      nickname,
      level,
      xp,
      currentHp,
      JSON.stringify(ivsJson || {}),
      JSON.stringify(movesJson || []),
      natureKey,
      abilityKey,
      abilityName,
      isShiny ? 1 : 0,
      isActive ? 1 : 0,
    ],
    connection,
  );

  const insertedId = Number(result?.insertId || 0);
  if (!insertedId) return null;
  return getPlayerPokemonById(ownerJid, insertedId, connection);
};

export const listPlayerPokemons = async (ownerJid, connection = null) => {
  const rows = await executeQuery(
    `SELECT ${PLAYER_POKEMON_COLUMNS}
       FROM ${TABLES.RPG_PLAYER_POKEMON}
      WHERE owner_jid = ?
      ORDER BY is_active DESC, level DESC, id ASC`,
    [ownerJid],
    connection,
  );

  return (rows || []).map(normalizePlayerPokemon);
};

export const getPlayerPokemonById = async (ownerJid, pokemonId, connection = null) => {
  const rows = await executeQuery(
    `SELECT ${PLAYER_POKEMON_COLUMNS}
       FROM ${TABLES.RPG_PLAYER_POKEMON}
      WHERE owner_jid = ?
        AND id = ?
      LIMIT 1`,
    [ownerJid, pokemonId],
    connection,
  );

  return normalizePlayerPokemon(rows?.[0] || null);
};

export const getPlayerPokemonByIdForUpdate = async (ownerJid, pokemonId, connection) => {
  const rows = await executeQuery(
    `SELECT ${PLAYER_POKEMON_COLUMNS}
       FROM ${TABLES.RPG_PLAYER_POKEMON}
      WHERE owner_jid = ?
        AND id = ?
      LIMIT 1
      FOR UPDATE`,
    [ownerJid, pokemonId],
    connection,
  );

  return normalizePlayerPokemon(rows?.[0] || null);
};

export const getActivePlayerPokemon = async (ownerJid, connection = null) => {
  const rows = await executeQuery(
    `SELECT ${PLAYER_POKEMON_COLUMNS}
       FROM ${TABLES.RPG_PLAYER_POKEMON}
      WHERE owner_jid = ?
        AND is_active = 1
      ORDER BY id ASC
      LIMIT 1`,
    [ownerJid],
    connection,
  );

  return normalizePlayerPokemon(rows?.[0] || null);
};

export const getActivePlayerPokemonForUpdate = async (ownerJid, connection) => {
  const rows = await executeQuery(
    `SELECT ${PLAYER_POKEMON_COLUMNS}
       FROM ${TABLES.RPG_PLAYER_POKEMON}
      WHERE owner_jid = ?
        AND is_active = 1
      ORDER BY id ASC
      LIMIT 1
      FOR UPDATE`,
    [ownerJid],
    connection,
  );

  return normalizePlayerPokemon(rows?.[0] || null);
};

export const setActivePokemon = async (ownerJid, pokemonId, connection = null) => {
  await executeQuery(
    `UPDATE ${TABLES.RPG_PLAYER_POKEMON}
        SET is_active = 0
      WHERE owner_jid = ?`,
    [ownerJid],
    connection,
  );

  const result = await executeQuery(
    `UPDATE ${TABLES.RPG_PLAYER_POKEMON}
        SET is_active = 1
      WHERE owner_jid = ?
        AND id = ?`,
    [ownerJid, pokemonId],
    connection,
  );

  return Number(result?.affectedRows || 0) > 0;
};

export const updatePlayerPokemonState = async (
  {
    id,
    ownerJid,
    level,
    xp,
    currentHp,
    movesJson = null,
    pokeId = null,
    nickname,
    isShiny,
    natureKey,
    abilityKey,
    abilityName,
  },
  connection = null,
) => {
  const fields = ['level = ?', 'xp = ?', 'current_hp = ?'];
  const params = [level, xp, currentHp];

  if (movesJson !== null) {
    fields.push('moves_json = ?');
    params.push(JSON.stringify(movesJson || []));
  }

  if (Number.isFinite(Number(pokeId)) && Number(pokeId) > 0) {
    fields.push('poke_id = ?');
    params.push(Number(pokeId));
  }

  if (nickname !== undefined) {
    fields.push('nickname = ?');
    params.push(nickname ?? null);
  }

  if (isShiny !== undefined) {
    fields.push('is_shiny = ?');
    params.push(isShiny ? 1 : 0);
  }

  if (natureKey !== undefined) {
    fields.push('nature_key = ?');
    params.push(natureKey ?? null);
  }

  if (abilityKey !== undefined) {
    fields.push('ability_key = ?');
    params.push(abilityKey ?? null);
  }

  if (abilityName !== undefined) {
    fields.push('ability_name = ?');
    params.push(abilityName ?? null);
  }

  params.push(id, ownerJid);

  await executeQuery(
    `UPDATE ${TABLES.RPG_PLAYER_POKEMON}
        SET ${fields.join(', ')}
      WHERE id = ?
        AND owner_jid = ?`,
    params,
    connection,
  );
};

export const deleteExpiredBattleStatesByOwner = async (ownerJid, connection = null) => {
  const result = await executeQuery(
    `DELETE FROM ${TABLES.RPG_BATTLE_STATE}
      WHERE owner_jid = ?
        AND expires_at <= UTC_TIMESTAMP()`,
    [ownerJid],
    connection,
  );

  return Number(result?.affectedRows || 0);
};

export const getBattleStateByOwner = async (ownerJid, connection = null) => {
  const rows = await executeQuery(
    `SELECT ${BATTLE_COLUMNS}
       FROM ${TABLES.RPG_BATTLE_STATE}
      WHERE owner_jid = ?
      LIMIT 1`,
    [ownerJid],
    connection,
  );

  return normalizeBattle(rows?.[0] || null);
};

export const getBattleStateByOwnerForUpdate = async (ownerJid, connection) => {
  const rows = await executeQuery(
    `SELECT ${BATTLE_COLUMNS}
       FROM ${TABLES.RPG_BATTLE_STATE}
      WHERE owner_jid = ?
      LIMIT 1
      FOR UPDATE`,
    [ownerJid],
    connection,
  );

  return normalizeBattle(rows?.[0] || null);
};

export const upsertBattleState = async (
  { chatJid, ownerJid, myPokemonId, battleSnapshot, turn = 1, expiresAt },
  connection = null,
) => {
  await executeQuery(
    `INSERT INTO ${TABLES.RPG_BATTLE_STATE}
      (chat_jid, owner_jid, my_pokemon_id, enemy_snapshot_json, turn, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      chat_jid = VALUES(chat_jid),
      owner_jid = VALUES(owner_jid),
      my_pokemon_id = VALUES(my_pokemon_id),
      enemy_snapshot_json = VALUES(enemy_snapshot_json),
      turn = VALUES(turn),
      expires_at = VALUES(expires_at),
      updated_at = CURRENT_TIMESTAMP`,
    [chatJid, ownerJid, myPokemonId, JSON.stringify(battleSnapshot || {}), turn, expiresAt],
    connection,
  );
};

export const deleteBattleStateByOwner = async (ownerJid, connection = null) => {
  await executeQuery(
    `DELETE FROM ${TABLES.RPG_BATTLE_STATE}
      WHERE owner_jid = ?`,
    [ownerJid],
    connection,
  );
};

export const getInventoryItems = async (ownerJid, connection = null) => {
  const rows = await executeQuery(
    `SELECT owner_jid, item_key, quantity, created_at, updated_at
       FROM ${TABLES.RPG_PLAYER_INVENTORY}
      WHERE owner_jid = ?
      ORDER BY item_key ASC`,
    [ownerJid],
    connection,
  );

  return (rows || []).map((row) => ({
    ...row,
    quantity: Number(row.quantity || 0),
  }));
};

export const getInventoryItem = async (ownerJid, itemKey, connection = null) => {
  const rows = await executeQuery(
    `SELECT owner_jid, item_key, quantity, created_at, updated_at
       FROM ${TABLES.RPG_PLAYER_INVENTORY}
      WHERE owner_jid = ?
        AND item_key = ?
      LIMIT 1`,
    [ownerJid, itemKey],
    connection,
  );

  const row = rows?.[0] || null;
  if (!row) return null;
  return {
    ...row,
    quantity: Number(row.quantity || 0),
  };
};

export const getInventoryItemForUpdate = async (ownerJid, itemKey, connection) => {
  const rows = await executeQuery(
    `SELECT owner_jid, item_key, quantity, created_at, updated_at
       FROM ${TABLES.RPG_PLAYER_INVENTORY}
      WHERE owner_jid = ?
        AND item_key = ?
      LIMIT 1
      FOR UPDATE`,
    [ownerJid, itemKey],
    connection,
  );

  const row = rows?.[0] || null;
  if (!row) return null;
  return {
    ...row,
    quantity: Number(row.quantity || 0),
  };
};

export const addInventoryItem = async ({ ownerJid, itemKey, quantity }, connection = null) => {
  await executeQuery(
    `INSERT INTO ${TABLES.RPG_PLAYER_INVENTORY} (owner_jid, item_key, quantity)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity), updated_at = CURRENT_TIMESTAMP`,
    [ownerJid, itemKey, quantity],
    connection,
  );
};

export const consumeInventoryItem = async ({ ownerJid, itemKey, quantity }, connection = null) => {
  const safeQty = Number(quantity);
  if (!Number.isFinite(safeQty) || safeQty <= 0) return false;

  const result = await executeQuery(
    `UPDATE ${TABLES.RPG_PLAYER_INVENTORY}
        SET quantity = quantity - ?
      WHERE owner_jid = ?
        AND item_key = ?
        AND quantity >= ?`,
    [safeQty, ownerJid, itemKey, safeQty],
    connection,
  );

  const consumed = Number(result?.affectedRows || 0) > 0;
  if (!consumed) return false;

  await executeQuery(
    `DELETE FROM ${TABLES.RPG_PLAYER_INVENTORY}
      WHERE owner_jid = ?
        AND item_key = ?
        AND quantity <= 0`,
    [ownerJid, itemKey],
    connection,
  );

  return true;
};

export const getGroupBiomeByJid = async (groupJid, connection = null) => {
  const rows = await executeQuery(
    `SELECT group_jid, biome_key, created_at, updated_at
       FROM ${TABLES.RPG_GROUP_BIOME}
      WHERE group_jid = ?
      LIMIT 1`,
    [groupJid],
    connection,
  );

  return rows?.[0] || null;
};

export const upsertGroupBiome = async ({ groupJid, biomeKey }, connection = null) => {
  await executeQuery(
    `INSERT INTO ${TABLES.RPG_GROUP_BIOME} (group_jid, biome_key)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE biome_key = VALUES(biome_key), updated_at = CURRENT_TIMESTAMP`,
    [groupJid, biomeKey],
    connection,
  );
};

const MISSION_COLUMNS =
  'owner_jid, daily_ref_date, daily_progress_json, daily_claimed_at, weekly_ref_date, weekly_progress_json, weekly_claimed_at, created_at, updated_at';

const normalizeMissionRow = (row) => {
  if (!row) return null;
  return {
    ...row,
    daily_progress_json: parseJson(row.daily_progress_json, {}),
    weekly_progress_json: parseJson(row.weekly_progress_json, {}),
  };
};

export const getMissionProgressByOwner = async (ownerJid, connection = null) => {
  const rows = await executeQuery(
    `SELECT ${MISSION_COLUMNS}
       FROM ${TABLES.RPG_PLAYER_MISSION_PROGRESS}
      WHERE owner_jid = ?
      LIMIT 1`,
    [ownerJid],
    connection,
  );

  return normalizeMissionRow(rows?.[0] || null);
};

export const getMissionProgressByOwnerForUpdate = async (ownerJid, connection) => {
  const rows = await executeQuery(
    `SELECT ${MISSION_COLUMNS}
       FROM ${TABLES.RPG_PLAYER_MISSION_PROGRESS}
      WHERE owner_jid = ?
      LIMIT 1
      FOR UPDATE`,
    [ownerJid],
    connection,
  );

  return normalizeMissionRow(rows?.[0] || null);
};

export const createMissionProgress = async (
  { ownerJid, dailyRefDate, dailyProgressJson, weeklyRefDate, weeklyProgressJson },
  connection = null,
) => {
  await executeQuery(
    `INSERT INTO ${TABLES.RPG_PLAYER_MISSION_PROGRESS}
      (owner_jid, daily_ref_date, daily_progress_json, daily_claimed_at, weekly_ref_date, weekly_progress_json, weekly_claimed_at)
     VALUES (?, ?, ?, NULL, ?, ?, NULL)
     ON DUPLICATE KEY UPDATE owner_jid = VALUES(owner_jid)`,
    [ownerJid, dailyRefDate, JSON.stringify(dailyProgressJson || {}), weeklyRefDate, JSON.stringify(weeklyProgressJson || {})],
    connection,
  );

  return getMissionProgressByOwner(ownerJid, connection);
};

export const updateMissionProgress = async (
  {
    ownerJid,
    dailyRefDate,
    dailyProgressJson,
    dailyClaimedAt,
    weeklyRefDate,
    weeklyProgressJson,
    weeklyClaimedAt,
  },
  connection = null,
) => {
  await executeQuery(
    `UPDATE ${TABLES.RPG_PLAYER_MISSION_PROGRESS}
        SET daily_ref_date = ?,
            daily_progress_json = ?,
            daily_claimed_at = ?,
            weekly_ref_date = ?,
            weekly_progress_json = ?,
            weekly_claimed_at = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE owner_jid = ?`,
    [
      dailyRefDate,
      JSON.stringify(dailyProgressJson || {}),
      dailyClaimedAt || null,
      weeklyRefDate,
      JSON.stringify(weeklyProgressJson || {}),
      weeklyClaimedAt || null,
      ownerJid,
    ],
    connection,
  );
};

export const upsertPokedexEntry = async ({ ownerJid, pokeId }, connection = null) => {
  const result = await executeQuery(
    `INSERT IGNORE INTO ${TABLES.RPG_PLAYER_POKEDEX} (owner_jid, poke_id)
     VALUES (?, ?)`,
    [ownerJid, pokeId],
    connection,
  );

  return Number(result?.affectedRows || 0) > 0;
};

export const countPokedexEntries = async (ownerJid, connection = null) => {
  const rows = await executeQuery(
    `SELECT COUNT(*) AS total
       FROM ${TABLES.RPG_PLAYER_POKEDEX}
      WHERE owner_jid = ?`,
    [ownerJid],
    connection,
  );

  return Number(rows?.[0]?.total || 0);
};

export const listPokedexEntries = async (ownerJid, limit = 12, connection = null) => {
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 12));
  const rows = await executeQuery(
    `SELECT owner_jid, poke_id, first_captured_at
       FROM ${TABLES.RPG_PLAYER_POKEDEX}
      WHERE owner_jid = ?
      ORDER BY first_captured_at DESC
      LIMIT ${safeLimit}`,
    [ownerJid],
    connection,
  );

  return (rows || []).map((row) => ({
    ...row,
    poke_id: Number(row.poke_id || 0),
  }));
};

export const getTravelStateByOwner = async (ownerJid, connection = null) => {
  const rows = await executeQuery(
    `SELECT owner_jid, region_key, location_key, location_area_key, created_at, updated_at
       FROM ${TABLES.RPG_PLAYER_TRAVEL}
      WHERE owner_jid = ?
      LIMIT 1`,
    [ownerJid],
    connection,
  );

  return rows?.[0] || null;
};

export const getTravelStateByOwnerForUpdate = async (ownerJid, connection) => {
  const rows = await executeQuery(
    `SELECT owner_jid, region_key, location_key, location_area_key, created_at, updated_at
       FROM ${TABLES.RPG_PLAYER_TRAVEL}
      WHERE owner_jid = ?
      LIMIT 1
      FOR UPDATE`,
    [ownerJid],
    connection,
  );

  return rows?.[0] || null;
};

export const upsertTravelState = async ({ ownerJid, regionKey = null, locationKey = null, locationAreaKey = null }, connection = null) => {
  await executeQuery(
    `INSERT INTO ${TABLES.RPG_PLAYER_TRAVEL} (owner_jid, region_key, location_key, location_area_key)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      region_key = VALUES(region_key),
      location_key = VALUES(location_key),
      location_area_key = VALUES(location_area_key),
      updated_at = CURRENT_TIMESTAMP`,
    [ownerJid, regionKey, locationKey, locationAreaKey],
    connection,
  );
};

export const getRaidStateByChat = async (chatJid, connection = null) => {
  const rows = await executeQuery(
    `SELECT chat_jid, created_by_jid, biome_key, boss_snapshot_json, max_hp, current_hp, started_at, ends_at, created_at, updated_at
       FROM ${TABLES.RPG_RAID_STATE}
      WHERE chat_jid = ?
      LIMIT 1`,
    [chatJid],
    connection,
  );

  return normalizeRaidState(rows?.[0] || null);
};

export const getRaidStateByChatForUpdate = async (chatJid, connection) => {
  const rows = await executeQuery(
    `SELECT chat_jid, created_by_jid, biome_key, boss_snapshot_json, max_hp, current_hp, started_at, ends_at, created_at, updated_at
       FROM ${TABLES.RPG_RAID_STATE}
      WHERE chat_jid = ?
      LIMIT 1
      FOR UPDATE`,
    [chatJid],
    connection,
  );

  return normalizeRaidState(rows?.[0] || null);
};

export const upsertRaidState = async (
  { chatJid, createdByJid, biomeKey = null, bossSnapshot, maxHp, currentHp, startedAt, endsAt },
  connection = null,
) => {
  await executeQuery(
    `INSERT INTO ${TABLES.RPG_RAID_STATE}
      (chat_jid, created_by_jid, biome_key, boss_snapshot_json, max_hp, current_hp, started_at, ends_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      created_by_jid = VALUES(created_by_jid),
      biome_key = VALUES(biome_key),
      boss_snapshot_json = VALUES(boss_snapshot_json),
      max_hp = VALUES(max_hp),
      current_hp = VALUES(current_hp),
      started_at = VALUES(started_at),
      ends_at = VALUES(ends_at),
      updated_at = CURRENT_TIMESTAMP`,
    [chatJid, createdByJid, biomeKey, JSON.stringify(bossSnapshot || {}), maxHp, currentHp, startedAt, endsAt],
    connection,
  );
};

export const deleteRaidStateByChat = async (chatJid, connection = null) => {
  await executeQuery(
    `DELETE FROM ${TABLES.RPG_RAID_STATE}
      WHERE chat_jid = ?`,
    [chatJid],
    connection,
  );
};

export const deleteExpiredRaidStates = async (connection = null) => {
  const result = await executeQuery(
    `DELETE FROM ${TABLES.RPG_RAID_STATE}
      WHERE ends_at <= UTC_TIMESTAMP()`,
    [],
    connection,
  );
  return Number(result?.affectedRows || 0);
};

export const upsertRaidParticipant = async ({ chatJid, ownerJid }, connection = null) => {
  await executeQuery(
    `INSERT INTO ${TABLES.RPG_RAID_PARTICIPANT} (chat_jid, owner_jid, total_damage)
     VALUES (?, ?, 0)
     ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP`,
    [chatJid, ownerJid],
    connection,
  );
};

export const addRaidParticipantDamage = async ({ chatJid, ownerJid, damage }, connection = null) => {
  await executeQuery(
    `INSERT INTO ${TABLES.RPG_RAID_PARTICIPANT} (chat_jid, owner_jid, total_damage)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE total_damage = total_damage + VALUES(total_damage), updated_at = CURRENT_TIMESTAMP`,
    [chatJid, ownerJid, Math.max(0, Number(damage) || 0)],
    connection,
  );
};

export const listRaidParticipants = async (chatJid, connection = null) => {
  const rows = await executeQuery(
    `SELECT chat_jid, owner_jid, total_damage, joined_at, updated_at
       FROM ${TABLES.RPG_RAID_PARTICIPANT}
      WHERE chat_jid = ?
      ORDER BY total_damage DESC, joined_at ASC`,
    [chatJid],
    connection,
  );

  return (rows || []).map((row) => ({
    ...row,
    total_damage: Number(row.total_damage || 0),
  }));
};

export const getRaidParticipant = async (chatJid, ownerJid, connection = null) => {
  const rows = await executeQuery(
    `SELECT chat_jid, owner_jid, total_damage, joined_at, updated_at
       FROM ${TABLES.RPG_RAID_PARTICIPANT}
      WHERE chat_jid = ?
        AND owner_jid = ?
      LIMIT 1`,
    [chatJid, ownerJid],
    connection,
  );

  const row = rows?.[0] || null;
  if (!row) return null;
  return {
    ...row,
    total_damage: Number(row.total_damage || 0),
  };
};

export const deleteRaidParticipantsByChat = async (chatJid, connection = null) => {
  await executeQuery(
    `DELETE FROM ${TABLES.RPG_RAID_PARTICIPANT}
      WHERE chat_jid = ?`,
    [chatJid],
    connection,
  );
};

export const createPvpChallenge = async (
  { chatJid = null, challengerJid, opponentJid, status = 'pending', turnJid = null, winnerJid = null, battleSnapshot, startedAt = null, expiresAt },
  connection = null,
) => {
  const result = await executeQuery(
    `INSERT INTO ${TABLES.RPG_PVP_CHALLENGE}
      (chat_jid, challenger_jid, opponent_jid, status, turn_jid, winner_jid, battle_snapshot_json, started_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [chatJid, challengerJid, opponentJid, status, turnJid, winnerJid, JSON.stringify(battleSnapshot || {}), startedAt, expiresAt],
    connection,
  );

  const insertId = Number(result?.insertId || 0);
  if (!insertId) return null;
  return getPvpChallengeById(insertId, connection);
};

export const getPvpChallengeById = async (challengeId, connection = null) => {
  const rows = await executeQuery(
    `SELECT id, chat_jid, challenger_jid, opponent_jid, status, turn_jid, winner_jid, battle_snapshot_json, started_at, expires_at, created_at, updated_at
       FROM ${TABLES.RPG_PVP_CHALLENGE}
      WHERE id = ?
      LIMIT 1`,
    [challengeId],
    connection,
  );

  return normalizePvpChallenge(rows?.[0] || null);
};

export const getPvpChallengeByIdForUpdate = async (challengeId, connection) => {
  const rows = await executeQuery(
    `SELECT id, chat_jid, challenger_jid, opponent_jid, status, turn_jid, winner_jid, battle_snapshot_json, started_at, expires_at, created_at, updated_at
       FROM ${TABLES.RPG_PVP_CHALLENGE}
      WHERE id = ?
      LIMIT 1
      FOR UPDATE`,
    [challengeId],
    connection,
  );

  return normalizePvpChallenge(rows?.[0] || null);
};

export const listOpenPvpChallengesByPlayer = async (ownerJid, connection = null) => {
  const rows = await executeQuery(
    `SELECT id, chat_jid, challenger_jid, opponent_jid, status, turn_jid, winner_jid, battle_snapshot_json, started_at, expires_at, created_at, updated_at
       FROM ${TABLES.RPG_PVP_CHALLENGE}
      WHERE (challenger_jid = ? OR opponent_jid = ?)
        AND status IN ('pending', 'active')
        AND expires_at > UTC_TIMESTAMP()
      ORDER BY id DESC`,
    [ownerJid, ownerJid],
    connection,
  );

  return (rows || []).map(normalizePvpChallenge);
};

export const getActivePvpChallengeByPlayerForUpdate = async (ownerJid, connection) => {
  const rows = await executeQuery(
    `SELECT id, chat_jid, challenger_jid, opponent_jid, status, turn_jid, winner_jid, battle_snapshot_json, started_at, expires_at, created_at, updated_at
       FROM ${TABLES.RPG_PVP_CHALLENGE}
      WHERE (challenger_jid = ? OR opponent_jid = ?)
        AND status = 'active'
        AND expires_at > UTC_TIMESTAMP()
      ORDER BY id DESC
      LIMIT 1
      FOR UPDATE`,
    [ownerJid, ownerJid],
    connection,
  );

  return normalizePvpChallenge(rows?.[0] || null);
};

export const updatePvpChallengeState = async (
  { id, status, turnJid, winnerJid, battleSnapshot, startedAt, expiresAt },
  connection = null,
) => {
  const fields = ['updated_at = CURRENT_TIMESTAMP'];
  const params = [];

  if (status !== undefined) {
    fields.push('status = ?');
    params.push(status);
  }
  if (turnJid !== undefined) {
    fields.push('turn_jid = ?');
    params.push(turnJid ?? null);
  }
  if (winnerJid !== undefined) {
    fields.push('winner_jid = ?');
    params.push(winnerJid ?? null);
  }
  if (battleSnapshot !== undefined) {
    fields.push('battle_snapshot_json = ?');
    params.push(JSON.stringify(battleSnapshot || {}));
  }
  if (startedAt !== undefined) {
    fields.push('started_at = ?');
    params.push(startedAt ?? null);
  }
  if (expiresAt !== undefined) {
    fields.push('expires_at = ?');
    params.push(expiresAt);
  }

  params.push(id);
  await executeQuery(
    `UPDATE ${TABLES.RPG_PVP_CHALLENGE}
        SET ${fields.join(', ')}
      WHERE id = ?`,
    params,
    connection,
  );
};

export const expireOldPvpChallenges = async (connection = null) => {
  const result = await executeQuery(
    `UPDATE ${TABLES.RPG_PVP_CHALLENGE}
        SET status = 'expired',
            updated_at = CURRENT_TIMESTAMP
      WHERE status IN ('pending', 'active')
        AND expires_at <= UTC_TIMESTAMP()`,
    [],
    connection,
  );
  return Number(result?.affectedRows || 0);
};
