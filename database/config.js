require('dotenv').config();
const logger = require('../app/utils/logger/loggerModule');

const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_POOL_LIMIT = 10 } = process.env;

const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const missingEnvVars = requiredEnvVars.filter((varName) => !process.env[varName]);

if (missingEnvVars.length > 0) {
  logger.error(`Variáveis de ambiente de banco de dados necessárias não encontradas: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

const dbConfig = {
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  poolLimit: Number(DB_POOL_LIMIT),
};

const TABLES = {
  MESSAGES: 'messages',
  CHATS: 'chats',
  GROUPS_METADATA: 'groups_metadata',
};

module.exports = {
  dbConfig,
  TABLES,
};
