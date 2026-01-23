import { createCanvas, loadImage } from 'canvas';
import { executeQuery } from '../../../database/index.js';
import logger from '../../utils/logger/loggerModule.js';
import { getGroupParticipants, _matchesParticipantId } from '../../config/groupUtils.js';
import { getProfilePicBuffer } from '../../config/baileysConfig.js';

const CLAN_NAME_LIST = [
  'Alpha',
  'Beta',
  'Gamma',
  'Delta',
  'Epsilon',
  'Zeta',
  'Eta',
  'Theta',
  'Iota',
  'Kappa',
  'Lambda',
  'Mu',
  'Nu',
  'Xi',
  'Omicron',
  'Pi',
  'Rho',
  'Sigma',
  'Tau',
  'Upsilon',
  'Phi',
  'Chi',
  'Psi',
  'Omega',
];

const CACHE_TTL_MS = 15 * 60 * 1000;
const SOCIAL_CACHE = new Map();

const SOCIAL_RECENT_DAYS = 60;
const SOCIAL_GRAPH_LIMIT = 20000;
const SOCIAL_NODE_LIMIT = 180;
const SOCIAL_SCOPE_GROUP = 'grupo atual';
const SOCIAL_SCOPE_GLOBAL = 'global do bot';

const PROFILE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const PROFILE_CACHE_LIMIT = 300;
const PROFILE_PIC_CACHE = new Map();

const getCacheKey = (focusJid, remoteJid) =>
  focusJid ? `focus:${remoteJid || 'global'}:${focusJid}` : 'global';

/**
 * Função filterRowsWithoutBot.
 * @param {*} rows - Parâmetro.
 * @param {*} botJid - Parâmetro.
 * @returns {*} - Retorno.
 */
const filterRowsWithoutBot = (rows, botJid) => {
  if (!botJid) return rows;
  return (rows || []).filter((row) => row.src !== botJid && row.dst !== botJid);
};

/**
 * Função getCachedResult.
 * @param {*} key - Parâmetro.
 * @returns {*} - Retorno.
 */
const getCachedResult = (key) => {
  const entry = SOCIAL_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    SOCIAL_CACHE.delete(key);
    return null;
  }
  return entry;
};

/**
 * Função setCachedResult.
 * @param {*} key - Parâmetro.
 * @param {*} payload - Parâmetro.
 * @returns {*} - Retorno.
 */
const setCachedResult = (key, payload) => {
  SOCIAL_CACHE.set(key, { ...payload, createdAt: Date.now() });
  if (SOCIAL_CACHE.size > 20) {
    const oldestKey = Array.from(SOCIAL_CACHE.entries()).sort(
      (a, b) => a[1].createdAt - b[1].createdAt,
    )[0]?.[0];
    if (oldestKey) SOCIAL_CACHE.delete(oldestKey);
  }
};

const getCachedProfilePic = (jid) => {
  const entry = PROFILE_PIC_CACHE.get(jid);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > PROFILE_CACHE_TTL_MS) {
    PROFILE_PIC_CACHE.delete(jid);
    return null;
  }
  return entry.buffer || null;
};

const setCachedProfilePic = (jid, buffer) => {
  if (!jid || !buffer) return;
  PROFILE_PIC_CACHE.set(jid, { buffer, createdAt: Date.now() });
  if (PROFILE_PIC_CACHE.size > PROFILE_CACHE_LIMIT) {
    const oldestKey = Array.from(PROFILE_PIC_CACHE.entries()).sort(
      (a, b) => a[1].createdAt - b[1].createdAt,
    )[0]?.[0];
    if (oldestKey) PROFILE_PIC_CACHE.delete(oldestKey);
  }
};

const fetchProfileBuffer = async (sock, jid, remoteJid) => {
  const cached = getCachedProfilePic(jid);
  if (cached) return cached;
  const buffer = await getProfilePicBuffer(sock, { key: { participant: jid, remoteJid } });
  if (buffer) setCachedProfilePic(jid, buffer);
  return buffer;
};

const loadProfileImages = async ({ sock, jids, remoteJid, concurrency = 6 }) => {
  const results = new Map();
  const queue = Array.from(new Set((jids || []).filter(Boolean)));
  let index = 0;

  const worker = async () => {
    while (index < queue.length) {
      const jid = queue[index];
      index += 1;
      if (results.has(jid)) continue;
      try {
        const buffer = await fetchProfileBuffer(sock, jid, remoteJid);
        if (!buffer) continue;
        const image = await loadImage(buffer);
        results.set(jid, image);
      } catch (error) {
        logger.warn('Falha ao carregar imagem de perfil para o social.', { error: error.message });
      }
    }
  };

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  return results;
};

const limitGraphData = (graphData, limit) => {
  if (!graphData || !Array.isArray(graphData.nodes) || graphData.nodes.length <= limit) {
    return graphData;
  }

  const nodes = graphData.nodes.slice(0, limit);
  const allowed = new Set(nodes.map((node) => node.jid));
  const edges = (graphData.edges || []).filter((edge) => allowed.has(edge.src) && allowed.has(edge.dst));

  const nodeClusters = new Map();
  (graphData.nodeClusters || new Map()).forEach((clusterId, jid) => {
    if (allowed.has(jid)) nodeClusters.set(jid, clusterId);
  });

  const clusterMap = new Map();
  nodeClusters.forEach((clusterId, jid) => {
    if (!clusterMap.has(clusterId)) clusterMap.set(clusterId, []);
    clusterMap.get(clusterId).push(jid);
  });

  const clusters = Array.from(clusterMap.entries())
    .map(([id, members]) => ({ id, members }))
    .sort((a, b) => b.members.length - a.members.length);

  return {
    nodes,
    edges,
    clusters,
    clusterColors: graphData.clusterColors,
    nodeClusters,
  };
};

/**
 * Função assignClanNamesFromList.
 * @param {*} clusters - Parâmetro.
 * @param {*} list - Parâmetro.
 * @returns {*} - Retorno.
 */
const assignClanNamesFromList = (clusters, list = CLAN_NAME_LIST) => {
  if (!clusters || !clusters.length) return clusters || [];
  return clusters.map((cluster, index) => {
    const baseName = list[index % list.length] || 'Clan';
    const suffix = index >= list.length ? ` ${Math.floor(index / list.length) + 1}` : '';
    return { ...cluster, keyword: `${baseName}${suffix}` };
  });
};

/**
 * Função getDisplayLabel.
 * @param {*} jid - Parâmetro.
 * @param {*} pushName - Parâmetro.
 * @returns {*} - Retorno.
 */
const getDisplayLabel = (jid, pushName) => {
  if (!jid || typeof jid !== 'string') return 'Desconhecido';
  const handle = `@${jid.split('@')[0]}`;
  if (pushName && typeof pushName === 'string' && pushName.trim() !== '') {
    return `${handle} (${pushName.trim()})`;
  }
  return handle;
};

/**
 * Função getNameLabel.
 * @param {*} jid - Parâmetro.
 * @param {*} pushName - Parâmetro.
 * @returns {*} - Retorno.
 */
const getNameLabel = (jid, pushName) => {
  if (pushName && typeof pushName === 'string' && pushName.trim() !== '') {
    return pushName.trim();
  }
  if (!jid || typeof jid !== 'string') return 'Desconhecido';
  return `@${jid.split('@')[0]}`;
};

/**
 * Função normalizeJidWithParticipants.
 * @param {*} value - Parâmetro.
 * @param {*} participantIndex - Parâmetro.
 * @returns {*} - Retorno.
 */
const normalizeJidWithParticipants = (value, participantIndex) => {
  if (!value || !participantIndex) return value;
  return participantIndex.get(value) || value;
};

/**
 * Função getFocusJid.
 * @param {*} messageInfo - Parâmetro.
 * @param {*} args - Parâmetro.
 * @param {*} senderJid - Parâmetro.
 * @returns {*} - Retorno.
 */
const getFocusJid = (messageInfo, args, senderJid) => {
  const mentioned = messageInfo.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  if (mentioned.length > 0) return mentioned[0];

  const repliedTo = messageInfo.message?.extendedTextMessage?.contextInfo?.participant;
  if (repliedTo) return repliedTo;

  const focusIndex = args.findIndex((arg) => ['foco', 'focus'].includes(arg.toLowerCase()));
  if (focusIndex >= 0) {
    if (args[focusIndex + 1] && args[focusIndex + 1].includes('@')) {
      return args[focusIndex + 1];
    }
    return senderJid || null;
  }

  const argJid = args.find((arg) => arg.includes('@s.whatsapp.net'));
  if (argJid) return argJid;

  return null;
};

/**
 * Função buildSocialRanking.
 * @param {*} rows - Parâmetro.
 * @returns {*} - Retorno.
 */
const buildSocialRanking = (rows) => {
  const totals = new Map();
  const partners = new Map();
  const names = new Map();

  rows.forEach((row) => {
    const total = Number(row.replies_total_par || 0);
    if (!row.src || !row.dst || total <= 0) return;

    if (row.src_pushName) names.set(row.src, row.src_pushName);
    if (row.dst_pushName) names.set(row.dst, row.dst_pushName);

    totals.set(row.src, (totals.get(row.src) || 0) + total);
    totals.set(row.dst, (totals.get(row.dst) || 0) + total);

    if (!partners.has(row.src)) partners.set(row.src, new Map());
    if (!partners.has(row.dst)) partners.set(row.dst, new Map());
    partners.get(row.src).set(row.dst, (partners.get(row.src).get(row.dst) || 0) + total);
    partners.get(row.dst).set(row.src, (partners.get(row.dst).get(row.src) || 0) + total);
  });

  const ranking = Array.from(totals.entries())
    .map(([jid, total]) => {
      const partnerMap = partners.get(jid) || new Map();
      const topPartners = Array.from(partnerMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([partnerJid, count]) => ({ jid: partnerJid, count }));
      return { jid, total, topPartners };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  return { ranking, totals, partners, names };
};

/**
 * Função formatDuration.
 * @param {*} ms - Parâmetro.
 * @returns {*} - Retorno.
 */
const formatDuration = (ms) => {
  if (!Number.isFinite(ms) || ms <= 0) return 'N/D';
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (ms >= day) return `${(ms / day).toFixed(1)}d`;
  if (ms >= hour) return `${(ms / hour).toFixed(1)}h`;
  if (ms >= minute) return `${Math.round(ms / minute)}m`;
  return `${Math.round(ms / 1000)}s`;
};

/**
 * Função toMillis.
 * @param {*} value - Parâmetro.
 * @returns {*} - Retorno.
 */
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
const buildProfileText = ({
  handle,
  totalMessages,
  firstMessage,
  lastMessage,
  activeDays,
  avgPerDay,
  percentOfGroup,
  rank,
  role,
  dbStart,
}) => {
  const lines = [
    `🔹 Usuário: ${handle}`,
    `🔸 Cargo: ${role}`,
    `💬 Mensagens: ${totalMessages}`,
    `📅 Primeira: ${formatDate(firstMessage)}`,
    `🕘 Última: ${formatDate(lastMessage)}`,
    `📆 Dias ativos: ${activeDays}`,
    `📈 Média/dia: ${avgPerDay}`,
    `📊 Participação: ${percentOfGroup}`,
  ];

  if (rank !== null) {
    lines.push(`🏆 Ranking: #${rank}`);
  }

  lines.push('ℹ️ Ranking é do grupo e pode ser visto com /rank.');
  lines.push(`🧾 Início da contagem: ${formatDate(dbStart)}`);
  return lines.join('\n');
};

/**
 * Função buildProfileSection.
 * @param {*} remoteJid - Parâmetro.
 * @param {*} focusJid - Parâmetro.
 * @param {*} isGroupMessage - Parâmetro.
 * @param {*} botJid - Parâmetro.
 * @returns {*} - Retorno.
 */
const buildProfileSection = async ({ remoteJid, focusJid, isGroupMessage, botJid }) => {
  if (!focusJid || !isGroupMessage) return null;
  const [userStats] = await executeQuery(
    `SELECT COUNT(*) AS total_messages,
            MIN(timestamp) AS first_message,
            MAX(timestamp) AS last_message,
            COUNT(DISTINCT DATE(timestamp)) AS active_days
       FROM messages
      WHERE chat_id = ?
        AND sender_id = ?`,
    [remoteJid, focusJid],
  );

  const [groupStats] = await executeQuery(
    botJid
      ? 'SELECT COUNT(*) AS total_messages FROM messages WHERE chat_id = ? AND sender_id <> ?'
      : 'SELECT COUNT(*) AS total_messages FROM messages WHERE chat_id = ?',
    botJid ? [remoteJid, botJid] : [remoteJid],
  );
  const [dbStartRow] = await executeQuery(
    botJid
      ? 'SELECT MIN(timestamp) AS db_start FROM messages WHERE sender_id <> ?'
      : 'SELECT MIN(timestamp) AS db_start FROM messages',
    botJid ? [botJid] : [],
  );

  const totalMessages = Number(userStats?.total_messages || 0);
  const groupTotal = Number(groupStats?.total_messages || 0);
  const percentOfGroup =
    groupTotal > 0 ? `${((totalMessages / groupTotal) * 100).toFixed(2)}%` : '0%';

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
  const participant = participants?.find((p) => _matchesParticipantId(p, focusJid));
  const role = resolveRoleLabel(participant);

  const handle = `@${focusJid.split('@')[0]}`;
  return buildProfileText({
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
};

/**
 * Função computeReciprocityAndAvg.
 * @param {*} rows - Parâmetro.
 * @returns {*} - Retorno.
 */
const computeReciprocityAndAvg = (rows) => {
  const reciprocityTotals = rows.reduce(
    (acc, row) => {
      const aToB = Number(row.replies_a_para_b || 0);
      const bToA = Number(row.replies_b_para_a || 0);
      if (aToB <= 0 && bToA <= 0) return acc;
      acc.min += Math.min(aToB, bToA);
      acc.max += Math.max(aToB, bToA);
      return acc;
    },
    { min: 0, max: 0 },
  );
  const reciprocity =
    reciprocityTotals.max > 0
      ? Math.round((reciprocityTotals.min / reciprocityTotals.max) * 100)
      : 0;

  const responseTimes = rows.reduce(
    (acc, row) => {
      const aCount = Number(row.replies_a_para_b || 0);
      const bCount = Number(row.replies_b_para_a || 0);
      const aFirst = toMillis(row.primeira_interacao_a_para_b);
      const aLast = toMillis(row.ultima_interacao_a_para_b);
      const bFirst = toMillis(row.primeira_interacao_b_para_a);
      const bLast = toMillis(row.ultima_interacao_b_para_a);
      if (aCount > 0 && aFirst !== null && aLast !== null && aLast >= aFirst) {
        acc.totalMs += aLast - aFirst;
        acc.totalCount += aCount;
      }
      if (bCount > 0 && bFirst !== null && bLast !== null && bLast >= bFirst) {
        acc.totalMs += bLast - bFirst;
        acc.totalCount += bCount;
      }
      return acc;
    },
    { totalMs: 0, totalCount: 0 },
  );
  const avgResponseMs =
    responseTimes.totalCount > 0 ? responseTimes.totalMs / responseTimes.totalCount : 0;
  return { reciprocity, avgResponseMs };
};

/**
 * Função buildInfluenceRanking.
 * @param {*} nodes - Parâmetro.
 * @param {*} edges - Parâmetro.
 * @param {*} nodeClusters - Parâmetro.
 * @param {*} limit - Parâmetro.
 * @returns {*} - Retorno.
 */
const buildInfluenceRanking = ({ nodes, edges, nodeClusters, limit = 5 }) => {
  if (!nodes || !nodes.length || !edges || !edges.length) return [];
  const totals = new Map();
  const neighbors = new Map();
  const crossClan = new Map();
  edges.forEach((edge) => {
    if (!edge.src || !edge.dst) return;
    totals.set(edge.src, (totals.get(edge.src) || 0) + edge.total);
    totals.set(edge.dst, (totals.get(edge.dst) || 0) + edge.total);
    if (!neighbors.has(edge.src)) neighbors.set(edge.src, new Set());
    if (!neighbors.has(edge.dst)) neighbors.set(edge.dst, new Set());
    neighbors.get(edge.src).add(edge.dst);
    neighbors.get(edge.dst).add(edge.src);
    if (nodeClusters) {
      const clanA = nodeClusters.get(edge.src);
      const clanB = nodeClusters.get(edge.dst);
      if (clanA && clanB && clanA !== clanB) {
        crossClan.set(edge.src, (crossClan.get(edge.src) || 0) + edge.total);
        crossClan.set(edge.dst, (crossClan.get(edge.dst) || 0) + edge.total);
      }
    }
  });
  const ranking = Array.from(totals.entries())
    .map(([jid, total]) => {
      const degree = neighbors.get(jid)?.size || 0;
      const cross = crossClan.get(jid) || 0;
      const score = total + cross * 1.2 + degree * 3;
      return { jid, total, cross, degree, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return ranking;
};

const buildInteractionGraphMessage = ({
  rows,
  focusLabel,
  focusJid,
  runtimeNames,
  clanByJid,
  clanColorByJid,
  influenceRanking,
}) => {
  if (!rows.length) {
    return {
      lines: ['Nao ha respostas suficientes para gerar o ranking social.'],
      names: new Map(),
    };
  }

  const { ranking, partners, names } = buildSocialRanking(rows);
  if (!ranking.length) {
    return { lines: ['Nao ha respostas suficientes para gerar o ranking social.'], names };
  }

  if (runtimeNames) {
    runtimeNames.forEach((value, key) => {
      if (!names.get(key)) names.set(key, value);
    });
  }

  const { reciprocity, avgResponseMs } = computeReciprocityAndAvg(rows);

  const makeLine = (text, color) => (color ? { text, color } : text);
  /**
   * Função getNameWithClan.
   * @param {*} jid - Parâmetro.
   * @returns {*} - Retorno.
   */
  const getNameWithClan = (jid) => {
    const base = getNameLabel(jid, names.get(jid));
    const clan = clanByJid?.get(jid);
    return clan ? `${base} - ${clan}` : base;
  };
  const getLineColor = (jid) => clanColorByJid?.get(jid) || null;

  const focusLine = focusJid
    ? `Foco: ${getNameWithClan(focusJid)}`
    : focusLabel
      ? `Foco: ${focusLabel}`
      : 'Resumo social';
  const lines = [focusLine, ''];
  lines.push('Metricas', '');
  lines.push(`Reciprocidade: ${reciprocity}%`);
  lines.push(`Tempo medio de resposta: ${formatDuration(avgResponseMs)}`);
  lines.push('');
  if (influenceRanking && influenceRanking.length) {
    lines.push('Influentes (aprox)', '');
    influenceRanking.forEach((entry, index) => {
      const display = getNameWithClan(entry.jid);
      lines.push(
        makeLine(`${index + 1}. ${display} — ${Math.round(entry.score)}`, getLineColor(entry.jid)),
      );
    });
    lines.push('');
  }

  const connectors = Array.from(partners.entries())
    .map(([jid, map]) => ({ jid, degree: map.size }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 5);
  if (connectors.length) {
    lines.push('Conectores (top 5)', '');
    connectors.forEach((entry, index) => {
      const display = getNameWithClan(entry.jid);
      lines.push(
        makeLine(`${index + 1}. ${display} — ${entry.degree} pessoas`, getLineColor(entry.jid)),
      );
    });
    lines.push('');
  }

  const initiators = new Map();
  rows.forEach((row) => {
    const aToB = Number(row.replies_a_para_b || 0);
    const bToA = Number(row.replies_b_para_a || 0);
    if (row.dst && aToB > 0) {
      initiators.set(row.dst, (initiators.get(row.dst) || 0) + aToB);
    }
    if (row.src && bToA > 0) {
      initiators.set(row.src, (initiators.get(row.src) || 0) + bToA);
    }
  });
  const topInitiators = Array.from(initiators.entries())
    .map(([jid, total]) => ({ jid, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
  if (topInitiators.length) {
    lines.push('Iniciadores (top 5)', '');
    topInitiators.forEach((entry, index) => {
      const display = getNameWithClan(entry.jid);
      lines.push(makeLine(`${index + 1}. ${display} — ${entry.total}`, getLineColor(entry.jid)));
    });
    lines.push('');
  }

  return { lines, names };
};

/**
 * Função buildGraphData.
 * @param {*} rows - Parâmetro.
 * @param {*} names - Parâmetro.
 * @returns {*} - Retorno.
 */
const buildGraphData = (rows, names) => {
  const edges = rows
    .filter((row) => Number(row.replies_total_par || 0) > 0)
    .map((row) => ({
      src: row.src,
      dst: row.dst,
      total: Number(row.replies_total_par || 0),
    }));

  const nodesMap = new Map();
  edges.forEach((edge) => {
    nodesMap.set(edge.src, (nodesMap.get(edge.src) || 0) + edge.total);
    nodesMap.set(edge.dst, (nodesMap.get(edge.dst) || 0) + edge.total);
  });

  const nodes = Array.from(nodesMap.entries())
    .map(([jid, total]) => ({
      jid,
      total,
      label: getNameLabel(jid, names.get(jid)),
    }))
    .sort((a, b) => b.total - a.total);

  const adjacency = new Map();
  nodes.forEach((node) => {
    adjacency.set(node.jid, new Map());
  });
  edges.forEach((edge) => {
    if (!adjacency.has(edge.src) || !adjacency.has(edge.dst)) return;
    adjacency
      .get(edge.src)
      .set(edge.dst, (adjacency.get(edge.src).get(edge.dst) || 0) + edge.total);
    adjacency
      .get(edge.dst)
      .set(edge.src, (adjacency.get(edge.dst).get(edge.src) || 0) + edge.total);
  });

  const labels = new Map();
  nodes.forEach((node) => {
    labels.set(node.jid, node.jid);
  });

  const labelIterations = 12;
  for (let iter = 0; iter < labelIterations; iter += 1) {
    let changed = false;
    nodes.forEach((node) => {
      const neighbors = adjacency.get(node.jid);
      if (!neighbors || neighbors.size === 0) return;
      const scores = new Map();
      neighbors.forEach((weight, neighbor) => {
        const label = labels.get(neighbor);
        scores.set(label, (scores.get(label) || 0) + weight);
      });
      let bestLabel = labels.get(node.jid);
      let bestScore = -1;
      scores.forEach((score, label) => {
        if (score > bestScore) {
          bestScore = score;
          bestLabel = label;
        }
      });
      if (bestLabel && bestLabel !== labels.get(node.jid)) {
        labels.set(node.jid, bestLabel);
        changed = true;
      }
    });
    if (!changed) break;
  }

  const clusterMap = new Map();
  nodes.forEach((node) => {
    const label = labels.get(node.jid);
    if (!clusterMap.has(label)) clusterMap.set(label, []);
    clusterMap.get(label).push(node.jid);
  });

  const clusters = Array.from(clusterMap.entries())
    .map(([label, members]) => ({ id: label, members }))
    .sort((a, b) => b.members.length - a.members.length);

  const clusterColors = new Map();
  clusters.forEach((cluster, index) => {
    const hue = (index * 97) % 360;
    clusterColors.set(cluster.id, `hsl(${hue}, 70%, 55%)`);
  });

  const nodeClusters = new Map();
  clusters.forEach((cluster) => {
    cluster.members.forEach((jid) => nodeClusters.set(jid, cluster.id));
  });

  return { nodes, edges, clusters, clusterColors, nodeClusters };
};

/**
 * Função buildClusterSummaryLines.
 * @param {*} clusters - Parâmetro.
 * @param {*} names - Parâmetro.
 * @param {*} clusterColors - Parâmetro.
 * @param {*} clanByJid - Parâmetro.
 * @param {*} limit - Parâmetro.
 * @returns {*} - Retorno.
 */
const buildClusterSummaryLines = (clusters, names, clusterColors, clanByJid, limit = 3) => {
  if (!clusters || !clusters.length) return [];
  const makeLine = (text, color) => (color ? { text, color } : text);
  const lines = ['Clans (top 3)', ''];
  clusters.slice(0, limit).forEach((cluster, index) => {
    const keyword = cluster.keyword || 'nd';
    const clanColor = clusterColors?.get(cluster.id) || null;
    const members = cluster.members
      .slice(0, 6)
      .map((jid) => {
        const base = getNameLabel(jid, names.get(jid));
        const clan = clanByJid?.get(jid) || keyword;
        return `${base} - ${clan}`;
      })
      .join(', ');
    lines.push(`${index + 1}. ${keyword}`);
    lines.push(makeLine(`   ${members || 'N/D'}`, clanColor));
    if (cluster.members.length > 6) {
      lines.push(makeLine(`   +${cluster.members.length - 6} pessoas`, clanColor));
    }
    lines.push('');
  });
  return lines;
};

/**
 * Função buildClanLegendLines.
 * @param {*} clusters - Parâmetro.
 * @param {*} clusterColors - Parâmetro.
 * @param {*} limit - Parâmetro.
 * @returns {*} - Retorno.
 */
const buildClanLegendLines = (clusters, clusterColors, limit = 6) => {
  if (!clusters || !clusters.length) return [];
  const makeLine = (text, color) => (color ? { text, color } : text);
  const lines = ['Legenda de clans', ''];
  clusters.slice(0, limit).forEach((cluster) => {
    const keyword = cluster.keyword || 'nd';
    const color = clusterColors?.get(cluster.id) || null;
    lines.push(makeLine(`• ${keyword} — ${cluster.members.length} pessoas`, color));
  });
  lines.push('');
  return lines;
};

/**
 * Função buildClanCaptionLines.
 * @param {*} clusters - Parâmetro.
 * @param {*} clusterColors - Parâmetro.
 * @param {*} leaderByClanId - Parâmetro.
 * @param {*} names - Parâmetro.
 * @param {*} limit - Parâmetro.
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

const buildClanCaptionLines = (clusters, clusterColors, leaderByClanId, names, limit = 10) => {
  if (!clusters || !clusters.length) return [];
  const lines = ['🏷️ *Clans*', ''];
  clusters.slice(0, limit).forEach((cluster) => {
    const keyword = cluster.keyword || 'nd';
    const color = hslToColorName(clusterColors?.get(cluster.id));
    const leaderJid = leaderByClanId?.get(cluster.id);
    const leaderLabel = leaderJid ? getNameLabel(leaderJid, names?.get(leaderJid)) : 'N/D';
    lines.push(`• ${keyword} — ${color} — 👑 líder: ${leaderLabel}`);
  });
  return lines;
};

/**
 * Função buildClanBridgeLines.
 * @param {*} edges - Parâmetro.
 * @param {*} nodeClusters - Parâmetro.
 * @param {*} names - Parâmetro.
 * @param {*} clanByJid - Parâmetro.
 * @param {*} clanColorByJid - Parâmetro.
 * @param {*} limit - Parâmetro.
 * @returns {*} - Retorno.
 */
const buildClanBridgeLines = ({
  edges,
  nodeClusters,
  names,
  clanByJid,
  clanColorByJid,
  limit = 5,
}) => {
  if (!edges || !edges.length || !nodeClusters) return [];
  const totals = new Map();
  edges.forEach((edge) => {
    const clanA = nodeClusters.get(edge.src);
    const clanB = nodeClusters.get(edge.dst);
    if (!clanA || !clanB || clanA === clanB) return;
    totals.set(edge.src, (totals.get(edge.src) || 0) + edge.total);
    totals.set(edge.dst, (totals.get(edge.dst) || 0) + edge.total);
  });
  const ranking = Array.from(totals.entries())
    .map(([jid, total]) => ({ jid, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
  if (!ranking.length) return [];
  const makeLine = (text, color) => (color ? { text, color } : text);
  const lines = ['🌉 *Pontes entre clans*'];
  ranking.forEach((entry, index) => {
    const base = getNameLabel(entry.jid, names.get(entry.jid));
    const clan = clanByJid?.get(entry.jid);
    const label = clan ? `${base} - ${clan}` : base;
    const color = clanColorByJid?.get(entry.jid) || null;
    lines.push(makeLine(`${index + 1}. ${label} — ${entry.total}`, color));
  });
  lines.push('');
  return lines;
};

/**
 * Função buildClanLeaders.
 * @param {*} nodes - Parâmetro.
 * @param {*} nodeClusters - Parâmetro.
 * @returns {*} - Retorno.
 */
const buildClanLeaders = (nodes, nodeClusters) => {
  const leaders = new Set();
  if (!nodes || !nodes.length || !nodeClusters) return leaders;
  const bestByClan = new Map();
  nodes.forEach((node) => {
    const clan = nodeClusters.get(node.jid);
    if (!clan) return;
    const current = bestByClan.get(clan);
    if (!current || node.total > current.total) {
      bestByClan.set(clan, node);
    }
  });
  bestByClan.forEach((node) => leaders.add(node.jid));
  return leaders;
};

/**
 * Função buildClanLeaderMap.
 * @param {*} nodes - Parâmetro.
 * @param {*} nodeClusters - Parâmetro.
 * @returns {*} - Retorno.
 */
const buildClanLeaderMap = (nodes, nodeClusters) => {
  const leaderMap = new Map();
  if (!nodes || !nodes.length || !nodeClusters) return leaderMap;
  const bestByClan = new Map();
  nodes.forEach((node) => {
    const clan = nodeClusters.get(node.jid);
    if (!clan) return;
    const current = bestByClan.get(clan);
    if (!current || node.total > current.total) {
      bestByClan.set(clan, node);
    }
  });
  bestByClan.forEach((node, clanId) => leaderMap.set(clanId, node.jid));
  return leaderMap;
};

/**
 * Função buildGrowthLines.
 * @param {*} rows - Parâmetro.
 * @param {*} names - Parâmetro.
 * @param {*} limit - Parâmetro.
 * @returns {*} - Retorno.
 */
const buildGrowthLines = (rows, names, limit = 5) => {
  if (!rows || !rows.length) return [];
  const lines = ['📈 *Crescimento 30d*'];
  rows.slice(0, limit).forEach((row, index) => {
    const jid = row.jid;
    const label = getNameLabel(jid, names.get(jid));
    const delta = Number(row.delta || 0);
    const last30 = Number(row.last30 || 0);
    const prev30 = Number(row.prev30 || 0);
    const sign = delta >= 0 ? '+' : '';
    lines.push(`${index + 1}. ${label} — ${sign}${delta} (30d: ${last30}, prev: ${prev30})`);
  });
  lines.push('');
  return lines;
};

/**
 * Função buildTopMentionsLines.
 * @param {*} rows - Parâmetro.
 * @param {*} names - Parâmetro.
 * @param {*} clanByJid - Parâmetro.
 * @param {*} clanColorByJid - Parâmetro.
 * @param {*} limit - Parâmetro.
 * @returns {*} - Retorno.
 */
const buildTopMentionsLines = (rows, names, clanByJid, clanColorByJid, limit = 5) => {
  if (!rows || !rows.length) return [];
  const totals = new Map();
  rows.forEach((row) => {
    if (!row.dst) return;
    const total = Number(row.replies_total_par || 0);
    if (total <= 0) return;
    totals.set(row.dst, (totals.get(row.dst) || 0) + total);
  });
  const ranking = Array.from(totals.entries())
    .map(([jid, total]) => ({ jid, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
  if (!ranking.length) return [];
  const lines = ['💬 *Top citados*'];
  ranking.forEach((entry, index) => {
    const label = getNameLabel(entry.jid, names.get(entry.jid));
    const clan = clanByJid.get(entry.jid);
    const color = clanColorByJid.get(entry.jid);
    const text = `${index + 1}. ${clan ? `${label} - ${clan}` : label} — ${entry.total}`;
    lines.push(color ? { text, color } : text);
  });
  lines.push('');
  return lines;
};

/**
 * Função buildTopPairsLines.
 * @param {*} rows - Parâmetro.
 * @param {*} names - Parâmetro.
 * @param {*} clanByJid - Parâmetro.
 * @param {*} clanColorByJid - Parâmetro.
 * @param {*} limit - Parâmetro.
 * @returns {*} - Retorno.
 */
const buildTopPairsLines = (rows, names, clanByJid, clanColorByJid, limit = 5) => {
  if (!rows || !rows.length) return [];
  const totals = new Map();
  rows.forEach((row) => {
    if (!row.src || !row.dst) return;
    const total = Number(row.replies_total_par || 0);
    if (total <= 0) return;
    const pairKey = [row.src, row.dst].sort().join('|');
    totals.set(pairKey, (totals.get(pairKey) || 0) + total);
  });
  const ranking = Array.from(totals.entries())
    .map(([key, total]) => {
      const [a, b] = key.split('|');
      return { a, b, total };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
  if (!ranking.length) return [];
  const lines = ['🤝 *Duplas fortes*'];
  ranking.forEach((entry, index) => {
    const aLabel = getNameLabel(entry.a, names.get(entry.a));
    const bLabel = getNameLabel(entry.b, names.get(entry.b));
    const aClan = clanByJid.get(entry.a);
    const bClan = clanByJid.get(entry.b);
    const aColor = clanColorByJid.get(entry.a);
    const bColor = clanColorByJid.get(entry.b);
    const text = `${index + 1}. ${aClan ? `${aLabel} - ${aClan}` : aLabel} ↔ ${bClan ? `${bLabel} - ${bClan}` : bLabel} — ${entry.total}`;
    const color = aColor || bColor || null;
    lines.push(color ? { text, color } : text);
  });
  lines.push('');
  return lines;
};

/**
 * Função buildTopRepliesReceivedLines.
 * @param {*} rows - Parâmetro.
 * @param {*} names - Parâmetro.
 * @param {*} clanByJid - Parâmetro.
 * @param {*} clanColorByJid - Parâmetro.
 * @param {*} limit - Parâmetro.
 * @returns {*} - Retorno.
 */
const buildTopRepliesReceivedLines = (rows, names, clanByJid, clanColorByJid, limit = 5) => {
  if (!rows || !rows.length) return [];
  const totals = new Map();
  rows.forEach((row) => {
    if (!row.dst) return;
    const total = Number(row.replies_a_para_b || 0);
    if (total <= 0) return;
    totals.set(row.dst, (totals.get(row.dst) || 0) + total);
  });
  const ranking = Array.from(totals.entries())
    .map(([jid, total]) => ({ jid, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
  if (!ranking.length) return [];
  const lines = ['📥 *Top respostas recebidas*'];
  ranking.forEach((entry, index) => {
    const label = getNameLabel(entry.jid, names.get(entry.jid));
    const clan = clanByJid.get(entry.jid);
    const color = clanColorByJid.get(entry.jid);
    const text = `${index + 1}. ${clan ? `${label} - ${clan}` : label} — ${entry.total}`;
    lines.push(color ? { text, color } : text);
  });
  lines.push('');
  return lines;
};

/**
 * Função buildTopRepliesSentLines.
 * @param {*} rows - Parâmetro.
 * @param {*} names - Parâmetro.
 * @param {*} clanByJid - Parâmetro.
 * @param {*} clanColorByJid - Parâmetro.
 * @param {*} limit - Parâmetro.
 * @returns {*} - Retorno.
 */
const buildTopRepliesSentLines = (rows, names, clanByJid, clanColorByJid, limit = 5) => {
  if (!rows || !rows.length) return [];
  const totals = new Map();
  rows.forEach((row) => {
    if (!row.src) return;
    const total = Number(row.replies_a_para_b || 0);
    if (total <= 0) return;
    totals.set(row.src, (totals.get(row.src) || 0) + total);
  });
  const ranking = Array.from(totals.entries())
    .map(([jid, total]) => ({ jid, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
  if (!ranking.length) return [];
  const lines = ['📤 *Top respostas enviadas*'];
  ranking.forEach((entry, index) => {
    const label = getNameLabel(entry.jid, names.get(entry.jid));
    const clan = clanByJid.get(entry.jid);
    const color = clanColorByJid.get(entry.jid);
    const text = `${index + 1}. ${clan ? `${label} - ${clan}` : label} — ${entry.total}`;
    lines.push(color ? { text, color } : text);
  });
  lines.push('');
  return lines;
};

/**
 * Função buildTopActiveClansLines.
 * @param {*} rows - Parâmetro.
 * @param {*} clusters - Parâmetro.
 * @param {*} clusterColors - Parâmetro.
 * @param {*} limit - Parâmetro.
 * @returns {*} - Retorno.
 */
const buildTopActiveClansLines = (rows, clusters, clusterColors, limit = 5) => {
  if (!rows || !rows.length || !clusters || !clusters.length) return [];
  const clanTotals = new Map();
  const memberClan = new Map();
  const clanNames = new Map();
  clusters.forEach((cluster) => {
    cluster.members.forEach((jid) => memberClan.set(jid, cluster.id));
    clanNames.set(cluster.id, cluster.keyword || cluster.id);
  });
  rows.forEach((row) => {
    const total = Number(row.replies_total_par || 0);
    if (total <= 0) return;
    const clan = memberClan.get(row.src);
    if (clan) clanTotals.set(clan, (clanTotals.get(clan) || 0) + total);
  });
  const ranking = Array.from(clanTotals.entries())
    .map(([clanId, total]) => ({ clanId, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
  if (!ranking.length) return [];
  const lines = ['🔥 *Clans mais ativos*'];
  ranking.forEach((entry, index) => {
    const color = clusterColors.get(entry.clanId);
    const clanLabel = clanNames.get(entry.clanId) || entry.clanId;
    lines.push(
      color
        ? { text: `${index + 1}. ${clanLabel} — ${entry.total}`, color }
        : `${index + 1}. ${clanLabel} — ${entry.total}`,
    );
  });
  lines.push('');
  return lines;
};

/**
 * Função buildGlobalConnectorsLines.
 * @param {*} rows - Parâmetro.
 * @param {*} names - Parâmetro.
 * @param {*} clanByJid - Parâmetro.
 * @param {*} clanColorByJid - Parâmetro.
 * @param {*} limit - Parâmetro.
 * @returns {*} - Retorno.
 */
const buildGlobalConnectorsLines = (rows, names, clanByJid, clanColorByJid, limit = 5) => {
  if (!rows || !rows.length) return [];
  const neighbors = new Map();
  rows.forEach((row) => {
    if (!row.src || !row.dst) return;
    if (!neighbors.has(row.src)) neighbors.set(row.src, new Set());
    if (!neighbors.has(row.dst)) neighbors.set(row.dst, new Set());
    neighbors.get(row.src).add(row.dst);
    neighbors.get(row.dst).add(row.src);
  });
  const ranking = Array.from(neighbors.entries())
    .map(([jid, set]) => ({ jid, degree: set.size }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, limit);
  if (!ranking.length) return [];
  const lines = ['🧩 *Conectores globais*'];
  ranking.forEach((entry, index) => {
    const label = getNameLabel(entry.jid, names.get(entry.jid));
    const clan = clanByJid.get(entry.jid);
    const color = clanColorByJid.get(entry.jid);
    const text = `${index + 1}. ${clan ? `${label} - ${clan}` : label} — ${entry.degree}`;
    lines.push(color ? { text, color } : text);
  });
  lines.push('');
  return lines;
};

/**
 * Função buildSkewLines.
 * @param {*} ranking - Parâmetro.
 * @returns {*} - Retorno.
 */
const buildSkewLines = (ranking) => {
  if (!ranking || !ranking.length) return [];
  const top = Number(ranking[0]?.total || 0);
  const avg = ranking.reduce((acc, entry) => acc + Number(entry.total || 0), 0) / ranking.length;
  const skew = avg > 0 ? (top / avg).toFixed(2) : '0.00';
  return ['📊 *Skew do grafo*', `Top 1 / média: ${skew}x`, ''];
};

/**
 * Função filterImageSummaryLines.
 * @param {*} lines - Parâmetro.
 * @returns {*} - Retorno.
 */
const filterImageSummaryLines = (lines) => {
  const blockedHeaders = new Set(['Conectores (top 5)']);
  const filtered = [];
  let skipSection = false;
  const input = lines || [];
  input.forEach((line) => {
    const text = typeof line === 'string' ? line : line?.text || '';
    if (blockedHeaders.has(text)) {
      skipSection = true;
      return;
    }
    if (skipSection) {
      if (!text.trim()) {
        skipSection = false;
      }
      return;
    }
    filtered.push(line);
  });
  return filtered;
};

const linesToText = (lines) =>
  (lines || [])
    .map((line) => (typeof line === 'string' ? line : line?.text || ''))
    .join('\n')
    .trim();

const renderGraphImage = ({
  nodes,
  edges,
  directedEdges,
  summaryLines,
  clusterColors,
  nodeClusters,
  totalMessages,
  clanLeaders,
  focusJid,
  avatarImages,
  showPanel = true,
}) => {
  const width = 3200;
  const height = 2200;
  const panelWidth = showPanel ? 900 : 0;
  const scale = 2;
  const graphWidth = width - panelWidth;
  const canvas = createCanvas(width * scale, height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#e2e8f0';
  ctx.font = 'bold 32px Arial';
  ctx.textAlign = 'left';
  ctx.fillText('Grafo social global', 40, 50);

  if (showPanel) {
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(graphWidth, 0, panelWidth, height);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 24px Arial';
    ctx.fillText('Resumo', graphWidth + 24, 50);
    if (Number.isFinite(totalMessages)) {
      ctx.font = '16px Arial';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(`Total de mensagens: ${Math.round(totalMessages)}`, graphWidth + 24, 80);
      ctx.fillStyle = '#e2e8f0';
    }
  }

  if (!nodes.length) {
    ctx.font = '16px Arial';
    ctx.fillText('Sem dados suficientes para desenhar o grafo.', 40, 90);
    return canvas.toBuffer('image/png');
  }

  const centerX = graphWidth / 2;
  const centerY = height / 2 + 30;
  const maxRadius = Math.min(graphWidth, height) / 2 - 140;

  const maxNodeValue = Math.max(...nodes.map((n) => n.total));
  const drawEdges = directedEdges && directedEdges.length ? directedEdges : edges;
  const maxEdgeValue =
    drawEdges && drawEdges.length ? Math.max(...drawEdges.map((e) => e.total)) : 1;

  const nodePositions = new Map();
  const nodeRadii = new Map();
  const sortedNodes = [...nodes].sort((a, b) => b.total - a.total);
  sortedNodes.forEach((node) => {
    const weight = maxNodeValue ? node.total / maxNodeValue : 0.2;
    const nodeRadius = 36 + weight * 36;
    nodeRadii.set(node.jid, nodeRadius);
  });

  const minGap = 39;
  const maxAttempts = 400;
  /**
   * Função rand.
   * @param {*} seed - Parâmetro.
   * @returns {*} - Retorno.
   */
  const rand = (seed) => {
    let x = seed;
    return () => {
      x = (x * 9301 + 49297) % 233280;
      return x / 233280;
    };
  };

  sortedNodes.forEach((node, index) => {
    const radius = nodeRadii.get(node.jid) || 30;
    const jitter = rand(node.jid.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), index + 1));
    let placed = false;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const r = Math.sqrt(jitter()) * maxRadius;
      const angle = jitter() * Math.PI * 2;
      const x = centerX + r * Math.cos(angle);
      const y = centerY + r * Math.sin(angle);

      if (x - radius < 20 || x + radius > graphWidth - 20) continue;
      if (y - radius < 80 || y + radius > height - 40) continue;

      let ok = true;
      for (const [jid, pos] of nodePositions.entries()) {
        const otherRadius = nodeRadii.get(jid) || 30;
        const dx = x - pos.x;
        const dy = y - pos.y;
        const minDist = radius + otherRadius + minGap;
        if (dx * dx + dy * dy < minDist * minDist) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      nodePositions.set(node.jid, { x, y });
      placed = true;
      break;
    }

    if (!placed) {
      // Fallback: place on expanding spiral
      const spiralAngle = index * 0.9;
      const spiralRadius = Math.min(maxRadius, 60 + index * 12);
      const x = centerX + spiralRadius * Math.cos(spiralAngle);
      const y = centerY + spiralRadius * Math.sin(spiralAngle);
      nodePositions.set(node.jid, { x, y });
    }
  });

  const nodeIndex = new Map();
  sortedNodes.forEach((node, index) => {
    nodeIndex.set(node.jid, index);
  });

  const positions = sortedNodes.map((node) => {
    const pos = nodePositions.get(node.jid);
    return { x: pos?.x || centerX, y: pos?.y || centerY };
  });

  /**
   * Função clampPosition.
   * @param {*} pos - Parâmetro.
   * @param {*} radius - Parâmetro.
   * @returns {*} - Retorno.
   */
  const clampPosition = (pos, radius) => {
    const minX = 20 + radius;
    const maxX = graphWidth - 20 - radius;
    const minY = 80 + radius;
    const maxY = height - 40 - radius;
    pos.x = Math.min(maxX, Math.max(minX, pos.x));
    pos.y = Math.min(maxY, Math.max(minY, pos.y));
  };

  const edgeList = edges
    .map((edge) => ({
      ...edge,
      srcIndex: nodeIndex.get(edge.src),
      dstIndex: nodeIndex.get(edge.dst),
    }))
    .filter((edge) => edge.srcIndex !== undefined && edge.dstIndex !== undefined);

  const attractionIters = 60;
  const minEdgeDistStrong = 50;
  const minEdgeDistWeak = 198;
  const repulsionEnabled = true;

  for (let iter = 0; iter < attractionIters; iter += 1) {
    const velocity = positions.map(() => ({ x: 0, y: 0 }));

    edgeList.forEach((edge) => {
      const from = positions[edge.srcIndex];
      const to = positions[edge.dstIndex];
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const weight = maxEdgeValue ? edge.total / maxEdgeValue : 0.2;
      const radiusA = nodeRadii.get(sortedNodes[edge.srcIndex].jid) || 30;
      const radiusB = nodeRadii.get(sortedNodes[edge.dstIndex].jid) || 30;
      const base = minEdgeDistStrong + (1 - weight) * (minEdgeDistWeak - minEdgeDistStrong);
      const desired = base + radiusA + radiusB + (1 - weight) * (maxRadius * 0.6);
      const force = (dist - desired) * 0.015 * (0.4 + weight);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      velocity[edge.srcIndex].x += fx;
      velocity[edge.srcIndex].y += fy;
      velocity[edge.dstIndex].x -= fx;
      velocity[edge.dstIndex].y -= fy;
    });

    if (repulsionEnabled) {
      for (let a = 0; a < positions.length; a += 1) {
        for (let b = a + 1; b < positions.length; b += 1) {
          const dx = positions[b].x - positions[a].x;
          const dy = positions[b].y - positions[a].y;
          const dist = Math.max(1, Math.hypot(dx, dy));
          const desired =
            (nodeRadii.get(sortedNodes[a].jid) || 30) +
            (nodeRadii.get(sortedNodes[b].jid) || 30) +
            minGap;
          if (dist < desired) {
            const push = (desired - dist) * 0.02;
            const fx = (dx / dist) * push;
            const fy = (dy / dist) * push;
            velocity[a].x -= fx;
            velocity[a].y -= fy;
            velocity[b].x += fx;
            velocity[b].y += fy;
          }
        }
      }
    }

    positions.forEach((pos, idx) => {
      pos.x += velocity[idx].x;
      pos.y += velocity[idx].y;
      clampPosition(pos, nodeRadii.get(sortedNodes[idx].jid) || 30);
    });
  }

  sortedNodes.forEach((node, index) => {
    nodePositions.set(node.jid, positions[index]);
  });

  // Final overlap resolution pass
  for (let iter = 0; iter < 40; iter += 1) {
    let moved = false;
    for (let a = 0; a < positions.length; a += 1) {
      for (let b = a + 1; b < positions.length; b += 1) {
        const dx = positions[b].x - positions[a].x;
        const dy = positions[b].y - positions[a].y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const desired =
          (nodeRadii.get(sortedNodes[a].jid) || 30) +
          (nodeRadii.get(sortedNodes[b].jid) || 30) +
          minGap;
        if (dist < desired) {
          const overlap = (desired - dist) / 2;
          const fx = (dx / dist) * overlap;
          const fy = (dy / dist) * overlap;
          positions[a].x -= fx;
          positions[a].y -= fy;
          positions[b].x += fx;
          positions[b].y += fy;
          clampPosition(positions[a], nodeRadii.get(sortedNodes[a].jid) || 30);
          clampPosition(positions[b], nodeRadii.get(sortedNodes[b].jid) || 30);
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  sortedNodes.forEach((node, index) => {
    nodePositions.set(node.jid, positions[index]);
  });

  /**
   * Função hashString.
   * @param {*} value - Parâmetro.
   * @returns {*} - Retorno.
   */
  const hashString = (value) => {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
    }
    return hash;
  };

  /**
   * Função edgeStyleFromKey.
   * @param {*} key - Parâmetro.
   * @returns {*} - Retorno.
   */
  const edgeStyleFromKey = (key) => {
    const hash = hashString(key);
    const hue = hash % 360;
    const saturation = 60 + (hash % 30);
    const light = 45 + (hash % 25);
    const dashBase = 6 + (hash % 10);
    const gapBase = 4 + ((hash >> 4) % 8);
    return {
      color: `hsla(${hue}, ${saturation}%, ${light}%, 0.85)`,
      dash: [dashBase, gapBase],
    };
  };

  drawEdges.forEach((edge) => {
    const from = nodePositions.get(edge.src);
    const to = nodePositions.get(edge.dst);
    if (!from || !to) return;
    const weight = maxEdgeValue ? edge.total / maxEdgeValue : 0.2;
    const style = edgeStyleFromKey(`${edge.src}->${edge.dst}`);
    ctx.strokeStyle = style.color;
    ctx.setLineDash(style.dash);
    ctx.lineWidth = 1.5 + weight * 7;
    const fromRadius = nodeRadii.get(edge.src) || 30;
    const toRadius = nodeRadii.get(edge.dst) || 30;
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const startX = from.x + Math.cos(angle) * fromRadius;
    const startY = from.y + Math.sin(angle) * fromRadius;
    const endX = to.x - Math.cos(angle) * toRadius;
    const endY = to.y - Math.sin(angle) * toRadius;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.setLineDash([]);
    const arrowSize = 8 + weight * 6;
    ctx.fillStyle = style.color;
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(
      endX - Math.cos(angle - Math.PI / 6) * arrowSize,
      endY - Math.sin(angle - Math.PI / 6) * arrowSize,
    );
    ctx.lineTo(
      endX - Math.cos(angle + Math.PI / 6) * arrowSize,
      endY - Math.sin(angle + Math.PI / 6) * arrowSize,
    );
    ctx.closePath();
    ctx.fill();
  });

  /**
   * Função drawTextInsideBubble.
   * @param {*} text - Parâmetro.
   * @param {*} x - Parâmetro.
   * @param {*} y - Parâmetro.
   * @param {*} radius - Parâmetro.
   * @returns {*} - Retorno.
   */
  const drawTextInsideBubble = (text, x, y, radius, options = {}) => {
    const { color = '#f8fafc', shadow = false } = options;
    const maxWidth = radius * 1.6;
    const maxLines = 2;
    const words = text.split(' ');
    let lines = [text];

    /**
     * Função tryWrap.
     * @returns {*} - Retorno.
     */
    const tryWrap = () => {
      const result = [];
      let current = '';
      words.forEach((word) => {
        const test = current ? `${current} ${word}` : word;
        if (ctx.measureText(test).width > maxWidth && current) {
          result.push(current);
          current = word;
        } else {
          current = test;
        }
      });
      if (current) result.push(current);
      return result;
    };

    let fontSize = 16;
    ctx.font = `bold ${fontSize}px Arial`;
    lines = tryWrap();
    while (
      (lines.length > maxLines || lines.some((line) => ctx.measureText(line).width > maxWidth)) &&
      fontSize > 9
    ) {
      fontSize -= 1;
      ctx.font = `bold ${fontSize}px Arial`;
      lines = tryWrap();
    }

    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      const last = lines[lines.length - 1];
      while (ctx.measureText(`${last}…`).width > maxWidth && last.length > 0) {
        lines[lines.length - 1] = last.slice(0, -1);
      }
      lines[lines.length - 1] = `${lines[lines.length - 1]}…`;
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius - 2, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (shadow) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = 6;
    }
    const lineHeight = fontSize + 2;
    const totalHeight = lineHeight * lines.length;
    lines.forEach((line, index) => {
      const offsetY = (index - (lines.length - 1) / 2) * lineHeight;
      ctx.fillText(line, x, y + offsetY);
    });
    ctx.restore();
  };

  nodes.forEach((node) => {
    const position = nodePositions.get(node.jid);
    if (!position) return;
    const nodeRadius = nodeRadii.get(node.jid) || 30;
    const clusterId = nodeClusters?.get(node.jid);
    const clusterColor = clusterId ? clusterColors?.get(clusterId) : null;
    const avatarImage = avatarImages?.get(node.jid) || null;

    if (focusJid && node.jid === focusJid) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(position.x, position.y, nodeRadius + 12, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
      ctx.lineWidth = 10;
      ctx.shadowBlur = 20;
      ctx.shadowColor = 'rgba(56, 189, 248, 0.55)';
      ctx.stroke();
      ctx.restore();
    }

    if (avatarImage) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(position.x, position.y, nodeRadius, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(
        avatarImage,
        position.x - nodeRadius,
        position.y - nodeRadius,
        nodeRadius * 2,
        nodeRadius * 2,
      );
      ctx.restore();
    } else {
      ctx.save();
      ctx.fillStyle = clusterColor || '#38bdf8';
      ctx.shadowBlur = 12;
      ctx.shadowColor = 'rgba(15, 23, 42, 0.35)';
      ctx.beginPath();
      ctx.arc(position.x, position.y, nodeRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.strokeStyle = clusterColor || '#0ea5e9';
    ctx.lineWidth = clanLeaders?.has(node.jid) ? 6 : 3;
    ctx.beginPath();
    ctx.arc(position.x, position.y, nodeRadius, 0, Math.PI * 2);
    ctx.stroke();

    drawTextInsideBubble(
      node.label,
      position.x,
      position.y,
      nodeRadius,
      avatarImage ? { shadow: true } : undefined,
    );

    ctx.save();
    if (avatarImage) {
      ctx.fillStyle = '#f8fafc';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = 6;
    } else {
      ctx.fillStyle = '#0f172a';
    }
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${node.total}`, position.x, position.y + nodeRadius - 12);
    ctx.restore();
  });

  /**
   * Função wrapText.
   * @param {*} text - Parâmetro.
   * @param {*} maxWidth - Parâmetro.
   * @returns {*} - Retorno.
   */
  const wrapText = (text, maxWidth) => {
    if (!text) return [''];
    const words = text.split(' ');
    const lines = [];
    let current = '';
    words.forEach((word) => {
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    });
    if (current) lines.push(current);
    return lines;
  };

  if (showPanel) {
    const textX = graphWidth + 24;
    const textMaxWidth = panelWidth - 48;
    let textY = 90;
    const textBottomLimit = height - 30;
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '15px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    const getLineText = (line) => (typeof line === 'string' ? line : line?.text || '');
    const getLineColor = (line) =>
      typeof line === 'string' ? '#e2e8f0' : line?.color || '#e2e8f0';
    const maxLines = Math.max(10, Math.floor((textBottomLimit - textY) / 20));
    const sections = [];
    let current = [];

    (summaryLines || []).forEach((line) => {
      const lineText = getLineText(line);
      if (!lineText.trim()) {
        if (current.length) {
          sections.push(current);
          current = [];
        }
        return;
      }
      const clean = lineText.replace(/\*/g, '').replace(/•/g, '•').trim();
      const wrapped = wrapText(clean, textMaxWidth - 24);
      const color = getLineColor(line);
      wrapped.forEach((wrapLine) => current.push({ text: wrapLine, color }));
    });
    if (current.length) sections.push(current);

    /**
     * Função drawRoundedRect.
     * @param {*} x - Parâmetro.
     * @param {*} y - Parâmetro.
     * @param {*} w - Parâmetro.
     * @param {*} h - Parâmetro.
     * @param {*} r - Parâmetro.
     * @returns {*} - Retorno.
     */
    const drawRoundedRect = (x, y, w, h, r) => {
      const radius = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.arcTo(x + w, y, x + w, y + h, radius);
      ctx.arcTo(x + w, y + h, x, y + h, radius);
      ctx.arcTo(x, y + h, x, y, radius);
      ctx.arcTo(x, y, x + w, y, radius);
      ctx.closePath();
    };

    let printed = 0;
    sections.forEach((section) => {
      if (printed >= maxLines) return;
      const linesToDraw = section.slice(0, Math.max(0, maxLines - printed));
      if (!linesToDraw.length) return;
      const boxPaddingY = 10;
      const boxPaddingX = 12;
      const lineHeight = 20;
      const boxHeight = linesToDraw.length * lineHeight + boxPaddingY * 2;
      if (textY + boxHeight > textBottomLimit) return;
      drawRoundedRect(textX - 6, textY - 6, textMaxWidth + 12, boxHeight + 12, 12);
      ctx.fillStyle = '#0f172a';
      ctx.fill();
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      ctx.stroke();

      let lineY = textY + boxPaddingY;
      linesToDraw.forEach((wrapLine) => {
        ctx.fillStyle = wrapLine.color;
        ctx.fillText(wrapLine.text, textX + boxPaddingX, lineY);
        lineY += lineHeight;
        printed += 1;
      });
      textY += boxHeight + 14;
    });

    if (printed >= maxLines) {
      ctx.fillText('…', textX, textY);
    }
  }

  return canvas.toBuffer('image/png');
};

/**
 * Função handleInteractionGraphCommand.
 * @param {*} sock - Parâmetro.
 * @param {*} remoteJid - Parâmetro.
 * @param {*} messageInfo - Parâmetro.
 * @param {*} expirationMessage - Parâmetro.
 * @param {*} isGroupMessage - Parâmetro.
 * @param {*} args - Parâmetro.
 * @param {*} senderJid - Parâmetro.
 * @returns {*} - Retorno.
 */
export async function handleInteractionGraphCommand({
  sock,
  remoteJid,
  messageInfo,
  expirationMessage,
  isGroupMessage,
  args,
  senderJid,
}) {
  try {
    const botJid = sock?.user?.id ? `${sock.user.id.split(':')[0]}@s.whatsapp.net` : null;
    const focusJid = getFocusJid(messageInfo, args || [], senderJid);
    const cacheKey = getCacheKey(focusJid, remoteJid);
    const cached = getCachedResult(cacheKey);
    if (cached) {
      await sock.sendMessage(
        remoteJid,
        {
          image: cached.imageBuffer,
          caption: cached.captionText,
          ...(cached.mentions?.length ? { mentions: cached.mentions } : {}),
        },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      return;
    }

    const [totalMessagesRow] = await executeQuery(
      botJid
        ? 'SELECT COUNT(*) AS total FROM messages WHERE sender_id <> ?'
        : 'SELECT COUNT(*) AS total FROM messages',
      botJid ? [botJid] : [],
    );
    const totalMessages = Number(totalMessagesRow?.total || 0);

    const rows = await executeQuery(
      `SELECT
        e.src,
        e.dst,
        e.replies AS replies_a_para_b,
        IFNULL(r.replies, 0) AS replies_b_para_a,
        (e.replies + IFNULL(r.replies, 0)) AS replies_total_par,
        e.first_ts AS primeira_interacao_a_para_b,
        e.last_ts  AS ultima_interacao_a_para_b,
        r.first_ts AS primeira_interacao_b_para_a,
        r.last_ts  AS ultima_interacao_b_para_a
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
          COUNT(*) AS replies,
          MIN(m.timestamp) AS first_ts,
          MAX(m.timestamp) AS last_ts
        FROM messages m
        WHERE m.raw_message IS NOT NULL
          AND m.sender_id IS NOT NULL
          ${botJid ? 'AND m.sender_id <> ?' : ''}
          AND (
            CASE
              WHEN m.timestamp > 1000000000000 THEN FROM_UNIXTIME(m.timestamp / 1000)
              WHEN m.timestamp > 1000000000 THEN FROM_UNIXTIME(m.timestamp)
              ELSE m.timestamp
            END
          ) >= NOW() - INTERVAL ${SOCIAL_RECENT_DAYS} DAY
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
          COUNT(*) AS replies,
          MIN(m.timestamp) AS first_ts,
          MAX(m.timestamp) AS last_ts
        FROM messages m
        WHERE m.raw_message IS NOT NULL
          AND m.sender_id IS NOT NULL
          ${botJid ? 'AND m.sender_id <> ?' : ''}
          AND (
            CASE
              WHEN m.timestamp > 1000000000000 THEN FROM_UNIXTIME(m.timestamp / 1000)
              WHEN m.timestamp > 1000000000 THEN FROM_UNIXTIME(m.timestamp)
              ELSE m.timestamp
            END
          ) >= NOW() - INTERVAL ${SOCIAL_RECENT_DAYS} DAY
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
      ORDER BY replies_total_par DESC, e.last_ts DESC
      LIMIT ${SOCIAL_GRAPH_LIMIT}`,
      botJid ? [botJid, botJid] : [],
    );

    const participantIndex = new Map();
    const normalizedRows = filterRowsWithoutBot(rows, botJid)
      .map((row) => ({
        ...row,
        src: normalizeJidWithParticipants(row.src, participantIndex),
        dst: normalizeJidWithParticipants(row.dst, participantIndex),
      }))
      .filter(
        (row) =>
          !participantIndex.size ||
          (participantIndex.has(row.src) && participantIndex.has(row.dst)),
      );

    const normalizedFocus = focusJid
      ? normalizeJidWithParticipants(focusJid, participantIndex)
      : null;
    const filteredRows = normalizedFocus
      ? normalizedRows.filter((row) => row.src === normalizedFocus || row.dst === normalizedFocus)
      : normalizedRows;

    let directedEdges = filteredRows.flatMap((row) => {
      const aToB = Number(row.replies_a_para_b || 0);
      const bToA = Number(row.replies_b_para_a || 0);
      const items = [];
      if (row.src && row.dst && aToB > 0) items.push({ src: row.src, dst: row.dst, total: aToB });
      if (row.src && row.dst && bToA > 0) items.push({ src: row.dst, dst: row.src, total: bToA });
      return items;
    });

    const runtimeNames = new Map();
    if (senderJid && messageInfo?.pushName) {
      const runtimeKey = normalizeJidWithParticipants(senderJid, participantIndex);
      runtimeNames.set(runtimeKey, messageInfo.pushName);
    }
    const { ranking, names } = buildSocialRanking(filteredRows);
    if (runtimeNames) {
      runtimeNames.forEach((value, key) => {
        if (!names.get(key)) names.set(key, value);
      });
    }
    const { names: globalNames } = buildSocialRanking(normalizedRows);
    if (runtimeNames) {
      runtimeNames.forEach((value, key) => {
        if (!globalNames.get(key)) globalNames.set(key, value);
      });
    }

    const growthRows = await executeQuery(
      `SELECT sender_id AS jid,
              SUM(CASE WHEN ts >= NOW() - INTERVAL 30 DAY THEN 1 ELSE 0 END) AS last30,
              SUM(CASE WHEN ts < NOW() - INTERVAL 30 DAY AND ts >= NOW() - INTERVAL 60 DAY THEN 1 ELSE 0 END) AS prev30,
              SUM(CASE WHEN ts >= NOW() - INTERVAL 30 DAY THEN 1 ELSE 0 END)
                - SUM(CASE WHEN ts < NOW() - INTERVAL 30 DAY AND ts >= NOW() - INTERVAL 60 DAY THEN 1 ELSE 0 END) AS delta
         FROM (
           SELECT m.sender_id,
                  CASE
                    WHEN m.timestamp > 1000000000000 THEN FROM_UNIXTIME(m.timestamp / 1000)
                    WHEN m.timestamp > 1000000000 THEN FROM_UNIXTIME(m.timestamp)
                    ELSE m.timestamp
                  END AS ts
             FROM messages m
            WHERE m.sender_id IS NOT NULL
            ${botJid ? 'AND m.sender_id <> ?' : ''}
         ) src
        GROUP BY sender_id
        HAVING last30 > 0
        ORDER BY delta DESC
        LIMIT 5`,
      botJid ? [botJid] : [],
    );
    const [dbStartRow] = await executeQuery(
      botJid
        ? 'SELECT MIN(timestamp) AS db_start FROM messages WHERE sender_id <> ?'
        : 'SELECT MIN(timestamp) AS db_start FROM messages',
      botJid ? [botJid] : [],
    );
    const dbStartLabel = formatDate(dbStartRow?.db_start || null);

    // "global": dados agregados de todos os chats do bot (sem filtro por chat_id)
    const globalGraphData = buildGraphData(normalizedRows, globalNames);
    const graphData = limitGraphData(buildGraphData(filteredRows, names), SOCIAL_NODE_LIMIT);
    const allowedJids = new Set(graphData.nodes.map((node) => node.jid));
    directedEdges = directedEdges.filter((edge) => allowedJids.has(edge.src) && allowedJids.has(edge.dst));
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
    const { reciprocity, avgResponseMs } = computeReciprocityAndAvg(filteredRows);
    const clanLeaders = buildClanLeaders(graphData.nodes, graphData.nodeClusters);
    const clanLeaderById = buildClanLeaderMap(graphData.nodes, graphData.nodeClusters);
    const captionLines = [];
    const totalParticipants = globalGraphData.nodes.length;
    const bridgeLines = buildClanBridgeLines({
      edges: graphData.edges,
      nodeClusters: graphData.nodeClusters,
      names,
      clanByJid,
      clanColorByJid,
    });
    const growthLines = buildGrowthLines(growthRows, names);
    const detailLines = [...captionLines];
    const summaryText = linesToText(detailLines);

    // "grupo": dados restritos ao chat_id atual
    let profileText = null;
    let profileSocialText = null;
    if (normalizedFocus) {
      profileText = await buildProfileSection({
        remoteJid,
        focusJid: normalizedFocus,
        isGroupMessage,
        botJid,
      });

      const globalClustersWithKeywords = assignClanNamesFromList(globalGraphData.clusters);
      const globalClanByJid = new Map();
      globalClustersWithKeywords.forEach((cluster) => {
        cluster.members.forEach((jid) => globalClanByJid.set(jid, cluster.keyword || 'nd'));
      });
      const globalClanColorByJid = new Map();
      globalGraphData.nodeClusters.forEach((clusterId, jid) => {
        const color = globalGraphData.clusterColors.get(clusterId);
        if (color) globalClanColorByJid.set(jid, color);
      });
      const globalInfluenceRanking = buildInfluenceRanking({
        nodes: globalGraphData.nodes,
        edges: globalGraphData.edges,
        nodeClusters: globalGraphData.nodeClusters,
      });

      const userNode = globalGraphData.nodes.find((node) => node.jid === normalizedFocus);
      const totalInteractions = Number(userNode?.total || 0);
      const repliesSent = normalizedRows.reduce(
        (acc, row) => acc + (row.src === normalizedFocus ? Number(row.replies_a_para_b || 0) : 0),
        0,
      );
      const repliesReceived = normalizedRows.reduce(
        (acc, row) => acc + (row.dst === normalizedFocus ? Number(row.replies_a_para_b || 0) : 0),
        0,
      );
      const partners = new Set();
      normalizedRows.forEach((row) => {
        if (row.src === normalizedFocus && row.dst) partners.add(row.dst);
        if (row.dst === normalizedFocus && row.src) partners.add(row.src);
      });
      const clanName = globalClanByJid.get(normalizedFocus) || 'N/D';
      const clanColor = hslToColorName(globalClanColorByJid.get(normalizedFocus));
      const influenceIndex = globalInfluenceRanking.findIndex(
        (entry) => entry.jid === normalizedFocus,
      );
      const influenceRank = influenceIndex >= 0 ? `#${influenceIndex + 1}` : 'N/D';

      const socialLines = [
        '🌐 Social global',
        `🧩 Clan: ${clanName} (${clanColor})`,
        `🔁 Interações: ${totalInteractions}`,
        `📤 Respostas enviadas: ${repliesSent}`,
        `📥 Respostas recebidas: ${repliesReceived}`,
        `🤝 Conexões únicas: ${partners.size}`,
        `⭐ Influência (aprox): ${influenceRank}`,
      ];
      profileSocialText = socialLines.join('\n');
    }

    const focusDisplay = normalizedFocus
      ? getNameLabel(normalizedFocus, names.get(normalizedFocus))
      : null;
    const introLines = normalizedFocus
      ? [
          '🎯 Social foco',
          `👤 Usuário: ${focusDisplay || 'N/D'}`,
          '🔗 A imagem mostra só a bolha do usuário e suas ligações diretas.',
          `👥 Total de usuários participantes (${SOCIAL_SCOPE_GLOBAL}): ${totalParticipants}`,
          `🧾 Perfil acima = dados do ${SOCIAL_SCOPE_GROUP}.`,
          `🌐 Social global acima = dados ${SOCIAL_SCOPE_GLOBAL}.`,
          '🛠️ Use social para ver o panorama completo do grupo.',
        ]
      : [
          '✨ *Social*',
          '🌍 Este gráfico mostra as conexões do sistema inteiro.',
          `👥 Dados ${SOCIAL_SCOPE_GLOBAL}.`,
          `🧩 Total de usuários participantes (${SOCIAL_SCOPE_GLOBAL}): ${totalParticipants}`,
          `🧾 Início da contagem: ${dbStartLabel}`,
          '🫧 Tamanho da bolha = volume de interações (replies enviadas/recebidas).',
          '🧭 Arestas e setas indicam direção e intensidade das respostas.',
          '🎨 Cores indicam o clan de cada pessoa.',
          '',
          '🧠 Para que serve:',
          '• Identificar quem mais conversa e com quem interage.',
          '• Visualizar subgrupos (clans) e líderes naturais.',
          '• Entender conexões fortes, influentes e pontes entre pessoas.',
          '',
          '🧩 Como funcionam os clans:',
          '• Um clan é um grupo de pessoas que interagem mais entre si do que com o resto.',
          '• Os nomes dos clans seguem uma lista fixa (Alpha, Beta, Gamma...).',
          '• O líder do clan é quem mais interage dentro do próprio clan.',
          '',
          '🛠️ Como usar o comando:',
          '• Digite *social* para ver o panorama completo.',
          '• Use *social foco @pessoa* para destacar um usuário específico e ver o perfil.',
          '• Compare as caixas do painel para entender influência, crescimento e pares fortes.',
        ];
    const introBlocks = [profileText, profileSocialText, introLines.join('\n')].filter(Boolean);
    const introText = introBlocks.join('\n\n');
    const captionText = summaryText ? `${introText}\n\n${summaryText}` : introText;

    const totalInteractions = filteredRows.reduce(
      (acc, row) => acc + Number(row.replies_total_par || 0),
      0,
    );
    const makeLine = (text, color) => (color ? { text, color } : text);
    const clanBoxLines = clustersWithKeywords.slice(0, 8).map((cluster) => {
      const leaderJid = clanLeaderById.get(cluster.id);
      const leaderLabel = leaderJid ? getNameLabel(leaderJid, names.get(leaderJid)) : 'N/D';
      const label = `${cluster.keyword || 'nd'} — líder: ${leaderLabel}`;
      const color = graphData.clusterColors.get(cluster.id);
      return makeLine(label, color);
    });

    const mentionLines = buildTopMentionsLines(filteredRows, names, clanByJid, clanColorByJid);
    const pairLines = buildTopPairsLines(filteredRows, names, clanByJid, clanColorByJid);
    const receivedLines = buildTopRepliesReceivedLines(
      filteredRows,
      names,
      clanByJid,
      clanColorByJid,
    );
    const sentLines = buildTopRepliesSentLines(filteredRows, names, clanByJid, clanColorByJid);
    const activeClansLines = buildTopActiveClansLines(
      filteredRows,
      clustersWithKeywords,
      graphData.clusterColors,
    );
    const connectorLines = buildGlobalConnectorsLines(
      filteredRows,
      names,
      clanByJid,
      clanColorByJid,
    );
    const skewLines = buildSkewLines(ranking);

    const summaryLines = [
      'Resumo geral',
      `Total de mensagens: ${totalMessages}`,
      `Total de interacoes: ${totalInteractions}`,
      '',
      'Reciprocidade',
      `Reciprocidade: ${reciprocity}%`,
      `Tempo medio de resposta: ${formatDuration(avgResponseMs)}`,
      '',
      'Influentes (aprox)',
      ...(influenceRanking || []).map((entry, index) => {
        const display = getNameLabel(entry.jid, names.get(entry.jid));
        const clan = clanByJid.get(entry.jid);
        const color = clanColorByJid.get(entry.jid);
        return makeLine(
          `${index + 1}. ${clan ? `${display} - ${clan}` : display} — ${Math.round(entry.score)}`,
          color,
        );
      }),
      '',
      'Mais interacoes',
      ...ranking.slice(0, 5).map((entry, index) => {
        const display = getNameLabel(entry.jid, names.get(entry.jid));
        const clan = clanByJid.get(entry.jid);
        const color = clanColorByJid.get(entry.jid);
        return makeLine(
          `${index + 1}. ${clan ? `${display} - ${clan}` : display} — ${entry.total}`,
          color,
        );
      }),
      '',
      'Clans',
      ...clanBoxLines,
      '',
      ...mentionLines,
      ...pairLines,
      ...receivedLines,
      ...sentLines,
      ...activeClansLines,
      ...connectorLines,
      ...skewLines,
      '',
      ...bridgeLines,
      ...growthLines,
    ];
    const avatarImages = await loadProfileImages({
      sock,
      jids: graphData.nodes.map((node) => node.jid),
      remoteJid,
    });
    const imageBuffer = renderGraphImage({
      ...graphData,
      directedEdges,
      clusters: clustersWithKeywords,
      summaryLines,
      totalMessages,
      clanLeaders,
      focusJid: normalizedFocus,
      avatarImages,
      showPanel: !normalizedFocus,
    });

    const mentions = normalizedFocus ? [normalizedFocus] : [];
    setCachedResult(cacheKey, { imageBuffer, captionText, mentions });
    await sock.sendMessage(
      remoteJid,
      { image: imageBuffer, caption: captionText, ...(mentions.length ? { mentions } : {}) },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  } catch (error) {
    logger.error('Erro ao gerar ranking de interacoes:', { error: error.message });
    await sock.sendMessage(
      remoteJid,
      { text: `Erro ao gerar ranking de interacoes: ${error.message}` },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  }
}

export { assignClanNamesFromList, buildGraphData, buildInfluenceRanking, buildSocialRanking };
