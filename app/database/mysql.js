/**
 * OmniZap MySQL Database Connection
 *
 * Módulo responsável pela conexão com o banco de dados MySQL
 *
 * @version 1.0.0
 * @author OmniZap Team
 * @license MIT
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const logger = require('../utils/logger/loggerModule');
const { cleanEnv, str, num } = require('envalid');

const env = cleanEnv(process.env, {
  DB_HOST: str({ default: 'localhost' }),
  DB_USER: str({ default: 'root' }),
  DB_PASSWORD: str({ default: '' }),
  DB_NAME: str({ default: 'omnizap_cache' }),
  DB_PORT: num({ default: 3306 }),
});

/**
 * Cria pool de conexões com o banco de dados
 */
const pool = mysql.createPool({
  host: env.DB_HOST,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  port: env.DB_PORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

/**
 * Inicializa o banco de dados criando as tabelas necessárias
 */
const initDatabase = async () => {
  try {
    logger.info('🔄 OmniZap Database: Inicializando banco de dados MySQL');

    // Criar tabela de mensagens
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS messages (
        id VARCHAR(255) PRIMARY KEY,
        remote_jid VARCHAR(255) NOT NULL,
        from_me BOOLEAN DEFAULT FALSE,
        push_name VARCHAR(255),
        timestamp BIGINT,
        message_type VARCHAR(50),
        message_text TEXT,
        participant VARCHAR(255),
        quoted_message_id VARCHAR(255),
        raw_data JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_remote_jid (remote_jid),
        INDEX idx_timestamp (timestamp),
        INDEX idx_message_type (message_type),
        INDEX idx_participant (participant)
      )
    `);

    // Criar tabela de eventos
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS events (
        id VARCHAR(255) PRIMARY KEY,
        event_type VARCHAR(50) NOT NULL,
        event_id VARCHAR(255),
        event_timestamp BIGINT,
        event_data JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_event_type (event_type),
        INDEX idx_event_timestamp (event_timestamp)
      )
    `);

    // Criar tabela de grupos
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS groups (
        jid VARCHAR(255) PRIMARY KEY,
        subject VARCHAR(255),
        creation_timestamp BIGINT,
        owner VARCHAR(255),
        description TEXT,
        participant_count INT DEFAULT 0,
        metadata JSON,
        last_updated BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_subject (subject),
        INDEX idx_creation_timestamp (creation_timestamp),
        INDEX idx_last_updated (last_updated)
      )
    `);

    // Criar tabela de participantes de grupos
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS group_participants (
        id INT AUTO_INCREMENT PRIMARY KEY,
        group_jid VARCHAR(255) NOT NULL,
        participant_jid VARCHAR(255) NOT NULL,
        is_admin BOOLEAN DEFAULT FALSE,
        is_super_admin BOOLEAN DEFAULT FALSE,
        joined_timestamp BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_participant (group_jid, participant_jid),
        INDEX idx_group_jid (group_jid),
        INDEX idx_participant_jid (participant_jid),
        FOREIGN KEY (group_jid) REFERENCES groups(jid) ON DELETE CASCADE
      )
    `);

    // Criar tabela de contatos
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS contacts (
        jid VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255),
        notify VARCHAR(255),
        verify VARCHAR(255),
        short_name VARCHAR(255),
        push_name VARCHAR(255),
        status TEXT,
        profile_picture_url TEXT,
        is_business BOOLEAN DEFAULT FALSE,
        is_enterprise BOOLEAN DEFAULT FALSE,
        metadata JSON,
        last_updated BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_name (name),
        INDEX idx_push_name (push_name)
      )
    `);

    // Criar tabela de chats
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS chats (
        jid VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255),
        unread_count INT DEFAULT 0,
        timestamp BIGINT,
        archived BOOLEAN DEFAULT FALSE,
        pinned BOOLEAN DEFAULT FALSE,
        is_muted BOOLEAN DEFAULT FALSE,
        is_group BOOLEAN DEFAULT FALSE,
        metadata JSON,
        last_updated BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_name (name),
        INDEX idx_timestamp (timestamp),
        INDEX idx_archived (archived),
        INDEX idx_is_group (is_group)
      )
    `);

    logger.info('✅ OmniZap Database: Banco de dados MySQL inicializado com sucesso');
    return true;
  } catch (error) {
    logger.error('❌ OmniZap Database: Erro ao inicializar banco de dados MySQL', {
      error: error.message,
      stack: error.stack,
    });
    return false;
  }
};

/**
 * Executa uma query SQL
 * @param {string} query - SQL query
 * @param {Array} params - Parâmetros para a query
 * @returns {Promise} - Resultado da query
 */
const query = async (query, params = []) => {
  try {
    const [rows] = await pool.execute(query, params);
    return rows;
  } catch (error) {
    logger.error('Database: Erro ao executar query:', {
      error: error.message,
      stack: error.stack,
      query,
      params,
    });
    throw error;
  }
};

/**
 * Fecha todas as conexões do pool
 */
const closeConnection = async () => {
  try {
    await pool.end();
    logger.info('Database: Conexões com MySQL encerradas');
  } catch (error) {
    logger.error('Database: Erro ao encerrar conexões:', {
      error: error.message,
      stack: error.stack,
    });
  }
};

module.exports = {
  pool,
  query,
  initDatabase,
  closeConnection,
};
