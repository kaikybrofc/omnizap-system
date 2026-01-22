import { executeQuery } from '../../../database/index.js';
import logger from '../../utils/logger/loggerModule.js';
import { getGroupParticipants, _matchesParticipantId } from '../../config/groupUtils.js';
import {
  assignClanNamesFromList,
  buildGraphData,
  buildInfluenceRanking,
  buildSocialRanking,
} from './interactionGraphCommand.js';

/**
 * Função formatDate.
 * @param {*} value - Parâmetro.
 * @returns {*} - Retorno.
 */
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

/**
 * Função getTargetJid.
 * @param {*} messageInfo - Parâmetro.
 * @param {*} args - Parâmetro.
 * @param {*} senderJid - Parâmetro.
 * @returns {*} - Retorno.
 */
const getTargetJid = (messageInfo, args, senderJid) => {
  const mentioned = messageInfo.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  if (mentioned.length > 0) return mentioned[0];

  const repliedTo = messageInfo.message?.extendedTextMessage?.contextInfo?.participant;
  if (repliedTo) return repliedTo;

  const argJid = args.find((arg) => arg.includes('@s.whatsapp.net'));
  if (argJid) return argJid;

  return senderJid;
};

/**
 * Função resolveRoleLabel.
 * @param {*} participant - Parâmetro.
 * @returns {*} - Retorno.
 */
const resolveRoleLabel = (participant) => {
  if (!participant) return 'membro';
  if (participant.admin === 'superadmin') return 'superadmin';
  if (participant.admin === 'admin' || participant.isAdmin === true) return 'admin';
  return 'membro';
};

/**
 * Função hslToColorName.
 * @param {*} hsl - Parâmetro.
 * @returns {*} - Retorno.
 */
const hslToColorName = (hsl) => {
  if (!hsl || typeof hsl !== 'string') return 'sem cor';
  const match = /hsl\((\d+),\s*(\d+)%?,\s*(\d+)%?\)/i.exec(hsl);
  if (!match) return 'sem cor';
  const hue = Number(match[1]);
  if (Number.isNaN(hue)) return 'sem cor';
  const h = ((hue % 360) + 360) % 360;
  if (h < 15 || h >= 345) return 'vermelho';
  if (h < 45) return 'laranja';
  if (h < 70) return 'amarelo';
  if (h < 160) return 'verde';
  if (h < 200) return 'turquesa';
  if (h < 250) return 'azul';
  if (h < 290) return 'roxo';
  if (h < 330) return 'magenta';
  return 'rosa';
};

/**
 * Função buildProfileText.
 * @param {*} handle - Parâmetro.
 * @param {*} totalMessages - Parâmetro.
 * @param {*} firstMessage - Parâmetro.
 * @param {*} lastMessage - Parâmetro.
 * @param {*} activeDays - Parâmetro.
 * @param {*} avgPerDay - Parâmetro.
 * @param {*} percentOfGroup - Parâmetro.
 * @param {*} rank - Parâmetro.
 * @param {*} role - Parâmetro.
 * @param {*} dbStart - Parâmetro.
 * @returns {*} - Retorno.
 */
const buildProfileText = ({ handle, totalMessages, firstMessage, lastMessage, activeDays, avgPerDay, percentOfGroup, rank, role, dbStart }) => {
  const lines = ['👤 *Perfil no grupo*', '', `🔹 *Usuário:* ${handle}`, `🔸 *Cargo:* ${role}`, `💬 *Mensagens:* ${totalMessages}`, `📅 *Primeira:* ${formatDate(firstMessage)}`, `🕘 *Última:* ${formatDate(lastMessage)}`, `📆 *Dias ativos:* ${activeDays}`, `📈 *Média/dia:* ${avgPerDay}`, `📊 *Participação:* ${percentOfGroup}`];

  if (rank !== null) {
    lines.push(`🏆 *Ranking:* #${rank}`);
  }

  lines.push('', `🧾 *Início da contagem:* ${formatDate(dbStart)}`);
  return lines.join('\n');
};

/**
 * Função handleProfileCommand.
 * @param {*} sock - Parâmetro.
 * @param {*} remoteJid - Parâmetro.
 * @param {*} messageInfo - Parâmetro.
 * @param {*} expirationMessage - Parâmetro.
 * @param {*} isGroupMessage - Parâmetro.
 * @param {*} senderJid - Parâmetro.
 * @param {*} args - Parâmetro.
 * @returns {*} - Retorno.
 */
export async function handleProfileCommand({ sock, remoteJid, messageInfo, expirationMessage, isGroupMessage, senderJid, args }) {
  if (!isGroupMessage) {
    await sock.sendMessage(remoteJid, { text: 'Este comando só pode ser usado em grupos.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
    return;
  }

  const targetJid = getTargetJid(messageInfo, args, senderJid);
  if (!targetJid) {
    await sock.sendMessage(remoteJid, { text: 'Não foi possível identificar o usuário.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
    return;
  }

  try {
    const [userStats] = await executeQuery(
      `SELECT COUNT(*) AS total_messages,
              MIN(timestamp) AS first_message,
              MAX(timestamp) AS last_message,
              COUNT(DISTINCT DATE(timestamp)) AS active_days
         FROM messages
        WHERE chat_id = ?
          AND sender_id = ?`,
      [remoteJid, targetJid],
    );

    const [groupStats] = await executeQuery('SELECT COUNT(*) AS total_messages FROM messages WHERE chat_id = ?', [remoteJid]);

    const [dbStartRow] = await executeQuery('SELECT MIN(timestamp) AS db_start FROM messages');

    const totalMessages = Number(userStats?.total_messages || 0);
    const groupTotal = Number(groupStats?.total_messages || 0);
    const percentOfGroup = groupTotal > 0 ? `${((totalMessages / groupTotal) * 100).toFixed(2)}%` : '0%';

    let rank = null;
    if (totalMessages > 0) {
      const [rankRow] = await executeQuery(
        `SELECT COUNT(*) AS higher_count
           FROM (
             SELECT sender_id, COUNT(*) AS total
               FROM messages
              WHERE chat_id = ?
              GROUP BY sender_id
           ) totals
          WHERE totals.total > ?`,
        [remoteJid, totalMessages],
      );
      rank = Number(rankRow?.higher_count || 0) + 1;
    }

    const firstMessage = userStats?.first_message || null;
    const lastMessage = userStats?.last_message || null;
    const activeDays = Number(userStats?.active_days || 0);

    let avgPerDay = '0';
    if (firstMessage && lastMessage && totalMessages > 0) {
      const diffMs = new Date(lastMessage).getTime() - new Date(firstMessage).getTime();
      const rangeDays = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)) + 1);
      avgPerDay = (totalMessages / rangeDays).toFixed(2);
    }

    const participants = await getGroupParticipants(remoteJid);
    const participant = participants?.find((p) => _matchesParticipantId(p, targetJid));
    const role = resolveRoleLabel(participant);

    const handle = `@${targetJid.split('@')[0]}`;
    const text = buildProfileText({
      handle,
      totalMessages,
      firstMessage,
      lastMessage,
      activeDays,
      avgPerDay,
      percentOfGroup,
      rank,
      role,
      dbStart: dbStartRow?.db_start || null,
    });

    const rows = await executeQuery(
      `SELECT
        e.src,
        (
          SELECT JSON_UNQUOTE(JSON_EXTRACT(m2.raw_message, '$.pushName'))
          FROM messages m2
          WHERE m2.sender_id = e.src
            AND m2.raw_message IS NOT NULL
            AND JSON_EXTRACT(m2.raw_message, '$.pushName') IS NOT NULL
          ORDER BY m2.id DESC
          LIMIT 1
        ) AS src_pushName,
        e.dst,
        (
          SELECT JSON_UNQUOTE(JSON_EXTRACT(m3.raw_message, '$.pushName'))
          FROM messages m3
          WHERE m3.sender_id = e.dst
            AND m3.raw_message IS NOT NULL
            AND JSON_EXTRACT(m3.raw_message, '$.pushName') IS NOT NULL
          ORDER BY m3.id DESC
          LIMIT 1
        ) AS dst_pushName,
        e.replies AS replies_a_para_b,
        IFNULL(r.replies, 0) AS replies_b_para_a,
        (e.replies + IFNULL(r.replies, 0)) AS replies_total_par
      FROM
      (
        SELECT
          m.sender_id AS src,
          JSON_UNQUOTE(
            COALESCE(
              JSON_EXTRACT(m.raw_message, '$.message.extendedTextMessage.contextInfo.participant'),
              JSON_EXTRACT(m.raw_message, '$.message.extendedTextMessage.contextInfo.mentionedJid[0]'),
              JSON_EXTRACT(m.raw_message, '$.message.imageMessage.contextInfo.participant'),
              JSON_EXTRACT(m.raw_message, '$.message.imageMessage.contextInfo.mentionedJid[0]'),
              JSON_EXTRACT(m.raw_message, '$.message.videoMessage.contextInfo.participant'),
              JSON_EXTRACT(m.raw_message, '$.message.videoMessage.contextInfo.mentionedJid[0]'),
              JSON_EXTRACT(m.raw_message, '$.message.documentMessage.contextInfo.participant'),
              JSON_EXTRACT(m.raw_message, '$.message.documentMessage.contextInfo.mentionedJid[0]')
            )
          ) AS dst,
          COUNT(*) AS replies
        FROM messages m
        WHERE m.raw_message IS NOT NULL
          AND m.sender_id IS NOT NULL
          AND COALESCE(
            JSON_EXTRACT(m.raw_message, '$.message.extendedTextMessage.contextInfo.participant'),
            JSON_EXTRACT(m.raw_message, '$.message.extendedTextMessage.contextInfo.mentionedJid[0]'),
            JSON_EXTRACT(m.raw_message, '$.message.imageMessage.contextInfo.participant'),
            JSON_EXTRACT(m.raw_message, '$.message.imageMessage.contextInfo.mentionedJid[0]'),
            JSON_EXTRACT(m.raw_message, '$.message.videoMessage.contextInfo.participant'),
            JSON_EXTRACT(m.raw_message, '$.message.videoMessage.contextInfo.mentionedJid[0]'),
            JSON_EXTRACT(m.raw_message, '$.message.documentMessage.contextInfo.participant'),
            JSON_EXTRACT(m.raw_message, '$.message.documentMessage.contextInfo.mentionedJid[0]')
          ) IS NOT NULL
        GROUP BY src, dst
      ) e
      LEFT JOIN
      (
        SELECT
          m.sender_id AS src,
          JSON_UNQUOTE(
            COALESCE(
              JSON_EXTRACT(m.raw_message, '$.message.extendedTextMessage.contextInfo.participant'),
              JSON_EXTRACT(m.raw_message, '$.message.extendedTextMessage.contextInfo.mentionedJid[0]'),
              JSON_EXTRACT(m.raw_message, '$.message.imageMessage.contextInfo.participant'),
              JSON_EXTRACT(m.raw_message, '$.message.imageMessage.contextInfo.mentionedJid[0]'),
              JSON_EXTRACT(m.raw_message, '$.message.videoMessage.contextInfo.participant'),
              JSON_EXTRACT(m.raw_message, '$.message.videoMessage.contextInfo.mentionedJid[0]'),
              JSON_EXTRACT(m.raw_message, '$.message.documentMessage.contextInfo.participant'),
              JSON_EXTRACT(m.raw_message, '$.message.documentMessage.contextInfo.mentionedJid[0]')
            )
          ) AS dst,
          COUNT(*) AS replies
        FROM messages m
        WHERE m.raw_message IS NOT NULL
          AND m.sender_id IS NOT NULL
          AND COALESCE(
            JSON_EXTRACT(m.raw_message, '$.message.extendedTextMessage.contextInfo.participant'),
            JSON_EXTRACT(m.raw_message, '$.message.extendedTextMessage.contextInfo.mentionedJid[0]'),
            JSON_EXTRACT(m.raw_message, '$.message.imageMessage.contextInfo.participant'),
            JSON_EXTRACT(m.raw_message, '$.message.imageMessage.contextInfo.mentionedJid[0]'),
            JSON_EXTRACT(m.raw_message, '$.message.videoMessage.contextInfo.participant'),
            JSON_EXTRACT(m.raw_message, '$.message.videoMessage.contextInfo.mentionedJid[0]'),
            JSON_EXTRACT(m.raw_message, '$.message.documentMessage.contextInfo.participant'),
            JSON_EXTRACT(m.raw_message, '$.message.documentMessage.contextInfo.mentionedJid[0]')
          ) IS NOT NULL
        GROUP BY src, dst
      ) r
        ON r.src = e.dst
       AND r.dst = e.src
      WHERE e.dst IS NOT NULL
        AND e.dst <> ''
        AND e.src <> e.dst
      ORDER BY replies_total_par DESC
      LIMIT 800`,
      [],
    );

    const { names } = buildSocialRanking(rows);
    const graphData = buildGraphData(rows, names);
    const clustersWithKeywords = assignClanNamesFromList(graphData.clusters);
    const clanByJid = new Map();
    clustersWithKeywords.forEach((cluster) => {
      cluster.members.forEach((jid) => clanByJid.set(jid, cluster.keyword || 'nd'));
    });
    const clanColorByJid = new Map();
    graphData.nodeClusters.forEach((clusterId, jid) => {
      const color = graphData.clusterColors.get(clusterId);
      if (color) clanColorByJid.set(jid, color);
    });
    const influenceRanking = buildInfluenceRanking({
      nodes: graphData.nodes,
      edges: graphData.edges,
      nodeClusters: graphData.nodeClusters,
    });

    const userNode = graphData.nodes.find((node) => node.jid === targetJid);
    const totalInteractions = Number(userNode?.total || 0);
    const repliesSent = rows.reduce((acc, row) => acc + (row.src === targetJid ? Number(row.replies_a_para_b || 0) : 0), 0);
    const repliesReceived = rows.reduce((acc, row) => acc + (row.dst === targetJid ? Number(row.replies_a_para_b || 0) : 0), 0);
    const partners = new Set();
    rows.forEach((row) => {
      if (row.src === targetJid && row.dst) partners.add(row.dst);
      if (row.dst === targetJid && row.src) partners.add(row.src);
    });
    const clanName = clanByJid.get(targetJid) || 'N/D';
    const clanColor = hslToColorName(clanColorByJid.get(targetJid));
    const influenceIndex = influenceRanking.findIndex((entry) => entry.jid === targetJid);
    const influenceRank = influenceIndex >= 0 ? `#${influenceIndex + 1}` : 'N/D';

    const socialLines = [
      '',
      '🌐 *Social global*',
      `🧩 *Clan:* ${clanName} (${clanColor})`,
      `🔁 *Interações:* ${totalInteractions}`,
      `📤 *Respostas enviadas:* ${repliesSent}`,
      `📥 *Respostas recebidas:* ${repliesReceived}`,
      `🤝 *Conexões únicas:* ${partners.size}`,
      `⭐ *Influência (aprox):* ${influenceRank}`,
    ];

    await sock.sendMessage(
      remoteJid,
      { text: `${text}\n${socialLines.join('\n')}`, mentions: [targetJid] },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  } catch (error) {
    logger.error('Erro ao gerar perfil do usuário:', { error: error.message });
    await sock.sendMessage(remoteJid, { text: `Erro ao gerar perfil: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
  }
}