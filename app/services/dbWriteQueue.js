import logger from '../utils/logger/loggerModule.js';
import { executeQuery, TABLES } from '../../database/index.js';
import { queueLidUpdate, flushLidQueue } from './lidMapService.js';
import { recordError, setQueueDepth } from '../observability/metrics.js';

const parseNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const FLUSH_INTERVAL_MS = Math.min(
  3000,
  Math.max(1000, parseNumber(process.env.DB_WRITE_FLUSH_MS, 1500)),
);
const MESSAGE_BATCH_SIZE = Math.max(1, Math.floor(parseNumber(process.env.DB_MESSAGE_BATCH_SIZE, 200)));
const CHAT_BATCH_SIZE = Math.max(1, Math.floor(parseNumber(process.env.DB_CHAT_BATCH_SIZE, 200)));
const CHAT_COOLDOWN_MS = Math.max(1000, Math.floor(parseNumber(process.env.DB_CHAT_COOLDOWN_MS, 45000)));
const MESSAGE_QUEUE_MAX = Math.max(
  MESSAGE_BATCH_SIZE * 5,
  Math.floor(parseNumber(process.env.DB_MESSAGE_QUEUE_MAX, 5000)),
);

const messageQueue = [];
const messagePendingIds = new Set();
let messageFlushInProgress = false;
let messageFlushRequested = false;

const chatQueue = new Map();
const chatCache = new Map();
let chatFlushInProgress = false;
let chatFlushRequested = false;

let flushScheduled = false;

const updateQueueMetrics = () => {
  setQueueDepth('messages', messageQueue.length);
  setQueueDepth('chats', chatQueue.size);
};

const scheduleFlush = () => {
  if (flushScheduled) return;
  flushScheduled = true;
  setImmediate(() => {
    flushScheduled = false;
    flushQueues().catch((error) => {
      logger.error('Falha ao executar flush das filas.', { error: error.message });
      recordError('db_write_queue');
    });
  });
};

const fnv1aHash = (input) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

const stableStringify = (value, depth = 0, seen = new WeakSet()) => {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'bigint') return `"${value.toString()}"`;
  if (value instanceof Date) return `"${value.toISOString()}"`;
  if (Buffer.isBuffer(value)) return `"Buffer:${value.length}"`;
  if (typeof value !== 'object') return `"${String(value)}"`;
  if (seen.has(value)) return '"[Circular]"';
  if (depth > 6) return '"[MaxDepth]"';

  seen.add(value);
  if (Array.isArray(value)) {
    const items = value.map((item) => stableStringify(item, depth + 1, seen));
    return `[${items.join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  const items = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key], depth + 1, seen)}`);
  return `{${items.join(',')}}`;
};

const hashObject = (value) => {
  try {
    return fnv1aHash(stableStringify(value));
  } catch (error) {
    return fnv1aHash(String(value));
  }
};

const buildPlaceholders = (rows, cols) =>
  Array.from({ length: rows }, () => `(${Array(cols).fill('?').join(', ')})`).join(', ');

export function queueMessageInsert(messageData) {
  if (!messageData?.message_id) return false;
  if (messagePendingIds.has(messageData.message_id)) return false;

  if (messageQueue.length >= MESSAGE_QUEUE_MAX) {
    logger.warn('Fila de mensagens cheia, forçando flush.', { size: messageQueue.length });
    scheduleFlush();
  }

  messagePendingIds.add(messageData.message_id);
  messageQueue.push(messageData);
  updateQueueMetrics();

  if (messageQueue.length >= MESSAGE_BATCH_SIZE) {
    scheduleFlush();
  }
  return true;
}

export function queueChatUpdate(chat, options = {}) {
  if (!chat || !chat.id) return false;

  const now = Date.now();
  const isPartial = Boolean(options.partial);
  const forceName = Boolean(options.forceName);
  const cache = chatCache.get(chat.id) || {
    storedRaw: null,
    storedHash: null,
    storedName: null,
    lastWriteAt: 0,
    pendingRaw: null,
    pendingHash: null,
    pendingName: null,
  };

  const baseRaw = cache.pendingRaw || cache.storedRaw;
  const rawChat = isPartial ? (baseRaw ? { ...baseRaw, ...chat } : null) : chat;
  const rawHash = rawChat ? hashObject(rawChat) : cache.pendingHash || cache.storedHash;

  const providedName = forceName ? chat.name || chat.id : chat.name;
  const nameProvided = providedName !== undefined && providedName !== null;
  const name = nameProvided ? providedName : cache.pendingName || cache.storedName || null;
  const compareHash = cache.pendingHash || cache.storedHash;
  const compareName = cache.pendingName || cache.storedName;

  const rawChanged = Boolean(rawChat && rawHash && rawHash !== compareHash);
  const nameChanged = nameProvided && name !== compareName;

  if (!rawChanged && !nameChanged) {
    return false;
  }

  const nextAllowedAt = cache.lastWriteAt ? cache.lastWriteAt + CHAT_COOLDOWN_MS : now;
  const entry = {
    id: chat.id,
    name: nameProvided ? name : null,
    raw: rawChanged ? rawChat : null,
    rawHash: rawHash || compareHash,
    queuedAt: now,
    nextAllowedAt,
  };

  chatQueue.set(chat.id, entry);
  chatCache.set(chat.id, {
    ...cache,
    pendingRaw: rawChat || cache.pendingRaw,
    pendingHash: rawHash || cache.pendingHash,
    pendingName: nameProvided ? name : cache.pendingName,
  });

  updateQueueMetrics();
  scheduleFlush();
  return true;
}

async function flushMessageQueue() {
  if (messageFlushInProgress) {
    messageFlushRequested = true;
    return;
  }
  messageFlushInProgress = true;
  try {
    while (messageQueue.length > 0) {
      const batch = messageQueue.splice(0, MESSAGE_BATCH_SIZE);
      const placeholders = buildPlaceholders(batch.length, 6);
      const params = [];
      for (const message of batch) {
        params.push(
          message.message_id,
          message.chat_id,
          message.sender_id,
          message.content,
          message.raw_message,
          message.timestamp,
        );
      }
      const sql = `INSERT IGNORE INTO ${TABLES.MESSAGES}
        (message_id, chat_id, sender_id, content, raw_message, timestamp)
        VALUES ${placeholders}`;

      try {
        await executeQuery(sql, params);
        for (const message of batch) {
          messagePendingIds.delete(message.message_id);
        }
      } catch (error) {
        logger.error('Falha ao inserir batch de mensagens.', { error: error.message });
        recordError('db_write_queue');
        messageQueue.unshift(...batch);
        break;
      }
    }
  } finally {
    messageFlushInProgress = false;
    updateQueueMetrics();
    if (messageFlushRequested) {
      messageFlushRequested = false;
      setImmediate(() => {
        flushMessageQueue().catch(() => {});
      });
    }
  }
}

async function flushChatQueue() {
  if (chatFlushInProgress) {
    chatFlushRequested = true;
    return;
  }
  chatFlushInProgress = true;
  try {
    while (chatQueue.size > 0) {
      const now = Date.now();
      const ready = [];
      for (const entry of chatQueue.values()) {
        if (now < entry.nextAllowedAt) continue;
        ready.push(entry);
        if (ready.length >= CHAT_BATCH_SIZE) break;
      }
      if (!ready.length) break;

      const placeholders = buildPlaceholders(ready.length, 3);
      const params = [];
      for (const entry of ready) {
        params.push(entry.id, entry.name, entry.raw);
      }

      const sql = `INSERT INTO ${TABLES.CHATS} (id, name, raw_chat)
        VALUES ${placeholders}
        ON DUPLICATE KEY UPDATE
          name = COALESCE(VALUES(name), name),
          raw_chat = COALESCE(VALUES(raw_chat), raw_chat)`;

      try {
        await executeQuery(sql, params);
        const writeAt = Date.now();
        for (const entry of ready) {
          const current = chatQueue.get(entry.id);
          const cache = chatCache.get(entry.id) || {};

          if (entry.raw) {
            cache.storedRaw = entry.raw;
            cache.storedHash = entry.rawHash;
          }
          if (entry.name !== null && entry.name !== undefined) {
            cache.storedName = entry.name;
          }
          cache.lastWriteAt = writeAt;

          if (!current || current.queuedAt === entry.queuedAt) {
            chatQueue.delete(entry.id);
            cache.pendingRaw = null;
            cache.pendingHash = null;
            cache.pendingName = null;
          } else {
            current.nextAllowedAt = writeAt + CHAT_COOLDOWN_MS;
            chatQueue.set(entry.id, current);
          }

          chatCache.set(entry.id, cache);
        }
      } catch (error) {
        logger.error('Falha ao inserir batch de chats.', { error: error.message });
        recordError('db_write_queue');
        break;
      }
    }
  } finally {
    chatFlushInProgress = false;
    updateQueueMetrics();
    if (chatFlushRequested) {
      chatFlushRequested = false;
      setImmediate(() => {
        flushChatQueue().catch(() => {});
      });
    }
  }
}

export async function flushQueues() {
  await Promise.allSettled([flushMessageQueue(), flushChatQueue(), flushLidQueue()]);
}

updateQueueMetrics();

if (FLUSH_INTERVAL_MS > 0) {
  const timer = setInterval(() => {
    flushQueues().catch((error) => {
      logger.error('Erro ao executar flush periódico das filas.', { error: error.message });
      recordError('db_write_queue');
    });
  }, FLUSH_INTERVAL_MS);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}

export { queueLidUpdate };
