require('dotenv').config();
const mysql = require('mysql2/promise');
const logger = require('../app/utils/logger/loggerModule'); // usar logger padrão

// Validação das variáveis de ambiente necessárias
const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const missingEnvVars = requiredEnvVars.filter((varName) => !process.env[varName]);

if (missingEnvVars.length > 0) {
  logger.error(`Variáveis de ambiente necessárias não encontradas: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_POOL_LIMIT = 10 } = process.env;

const pool = mysql.createPool({
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: Number(DB_POOL_LIMIT),
  queueLimit: 0,
  timezone: 'Z',
  charset: 'utf8mb4',
  collation: 'utf8mb4_unicode_ci',
});

async function validateConnection() {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    logger.info('Pool de conexões com o MySQL criado e testado com sucesso.');
  } catch (error) {
    logger.error('Erro ao conectar ao MySQL:', error.message);
    process.exit(1);
  }
}

// Executa a validação
validateConnection();

// Tratamento de encerramento gracioso
async function closePool() {
  try {
    await pool.end();
    logger.info('Pool de conexões MySQL encerrado com sucesso.');
  } catch (error) {
    logger.error('Erro ao encerrar pool de conexões:', error.message);
    process.exit(1);
  }
}

// Registra handlers para sinais de término
process.on('SIGTERM', () => closePool());
process.on('SIGINT', () => closePool());

module.exports = { pool, closePool };
