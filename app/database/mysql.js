/**
 * OmniZap MySQL Database Connection
 *
 * Módulo responsável pela conexão com o banco de dados MySQL
 *
 * @version 1.0.5
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
 * Sanitiza valores para evitar erros de tipo ao salvar no MySQL
 * @param {*} value Valor a ser sanitizado
 * @returns {*} Valor sanitizado
 */
function sanitizeValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'object' && value !== null && typeof value.toString === 'function' && (value.constructor?.name === 'Long' || value.constructor?.name === 'BigInt' || (typeof value.low === 'number' && typeof value.high === 'number'))) {
    return String(value.toString());
  }

  if (typeof value === 'object' && value !== null && !(value instanceof Date) && !(value instanceof Buffer)) {
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeValue(item));
    } else {
      const sanitized = {};
      Object.keys(value).forEach((key) => {
        sanitized[key] = sanitizeValue(value[key]);
      });
      return sanitized;
    }
  }

  return value;
}

// Variável global para armazenar o pool de conexões
let pool = null;

/**
 * Cria uma conexão temporária com o banco de dados MySQL
 * @param {boolean} useDatabase - Se deve usar o banco de dados especificado ou não
 * @returns {Promise<mysql.Connection>} Conexão MySQL temporária
 */
const getTemporaryConnection = async (useDatabase = false) => {
  try {
    const connectionConfig = {
      host: env.DB_HOST,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      port: env.DB_PORT,
    };

    if (useDatabase) {
      connectionConfig.database = env.DB_NAME;
    }

    return await mysql.createConnection(connectionConfig);
  } catch (error) {
    logger.error('❌ OmniZap Database: Erro ao criar conexão temporária MySQL', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

/**
 * Cria e conecta o pool de conexões com o banco de dados
 * @returns {Promise<boolean>} True se o pool foi criado com sucesso
 */
const connectPool = async () => {
  try {
    logger.info('🔄 OmniZap Database: Criando pool de conexões com o MySQL');

    pool = mysql.createPool({
      host: env.DB_HOST,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
      port: env.DB_PORT,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });

    // Testar pool com uma query simples
    await pool.query('SELECT 1');

    // Validar pool tentando fazer uma conexão de teste
    const connection = await pool.getConnection();
    connection.release();

    logger.info('✅ OmniZap Database: Pool de conexões MySQL criado com sucesso');
    return true;
  } catch (error) {
    logger.error('❌ OmniZap Database: Erro ao criar pool de conexões MySQL', {
      error: error.message,
      stack: error.stack,
    });
    pool = null;
    return false;
  }
};

/**
 * Verifica se o pool está disponível e tenta reconectar se necessário
 * @returns {Promise<boolean>} True se o pool está disponível
 */
const ensurePool = async () => {
  if (!pool) {
    return await connectPool();
  }

  try {
    // Testar a conexão com uma query simples
    await pool.query('SELECT 1');

    // Verificar se o pool ainda está conectado
    const connection = await pool.getConnection();
    connection.release();
    return true;
  } catch (error) {
    logger.warn('⚠️ OmniZap Database: Pool de conexões MySQL não está disponível, tentando reconectar...', {
      error: error.message,
    });
    return await connectPool();
  }
};

/**
 * Inicializa o banco de dados criando o banco se não existir e as tabelas necessárias
 */
const initDatabase = async () => {
  let connection;

  try {
    logger.info('🔄 OmniZap Database: Iniciando configuração do banco de dados MySQL');

    // Usar a função getTemporaryConnection
    connection = await getTemporaryConnection();

    logger.info(`🔄 OmniZap Database: Criando banco de dados '${env.DB_NAME}' se não existir...`);
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${env.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    await connection.query(`USE \`${env.DB_NAME}\``);
    await connection.end();

    // Criar pool de conexões após garantir que o banco existe
    const poolCreated = await connectPool();
    if (!poolCreated) {
      throw new Error('Falha ao criar pool de conexões MySQL');
    }

    logger.info('🔄 OmniZap Database: Conectando ao banco de dados e criando tabelas...');

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
      CREATE TABLE IF NOT EXISTS \`groups\` (
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
        FOREIGN KEY (group_jid) REFERENCES \`groups\`(jid) ON DELETE CASCADE
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
  const sanitizedParams = params.map((param) => sanitizeValue(param));

  try {
    // Verificar se o pool está disponível antes de executar a query
    const isPoolAvailable = await ensurePool();
    if (!isPoolAvailable) {
      throw new Error('Pool de conexões MySQL não está disponível');
    }

    // Verificação rápida da conexão antes de executar a query
    try {
      await pool.query('SELECT 1');
    } catch (pingError) {
      logger.warn('⚠️ OmniZap Database: Falha no ping do MySQL, tentando reconectar...', {
        error: pingError.message,
      });

      // Tentar reconectar uma última vez
      const reconnected = await connectPool();
      if (!reconnected) {
        throw new Error('Não foi possível reconectar ao MySQL após falha de ping');
      }
    }

    const [rows] = await pool.execute(query, sanitizedParams);
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
    if (pool) {
      await pool.end();
      pool = null;
      logger.info('Database: Conexões com MySQL encerradas');
    }
  } catch (error) {
    logger.error('Database: Erro ao encerrar conexões:', {
      error: error.message,
      stack: error.stack,
    });
  }
};

/**
 * Inicializa o banco de dados
 * Wrapper para inicialização, para uso no arquivo principal
 * @returns {Promise<boolean>} - True se inicializado com sucesso
 */
const init = async () => {
  try {
    logger.info('🚀 OmniZap Database: Inicializando MySQL...');
    const result = await initDatabase();

    if (result) {
      logger.info('✅ OmniZap Database: Banco de dados MySQL configurado e pronto para uso');

      const tables = await query('SHOW TABLES');
      logger.info('📋 OmniZap Database: Tabelas disponíveis:');
      tables.forEach((table) => {
        const tableName = Object.values(table)[0];
        logger.info(`- ${tableName}`);
      });
    }

    return result;
  } catch (error) {
    logger.error('❌ OmniZap Database: Erro ao inicializar banco de dados:', {
      error: error.message,
      stack: error.stack,
    });
    return false;
  }
};

module.exports = {
  query,
  initDatabase,
  closeConnection,
  sanitizeValue,
  init,
  ensurePool,
  connectPool,
  getTemporaryConnection,
};
