require('dotenv').config();
const mysql = require('mysql2/promise');

const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME } = process.env;

const createMessagesTableSQL = `
  CREATE TABLE IF NOT EXISTS messages (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    message_id VARCHAR(255) UNIQUE NOT NULL,
    chat_id VARCHAR(255) NOT NULL,
    sender_id VARCHAR(255),
    content TEXT,
    raw_message JSON,
    timestamp DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_chat_timestamp (chat_id, timestamp),
    INDEX idx_sender (sender_id),
    INDEX idx_timestamp (timestamp)
  );
`;

const createChatsTableSQL = `
  CREATE TABLE IF NOT EXISTS chats (
    id VARCHAR(255) PRIMARY KEY NOT NULL,
    name VARCHAR(255),
    raw_chat JSON,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  );
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
  );
`;

async function initializeDatabase() {
  let connection;
  try {
    // Cria a conexão inicial
    connection = await mysql.createConnection({ host: DB_HOST, user: DB_USER, password: DB_PASSWORD });
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`;`);
    console.log(`Banco de dados '${DB_NAME}' verificado/criado com sucesso.`);

    // Muda para o banco de dados criado
    await connection.changeUser({ database: DB_NAME });

    // Executa todas as queries de criação de tabelas em paralelo
    await Promise.all([connection.query(createMessagesTableSQL), connection.query(createChatsTableSQL), connection.query(createGroupsMetadataTableSQL)]);

    console.log('Todas as tabelas foram verificadas/criadas com sucesso.');
  } catch (error) {
    console.error('Erro ao inicializar o banco de dados ou tabelas:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('Conexão com o MySQL encerrada para inicialização.');
    }
  }
}

module.exports = initializeDatabase;

if (require.main === module) {
  initializeDatabase();
}
