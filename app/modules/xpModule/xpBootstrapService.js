import logger from '../../utils/logger/loggerModule.js';
import { XP_CONFIG, calculateLevelFromXp, getBootstrapCommandPrefixes } from './xpConfig.js';
import { fetchBootstrapBatch, getTopUsersByXp, upsertUserXpBatch } from './xpRepository.js';

const toSafeInt = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
};

export const bootstrapXpFromHistory = async ({ batchSize = XP_CONFIG.bootstrapBatchSize } = {}) => {
  const startedAt = Date.now();
  const commandPrefixes = getBootstrapCommandPrefixes();
  const defaultPrefix = commandPrefixes[0] || '/';
  const extraPrefixes = commandPrefixes.slice(1);

  let batchNumber = 0;
  let lastSenderId = '';
  let processedUsers = 0;
  let consideredMessages = 0;

  while (true) {
    const rows = await fetchBootstrapBatch({
      startAfterSenderId: lastSenderId,
      batchSize,
      defaultCommandPrefix: defaultPrefix,
      ignoreCommands: XP_CONFIG.ignoreCommandMessages,
      extraCommandPrefixes: extraPrefixes,
    });

    if (!rows || rows.length === 0) {
      break;
    }

    batchNumber += 1;
    const upsertRows = rows.map((row) => {
      const messagesCount = toSafeInt(row.messages_count);
      const totalXp = messagesCount * XP_CONFIG.baseXp;
      const { level } = calculateLevelFromXp(totalXp);

      return {
        senderId: row.sender_id,
        xp: totalXp,
        level,
        messagesCount,
        lastXpAt: null,
      };
    });

    await upsertUserXpBatch(upsertRows);

    const batchMessages = upsertRows.reduce((acc, item) => acc + item.messagesCount, 0);
    consideredMessages += batchMessages;
    processedUsers += upsertRows.length;
    lastSenderId = String(rows[rows.length - 1]?.sender_id || lastSenderId);

    logger.info('XP bootstrap: batch processado.', {
      action: 'xp_bootstrap_batch',
      batch: batchNumber,
      usersInBatch: upsertRows.length,
      messagesInBatch: batchMessages,
      processedUsers,
      consideredMessages,
      lastSenderId,
      elapsedMs: Date.now() - startedAt,
    });
  }

  const topUsers = await getTopUsersByXp(5);
  const finishedAt = Date.now();

  return {
    processedUsers,
    consideredMessages,
    batchCount: batchNumber,
    durationMs: finishedAt - startedAt,
    topUsers,
  };
};
