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
        LOG_LEVEL: 'debug',
      },
      env_production: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
      },
      wait_ready: true,
      listen_timeout: 10000,
      kill_timeout: 5000,
    },
  ],
};
