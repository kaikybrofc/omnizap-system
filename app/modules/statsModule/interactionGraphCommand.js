import { createCanvas } from 'canvas';
import { executeQuery } from '../../../database/index.js';
import logger from '../../utils/logger/loggerModule.js';

const getDisplayLabel = (jid, pushName) => {
  if (!jid || typeof jid !== 'string') return 'Desconhecido';
  const handle = `@${jid.split('@')[0]}`;
  if (pushName && typeof pushName === 'string' && pushName.trim() !== '') {
    return `${handle} (${pushName.trim()})`;
  }
  return handle;
};

const getNameLabel = (jid, pushName) => {
  if (pushName && typeof pushName === 'string' && pushName.trim() !== '') {
    return pushName.trim();
  }
  if (!jid || typeof jid !== 'string') return 'Desconhecido';
  return `@${jid.split('@')[0]}`;
};

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

const buildInteractionGraphMessage = ({
  rows,
  recentTotals,
  previousTotals,
}) => {
  if (!rows.length) {
    return { lines: ['Nao ha respostas suficientes para gerar o ranking social.'], names: new Map() };
  }

  const {
    ranking,
    partners,
    names,
  } = buildSocialRanking(rows);
  if (!ranking.length) {
    return { lines: ['Nao ha respostas suficientes para gerar o ranking social.'], names };
  }

  const topFifteen = ranking.slice(0, 15);
  const lines = ['Top 15 sociais', ''];
  topFifteen.forEach((entry, index) => {
    const display = getNameLabel(entry.jid, names.get(entry.jid));
    const partners = entry.topPartners
      .map((partner) => `${getNameLabel(partner.jid, names.get(partner.jid))} (${partner.count})`)
      .join(', ');
    lines.push(
      `${index + 1}. ${display} — ${entry.total}`,
      `   com: ${partners || 'N/D'}`,
      '────────',
    );
  });

  return { lines, names };
};

const buildGraphData = (rows, names) => {
  const edges = rows
    .filter((row) => Number(row.replies_total_par || 0) > 0)
    .sort((a, b) => Number(b.replies_total_par || 0) - Number(a.replies_total_par || 0))
    .slice(0, 20)
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
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);

  return { nodes, edges };
};

const renderGraphImage = ({ nodes, edges, summaryLines }) => {
  const width = 1400;
  const height = 900;
  const panelWidth = 460;
  const graphWidth = width - panelWidth;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#e2e8f0';
  ctx.font = 'bold 28px Arial';
  ctx.textAlign = 'left';
  ctx.fillText('Grafo social do grupo', 40, 50);

  ctx.fillStyle = '#0b1220';
  ctx.fillRect(graphWidth, 0, panelWidth, height);

  ctx.fillStyle = '#e2e8f0';
  ctx.font = 'bold 22px Arial';
  ctx.fillText('Resumo', graphWidth + 24, 50);

  if (!nodes.length) {
    ctx.font = '16px Arial';
    ctx.fillText('Sem dados suficientes para desenhar o grafo.', 40, 90);
    return canvas.toBuffer('image/png');
  }

  const centerX = graphWidth / 2;
  const centerY = height / 2 + 30;
  const radius = Math.min(graphWidth, height) / 2 - 140;

  const maxNodeValue = Math.max(...nodes.map((n) => n.total));
  const maxEdgeValue = Math.max(...edges.map((e) => e.total));

  const nodePositions = new Map();
  nodes.forEach((node, index) => {
    const angle = (Math.PI * 2 * index) / nodes.length;
    const x = centerX + radius * Math.cos(angle);
    const y = centerY + radius * Math.sin(angle);
    nodePositions.set(node.jid, { x, y });
  });

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
  edges.forEach((edge) => {
    const from = nodePositions.get(edge.src);
    const to = nodePositions.get(edge.dst);
    if (!from || !to) return;
    const weight = maxEdgeValue ? edge.total / maxEdgeValue : 0.2;
    ctx.lineWidth = 1 + weight * 6;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  });

  const drawLabel = (text, x, y) => {
    ctx.font = 'bold 16px Arial';
    const metrics = ctx.measureText(text);
    const paddingX = 10;
    const paddingY = 6;
    const boxWidth = metrics.width + paddingX * 2;
    const boxHeight = 18 + paddingY * 2;
    const boxX = x - boxWidth / 2;
    const boxY = y;

    ctx.fillStyle = 'rgba(245, 158, 11, 0.9)';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, boxY + boxHeight / 2);
  };

  nodes.forEach((node) => {
    const position = nodePositions.get(node.jid);
    if (!position) return;
    const weight = maxNodeValue ? node.total / maxNodeValue : 0.2;
    const nodeRadius = 18 + weight * 20;

    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(position.x, position.y, nodeRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#0ea5e9';
    ctx.lineWidth = 2;
    ctx.stroke();

    drawLabel(node.label, position.x, position.y + nodeRadius + 12);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 13px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${node.total}`, position.x, position.y);
  });

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

  const textX = graphWidth + 24;
  const textMaxWidth = panelWidth - 48;
  let textY = 90;
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '15px Arial';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  let printed = 0;
  const maxLines = 42;
  (summaryLines || []).forEach((line) => {
    if (printed >= maxLines) return;
    if (!line.trim()) {
      textY += 8;
      return;
    }
    const clean = line.replace(/\*/g, '').replace(/•/g, '•').trim();
    const wrapped = wrapText(clean, textMaxWidth);
    wrapped.forEach((wrapLine) => {
      if (printed >= maxLines) return;
      ctx.fillText(wrapLine, textX, textY);
      textY += 20;
      printed += 1;
    });
  });

  if (printed >= maxLines) {
    ctx.fillText('…', textX, textY);
  }

  return canvas.toBuffer('image/png');
};

export async function handleInteractionGraphCommand({ sock, remoteJid, messageInfo, expirationMessage, isGroupMessage }) {
  if (!isGroupMessage) {
    await sock.sendMessage(remoteJid, { text: 'Este comando so pode ser usado em grupos.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
    return;
  }

  try {
    const now = Date.now();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000);

    const rows = await executeQuery(
      `SELECT
        e.chat_id,
        e.src,
        (
          SELECT JSON_UNQUOTE(JSON_EXTRACT(m2.raw_message, '$.pushName'))
          FROM messages m2
          WHERE m2.chat_id = e.chat_id
            AND m2.sender_id = e.src
            AND m2.raw_message IS NOT NULL
            AND JSON_EXTRACT(m2.raw_message, '$.pushName') IS NOT NULL
          ORDER BY m2.id DESC
          LIMIT 1
        ) AS src_pushName,
        e.dst,
        (
          SELECT JSON_UNQUOTE(JSON_EXTRACT(m3.raw_message, '$.pushName'))
          FROM messages m3
          WHERE m3.chat_id = e.chat_id
            AND m3.sender_id = e.dst
            AND m3.raw_message IS NOT NULL
            AND JSON_EXTRACT(m3.raw_message, '$.pushName') IS NOT NULL
          ORDER BY m3.id DESC
          LIMIT 1
        ) AS dst_pushName,
        e.replies AS replies_a_para_b,
        IFNULL(r.replies, 0) AS replies_b_para_a,
        (e.replies + IFNULL(r.replies, 0)) AS replies_total_par,
        e.first_ts AS primeira_interacao_a_para_b,
        e.last_ts  AS ultima_interacao_a_para_b
      FROM
      (
        SELECT
          m.chat_id,
          m.sender_id AS src,
          JSON_UNQUOTE(
            COALESCE(
              JSON_EXTRACT(m.raw_message, '$.message.extendedTextMessage.contextInfo.participant'),
              JSON_EXTRACT(m.raw_message, '$.message.imageMessage.contextInfo.participant'),
              JSON_EXTRACT(m.raw_message, '$.message.videoMessage.contextInfo.participant'),
              JSON_EXTRACT(m.raw_message, '$.message.documentMessage.contextInfo.participant')
            )
          ) AS dst,
          COUNT(*) AS replies,
          MIN(m.timestamp) AS first_ts,
          MAX(m.timestamp) AS last_ts
        FROM messages m
        WHERE m.raw_message IS NOT NULL
          AND m.sender_id IS NOT NULL
          AND m.chat_id = ?
          AND COALESCE(
            JSON_EXTRACT(m.raw_message, '$.message.extendedTextMessage.contextInfo.participant'),
            JSON_EXTRACT(m.raw_message, '$.message.imageMessage.contextInfo.participant'),
            JSON_EXTRACT(m.raw_message, '$.message.videoMessage.contextInfo.participant'),
            JSON_EXTRACT(m.raw_message, '$.message.documentMessage.contextInfo.participant')
          ) IS NOT NULL
        GROUP BY m.chat_id, src, dst
      ) e
      LEFT JOIN
      (
        SELECT
          m.chat_id,
          m.sender_id AS src,
          JSON_UNQUOTE(
            COALESCE(
              JSON_EXTRACT(m.raw_message, '$.message.extendedTextMessage.contextInfo.participant'),
              JSON_EXTRACT(m.raw_message, '$.message.imageMessage.contextInfo.participant'),
              JSON_EXTRACT(m.raw_message, '$.message.videoMessage.contextInfo.participant'),
              JSON_EXTRACT(m.raw_message, '$.message.documentMessage.contextInfo.participant')
            )
          ) AS dst,
          COUNT(*) AS replies
        FROM messages m
        WHERE m.raw_message IS NOT NULL
          AND m.sender_id IS NOT NULL
          AND m.chat_id = ?
          AND COALESCE(
            JSON_EXTRACT(m.raw_message, '$.message.extendedTextMessage.contextInfo.participant'),
            JSON_EXTRACT(m.raw_message, '$.message.imageMessage.contextInfo.participant'),
            JSON_EXTRACT(m.raw_message, '$.message.videoMessage.contextInfo.participant'),
            JSON_EXTRACT(m.raw_message, '$.message.documentMessage.contextInfo.participant')
          ) IS NOT NULL
        GROUP BY m.chat_id, src, dst
      ) r
        ON r.chat_id = e.chat_id
       AND r.src = e.dst
       AND r.dst = e.src
      WHERE e.dst IS NOT NULL
        AND e.dst <> ''
        AND e.src <> e.dst
      ORDER BY replies_total_par DESC, e.last_ts DESC
      LIMIT 500`,
      [remoteJid, remoteJid],
    );

    const recentRows = await executeQuery(
      `SELECT
        m.sender_id AS src,
        JSON_UNQUOTE(
          COALESCE(
            JSON_EXTRACT(m.raw_message, '$.message.extendedTextMessage.contextInfo.participant'),
            JSON_EXTRACT(m.raw_message, '$.message.imageMessage.contextInfo.participant'),
            JSON_EXTRACT(m.raw_message, '$.message.videoMessage.contextInfo.participant'),
            JSON_EXTRACT(m.raw_message, '$.message.documentMessage.contextInfo.participant')
          )
        ) AS dst,
        COUNT(*) AS replies
      FROM messages m
      WHERE m.raw_message IS NOT NULL
        AND m.sender_id IS NOT NULL
        AND m.chat_id = ?
        AND m.timestamp >= ?
        AND COALESCE(
          JSON_EXTRACT(m.raw_message, '$.message.extendedTextMessage.contextInfo.participant'),
          JSON_EXTRACT(m.raw_message, '$.message.imageMessage.contextInfo.participant'),
          JSON_EXTRACT(m.raw_message, '$.message.videoMessage.contextInfo.participant'),
          JSON_EXTRACT(m.raw_message, '$.message.documentMessage.contextInfo.participant')
        ) IS NOT NULL
      GROUP BY m.chat_id, src, dst`,
      [remoteJid, sevenDaysAgo],
    );

    const previousRows = await executeQuery(
      `SELECT
        m.sender_id AS src,
        JSON_UNQUOTE(
          COALESCE(
            JSON_EXTRACT(m.raw_message, '$.message.extendedTextMessage.contextInfo.participant'),
            JSON_EXTRACT(m.raw_message, '$.message.imageMessage.contextInfo.participant'),
            JSON_EXTRACT(m.raw_message, '$.message.videoMessage.contextInfo.participant'),
            JSON_EXTRACT(m.raw_message, '$.message.documentMessage.contextInfo.participant')
          )
        ) AS dst,
        COUNT(*) AS replies
      FROM messages m
      WHERE m.raw_message IS NOT NULL
        AND m.sender_id IS NOT NULL
        AND m.chat_id = ?
        AND m.timestamp >= ?
        AND m.timestamp < ?
        AND COALESCE(
          JSON_EXTRACT(m.raw_message, '$.message.extendedTextMessage.contextInfo.participant'),
          JSON_EXTRACT(m.raw_message, '$.message.imageMessage.contextInfo.participant'),
          JSON_EXTRACT(m.raw_message, '$.message.videoMessage.contextInfo.participant'),
          JSON_EXTRACT(m.raw_message, '$.message.documentMessage.contextInfo.participant')
        ) IS NOT NULL
      GROUP BY m.chat_id, src, dst`,
      [remoteJid, fourteenDaysAgo, sevenDaysAgo],
    );

    const recentTotals = new Map();
    recentRows.forEach((row) => {
      const total = Number(row.replies || 0);
      if (row.src) recentTotals.set(row.src, (recentTotals.get(row.src) || 0) + total);
      if (row.dst) recentTotals.set(row.dst, (recentTotals.get(row.dst) || 0) + total);
    });

    const previousTotals = new Map();
    previousRows.forEach((row) => {
      const total = Number(row.replies || 0);
      if (row.src) previousTotals.set(row.src, (previousTotals.get(row.src) || 0) + total);
      if (row.dst) previousTotals.set(row.dst, (previousTotals.get(row.dst) || 0) + total);
    });

    const { lines, names } = buildInteractionGraphMessage({
      rows,
      recentTotals,
      previousTotals,
    });

    const graphData = buildGraphData(rows, names);
    const imageBuffer = renderGraphImage({ ...graphData, summaryLines: lines });

    await sock.sendMessage(
      remoteJid,
      { image: imageBuffer },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  } catch (error) {
    logger.error('Erro ao gerar ranking de interacoes:', { error: error.message });
    await sock.sendMessage(remoteJid, { text: `Erro ao gerar ranking de interacoes: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
  }
}
