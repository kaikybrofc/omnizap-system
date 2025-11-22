require('dotenv').config();

const appName = process.env.PM2_APP_NAME || 'omnizap-system';

module.exports = {
  apps: [
    {
      name: `${appName}-prod`,
      script: 'index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      out_file: `logs/${appName}-out.log`,
      error_file: `logs/${appName}-error.log`,
      env: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
      },
      wait_ready: true,
      listen_timeout: 10000,
      kill_timeout: 5000,
    },
  ],
};
