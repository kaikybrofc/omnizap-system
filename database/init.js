require('dotenv').config();
const mysql = require('mysql2/promise');

const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME } = process.env;

const createMessagesTableSQL = `
  CREATE TABLE IF NOT EXISTS messages (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    message_id VARCHAR(255) UNIQUE NOT NULL,
    chat_id VARCHAR(255) NOT NULL,
    sender_id VARCHAR(255),
    content TEXT,
    raw_message JSON,
    timestamp DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    // 1. Conecta ao servidor MySQL para garantir que o banco de dados exista
    connection = await mysql.createConnection({ host: DB_HOST, user: DB_USER, password: DB_PASSWORD });
    await connection.query(`CREATE DATABASE IF NOT EXISTS 
${DB_NAME}
;`);
    await connection.end();
    console.log(`Banco de dados '${DB_NAME}' verificado/criado com sucesso.`);

    // 2. Conecta-se ao banco de dados específico para criar as tabelas
    connection = await mysql.createConnection({ host: DB_HOST, user: DB_USER, password: DB_PASSWORD, database: DB_NAME });
    await connection.query(createMessagesTableSQL);
    console.log('Tabela messages verificada/criada com sucesso.');
    await connection.query(createChatsTableSQL);
    console.log('Tabela chats verificada/criada com sucesso.');
    await connection.query(createGroupsMetadataTableSQL);
    console.log('Tabela groups_metadata verificada/criada com sucesso.');

  } catch (error) {
    console.error('Erro ao inicializar o banco de dados ou tabelas:', error);
    process.exit(1); // Encerra o script com um código de erro
  } finally {
    if (connection) {
      await connection.end();
      console.log('Conexão com o MySQL encerrada para inicialização.');
    }
  }
}

module.exports = initializeDatabase;

// Executa a função apenas se o script for chamado diretamente
if (require.main === module) {
  initializeDatabase();
}