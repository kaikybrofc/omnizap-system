const os = require('os');

const getSystemMetrics = () => {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryUsagePercentage = (usedMemory / totalMemory) * 100;

  // CPU usage calculation (simplified for demonstration)
  // For more accurate CPU usage, you'd need to track over time
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

  return {
    cpuUsagePercentage: parseFloat(cpuUsagePercentage.toFixed(2)),
    memoryUsagePercentage: parseFloat(memoryUsagePercentage.toFixed(2)),
    totalMemoryMB: parseFloat((totalMemory / (1024 * 1024)).toFixed(2)),
    freeMemoryMB: parseFloat((freeMemory / (1024 * 1024)).toFixed(2)),
    usedMemoryMB: parseFloat((usedMemory / (1024 * 1024)).toFixed(2)),
  };
};

module.exports = {
  getSystemMetrics,
};