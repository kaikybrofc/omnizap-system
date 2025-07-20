module.exports = {
  apps: [
    {
      name: 'omnizap-system',
      script: 'index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      // Configuração para esperar o sinal 'ready'
      wait_ready: true,
      listen_timeout: 10000, // Tempo máximo para esperar pelo sinal 'ready' (10 segundos)
      kill_timeout: 5000, // Tempo para o PM2 esperar antes de forçar o encerramento (5 segundos)
    },
  ],
};