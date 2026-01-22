import { createCanvas } from 'canvas';
import { executeQuery } from '../../../database/index.js';
import logger from '../../utils/logger/loggerModule.js';
import { getGroupParticipants, _matchesParticipantId } from '../../config/groupUtils.js';

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

const buildParticipantIndex = (participants) => {
  const index = new Map();
  (participants || []).forEach((participant) => {
    const canonical = participant.phoneNumber || participant.id || participant.jid || participant.lid || null;
    if (!canonical) return;
    [participant.id, participant.jid, participant.lid, participant.phoneNumber].forEach((key) => {
      if (key && !index.has(key)) index.set(key, canonical);
    });
  });
  return index;
};

const normalizeJidWithParticipants = (value, participantIndex) => {
  if (!value || !participantIndex) return value;
  return participantIndex.get(value) || value;
};

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
  focusLabel,
  runtimeNames,
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

  if (runtimeNames) {
    runtimeNames.forEach((value, key) => {
      if (!names.get(key)) names.set(key, value);
    });
  }

  const topFifteen = ranking.slice(0, 15);
  const lines = [
    focusLabel ? `Foco: ${focusLabel}` : 'Top 15 sociais',
    '',
  ];
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
    adjacency.get(edge.src).set(edge.dst, (adjacency.get(edge.src).get(edge.dst) || 0) + edge.total);
    adjacency.get(edge.dst).set(edge.src, (adjacency.get(edge.dst).get(edge.src) || 0) + edge.total);
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

const buildClusterSummaryLines = (clusters, names, limit = 3) => {
  if (!clusters || !clusters.length) return [];
  const lines = ['Clusters (top 3)', ''];
  clusters.slice(0, limit).forEach((cluster, index) => {
    const members = cluster.members
      .slice(0, 6)
      .map((jid) => getNameLabel(jid, names.get(jid)))
      .join(', ');
    lines.push(`${index + 1}. ${members || 'N/D'}`);
    if (cluster.members.length > 6) {
      lines.push(`   +${cluster.members.length - 6} pessoas`);
    }
    lines.push('');
  });
  return lines;
};

const renderGraphImage = ({ nodes, edges, summaryLines, clusterColors, nodeClusters }) => {
  const width = 2000;
  const height = 1400;
  const panelWidth = 640;
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
  const maxRadius = Math.min(graphWidth, height) / 2 - 140;

  const maxNodeValue = Math.max(...nodes.map((n) => n.total));
  const maxEdgeValue = Math.max(...edges.map((e) => e.total));

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
          const desired = (nodeRadii.get(sortedNodes[a].jid) || 30)
            + (nodeRadii.get(sortedNodes[b].jid) || 30)
            + minGap;
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
        const desired = (nodeRadii.get(sortedNodes[a].jid) || 30)
          + (nodeRadii.get(sortedNodes[b].jid) || 30)
          + minGap;
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

  const hashString = (value) => {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
    }
    return hash;
  };

  const edgeStyleFromKey = (key) => {
    const hash = hashString(key);
    const hue = hash % 360;
    const saturation = 60 + (hash % 30);
    const light = 50 + (hash % 20);
    const dashBase = 6 + (hash % 10);
    const gapBase = 4 + ((hash >> 4) % 8);
    return {
      color: `hsla(${hue}, ${saturation}%, ${light}%, 0.7)`,
      dash: [dashBase, gapBase],
    };
  };

  edges.forEach((edge) => {
    const from = nodePositions.get(edge.src);
    const to = nodePositions.get(edge.dst);
    if (!from || !to) return;
    const weight = maxEdgeValue ? edge.total / maxEdgeValue : 0.2;
    const style = edgeStyleFromKey(`${edge.src}->${edge.dst}`);
    ctx.strokeStyle = style.color;
    ctx.setLineDash(style.dash);
    ctx.lineWidth = 1 + weight * 6;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.setLineDash([]);
  });

  const drawTextInsideBubble = (text, x, y, radius) => {
    const maxWidth = radius * 1.6;
    const maxLines = 2;
    const words = text.split(' ');
    let lines = [text];

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

    let fontSize = 14;
    ctx.font = `bold ${fontSize}px Arial`;
    lines = tryWrap();
    while ((lines.length > maxLines || lines.some((line) => ctx.measureText(line).width > maxWidth)) && fontSize > 9) {
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

    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
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

    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(position.x, position.y, nodeRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = clusterColor || '#0ea5e9';
    ctx.lineWidth = 3;
    ctx.stroke();

    drawTextInsideBubble(node.label, position.x, position.y, nodeRadius);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 13px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${node.total}`, position.x, position.y + nodeRadius - 12);
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

export async function handleInteractionGraphCommand({ sock, remoteJid, messageInfo, expirationMessage, isGroupMessage, args, senderJid }) {
  if (!isGroupMessage) {
    await sock.sendMessage(remoteJid, { text: 'Este comando so pode ser usado em grupos.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
    return;
  }

  try {
    const focusJid = getFocusJid(messageInfo, args || [], senderJid);

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
          AND m.chat_id = ?
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
          AND m.chat_id = ?
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

    const participants = await getGroupParticipants(remoteJid);
    const participantIndex = buildParticipantIndex(participants);
    const normalizedRows = rows
      .map((row) => ({
        ...row,
        src: normalizeJidWithParticipants(row.src, participantIndex),
        dst: normalizeJidWithParticipants(row.dst, participantIndex),
      }))
      .filter((row) => !participantIndex.size || (participantIndex.has(row.src) && participantIndex.has(row.dst)));

    const normalizedFocus = focusJid ? normalizeJidWithParticipants(focusJid, participantIndex) : null;
    const filteredRows = normalizedFocus
      ? normalizedRows.filter((row) => row.src === normalizedFocus || row.dst === normalizedFocus)
      : normalizedRows;

    const runtimeNames = new Map();
    if (senderJid && messageInfo?.pushName) {
      const runtimeKey = normalizeJidWithParticipants(senderJid, participantIndex);
      runtimeNames.set(runtimeKey, messageInfo.pushName);
    }
    const focusLabel = normalizedFocus ? getNameLabel(normalizedFocus, runtimeNames.get(normalizedFocus)) : null;
    const { lines, names } = buildInteractionGraphMessage({
      rows: filteredRows,
      focusLabel,
      runtimeNames,
    });

    const graphData = buildGraphData(filteredRows, names);
    const clusterLines = buildClusterSummaryLines(graphData.clusters, names);
    const summaryLines = [...lines, ...clusterLines];
    const imageBuffer = renderGraphImage({
      ...graphData,
      summaryLines,
    });

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
