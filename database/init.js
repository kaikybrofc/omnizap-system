require('dotenv').config();
const mysql = require('mysql2/promise');
const logger = require('../app/utils/logger/loggerModule'); // manter padrão do projeto

const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME } = process.env;

if (!DB_HOST || !DB_USER || !DB_PASSWORD || !DB_NAME) {
  logger.error('Erro: variáveis de ambiente DB_HOST, DB_USER, DB_PASSWORD e DB_NAME são obrigatórias.');
  process.exit(1);
}

const createDatabaseSQL = `
  CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;
`;

const createMessagesTableSQL = `
  CREATE TABLE IF NOT EXISTS messages (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    message_id VARCHAR(255) UNIQUE NOT NULL,
    chat_id VARCHAR(255) NOT NULL,
    sender_id VARCHAR(255),
    content TEXT,
    raw_message JSON,
    timestamp TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_chat_timestamp (chat_id, timestamp),
    INDEX idx_sender (sender_id),
    INDEX idx_timestamp (timestamp)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const createChatsTableSQL = `
  CREATE TABLE IF NOT EXISTS chats (
    id VARCHAR(255) PRIMARY KEY NOT NULL,
    name VARCHAR(255),
    raw_chat JSON,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const createGroupsMetadataTableSQL = `
  CREATE TABLE IF NOT EXISTS groups_metadata (
    id VARCHAR(255) PRIMARY KEY NOT NULL,
    subject VARCHAR(255),
    description TEXT,
    owner_jid VARCHAR(255),
    creation BIGINT,
    participants JSON,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

async function initializeDatabase() {
  let connection;
  try {
    connection = await mysql.createConnection({ host: DB_HOST, user: DB_USER, password: DB_PASSWORD });

    await connection.query(createDatabaseSQL);
    logger.info(`Banco de dados '${DB_NAME}' verificado/criado com sucesso.`);

    await connection.changeUser({ database: DB_NAME });

    await Promise.all([connection.query(createMessagesTableSQL), connection.query(createChatsTableSQL), connection.query(createGroupsMetadataTableSQL)]);

    logger.info('Todas as tabelas foram verificadas/criadas com sucesso.');
  } catch (error) {
    logger.error(`Erro ao inicializar o banco: ${error.code || ''} ${error.message}`);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      logger.info('Conexão com o MySQL encerrada após inicialização.');
    }
  }
}

module.exports = initializeDatabase;

if (require.main === module) {
  initializeDatabase();
}
