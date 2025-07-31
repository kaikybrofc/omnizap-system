const os = require('os');
const process = require('process');

const getSystemMetrics = () => {
  // Métricas de Memória
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryUsagePercentage = (usedMemory / totalMemory) * 100;

  // Métricas de CPU (simplificado)
  // Para um uso de CPU mais preciso, seria necessário monitorar ao longo do tempo
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;

  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }

  const cpuUsagePercentage = 100 - (totalIdle / totalTick) * 100;

  // Função para formatar bytes para uma leitura amigável
  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Informações do Processo e Sistema Operacional
  const uptimeInSeconds = process.uptime();
  const uptime = new Date(uptimeInSeconds * 1000).toISOString().substr(11, 8);

  return {
    // Métricas de CPU
    usoCpuPercentual: parseFloat(cpuUsagePercentage.toFixed(2)),

    // Métricas de Memória
    usoMemoriaPercentual: parseFloat(memoryUsagePercentage.toFixed(2)),
    memoriaTotal: formatBytes(totalMemory),
    memoriaLivre: formatBytes(freeMemory),
    memoriaUsada: formatBytes(usedMemory),

    // Informações do Sistema
    uptime,
    plataforma: os.platform(),
    arquitetura: os.arch(),
    hostname: os.hostname(),
    tipo: os.type(),
    release: os.release(),
    versaoNode: process.version,
    cpus: cpus.map(cpu => ({
      modelo: cpu.model,
      velocidade: cpu.speed,
    })),
  };
};

module.exports = {
  getSystemMetrics,
};