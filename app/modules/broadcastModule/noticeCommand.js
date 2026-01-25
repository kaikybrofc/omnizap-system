import logger from '../../utils/logger/loggerModule.js';
import getImageBuffer from '../../utils/http/getImageBufferModule.js';
import { getAllParticipatingGroups } from '../../config/groupUtils.js';
import { normalizeJid, encodeJid } from '../../config/baileysConfig.js';

const MENU_IMAGE_ENV = 'IMAGE_MENU';
const OWNER_JID_ENV = 'USER_ADMIN';
const PROGRESS_EVERY = 10;
const PROGRESS_INTERVAL_MS = 15 * 1000;
const MAX_FAILURE_SAMPLE = 10;

const MODE_CONFIG = {
  default: {
    concurrency: 4,
    jitterMin: 200,
    jitterMax: 900,
    retries: 2,
    backoffBaseMs: 2000,
  },
  fast: {
    concurrency: 6,
    jitterMin: 120,
    jitterMax: 600,
    retries: 1,
    backoffBaseMs: 2000,
  },
  safe: {
    concurrency: 2,
    jitterMin: 400,
    jitterMax: 1200,
    retries: 3,
    backoffBaseMs: 2500,
  },
};

const toWhatsAppJid = (jid) => (jid && jid.includes('@') ? jid : encodeJid(jid, 's.whatsapp.net'));

/**
 * Aguarda um tempo em milissegundos.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const jitter = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const isRateLimitError = (error) => {
  const status =
    error?.status || error?.statusCode || error?.response?.status || error?.output?.statusCode;
  if (status === 429) return true;
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('rate') ||
    message.includes('flood') ||
    message.includes('too many') ||
    message.includes('spam') ||
    message.includes('limit')
  );
};

const isRetryableError = (error) => {
  const status =
    error?.status || error?.statusCode || error?.response?.status || error?.output?.statusCode;
  if (status && status >= 500) return true;
  if (isRateLimitError(error)) return true;
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('network') ||
    message.includes('connection') ||
    message.includes('socket')
  );
};

const withRetry = async (
  fn,
  { retries = 2, baseDelayMs = 2000, jitterMin = 200, jitterMax = 800, onRateLimit } = {},
) => {
  let attempt = 0;
  while (true) {
    try {
      return await fn(attempt);
    } catch (error) {
      const retryable = isRetryableError(error);
      if (!retryable || attempt >= retries) {
        throw error;
      }
      const base = Math.min(15000, baseDelayMs * 2 ** attempt);
      const wait = base + jitter(jitterMin, jitterMax);
      if (isRateLimitError(error) && typeof onRateLimit === 'function') {
        onRateLimit(wait);
      }
      await sleep(wait);
      attempt += 1;
    }
  }
};

const runWithConcurrency = async (items, limit, workerFn, onProgress) => {
  let index = 0;
  const results = new Array(items.length);
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const currentIndex = index;
      if (currentIndex >= items.length) break;
      const item = items[currentIndex];
      index += 1;
      let result;
      try {
        result = await workerFn(item, currentIndex);
      } catch (error) {
        result = { ok: false, id: item?.id, error };
      }
      results[currentIndex] = result;
      if (onProgress) {
        await onProgress(result, currentIndex);
      }
    }
  });
  await Promise.all(workers);
  return results;
};

const parseNoticeArgs = (text = '') => {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  let mode = 'default';
  const remaining = [];
  tokens.forEach((token) => {
    const lower = token.toLowerCase();
    if (lower === '-fast') mode = 'fast';
    else if (lower === '-safe') mode = 'safe';
    else remaining.push(token);
  });
  return { mode, message: remaining.join(' ').trim() };
};

/**
 * Monta uma lista textual dos grupos.
 *
 * @param {Array<{id: string, subject?: string}>} groups
 * @returns {string}
 */
const buildGroupList = (groups) =>
  groups
    .map((group, index) => {
      const name = group.subject || 'Sem nome';
      return `${index + 1}. ${name} (${group.id})`;
    })
    .join('\n');

/**
 * Comando do dono do bot para enviar um aviso com a imagem do menu a todos os grupos.
 *
 * @param {object} params
 * @param {object} params.sock
 * @param {string} params.remoteJid
 * @param {object} params.messageInfo
 * @param {number} params.expirationMessage
 * @param {string} params.senderJid
 * @param {string} params.text
 * @returns {Promise<void>}
 */
export async function handleNoticeCommand({
  sock,
  remoteJid,
  messageInfo,
  expirationMessage,
  senderJid,
  text,
}) {
  const ownerJid = process.env[OWNER_JID_ENV];
  if (!ownerJid) {
    await sock.sendMessage(
      remoteJid,
      { text: '❌ USER_ADMIN não configurado no ambiente.' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }

  if (normalizeJid(toWhatsAppJid(ownerJid)) !== normalizeJid(toWhatsAppJid(senderJid))) {
    await sock.sendMessage(
      remoteJid,
      { text: '❌ Você não tem permissão para usar este comando.' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }

  const { mode, message: noticeText } = parseNoticeArgs(text || '');
  if (!noticeText) {
    await sock.sendMessage(
      remoteJid,
      { text: 'Uso: /aviso [-fast|-safe] <mensagem>' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }

  const imageUrl = process.env[MENU_IMAGE_ENV];
  if (!imageUrl) {
    await sock.sendMessage(
      remoteJid,
      { text: '❌ IMAGE_MENU não configurado no ambiente.' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }

  let groupsMap = null;
  try {
    groupsMap = await getAllParticipatingGroups(sock);
  } catch (error) {
    logger.error(`handleNoticeCommand Erro ao obter grupos: ${error.message}`);
    await sock.sendMessage(
      remoteJid,
      { text: '❌ Não foi possível obter a lista de grupos.' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }

  const groups = Object.values(groupsMap || {});
  if (groups.length === 0) {
    await sock.sendMessage(
      remoteJid,
      { text: '⚠️ O bot não está em nenhum grupo.' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }

  const groupListText = buildGroupList(groups);
  const config = MODE_CONFIG[mode] || MODE_CONFIG.default;
  await sock.sendMessage(
    remoteJid,
    {
      text: `📋 Grupos (${groups.length}):\n${groupListText}\n\n📣 Aviso:\n${noticeText}\n\n🚀 Iniciando envio (modo ${mode}).\nConcorrência: ${config.concurrency} | Jitter: ${config.jitterMin}-${config.jitterMax}ms | Retries: ${config.retries}`,
    },
    { quoted: messageInfo, ephemeralExpiration: expirationMessage },
  );

  let imageBuffer = null;
  try {
    imageBuffer = await getImageBuffer(imageUrl);
  } catch (error) {
    logger.error(`handleNoticeCommand Erro ao baixar imagem do menu: ${error.message}`);
    await sock.sendMessage(
      remoteJid,
      { text: '❌ Não foi possível baixar a imagem do menu.' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }

  const sendBroadcast = async () => {
    let processed = 0;
    let successCount = 0;
    let failureCount = 0;
    let lastProgressAt = Date.now();
    const failureIds = [];
    let globalBackoffUntil = 0;
    let rateLimitHits = 0;

    const worker = async (group) => {
      await sleep(jitter(config.jitterMin, config.jitterMax));
      const sendOnce = async () => {
        const now = Date.now();
        if (globalBackoffUntil > now) {
          await sleep(globalBackoffUntil - now);
        }
        await sock.sendMessage(group.id, { image: imageBuffer, caption: noticeText });
      };

      await withRetry(sendOnce, {
        retries: config.retries,
        baseDelayMs: config.backoffBaseMs,
        jitterMin: config.jitterMin,
        jitterMax: config.jitterMax,
        onRateLimit: (delay) => {
          rateLimitHits += 1;
          const until = Date.now() + delay;
          if (until > globalBackoffUntil) globalBackoffUntil = until;
        },
      });
      return { ok: true, id: group.id };
    };

    const onProgress = async (result) => {
      processed += 1;
      if (result.ok) {
        successCount += 1;
      } else {
        failureCount += 1;
        if (failureIds.length < MAX_FAILURE_SAMPLE && result.id) {
          failureIds.push(result.id);
        }
        logger.error(
          `handleNoticeCommand Falha ao enviar aviso para ${result.id}: ${result.error?.message || result.error}`,
        );
      }

      const now = Date.now();
      if (
        processed % PROGRESS_EVERY === 0 ||
        (now - lastProgressAt >= PROGRESS_INTERVAL_MS && processed < groups.length)
      ) {
        lastProgressAt = now;
        await sock.sendMessage(
          remoteJid,
          {
            text: `📣 Progresso: ${processed}/${groups.length}\n✅ Sucesso: ${successCount}\n❌ Falhas: ${failureCount}`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      }
    };

    await runWithConcurrency(groups, config.concurrency, worker, onProgress);

    const extraFailures =
      failureCount > failureIds.length ? ` … +${failureCount - failureIds.length}` : '';
    const failureList = failureIds.length ? `\nFalhas: ${failureIds.join(', ')}${extraFailures}` : '';
    const rateLimitText = rateLimitHits
      ? `\n⚠️ Rate limit detectado: ${rateLimitHits}x (backoff aplicado)`
      : '';

    await sock.sendMessage(
      remoteJid,
      {
        text: `✅ Aviso finalizado.\nTotal: ${groups.length}\n✅ Sucesso: ${successCount}\n❌ Falhas: ${failureCount}${failureList}${rateLimitText}`,
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  };

  void sendBroadcast();
}
