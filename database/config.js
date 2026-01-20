import 'dotenv/config';
import logger from '../app/utils/logger/loggerModule.js';

const { NODE_ENV } = process.env;
const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_POOL_LIMIT = 10 } = process.env;

const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const missingEnvVars = requiredEnvVars.filter((varName) => !process.env[varName]);

if (missingEnvVars.length > 0) {
  logger.error(
    `Variáveis de ambiente de banco de dados necessárias não encontradas: ${missingEnvVars.join(
      ', ',
    )}`,
  );
  process.exit(1);
}

const environment = NODE_ENV || 'development';
const dbName = `${DB_NAME}_${environment === 'production' ? 'prod' : 'dev'}`;

export const dbConfig = {
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASSWORD,
  database: dbName,
  poolLimit: Number(DB_POOL_LIMIT),
};

logger.info(`Configuração de banco de dados carregada para o ambiente: ${environment}`);

export const TABLES = {
  MESSAGES: 'messages',
  CHATS: 'chats',
  GROUPS_METADATA: 'groups_metadata',
};