import { executeQuery, TABLES } from '../../../database/index.js';

const USER_XP_COLUMNS_SQL = 'id, sender_id, xp, level, messages_count, last_xp_at, created_at, updated_at';
const CONVERSATION_TEXT_SQL = "COALESCE(JSON_UNQUOTE(JSON_EXTRACT(m.raw_message, '$.message.conversation')), '')";
const EXTENDED_TEXT_SQL = "COALESCE(JSON_UNQUOTE(JSON_EXTRACT(m.raw_message, '$.message.extendedTextMessage.text')), '')";
const EFFECTIVE_COMMAND_PREFIX_SQL = "COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(gc.config, '$.commandPrefix')), ''), ?)";

const buildBootstrapFilterSql = ({ ignoreCommands, extraCommandPrefixes = [] } = {}) => {
  const conditions = [
    'm.sender_id IS NOT NULL',
    'm.sender_id > ?',
    "IFNULL(JSON_UNQUOTE(JSON_EXTRACT(m.raw_message, '$.key.fromMe')), 'false') <> 'true'",
    "JSON_EXTRACT(m.raw_message, '$.messageStubType') IS NULL",
    "JSON_EXTRACT(m.raw_message, '$.message.protocolMessage') IS NULL",
    `(
      JSON_EXTRACT(m.raw_message, '$.message.conversation') IS NOT NULL
      OR JSON_EXTRACT(m.raw_message, '$.message.extendedTextMessage') IS NOT NULL
      OR JSON_EXTRACT(m.raw_message, '$.message.imageMessage') IS NOT NULL
      OR JSON_EXTRACT(m.raw_message, '$.message.videoMessage') IS NOT NULL
      OR JSON_EXTRACT(m.raw_message, '$.message.documentMessage') IS NOT NULL
      OR JSON_EXTRACT(m.raw_message, '$.message.audioMessage') IS NOT NULL
      OR JSON_EXTRACT(m.raw_message, '$.message.stickerMessage') IS NOT NULL
      OR JSON_EXTRACT(m.raw_message, '$.message.locationMessage') IS NOT NULL
      OR JSON_EXTRACT(m.raw_message, '$.message.contactMessage') IS NOT NULL
      OR JSON_EXTRACT(m.raw_message, '$.message.contactsArrayMessage') IS NOT NULL
      OR JSON_EXTRACT(m.raw_message, '$.message.listMessage') IS NOT NULL
      OR JSON_EXTRACT(m.raw_message, '$.message.listResponseMessage') IS NOT NULL
      OR JSON_EXTRACT(m.raw_message, '$.message.buttonsMessage') IS NOT NULL
      OR JSON_EXTRACT(m.raw_message, '$.message.buttonsResponseMessage') IS NOT NULL
      OR JSON_EXTRACT(m.raw_message, '$.message.templateButtonReplyMessage') IS NOT NULL
      OR JSON_EXTRACT(m.raw_message, '$.message.interactiveResponseMessage') IS NOT NULL
      OR JSON_EXTRACT(m.raw_message, '$.message.productMessage') IS NOT NULL
      OR JSON_EXTRACT(m.raw_message, '$.message.reactionMessage') IS NOT NULL
      OR JSON_EXTRACT(m.raw_message, '$.message.pollCreationMessage') IS NOT NULL
      OR JSON_EXTRACT(m.raw_message, '$.message.pollResultSnapshotMessage') IS NOT NULL
      OR JSON_EXTRACT(m.raw_message, '$.message.requestPhoneNumberMessage') IS NOT NULL
      OR JSON_EXTRACT(m.raw_message, '$.message.groupInviteMessage') IS NOT NULL
      OR JSON_EXTRACT(m.raw_message, '$.message.eventMessage') IS NOT NULL
      OR JSON_EXTRACT(m.raw_message, '$.message.newsletterAdminInviteMessage') IS NOT NULL
      OR JSON_EXTRACT(m.raw_message, '$.message.albumMessage') IS NOT NULL
      OR JSON_EXTRACT(m.raw_message, '$.message.stickerPackMessage') IS NOT NULL
    )`,
  ];

  if (ignoreCommands) {
    conditions.push(
      `NOT (
        ${CONVERSATION_TEXT_SQL} LIKE CONCAT(${EFFECTIVE_COMMAND_PREFIX_SQL}, '%')
        OR ${EXTENDED_TEXT_SQL} LIKE CONCAT(${EFFECTIVE_COMMAND_PREFIX_SQL}, '%')
      )`,
    );

    extraCommandPrefixes.forEach(() => {
      conditions.push(
        `NOT (
          ${CONVERSATION_TEXT_SQL} LIKE CONCAT(?, '%')
          OR ${EXTENDED_TEXT_SQL} LIKE CONCAT(?, '%')
        )`,
      );
    });
  }

  return conditions;
};

export const ensureUserXpRowForUpdate = async ({ senderId, connection }) => {
  await executeQuery(
    `INSERT INTO ${TABLES.USER_XP} (sender_id, xp, level, messages_count, last_xp_at)
     VALUES (?, 0, 1, 0, NULL)
     ON DUPLICATE KEY UPDATE sender_id = VALUES(sender_id)`,
    [senderId],
    connection,
  );

  const rows = await executeQuery(
    `SELECT ${USER_XP_COLUMNS_SQL}
       FROM ${TABLES.USER_XP}
      WHERE sender_id = ?
      FOR UPDATE`,
    [senderId],
    connection,
  );

  return rows?.[0] || null;
};

export const updateUserXpRow = async ({ senderId, xp, level, messagesCount, lastXpAt }, connection) => {
  await executeQuery(
    `UPDATE ${TABLES.USER_XP}
        SET xp = ?,
            level = ?,
            messages_count = ?,
            last_xp_at = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE sender_id = ?`,
    [xp, level, messagesCount, lastXpAt, senderId],
    connection,
  );
};

export const upsertUserXpBatch = async (rows, connection = null) => {
  if (!Array.isArray(rows) || rows.length === 0) return 0;

  const placeholders = rows.map(() => '(?, ?, ?, ?, ?)').join(', ');
  const params = [];

  rows.forEach((row) => {
    params.push(row.senderId, row.xp, row.level, row.messagesCount, row.lastXpAt || null);
  });

  const result = await executeQuery(
    `INSERT INTO ${TABLES.USER_XP} (sender_id, xp, level, messages_count, last_xp_at)
     VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE
      xp = VALUES(xp),
      level = VALUES(level),
      messages_count = VALUES(messages_count),
      last_xp_at = VALUES(last_xp_at),
      updated_at = CURRENT_TIMESTAMP`,
    params,
    connection,
  );

  return Number(result?.affectedRows || 0);
};

export const fetchBootstrapBatch = async ({
  startAfterSenderId = '',
  batchSize,
  defaultCommandPrefix,
  ignoreCommands = true,
  extraCommandPrefixes = [],
}) => {
  const filters = buildBootstrapFilterSql({ ignoreCommands, extraCommandPrefixes });
  const whereSql = filters.join('\n        AND ');

  const params = [startAfterSenderId];
  if (ignoreCommands) {
    params.push(defaultCommandPrefix, defaultCommandPrefix);
    extraCommandPrefixes.forEach((prefix) => params.push(prefix, prefix));
  }
  params.push(batchSize);

  const sql = `
    SELECT
      m.sender_id,
      COUNT(*) AS messages_count
    FROM ${TABLES.MESSAGES} m
    LEFT JOIN ${TABLES.GROUP_CONFIGS} gc
      ON gc.id = m.chat_id
    WHERE ${whereSql}
    GROUP BY m.sender_id
    ORDER BY m.sender_id ASC
    LIMIT ?
  `;

  return executeQuery(sql, params);
};

export const getTopUsersByXp = async (limit = 5) => {
  return executeQuery(
    `SELECT sender_id, xp, level, messages_count
       FROM ${TABLES.USER_XP}
      ORDER BY xp DESC, level DESC, messages_count DESC
      LIMIT ?`,
    [limit],
  );
};

export const getUserXpBySenderId = async (senderId) => {
  const rows = await executeQuery(
    `SELECT ${USER_XP_COLUMNS_SQL}
       FROM ${TABLES.USER_XP}
      WHERE sender_id = ?
      LIMIT 1`,
    [senderId],
  );

  return rows?.[0] || null;
};

export const insertXpTransaction = async ({ senderId, amount, reason, actorId }, connection = null) => {
  await executeQuery(
    `INSERT INTO ${TABLES.XP_TRANSACTIONS} (sender_id, amount, reason, actor_id)
     VALUES (?, ?, ?, ?)`,
    [senderId, amount, reason || null, actorId || null],
    connection,
  );
};
