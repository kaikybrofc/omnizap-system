import logger from '../../utils/logger/loggerModule.js';
import { getSystemMetrics } from '../../utils/systemMetrics/systemMetricsModule.js';
import { sendAndStore } from '../../services/messagePersistenceService.js';

const METRICS_ENDPOINT = process.env.METRICS_ENDPOINT || `http://localhost:${process.env.METRICS_PORT || 9102}${process.env.METRICS_PATH || '/metrics'}`;
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

const parseMetricNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const parsed = Number(value.replace(',', '.').trim());
  return Number.isFinite(parsed) ? parsed : null;
};

const getStatusLevel = (value, warnAt, criticalAt) => {
  const numericValue = parseMetricNumber(value);
  if (numericValue === null) return { emoji: '⚪', label: 'sem dado' };
  if (numericValue >= criticalAt) return { emoji: '🔴', label: 'crítico' };
  if (numericValue >= warnAt) return { emoji: '🟡', label: 'atenção' };
  return { emoji: '🟢', label: 'ok' };
};

const formatStatusLevel = (status) => `${status.emoji} ${status.label}`;

const padNumber = (value) => String(value).padStart(2, '0');

const formatDateTime = (date = new Date()) => `${padNumber(date.getDate())}/${padNumber(date.getMonth() + 1)}/${date.getFullYear()} ${padNumber(date.getHours())}:${padNumber(date.getMinutes())}:${padNumber(date.getSeconds())}`;

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

const buildPingMessage = ({ systemMetrics, metricsSummary, metricsOk, metricsError, latencyMs, generatedAt }) => {
  const responseTime = Number.isFinite(latencyMs) ? `${Math.max(0, Math.round(latencyMs))}ms` : 'n/a';

  const hostCpuStatus = getStatusLevel(systemMetrics.usoCpuPercentual, 65, 85);
  const hostMemoryStatus = getStatusLevel(systemMetrics.usoMemoriaPercentual, 75, 90);

  const load1 = Array.isArray(systemMetrics.cargaMedia) ? systemMetrics.cargaMedia[0] : null;
  const loadPerCore = Number.isFinite(load1) && systemMetrics.totalCpus > 0 ? load1 / systemMetrics.totalCpus : null;
  const loadStatus = getStatusLevel(loadPerCore, 0.9, 1.2);
  const loadPerCoreText = loadPerCore === null ? 'n/a' : loadPerCore.toFixed(2);

  const systemPart = `
🖥️ *Servidor (máquina)*
• Host: ${systemMetrics.hostname}
• SO: ${systemMetrics.plataforma} ${systemMetrics.release} (${systemMetrics.arquitetura})
• Uptime do sistema: ${systemMetrics.uptimeSistema}
• CPU da máquina: ${formatStatusLevel(hostCpuStatus)} • ${systemMetrics.usoCpuPercentual}% (uso geral)
• Carga (1m|5m|15m): ${formatLoadAverage(systemMetrics.cargaMedia)}
• Pressão por núcleo (1m): ${loadPerCoreText} • ${formatStatusLevel(loadStatus)}
• RAM: ${formatStatusLevel(hostMemoryStatus)} • ${systemMetrics.memoriaUsada} / ${systemMetrics.memoriaTotal} (${systemMetrics.usoMemoriaPercentual}%)
`.trim();

  if (!metricsOk) {
    return `
🏓 *Pong! Painel de saúde (modo básico)*
🕐 Atualizado em: ${formatDateTime(generatedAt)}
⚡ Tempo de resposta: ${responseTime}
🧭 Legenda: 🟢 ok • 🟡 atenção • 🔴 crítico • ⚪ sem dado

${systemPart}

⚠️ *Métricas avançadas indisponíveis*
• Motivo: ${metricsError || 'sem detalhes'}
• Endpoint: ${METRICS_ENDPOINT}
• Timeout: ${METRICS_TIMEOUT_MS}ms

💡 *Dica:* as métricas avançadas vêm do endpoint */metrics* (Prometheus).
`.trim();
  }

  const openFds = parseMetricNumber(metricsSummary.openFds);
  const maxFds = parseMetricNumber(metricsSummary.maxFds);
  const fdsUsage = openFds !== null && maxFds && maxFds > 0 ? (openFds / maxFds) * 100 : null;
  const fdsStatus = getStatusLevel(fdsUsage, 60, 80);
  const fdsUsageText = fdsUsage === null ? 'n/a' : `${fdsUsage.toFixed(1)}%`;

  const lagP99 = parseMetricNumber(metricsSummary.lagP99);
  const lagStatus = getStatusLevel(lagP99, 120, 300);

  const dbTotal = parseMetricNumber(metricsSummary.dbTotal) || 0;
  const dbSlow = parseMetricNumber(metricsSummary.dbSlow) || 0;
  const slowRate = dbTotal > 0 ? (dbSlow / dbTotal) * 100 : null;
  const dbStatus = getStatusLevel(slowRate, 5, 15);
  const slowRateText = slowRate === null ? 'n/a' : `${slowRate.toFixed(2)}%`;

  const queueValues = [metricsSummary.queues.messages, metricsSummary.queues.chats, metricsSummary.queues.lid_map].map((value) => parseMetricNumber(value)).filter((value) => value !== null);
  const queuePeak = queueValues.length ? Math.max(...queueValues) : null;
  const queueStatus = getStatusLevel(queuePeak, 30, 120);
  const queuePeakText = queuePeak === null ? 'n/a' : String(Math.round(queuePeak));

  const processPart = `
⚙️ *Processo do bot*
• Uptime do processo: ${metricsSummary.processUptime}
• Node.js: ${metricsSummary.nodeVersion}
• CPU acumulada: total ${metricsSummary.cpuTotalSec}s (user ${metricsSummary.cpuUserSec}s | sys ${metricsSummary.cpuSysSec}s)
• Memória do processo: RSS ${metricsSummary.rss} | Heap ${metricsSummary.heap} | VMem ${metricsSummary.vmem}
• FDs abertos: ${metricsSummary.openFds}/${metricsSummary.maxFds} (${fdsUsageText}) • ${formatStatusLevel(fdsStatus)}
`.trim();

  const nodePart = `
🧠 *Event Loop (responsividade)*
• Lag p50: ${metricsSummary.lagP50}ms (comportamento normal)
• Lag p90: ${metricsSummary.lagP90}ms (picos frequentes)
• Lag p99: ${metricsSummary.lagP99}ms (pior caso recente)
• Status do loop: ${formatStatusLevel(lagStatus)} (quanto menor o lag, melhor)
`.trim();

  const dbPart = `
🗄️ *Banco*
• Queries totais: ${metricsSummary.dbTotal}
• Queries lentas: ${metricsSummary.dbSlow} (${slowRateText}) • ${formatStatusLevel(dbStatus)}
• Writes: messages ${metricsSummary.writes.messages} | lid_map ${metricsSummary.writes.lid_map} | groups ${metricsSummary.writes.groups_metadata}
• Últimas latências (ms): messages ${metricsSummary.lastQuery.messages} | lid_map ${metricsSummary.lastQuery.lid_map} | groups ${metricsSummary.lastQuery.groups_metadata}
`.trim();

  const queuePart = `
📦 *Filas internas (backlog)*
• messages ${metricsSummary.queues.messages} | chats ${metricsSummary.queues.chats} | lid_map ${metricsSummary.queues.lid_map}
• Pico atual: ${queuePeakText} • ${formatStatusLevel(queueStatus)} (quanto menor, melhor)
`.trim();

  const upsertPart = `
📬 *messages.upsert (entrada de mensagens)*
• Eventos recebidos: append ${metricsSummary.upsertEvents.append} | notify ${metricsSummary.upsertEvents.notify}
• Mensagens processadas: append ${metricsSummary.upsertMessages.append} | notify ${metricsSummary.upsertMessages.notify}
`.trim();

  const glossaryPart = `
📖 *Glossário rápido*
• RSS: memória real em RAM usada pelo processo
• Heap: memória JavaScript gerenciada pelo Node.js
• VMem: memória virtual reservada pelo processo
• Lag: atraso do Node para executar tarefas
`.trim();

  return `
🏓 *Pong! Painel de saúde do Omnizap*
🕐 Atualizado em: ${formatDateTime(generatedAt)}
⚡ Tempo de resposta: ${responseTime}
🧭 Legenda: 🟢 ok • 🟡 atenção • 🔴 crítico • ⚪ sem dado

${systemPart}

${processPart}

${nodePart}

${dbPart}

${queuePart}

${upsertPart}

${glossaryPart}
`.trim();
};

const fetchMetricsSnapshot = async () => {
  const controller = typeof globalThis.AbortController === 'function' ? new globalThis.AbortController() : null;
  const timeout = setTimeout(() => controller?.abort(), METRICS_TIMEOUT_MS);
  try {
    if (typeof globalThis.fetch !== 'function') {
      throw new Error('fetch indisponível');
    }
    const response = await globalThis.fetch(METRICS_ENDPOINT, controller ? { signal: controller.signal } : {});
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

    const formatNumber = (value, digits = 2) => (Number.isFinite(value) ? value.toFixed(digits) : 'n/a');

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
        groups_metadata: Number.isFinite(lastQuery.groups_metadata) ? lastQuery.groups_metadata.toFixed(2) : 'n/a',
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
    const startedAt = Date.now();
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
      latencyMs: Date.now() - startedAt,
      generatedAt: new Date(),
    });
    await sendAndStore(sock, remoteJid, { text }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
  } catch (error) {
    logger.error('Erro ao gerar status do sistema:', { error: error.message });
    await sendAndStore(sock, remoteJid, { text: 'Erro ao obter informações do sistema.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
  }
}
