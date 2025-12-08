const { dbConfig } = require('./config');
const mysql = require('mysql2/promise');
const logger = require('../app/utils/logger/loggerModule');

const pool = mysql.createPool({
  host: dbConfig.host,
  user: dbConfig.user,
  password: dbConfig.password,
  database: dbConfig.database,
  waitForConnections: true,
  connectionLimit: dbConfig.poolLimit,
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
