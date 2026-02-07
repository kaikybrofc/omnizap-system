import { normalizeJid } from '../../config/baileysConfig.js';
import { isUserAdmin } from '../../config/groupUtils.js';
import { extractUserIdInfo, isWhatsAppUserId, resolveUserId, resolveUserIdCached } from '../../services/lidMapService.js';
import { sendAndStore } from '../../services/messagePersistenceService.js';
import logger from '../../utils/logger/loggerModule.js';
import { bootstrapXpFromHistory } from './xpBootstrapService.js';
import { addXpToUser } from './xpService.js';

const DEFAULT_COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';
const OWNER_JID = process.env.USER_ADMIN ? normalizeJid(process.env.USER_ADMIN) : null;

const MIN_PHONE_DIGITS = 5;
const MAX_PHONE_DIGITS = 20;

const buildUsageText = (commandPrefix = DEFAULT_COMMAND_PREFIX) => {
  return [
    '*Comandos de XP*',
    '',
    `• ${commandPrefix}xp bootstrap`,
    `• ${commandPrefix}xp add @usuario 500 [--announce] [motivo]`,
    `• ${commandPrefix}xp add <jid|numero> 500 [--announce] [motivo]`,
    '',
    '*Observações*',
    '• Apenas admin/dono pode executar.',
    '• Sem --announce o ajuste é silencioso por padrão.',
  ].join('\n');
};

const getContextInfo = (messageInfo) => {
  const root = messageInfo?.message;
  if (!root || typeof root !== 'object') return null;

  for (const value of Object.values(root)) {
    if (value?.contextInfo && typeof value.contextInfo === 'object') {
      return value.contextInfo;
    }
    if (value?.message && typeof value.message === 'object') {
      for (const nested of Object.values(value.message)) {
        if (nested?.contextInfo && typeof nested.contextInfo === 'object') {
          return nested.contextInfo;
        }
      }
    }
  }

  return null;
};

const parseTargetToken = (rawValue) => {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!value) return null;

  const withoutAt = value.startsWith('@') ? value.slice(1).trim() : value;
  if (!withoutAt) return null;

  if (withoutAt.includes('@')) {
    const normalized = normalizeJid(withoutAt);
    return normalized || null;
  }

  const digits = withoutAt.replace(/\D/g, '');
  const hasValidLength = digits.length >= MIN_PHONE_DIGITS && digits.length <= MAX_PHONE_DIGITS;
  if (!digits || !hasValidLength) return null;

  return `${digits}@s.whatsapp.net`;
};

const resolveCanonicalSenderId = async (source) => {
  if (!source) return null;
  const info = extractUserIdInfo(source);
  const fallback = resolveUserIdCached(info) || info.raw || null;

  try {
    const resolved = await resolveUserId(info);
    return normalizeJid(resolved) || resolved || fallback;
  } catch (error) {
    logger.warn('Falha ao resolver sender_id canônico para comando XP.', {
      error: error.message,
      source: info.raw,
    });
    return fallback;
  }
};

const hasAdminPermission = async ({ isGroupMessage, remoteJid, senderJid }) => {
  const normalizedSender = normalizeJid(senderJid) || senderJid;
  if (OWNER_JID && normalizedSender === OWNER_JID) {
    return true;
  }

  if (!isGroupMessage) {
    return false;
  }

  return isUserAdmin(remoteJid, senderJid);
};

const removeWrappingQuotes = (text) => {
  if (!text || typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (trimmed.length < 2) return trimmed;
  const startsWithQuote = trimmed.startsWith('"') || trimmed.startsWith("'");
  const endsWithQuote = trimmed.endsWith('"') || trimmed.endsWith("'");
  if (startsWithQuote && endsWithQuote) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const parseAddRequest = ({ payloadText, messageInfo }) => {
  const announceRegex = /(^|\s)--announce(?=\s|$)/g;
  const announce = announceRegex.test(payloadText);
  const normalizedPayload = payloadText.replace(announceRegex, ' ').trim();
  const tokens = normalizedPayload ? normalizedPayload.split(/\s+/) : [];

  const contextInfo = getContextInfo(messageInfo);
  const mentionedJid = Array.isArray(contextInfo?.mentionedJid)
    ? contextInfo.mentionedJid.find(Boolean) || null
    : null;
  const repliedParticipant = contextInfo?.participant || contextInfo?.participantAlt || null;

  let targetSource = null;
  let amountTokenIndex = 1;

  if (mentionedJid) {
    targetSource = mentionedJid;
    amountTokenIndex = tokens[0]?.startsWith('@') ? 1 : 0;
  } else {
    const explicitTarget = parseTargetToken(tokens[0]);
    if (explicitTarget) {
      targetSource = explicitTarget;
      amountTokenIndex = 1;
    } else if (repliedParticipant) {
      targetSource = {
        participant: repliedParticipant,
        participantAlt: contextInfo?.participantAlt || null,
      };
      amountTokenIndex = 0;
    }
  }

  const amountToken = tokens[amountTokenIndex] || '';
  const reason = removeWrappingQuotes(tokens.slice(amountTokenIndex + 1).join(' '));

  return {
    announce,
    targetSource,
    amountToken,
    reason,
  };
};

const formatTopUsers = (rows = []) => {
  if (!rows.length) {
    return 'Top 5 XP: sem dados processados.';
  }

  return rows
    .slice(0, 5)
    .map((row, index) => {
      const senderId = row?.sender_id || 'desconhecido';
      const label = isWhatsAppUserId(senderId) ? `@${senderId.split('@')[0]}` : senderId;
      return `${index + 1}. ${label} — XP ${Number(row?.xp || 0)} | nível ${Number(row?.level || 1)}`;
    })
    .join('\n');
};

export const handleXpCommand = async ({
  sock,
  remoteJid,
  messageInfo,
  expirationMessage,
  senderJid,
  text = '',
  args = [],
  isGroupMessage,
  commandPrefix = DEFAULT_COMMAND_PREFIX,
}) => {
  const subCommand = args?.[0]?.toLowerCase();
  if (!subCommand) {
    await sendAndStore(
      sock,
      remoteJid,
      { text: buildUsageText(commandPrefix) },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }

  const canRunAdminCommand = await hasAdminPermission({ isGroupMessage, remoteJid, senderJid });
  if (!canRunAdminCommand) {
    await sendAndStore(
      sock,
      remoteJid,
      {
        text: 'Permissão insuficiente. Apenas administradores do grupo ou o dono do bot podem usar comandos de XP.',
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }

  if (subCommand === 'bootstrap') {
    const startedAt = Date.now();
    logger.info('Comando XP bootstrap iniciado.', {
      action: 'xp_bootstrap_started',
      requestedBy: senderJid,
      chatId: remoteJid,
    });

    try {
      const summary = await bootstrapXpFromHistory();
      const seconds = (summary.durationMs / 1000).toFixed(2);
      const topUsersText = formatTopUsers(summary.topUsers);
      const response = [
        '✅ *Bootstrap de XP concluído*',
        `Usuários processados: *${summary.processedUsers}*`,
        `Mensagens consideradas: *${summary.consideredMessages}*`,
        `Batches: *${summary.batchCount}*`,
        `Tempo total: *${seconds}s*`,
        '',
        topUsersText,
      ].join('\n');

      const mentions = (summary.topUsers || [])
        .map((row) => row?.sender_id)
        .filter((jid) => isWhatsAppUserId(jid));

      await sendAndStore(
        sock,
        remoteJid,
        mentions.length ? { text: response, mentions } : { text: response },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );

      logger.info('Comando XP bootstrap finalizado.', {
        action: 'xp_bootstrap_completed',
        durationMs: summary.durationMs,
        processedUsers: summary.processedUsers,
        consideredMessages: summary.consideredMessages,
        requestedBy: senderJid,
        elapsedMs: Date.now() - startedAt,
      });
    } catch (error) {
      logger.error('Falha no comando XP bootstrap.', {
        error: error.message,
        requestedBy: senderJid,
      });

      await sendAndStore(
        sock,
        remoteJid,
        {
          text: `❌ Falha ao executar bootstrap de XP: ${error.message}`,
        },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
    }
    return;
  }

  if (subCommand === 'add') {
    const payloadText = String(text || '').trim().replace(/^\S+\s*/, '').trim();
    const request = parseAddRequest({ payloadText, messageInfo });

    if (!request.targetSource) {
      await sendAndStore(
        sock,
        remoteJid,
        {
          text: [
            'Formato inválido para ajuste de XP.',
            `Use: ${commandPrefix}xp add @usuario 500 [--announce] [motivo]`,
            `Ou: ${commandPrefix}xp add <jid|numero> 500 [--announce] [motivo]`,
          ].join('\n'),
        },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      return;
    }

    const amount = Number.parseInt(request.amountToken, 10);
    if (!Number.isInteger(amount) || amount === 0) {
      await sendAndStore(
        sock,
        remoteJid,
        {
          text: `Informe um valor inteiro diferente de zero para XP. Exemplo: ${commandPrefix}xp add @usuario 500`,
        },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      return;
    }

    const targetSenderId = await resolveCanonicalSenderId(request.targetSource);
    if (!targetSenderId) {
      await sendAndStore(
        sock,
        remoteJid,
        {
          text: 'Não foi possível resolver o usuário alvo. Tente mencionar, responder a mensagem dele ou informar o JID/telefone.',
        },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      return;
    }

    const actorId = (await resolveCanonicalSenderId(senderJid)) || senderJid;

    try {
      const result = await addXpToUser({
        senderId: targetSenderId,
        amount,
        reason: request.reason,
        silent: !request.announce,
        chatId: remoteJid,
        quoteMessage: messageInfo,
        actorId,
        sock,
        expirationMessage,
      });

      if (!request.announce) {
        const changeLabel = result.appliedAmount >= 0 ? `+${result.appliedAmount}` : `${result.appliedAmount}`;
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: [
              '✅ XP ajustado em modo silencioso.',
              `Usuário: ${targetSenderId}`,
              `Alteração aplicada: ${changeLabel} XP`,
              `XP total atual: ${result.xpAfter}`,
              `Nível atual: ${result.levelAfter}`,
            ].join('\n'),
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      }
    } catch (error) {
      await sendAndStore(
        sock,
        remoteJid,
        {
          text: `❌ Não foi possível ajustar XP: ${error.message}`,
        },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
    }

    return;
  }

  await sendAndStore(
    sock,
    remoteJid,
    { text: buildUsageText(commandPrefix) },
    { quoted: messageInfo, ephemeralExpiration: expirationMessage },
  );
};
