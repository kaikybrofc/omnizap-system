import os from 'node:os';
import process from 'node:process';

const formatBytes = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatDuration = (totalSeconds) => {
  const total = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  const time = [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
  return days > 0 ? `${days}d ${time}` : time;
};

export const getSystemMetrics = () => {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryUsagePercentage = (usedMemory / totalMemory) * 100;

  const cpus = os.cpus();
  const totalCpus = cpus.length;
  let totalIdle = 0;
  let totalTick = 0;

  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }

  const cpuUsagePercentage = 100 - (totalIdle / totalTick) * 100;

  const processUptimeSeconds = process.uptime();
  const systemUptimeSeconds = os.uptime();
  const uptime = formatDuration(processUptimeSeconds);
  const systemUptime = formatDuration(systemUptimeSeconds);
  const loadAverage = os.loadavg();
  const cpuSpeedAverage =
    totalCpus > 0
      ? Math.round(cpus.reduce((sum, cpu) => sum + (cpu.speed || 0), 0) / totalCpus)
      : 0;
  const memoryUsage = process.memoryUsage();

  return {
    usoCpuPercentual: parseFloat(cpuUsagePercentage.toFixed(2)),
    cargaMedia: loadAverage.map((value) => parseFloat(value.toFixed(2))),
    totalCpus,
    cpuModelo: cpus[0]?.model || 'Desconhecido',
    cpuVelocidadeMediaMHz: cpuSpeedAverage,

    usoMemoriaPercentual: parseFloat(memoryUsagePercentage.toFixed(2)),
    memoriaTotal: formatBytes(totalMemory),
    memoriaLivre: formatBytes(freeMemory),
    memoriaUsada: formatBytes(usedMemory),
    memoriaProcesso: {
      rss: formatBytes(memoryUsage.rss),
      heapTotal: formatBytes(memoryUsage.heapTotal),
      heapUsado: formatBytes(memoryUsage.heapUsed),
      external: formatBytes(memoryUsage.external),
      arrayBuffers: formatBytes(memoryUsage.arrayBuffers || 0),
    },

    uptime,
    uptimeSistema: systemUptime,
    uptimeSegundos: Math.floor(processUptimeSeconds),
    uptimeSistemaSegundos: Math.floor(systemUptimeSeconds),
    plataforma: os.platform(),
    arquitetura: os.arch(),
    hostname: os.hostname(),
    tipo: os.type(),
    release: os.release(),
    versaoNode: process.version,
    nodeEnv: process.env.NODE_ENV || 'development',
    pid: process.pid,
    ppid: process.ppid,
    cpus: cpus.map((cpu) => ({
      modelo: cpu.model,
      velocidade: cpu.speed,
    })),
  };
};
