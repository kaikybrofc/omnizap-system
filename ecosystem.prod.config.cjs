require('dotenv').config();

const appName = process.env.PM2_APP_NAME || 'omnizap-system';

module.exports = {
  apps: [
    {
      name: `${appName}-production`,
      script: './index.js',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '3G',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      out_file: `logs/${appName}-out.log`,
      error_file: `logs/${appName}-error.log`,
      env: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
        COMMAND_PREFIX: '/',
      },
      wait_ready: true,
      listen_timeout: 10000,
      kill_timeout: 5000,
    },
  ],
};
