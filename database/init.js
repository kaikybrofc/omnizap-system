import mysql from 'mysql2/promise';
import logger from '../app/utils/logger/loggerModule.js';
import { dbConfig, TABLES } from './index.js';

import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dbToCreate = dbConfig.database;

const createDatabaseSQL = `
  CREATE DATABASE IF NOT EXISTS \`${dbToCreate}\`
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

const createGroupConfigsTableSQL = `
  CREATE TABLE IF NOT EXISTS ${TABLES.GROUP_CONFIGS} (
    id VARCHAR(255) PRIMARY KEY NOT NULL,
    config JSON,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

/**
 * Inicializa o banco de dados e garante a existência das tabelas.
 * @returns {Promise<void>} Conclui após criar banco e tabelas.
 */
export default async function initializeDatabase() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: dbConfig.host,
      user: dbConfig.user,
      password: dbConfig.password,
    });

    await connection.query(createDatabaseSQL);
    logger.info(`Banco de dados '${dbToCreate}' verificado/criado com sucesso.`);

    await connection.changeUser({ database: dbToCreate });

    await Promise.all([connection.query(createMessagesTableSQL), connection.query(createChatsTableSQL), connection.query(createGroupsMetadataTableSQL), connection.query(createGroupConfigsTableSQL)]);

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

const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] === __filename) {
  initializeDatabase();
}
