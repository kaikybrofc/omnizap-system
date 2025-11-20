const mysql = require('mysql2/promise');
const logger = require('../app/utils/logger/loggerModule');
const { dbConfig, TABLES } = require('./config');

const createDatabaseSQL = `
  CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;
`;

const createMessagesTableSQL = `
  CREATE TABLE IF NOT EXISTS ${TABLES.MESSAGES} (
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
  CREATE TABLE IF NOT EXISTS ${TABLES.CHATS} (
    id VARCHAR(255) PRIMARY KEY NOT NULL,
    name VARCHAR(255),
    raw_chat JSON,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const createGroupsMetadataTableSQL = `
  CREATE TABLE IF NOT EXISTS ${TABLES.GROUPS_METADATA} (
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
    connection = await mysql.createConnection({
      host: dbConfig.host,
      user: dbConfig.user,
      password: dbConfig.password,
    });

    await connection.query(createDatabaseSQL);
    logger.info(`Banco de dados '${dbConfig.database}' verificado/criado com sucesso.`);

    await connection.changeUser({ database: dbConfig.database });

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
