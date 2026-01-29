import logger from '../../utils/logger/loggerModule.js';
import { getSystemMetrics } from '../../utils/systemMetrics/systemMetricsModule.js';

const METRICS_ENDPOINT =
  process.env.METRICS_ENDPOINT ||
  `http://localhost:${process.env.METRICS_PORT || 9102}${process.env.METRICS_PATH || '/metrics'}`;
const METRICS_TIMEOUT_MS = Number(process.env.METRICS_PING_TIMEOUT_MS || 1500);

const formatLoadAverage = (values) => values.map((value) => value.toFixed(2)).join(' | ');

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes)) return 'n/a';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 2)}${units[idx]}`;
};

const formatSeconds = (seconds) => {
  if (!Number.isFinite(seconds)) return 'n/a';
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const time = [hours, minutes, secs].map((value) => String(value).padStart(2, '0')).join(':');
  return days > 0 ? `${days}d ${time}` : time;
};

const parseLabels = (raw) => {
  if (!raw) return {};
  const labels = {};
  const regex = /(\w+)="((?:\\.|[^"\\])*)"/g;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    labels[match[1]] = match[2].replace(/\\"/g, '"');
  }
  return labels;
};

const parsePrometheusText = (text) => {
  const series = new Map();
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [metricPart, valuePart] = trimmed.split(/\s+/, 2);
    if (!metricPart || !valuePart) continue;
    const value = Number(valuePart);
    if (!Number.isFinite(value)) continue;
    const labelStart = metricPart.indexOf('{');
    let name = metricPart;
    let labels = {};
    if (labelStart !== -1) {
      name = metricPart.slice(0, labelStart);
      const labelBody = metricPart.slice(labelStart + 1, metricPart.lastIndexOf('}'));
      labels = parseLabels(labelBody);
    }
    const list = series.get(name) || [];
    list.push({ labels, value });
    series.set(name, list);
  }
  return series;
};

const pickValue = (series, name, filter = null) => {
  const list = series.get(name) || [];
  if (!list.length) return null;
  if (!filter) return list[0].value;
  const hit = list.find((entry) => filter(entry.labels));
  return hit ? hit.value : null;
};

const sumValues = (series, name, filter = null) => {
  const list = series.get(name) || [];
  return list.reduce((acc, entry) => {
    if (filter && !filter(entry.labels)) return acc;
    if (!Number.isFinite(entry.value)) return acc;
    return acc + entry.value;
  }, 0);
};

const getLabelValue = (series, name, labelKey) => {
  const list = series.get(name) || [];
  const entry = list.find((item) => item.labels && item.labels[labelKey]);
  return entry ? entry.labels[labelKey] : null;
};

const buildPingMessage = ({ systemMetrics, metricsSummary, metricsOk, metricsError }) => {
  const systemPart = `
🖥️ *Host:* ${systemMetrics.hostname}
🧠 *CPU:* ${systemMetrics.cpuModelo} (${systemMetrics.totalCpus} núcleos) • ${systemMetrics.usoCpuPercentual}%
📈 *Carga (1m|5m|15m):* ${formatLoadAverage(systemMetrics.cargaMedia)}
💾 *Memória:* ${systemMetrics.memoriaUsada} / ${systemMetrics.memoriaTotal} (${systemMetrics.usoMemoriaPercentual}%)
🕒 *Uptime do sistema:* ${systemMetrics.uptimeSistema}
🧱 *SO:* ${systemMetrics.plataforma} ${systemMetrics.release} (${systemMetrics.arquitetura})
`.trim();

  if (!metricsOk) {
    return `
🏓 *Pong! Status do sistema*

${systemPart}

⚠️ *Métricas Prometheus indisponíveis:* ${metricsError || 'sem detalhes'}
`.trim();
  }

  const processPart = `
⚙️ *Processo*
• Uptime: ${metricsSummary.processUptime}
• CPU: user ${metricsSummary.cpuUserSec}s | sys ${metricsSummary.cpuSysSec}s | total ${metricsSummary.cpuTotalSec}s
• Mem: RSS ${metricsSummary.rss} | Heap ${metricsSummary.heap} | VMem ${metricsSummary.vmem}
• FDs: ${metricsSummary.openFds}/${metricsSummary.maxFds}
`.trim();

  const nodePart = `
🧠 *Node/Event Loop*
• Node: ${metricsSummary.nodeVersion}
• Lag: p50 ${metricsSummary.lagP50}ms | p90 ${metricsSummary.lagP90}ms | p99 ${metricsSummary.lagP99}ms
`.trim();

  const dbPart = `
🗄️ *Banco*
• Queries: ${metricsSummary.dbTotal} total | ${metricsSummary.dbSlow} slow
• Writes: messages ${metricsSummary.writes.messages} | lid_map ${metricsSummary.writes.lid_map} | groups ${metricsSummary.writes.groups_metadata}
• Últimas latências (ms): messages ${metricsSummary.lastQuery.messages} | lid_map ${metricsSummary.lastQuery.lid_map} | groups ${metricsSummary.lastQuery.groups_metadata}
`.trim();

  const queuePart = `
📦 *Filas*
• messages ${metricsSummary.queues.messages} | chats ${metricsSummary.queues.chats} | lid_map ${metricsSummary.queues.lid_map}
`.trim();

  const upsertPart = `
📬 *messages.upsert*
• Eventos: append ${metricsSummary.upsertEvents.append} | notify ${metricsSummary.upsertEvents.notify}
• Mensagens: append ${metricsSummary.upsertMessages.append} | notify ${metricsSummary.upsertMessages.notify}
`.trim();

  return `
🏓 *Pong! (Observabilidade)*

${processPart}

${nodePart}

${dbPart}

${queuePart}

${upsertPart}

${systemPart}
`.trim();
};

const fetchMetricsSnapshot = async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), METRICS_TIMEOUT_MS);
  try {
    if (typeof fetch !== 'function') {
      throw new Error('fetch indisponível');
    }
    const response = await fetch(METRICS_ENDPOINT, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const text = await response.text();
    const series = parsePrometheusText(text);

    const processStart = pickValue(series, 'omnizap_process_start_time_seconds');
    const nowSec = Date.now() / 1000;
    const processUptime = processStart ? formatSeconds(nowSec - processStart) : 'n/a';

    const cpuUserSec = pickValue(series, 'omnizap_process_cpu_user_seconds_total');
    const cpuSysSec = pickValue(series, 'omnizap_process_cpu_system_seconds_total');
    const cpuTotalSec = pickValue(series, 'omnizap_process_cpu_seconds_total');

    const rss = pickValue(series, 'omnizap_process_resident_memory_bytes');
    const vmem = pickValue(series, 'omnizap_process_virtual_memory_bytes');
    const heap = pickValue(series, 'omnizap_process_heap_bytes');

    const openFds = pickValue(series, 'omnizap_process_open_fds');
    const maxFds = pickValue(series, 'omnizap_process_max_fds');

    const lagP50 = pickValue(series, 'omnizap_nodejs_eventloop_lag_p50_seconds');
    const lagP90 = pickValue(series, 'omnizap_nodejs_eventloop_lag_p90_seconds');
    const lagP99 = pickValue(series, 'omnizap_nodejs_eventloop_lag_p99_seconds');

    const nodeVersion = getLabelValue(series, 'omnizap_nodejs_version_info', 'version') || 'n/a';

    const dbTotal = sumValues(series, 'omnizap_db_query_total');
    const dbSlow = sumValues(series, 'omnizap_db_slow_queries_total');

    const writesByTable = {};
    const writeSeries = series.get('omnizap_db_write_total') || [];
    writeSeries.forEach((entry) => {
      const table = entry.labels?.table || 'unknown';
      writesByTable[table] = (writesByTable[table] || 0) + entry.value;
    });

    const lastQuerySeries = series.get('omnizap_db_last_query_duration_ms') || [];
    const lastQuery = {};
    lastQuerySeries.forEach((entry) => {
      const table = entry.labels?.table;
      if (!table) return;
      lastQuery[table] = entry.value;
    });

    const queueSeries = series.get('omnizap_queue_depth') || [];
    const queues = {};
    queueSeries.forEach((entry) => {
      const queue = entry.labels?.queue;
      if (!queue) return;
      queues[queue] = entry.value;
    });

    const upsertEvents = {};
    const upsertSeries = series.get('omnizap_messages_upsert_total') || [];
    upsertSeries.forEach((entry) => {
      const type = entry.labels?.type || 'unknown';
      upsertEvents[type] = (upsertEvents[type] || 0) + entry.value;
    });

    const upsertMessages = {};
    const upsertMsgSeries = series.get('omnizap_messages_upsert_messages_total') || [];
    upsertMsgSeries.forEach((entry) => {
      const type = entry.labels?.type || 'unknown';
      upsertMessages[type] = (upsertMessages[type] || 0) + entry.value;
    });

    const formatNumber = (value, digits = 2) =>
      Number.isFinite(value) ? value.toFixed(digits) : 'n/a';

    return {
      processUptime,
      cpuUserSec: formatNumber(cpuUserSec),
      cpuSysSec: formatNumber(cpuSysSec),
      cpuTotalSec: formatNumber(cpuTotalSec),
      rss: formatBytes(rss),
      heap: formatBytes(heap),
      vmem: formatBytes(vmem),
      openFds: Number.isFinite(openFds) ? Math.round(openFds) : 'n/a',
      maxFds: Number.isFinite(maxFds) ? Math.round(maxFds) : 'n/a',
      nodeVersion,
      lagP50: Number.isFinite(lagP50) ? (lagP50 * 1000).toFixed(2) : 'n/a',
      lagP90: Number.isFinite(lagP90) ? (lagP90 * 1000).toFixed(2) : 'n/a',
      lagP99: Number.isFinite(lagP99) ? (lagP99 * 1000).toFixed(2) : 'n/a',
      dbTotal: Math.round(dbTotal),
      dbSlow: Math.round(dbSlow),
      writes: {
        messages: Math.round(writesByTable.messages || 0),
        lid_map: Math.round(writesByTable.lid_map || 0),
        groups_metadata: Math.round(writesByTable.groups_metadata || 0),
      },
      lastQuery: {
        messages: Number.isFinite(lastQuery.messages) ? lastQuery.messages.toFixed(2) : 'n/a',
        lid_map: Number.isFinite(lastQuery.lid_map) ? lastQuery.lid_map.toFixed(2) : 'n/a',
        groups_metadata: Number.isFinite(lastQuery.groups_metadata)
          ? lastQuery.groups_metadata.toFixed(2)
          : 'n/a',
      },
      queues: {
        messages: Math.round(queues.messages || 0),
        chats: Math.round(queues.chats || 0),
        lid_map: Math.round(queues.lid_map || 0),
      },
      upsertEvents: {
        append: Math.round(upsertEvents.append || 0),
        notify: Math.round(upsertEvents.notify || 0),
      },
      upsertMessages: {
        append: Math.round(upsertMessages.append || 0),
        notify: Math.round(upsertMessages.notify || 0),
      },
    };
  } finally {
    clearTimeout(timeout);
  }
};

export async function handlePingCommand({ sock, remoteJid, messageInfo, expirationMessage }) {
  try {
    const systemMetrics = getSystemMetrics();
    let metricsSummary = null;
    let metricsOk = false;
    let metricsError = null;

    try {
      metricsSummary = await fetchMetricsSnapshot();
      metricsOk = true;
    } catch (error) {
      metricsError = error.message;
      logger.warn('Falha ao buscar métricas Prometheus para /ping.', { error: error.message });
    }

    const text = buildPingMessage({
      systemMetrics,
      metricsSummary,
      metricsOk,
      metricsError,
    });
    await sock.sendMessage(
      remoteJid,
      { text },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  } catch (error) {
    logger.error('Erro ao gerar status do sistema:', { error: error.message });
    await sock.sendMessage(
      remoteJid,
      { text: 'Erro ao obter informações do sistema.' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  }
}
