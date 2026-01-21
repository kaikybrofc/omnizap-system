import 'dotenv/config';
import mysql from 'mysql2/promise';
import path from 'node:path';
import logger from '../app/utils/logger/loggerModule.js';

const { NODE_ENV } = process.env;
const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_POOL_LIMIT = 10 } = process.env;

const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const missingEnvVars = requiredEnvVars.filter((varName) => !process.env[varName]);

if (missingEnvVars.length > 0) {
  logger.error(`Variáveis de ambiente de banco de dados necessárias não encontradas: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

const environment = NODE_ENV || 'development';
const resolveDbName = (baseName, env) => {
  const suffix = env === 'production' ? 'prod' : 'dev';
  if (baseName.endsWith('_dev') || baseName.endsWith('_prod')) {
    return baseName;
  }
  return `${baseName}_${suffix}`;
};
const dbName = resolveDbName(DB_NAME, environment);

/**
 * Configuracao do banco de dados baseada nas variaveis de ambiente.
 * @type {{host: string, user: string, password: string, database: string, poolLimit: number}}
 */
export const dbConfig = {
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASSWORD,
  database: dbName,
  poolLimit: Number(DB_POOL_LIMIT),
};

logger.info(`Configuração de banco de dados carregada para o ambiente: ${environment}`);

/**
 * Nomes das tabelas suportadas pelo sistema.
 * @type {{MESSAGES: string, CHATS: string, GROUPS_METADATA: string}}
 */
export const TABLES = {
  MESSAGES: 'messages',
  CHATS: 'chats',
  GROUPS_METADATA: 'groups_metadata',
  GROUP_CONFIGS: 'group_configs',
};

/**
 * Pool de conexoes com o MySQL.
 * @type {import('mysql2/promise').Pool}
 */
export const pool = mysql.createPool({
  host: dbConfig.host,
  user: dbConfig.user,
  password: dbConfig.password,
  database: dbConfig.database,
  waitForConnections: true,
  connectionLimit: dbConfig.poolLimit,
  queueLimit: 0,
  timezone: 'Z',
  charset: 'utf8mb4',
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

const isInitScript = process.argv[1]?.endsWith(`${path.sep}database${path.sep}init.js`);
if (!isInitScript) {
  validateConnection();
}

/**
 * Encerra o pool de conexoes do MySQL.
 * @returns {Promise<void>}
 */
export async function closePool() {
  try {
    await pool.end();
    logger.info('Pool de conexões MySQL encerrado com sucesso.');
  } catch (error) {
    logger.error('Erro ao encerrar pool de conexões:', error.message);
    process.exit(1);
  }
}

process.on('SIGTERM', () => closePool());
process.on('SIGINT', () => closePool());

/**
 * Erro padrao para operacoes de banco de dados.
 */
export class DatabaseError extends Error {
  constructor(message, originalError, sql, params) {
    super(message);
    this.name = 'DatabaseError';
    this.originalError = originalError;
    this.sql = sql;
    this.params = params;
    this.errorCode = originalError?.code;
    this.errorNumber = originalError?.errno;
    this.sqlState = originalError?.sqlState;
  }
}

const VALID_TABLES = Object.values(TABLES);

/**
 * Valida se o nome da tabela esta na lista permitida.
 * @param {string} tableName
 * @throws {Error} Se a tabela nao for valida.
 */
export function validateTableName(tableName) {
  if (!VALID_TABLES.includes(tableName)) {
    throw new Error(`Tabela inválida: ${tableName}`);
  }
}

/**
 * Converte undefined em null para parametros SQL.
 * @param {Array<any>} params
 * @returns {Array<any>}
 */
export function sanitizeParams(params) {
  return params.map((param) => (param === undefined ? null : param));
}

/**
 * Executa uma consulta SQL com parametros sanitizados.
 * @param {string} sql
 * @param {Array<any>} [params=[]]
 * @param {import('mysql2/promise').PoolConnection|null} [connection=null]
 * @returns {Promise<Array<any>>}
 */
export async function executeQuery(sql, params = [], connection = null) {
  const executor = connection || pool;
  try {
    const sanitizedParams = sanitizeParams(params);
    logger.debug('Executando SQL:', { sql, params: sanitizedParams });
    const [results] = await executor.execute(sql, sanitizedParams);
    return results;
  } catch (error) {
    logger.error('Erro na consulta SQL:', {
      sql,
      params,
      errorCode: error.code,
      errorMessage: error.message,
    });
    throw new DatabaseError(`Erro na execução da consulta: ${error.message}`, error, sql, params);
  }
}

/**
 * Busca todos os registros de uma tabela com paginacao.
 * @param {string} tableName
 * @param {number} [limit=100]
 * @param {number} [offset=0]
 * @returns {Promise<Array<any>>}
 */
export async function findAll(tableName, limit = 100, offset = 0) {
  validateTableName(tableName);
  const safeLimit = parseInt(limit, 10);
  const safeOffset = parseInt(offset, 10);

  if (isNaN(safeLimit) || isNaN(safeOffset)) {
    throw new Error('Limit e offset devem ser números válidos.');
  }

  const sql = `SELECT * FROM ${mysql.escapeId(tableName)} LIMIT ${safeLimit} OFFSET ${safeOffset}`;
  return executeQuery(sql);
}

/**
 * Busca um registro por ID em uma tabela.
 * @param {string} tableName
 * @param {number|string} id
 * @returns {Promise<any|null>}
 */
export async function findById(tableName, id) {
  validateTableName(tableName);
  const sql = `SELECT * FROM ${mysql.escapeId(tableName)} WHERE id = ?`;
  const results = await executeQuery(sql, [id]);
  return results[0] || null;
}

/**
 * Busca registros com base em criterios.
 * @param {string} tableName
 * @param {object} criteria
 * @param {object} [options]
 * @param {number} [options.limit]
 * @param {number} [options.offset]
 * @param {string} [options.orderBy]
 * @param {'ASC'|'DESC'} [options.orderDirection='ASC']
 * @returns {Promise<Array<any>>}
 */
export async function findBy(tableName, criteria, options = {}) {
  validateTableName(tableName);
  const keys = Object.keys(criteria);
  if (keys.length === 0) {
    return findAll(tableName, options.limit, options.offset);
  }

  const whereClause = keys.map((key) => `${mysql.escapeId(key)} = ?`).join(' AND ');
  const params = Object.values(criteria);

  let sql = `SELECT * FROM ${mysql.escapeId(tableName)} WHERE ${whereClause}`;

  if (options.orderBy) {
    const direction = options.orderDirection?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    sql += ` ORDER BY ${mysql.escapeId(options.orderBy)} ${direction}`;
  }

  if (options.limit !== undefined) {
    sql += ` LIMIT ${parseInt(options.limit, 10)}`;
  }

  if (options.offset !== undefined) {
    sql += ` OFFSET ${parseInt(options.offset, 10)}`;
  }

  return executeQuery(sql, params);
}

/**
 * Conta registros de uma tabela com filtro opcional.
 * @param {string} tableName
 * @param {object} [criteria]
 * @returns {Promise<number>}
 */
export async function count(tableName, criteria = {}) {
  validateTableName(tableName);
  const keys = Object.keys(criteria);
  let sql = `SELECT COUNT(*) as count FROM ${mysql.escapeId(tableName)}`;
  let params = [];

  if (keys.length > 0) {
    const whereClause = keys.map((key) => `${mysql.escapeId(key)} = ?`).join(' AND ');
    sql += ` WHERE ${whereClause}`;
    params = Object.values(criteria);
  }

  const result = await executeQuery(sql, params);
  return result[0].count;
}

/**
 * Cria um novo registro em uma tabela.
 * @param {string} tableName
 * @param {object} data
 * @returns {Promise<object>}
 */
export async function create(tableName, data) {
  validateTableName(tableName);
  const keys = Object.keys(data);
  if (keys.length === 0) {
    throw new Error('Não é possível criar um registro com dados vazios.');
  }
  const values = Object.values(data);
  const sql = `INSERT INTO ${mysql.escapeId(tableName)} (${keys.map(mysql.escapeId).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  const result = await executeQuery(sql, values);
  return { id: result.insertId, ...data };
}

/**
 * Cria um novo registro ignorando duplicidade.
 * @param {string} tableName
 * @param {object} data
 * @returns {Promise<object|null>}
 */
export async function createIgnore(tableName, data) {
  validateTableName(tableName);
  const keys = Object.keys(data);
  if (keys.length === 0) {
    throw new Error('Não é possível criar um registro com dados vazios.');
  }
  const values = Object.values(data);
  const sql = `INSERT IGNORE INTO ${mysql.escapeId(tableName)} (${keys.map(mysql.escapeId).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  const result = await executeQuery(sql, values);
  if (!result.insertId) {
    return null;
  }
  return { id: result.insertId, ...data };
}

/**
 * Insere multiplos registros em uma tabela.
 * @param {string} tableName
 * @param {Array<object>} records
 * @returns {Promise<number>}
 */
export async function bulkInsert(tableName, records) {
  validateTableName(tableName);
  if (!records || records.length === 0) {
    return 0;
  }

  const keys = Object.keys(records[0]);
  const values = records.map((r) => keys.map((k) => r[k]));
  const sql = `INSERT INTO ${mysql.escapeId(tableName)} (${keys.map(mysql.escapeId).join(', ')}) VALUES ?`;

  const [result] = await pool.query(sql, [values]);
  return result.affectedRows;
}

/**
 * Atualiza um registro existente em uma tabela pelo ID.
 * @param {string} tableName
 * @param {number|string} id
 * @param {object} data
 * @returns {Promise<boolean>}
 */
export async function update(tableName, id, data) {
  validateTableName(tableName);
  const keys = Object.keys(data);
  if (keys.length === 0) {
    throw new Error('Não é possível atualizar um registro com dados vazios.');
  }
  const sets = keys.map((key) => `${mysql.escapeId(key)} = ?`).join(', ');
  const sql = `UPDATE ${mysql.escapeId(tableName)} SET ${sets} WHERE id = ?`;
  const result = await executeQuery(sql, [...Object.values(data), id]);
  return result.affectedRows > 0;
}

/**
 * Remove um registro de uma tabela pelo ID.
 * @param {string} tableName
 * @param {number|string} id
 * @returns {Promise<boolean>}
 */
export async function remove(tableName, id) {
  validateTableName(tableName);
  const sql = `DELETE FROM ${mysql.escapeId(tableName)} WHERE id = ?`;
  const result = await executeQuery(sql, [id]);
  return result.affectedRows > 0;
}

/**
 * Insere ou atualiza um registro em uma tabela.
 * @param {string} tableName
 * @param {object} data
 * @returns {Promise<any>}
 */
export async function upsert(tableName, data) {
  validateTableName(tableName);
  const keys = Object.keys(data);
  if (keys.length === 0) {
    throw new Error('Não é possível fazer upsert com dados vazios.');
  }

  const updateData = { ...data };
  if (updateData.id) {
    delete updateData.id;
  }

  const insertKeys = keys.map(mysql.escapeId).join(', ');
  const insertPlaceholders = keys.map(() => '?').join(', ');
  const updateSets = Object.keys(updateData)
    .map((key) => `${mysql.escapeId(key)} = ?`)
    .join(', ');

  const sql = `INSERT INTO ${mysql.escapeId(tableName)} (${insertKeys}) 
               VALUES (${insertPlaceholders}) 
               ON DUPLICATE KEY UPDATE ${updateSets}`;

  const params = [...Object.values(data), ...Object.values(updateData)];
  return executeQuery(sql, params);
}

/**
 * Executa operacoes dentro de uma transacao.
 * @param {(connection: import('mysql2/promise').PoolConnection) => Promise<any>} callback
 * @returns {Promise<any>}
 */
async function withTransaction(callback) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (err) {
    await connection.rollback();
    logger.error('Transação revertida devido a um erro:', err);
    throw err;
  } finally {
    connection.release();
  }
}
