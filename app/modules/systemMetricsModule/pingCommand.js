import logger from '../../utils/logger/loggerModule.js';
import { getSystemMetrics } from '../../utils/systemMetrics/systemMetricsModule.js';

const formatLoadAverage = (values) => values.map((value) => value.toFixed(2)).join(' | ');

const buildPingMessage = (metrics) =>
  `
🏓 *Pong! Status do sistema*

🖥️ *Host:* ${metrics.hostname}
🧠 *CPU:* ${metrics.cpuModelo} (${metrics.totalCpus} núcleos) • ${metrics.usoCpuPercentual}%
📈 *Carga (1m|5m|15m):* ${formatLoadAverage(metrics.cargaMedia)}
💾 *Memória:* ${metrics.memoriaUsada} / ${metrics.memoriaTotal} (${metrics.usoMemoriaPercentual}%)
🧵 *Processo:* PID ${metrics.pid} • Uptime ${metrics.uptime}
🧮 *Memória do processo:* ${metrics.memoriaProcesso.heapUsado} heap • ${metrics.memoriaProcesso.rss} RSS
🕒 *Uptime do sistema:* ${metrics.uptimeSistema}
🧰 *Node:* ${metrics.versaoNode} • ${metrics.nodeEnv}
🧱 *SO:* ${metrics.plataforma} ${metrics.release} (${metrics.arquitetura})
`.trim();

export async function handlePingCommand({ sock, remoteJid, messageInfo, expirationMessage }) {
  try {
    const metrics = getSystemMetrics();
    const text = buildPingMessage(metrics);
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
