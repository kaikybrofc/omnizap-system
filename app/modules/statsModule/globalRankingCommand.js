import { executeQuery } from '../../../database/index.js';
import logger from '../../utils/logger/loggerModule.js';
import { getGroupParticipants, _normalizeDigits } from '../../config/groupUtils.js';

const RANKING_LIMIT = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

const MESSAGE_TYPE_SQL = `
  CASE
    WHEN JSON_EXTRACT(m.raw_message, '$.message.conversation') IS NOT NULL THEN 'texto'
    WHEN JSON_EXTRACT(m.raw_message, '$.message.extendedTextMessage') IS NOT NULL THEN 'texto'
    WHEN JSON_EXTRACT(m.raw_message, '$.message.imageMessage') IS NOT NULL THEN 'imagem'
    WHEN JSON_EXTRACT(m.raw_message, '$.message.videoMessage') IS NOT NULL THEN 'video'
    WHEN JSON_EXTRACT(m.raw_message, '$.message.audioMessage') IS NOT NULL THEN 'audio'
    WHEN JSON_EXTRACT(m.raw_message, '$.message.stickerMessage') IS NOT NULL THEN 'figurinha'
    WHEN JSON_EXTRACT(m.raw_message, '$.message.documentMessage') IS NOT NULL THEN 'documento'
    WHEN JSON_EXTRACT(m.raw_message, '$.message.locationMessage') IS NOT NULL THEN 'localizacao'
    WHEN JSON_EXTRACT(m.raw_message, '$.message.reactionMessage') IS NOT NULL THEN 'reacao'
    WHEN JSON_EXTRACT(m.raw_message, '$.message.pollCreationMessage') IS NOT NULL THEN 'enquete'
    WHEN JSON_EXTRACT(m.raw_message, '$.message.listMessage') IS NOT NULL THEN 'lista'
    WHEN JSON_EXTRACT(m.raw_message, '$.message.buttonsMessage') IS NOT NULL THEN 'botoes'
    ELSE 'outros'
  END
`;

const TIMESTAMP_TO_DATETIME_SQL = `
  CASE
    WHEN m.timestamp > 1000000000000 THEN FROM_UNIXTIME(m.timestamp / 1000)
    WHEN m.timestamp > 1000000000 THEN FROM_UNIXTIME(m.timestamp)
    ELSE m.timestamp
  END
`;

const formatDate = (value) => {
  if (!value) return 'N/D';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/D';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'America/Sao_Paulo',
  }).format(date);
};

const toMillis = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (value > 1e12) return value;
    if (value > 1e9) return value * 1000;
    return value;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const isLidJid = (jid) => typeof jid === 'string' && jid.endsWith('@lid');
const isWhatsAppJid = (jid) => typeof jid === 'string' && jid.endsWith('@s.whatsapp.net');

const normalizeJidWithParticipants = (value, participantIndex) => {
  if (!value || !participantIndex) return value;
  const direct = participantIndex.get(value);
  if (direct) return direct;
  const digits = _normalizeDigits(value);
  if (digits && participantIndex.has(digits)) return participantIndex.get(digits);
  return value;
};

const buildParticipantIndex = (participants) => {
  const index = new Map();
  (participants || []).forEach((participant) => {
    const canonical = participant?.jid || participant?.id || participant?.lid || null;
    if (!canonical) return;
    const keys = [participant?.jid, participant?.id, participant?.lid, participant?.phoneNumber].filter(Boolean);
    keys.forEach((key) => {
      index.set(key, canonical);
      const digits = _normalizeDigits(key);
      if (digits) index.set(digits, canonical);
    });
    const canonicalDigits = _normalizeDigits(canonical);
    if (canonicalDigits) index.set(canonicalDigits, canonical);
  });
  return index;
};

const resolveSenderIdsGlobal = (rawJid, participantIndex) => {
  if (!rawJid) return { displayId: null, mentionId: null, key: null };
  const normalized = participantIndex ? normalizeJidWithParticipants(rawJid, participantIndex) : null;
  const resolvedJid = normalized || rawJid;
  const resolvedDigits = _normalizeDigits(resolvedJid) || null;
  const digitsJid = resolvedDigits ? `${resolvedDigits}@s.whatsapp.net` : null;
  const isLid = isLidJid(rawJid);
  const mentionCandidate = !isLid ? (digitsJid || (isWhatsAppJid(rawJid) ? rawJid : null)) : (isWhatsAppJid(resolvedJid) ? resolvedJid : null);
  const mentionId = mentionCandidate && !isLidJid(mentionCandidate) ? mentionCandidate : null;
  const key = resolvedDigits || resolvedJid;
  const displayId = isWhatsAppJid(resolvedJid) ? resolvedJid : (digitsJid || resolvedJid);
  return { displayId, mentionId, key };
};

const getDisplayName = (pushName, jid) => {
  if (jid && typeof jid === 'string') {
    const handle = `@${jid.split('@')[0]}`;
    if (pushName && typeof pushName === 'string' && pushName.trim() !== '') {
      return `${handle} (${pushName.trim()})`;
    }
    return handle;
  }
  if (pushName && typeof pushName === 'string' && pushName.trim() !== '') {
    return pushName.trim();
  }
  return 'Desconhecido';
};

const buildGlobalRankingMessage = (rows, dbStart, totalMessages, top5Total, topType) => {
  if (!rows.length) {
    return `Nao ha mensagens suficientes para gerar o ranking global.\n\nInicio do banco (primeira mensagem): ${formatDate(dbStart)}`;
  }

  const totalLabel = Number(totalMessages || 0);
  const topShare = totalLabel > 0 ? ((Number(top5Total || 0) / totalLabel) * 100).toFixed(2) : '0.00';
  const topTypeLabel = topType?.label ? `${topType.label} (${topType.count})` : 'N/D';
  const lines = [
    `🏆 *Ranking Global Top ${RANKING_LIMIT} (mensagens)*`,
    `📦 Total de mensagens (global): ${totalLabel}`,
    `📊 Top ${RANKING_LIMIT} = ${topShare}% do total`,
    `🔥 Tipo mais usado: ${topTypeLabel}`,
    '',
  ];
  rows.forEach((row, index) => {
    const jid = row.sender_id || row.mention_id || '';
    const handle = getDisplayName(row.display_name, jid);
    const total = row.total_messages || 0;
    const percent = totalLabel > 0 ? ((Number(total || 0) / totalLabel) * 100).toFixed(2) : '0.00';
    const first = formatDate(row.first_message);
    const last = formatDate(row.last_message);
    const avgPerDay = row.avg_per_day || '0.00';
    const activeDays = row.active_days ?? 0;
    const streak = row.streak ?? 0;
    const favoriteType = row.favorite_type ? `${row.favorite_type} (${row.favorite_count || 0})` : 'N/D';
    const position = `${index + 1}`.padStart(2, '0');
    lines.push(
      `${position}. ${handle}`,
      `   💬 ${total} msg(s)`,
      `   📊 ${percent}% do total`,
      `   📆 dias ativos: ${activeDays}`,
      `   📈 media/dia: ${avgPerDay}`,
      `   🔥 favorito: ${favoriteType}`,
      `   🔗 streak: ${streak} dia(s)`,
      `   📅 primeira: ${first}`,
      `   🕘 ultima: ${last}`,
      '',
    );
  });

  lines.push(`Inicio do banco (primeira mensagem): ${formatDate(dbStart)}`);
  return lines.join('\n');
};

export async function handleGlobalRankingCommand({ sock, remoteJid, messageInfo, expirationMessage, isGroupMessage }) {
  try {
    const botJid = sock?.user?.id ? `${sock.user.id.split(':')[0]}@s.whatsapp.net` : null;
    const participants = isGroupMessage ? await getGroupParticipants(remoteJid) : null;
    const participantIndex = participants ? buildParticipantIndex(participants) : null;

    const [totalMessagesRow] = await executeQuery(
      botJid
        ? 'SELECT COUNT(*) AS total FROM messages WHERE sender_id IS NOT NULL AND sender_id <> ?'
        : 'SELECT COUNT(*) AS total FROM messages WHERE sender_id IS NOT NULL',
      botJid ? [botJid] : [],
    );
    const totalMessages = Number(totalMessagesRow?.total || 0);

    const rankingRows = await executeQuery(
      `SELECT
          m.sender_id,
          COUNT(*) AS total_messages,
          MIN(m.timestamp) AS first_message,
          MAX(m.timestamp) AS last_message
        FROM messages m
        WHERE m.sender_id IS NOT NULL
          ${botJid ? 'AND m.sender_id <> ?' : ''}
        GROUP BY m.sender_id
        ORDER BY total_messages DESC
        LIMIT ${RANKING_LIMIT}`,
      botJid ? [botJid] : [],
    );

    const [topTypeRow] = await executeQuery(
      `SELECT
          ${MESSAGE_TYPE_SQL} AS message_type,
          COUNT(*) AS total
        FROM messages m
        WHERE m.sender_id IS NOT NULL
          ${botJid ? 'AND m.sender_id <> ?' : ''}
          AND m.raw_message IS NOT NULL
        GROUP BY message_type
        ORDER BY total DESC
        LIMIT 1`,
      botJid ? [botJid] : [],
    );

    const senderIds = rankingRows.map((row) => row.sender_id).filter(Boolean);
    const pushNameBySender = new Map();
    if (senderIds.length) {
      const placeholders = senderIds.map(() => '?').join(',');
      const latestPushRows = await executeQuery(
        `SELECT t.sender_id,
                JSON_UNQUOTE(JSON_EXTRACT(m.raw_message, '$.pushName')) AS pushName
           FROM (
             SELECT sender_id, MAX(id) AS max_id
               FROM messages
              WHERE sender_id IN (${placeholders})
                AND raw_message IS NOT NULL
                AND JSON_EXTRACT(raw_message, '$.pushName') IS NOT NULL
              GROUP BY sender_id
           ) t
           JOIN messages m ON m.id = t.max_id`,
        senderIds,
      );
      latestPushRows.forEach((row) => {
        if (row?.sender_id && row?.pushName) {
          pushNameBySender.set(row.sender_id, row.pushName);
        }
      });
    }

    const normalizedTotals = new Map();
    rankingRows.forEach((row) => {
      const rawJid = row.sender_id || '';
      if (!rawJid) return;
      const { displayId, mentionId, key } = resolveSenderIdsGlobal(rawJid, participantIndex);
      if (!displayId || !key) return;
      const total = Number(row.total_messages || 0);
      const firstMs = toMillis(row.first_message);
      const lastMs = toMillis(row.last_message);
      const current = normalizedTotals.get(key) || {
        sender_id: displayId,
        mention_id: mentionId,
        display_name: null,
        total_messages: 0,
        first_message: null,
        last_message: null,
      };
      current.total_messages += total;
      if (firstMs !== null) {
        current.first_message = current.first_message === null ? firstMs : Math.min(current.first_message, firstMs);
      }
      if (lastMs !== null) {
        current.last_message = current.last_message === null ? lastMs : Math.max(current.last_message, lastMs);
      }
      if (!current.mention_id && mentionId) {
        current.mention_id = mentionId;
      }
      if (isWhatsAppJid(rawJid)) {
        current.mention_id = rawJid;
      }
      if (!current.display_name) {
        const pushName = pushNameBySender.get(rawJid);
        if (pushName) current.display_name = pushName;
      }
      normalizedTotals.set(key, current);
    });

    const topRows = Array.from(normalizedTotals.values())
      .sort((a, b) => b.total_messages - a.total_messages)
      .slice(0, RANKING_LIMIT);
    for (const row of topRows) {
      const rawJid = row.sender_id;
      if (!rawJid) continue;

      const daysRows = await executeQuery(
        `SELECT DISTINCT DATE(ts) AS day
           FROM (
             SELECT ${TIMESTAMP_TO_DATETIME_SQL} AS ts
               FROM messages m
              WHERE m.sender_id = ?
                ${botJid ? 'AND m.sender_id <> ?' : ''}
                AND m.timestamp IS NOT NULL
           ) d
          WHERE d.ts IS NOT NULL
          ORDER BY day ASC`,
        botJid ? [rawJid, botJid] : [rawJid],
      );

      const days = (daysRows || []).map((item) => item.day).filter(Boolean);
      row.active_days = days.length;
      row.streak = 0;
      if (days.length) {
        let best = 1;
        let current = 1;
        let prev = new Date(`${days[0]}T00:00:00Z`).getTime();
        for (let i = 1; i < days.length; i += 1) {
          const currentDay = new Date(`${days[i]}T00:00:00Z`).getTime();
          const diff = currentDay - prev;
          if (diff === DAY_MS) {
            current += 1;
          } else {
            current = 1;
          }
          if (current > best) best = current;
          prev = currentDay;
        }
        row.streak = best;
      }

      const total = Number(row.total_messages || 0);
      const firstMs = toMillis(row.first_message);
      const lastMs = toMillis(row.last_message);
      if (firstMs !== null && lastMs !== null && total > 0) {
        const rangeDays = Math.max(1, Math.ceil((lastMs - firstMs) / DAY_MS) + 1);
        row.avg_per_day = (total / rangeDays).toFixed(2);
      } else {
        row.avg_per_day = '0.00';
      }

      const [favRow] = await executeQuery(
        `SELECT
            ${MESSAGE_TYPE_SQL} AS message_type,
            COUNT(*) AS total
          FROM messages m
          WHERE m.sender_id = ?
            ${botJid ? 'AND m.sender_id <> ?' : ''}
            AND m.raw_message IS NOT NULL
          GROUP BY message_type
          ORDER BY total DESC
          LIMIT 1`,
        botJid ? [rawJid, botJid] : [rawJid],
      );
      row.favorite_type = favRow?.message_type || null;
      row.favorite_count = Number(favRow?.total || 0);
    }
    const top5Total = topRows.reduce((acc, row) => acc + Number(row.total_messages || 0), 0);

    const dbStartRows = await executeQuery(
      botJid
        ? 'SELECT MIN(timestamp) AS db_start FROM messages WHERE sender_id <> ?'
        : 'SELECT MIN(timestamp) AS db_start FROM messages',
      botJid ? [botJid] : [],
    );
    const dbStart = dbStartRows[0]?.db_start || null;

    const mentions = topRows
      .map((row) => row.mention_id)
      .filter((jid) => isWhatsAppJid(jid));

    const text = buildGlobalRankingMessage(
      topRows,
      dbStart,
      totalMessages,
      top5Total,
      topTypeRow ? { label: topTypeRow.message_type, count: topTypeRow.total } : null,
    );
    await sock.sendMessage(remoteJid, { text, mentions }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
  } catch (error) {
    logger.error('Erro ao gerar ranking global:', { error: error.message });
    await sock.sendMessage(remoteJid, { text: `Erro ao gerar ranking global: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
  }
}
