const { pool } = require('./connection');
const mysql = require('mysql2/promise');
const logger = require('../app/utils/logger/loggerModule');

const VALID_TABLES = ['chats', 'groups_metadata', 'messages'];

function validateTableName(tableName) {
  if (!VALID_TABLES.includes(tableName)) {
    const error = new Error(`Tabela inválida: ${tableName}`);
    logger.error('Erro de validação de tabela:', { tableName, error: error.message });
    throw error;
  }
}

function sanitizeParams(params) {
  return params.map((param) => (param === undefined ? null : param));
}

async function executeQuery(sql, params = [], connection = null) {
  try {
    const sanitizedParams = sanitizeParams(params);
    logger.debug('Executando SQL:', { sql, params: sanitizedParams });

    const executor = connection || pool;
    const [results] = await executor.execute(sql, sanitizedParams);

    return results;
  } catch (error) {
    logger.error('Erro na consulta SQL:', { sql, params, error: error.message });
    throw error;
  }
}

/**
 * Busca todos os registros de uma tabela (com paginação).
 */
async function findAll(tableName, limit = 100, offset = 0) {
  validateTableName(tableName);
  const sql = `SELECT * FROM ${mysql.escapeId(tableName)} LIMIT ? OFFSET ?`;
  return await executeQuery(sql, [limit, offset]);
}

/**
 * Busca um registro em uma tabela pelo ID.
 */
async function findById(tableName, id) {
  validateTableName(tableName);
  const sql = `SELECT * FROM ${mysql.escapeId(tableName)} WHERE id = ?`;
  const results = await executeQuery(sql, [id]);
  return results[0] || null;
}

/**
 * Cria um novo registro em uma tabela.
 */
async function create(tableName, data) {
  validateTableName(tableName);
  const keys = Object.keys(data);
  const values = Object.values(data);
  const sql = `INSERT INTO ${mysql.escapeId(tableName)} (${keys.map((k) => mysql.escapeId(k)).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  const result = await executeQuery(sql, values);
  return { id: result.insertId, ...data };
}

/**
 * Bulk insert (múltiplos registros de uma vez).
 */
async function bulkInsert(tableName, records) {
  validateTableName(tableName);
  if (!records.length) return 0;

  const keys = Object.keys(records[0]);
  const values = records.map((r) => keys.map((k) => r[k]));
  const sql = `INSERT INTO ${mysql.escapeId(tableName)} (${keys.map((k) => mysql.escapeId(k)).join(', ')}) VALUES ?`;

  const [result] = await pool.query(sql, [values]);
  return result.affectedRows;
}

/**
 * Atualiza um registro em uma tabela pelo ID.
 */
async function update(tableName, id, data) {
  validateTableName(tableName);
  const sets = Object.entries(data)
    .map(([key]) => `${mysql.escapeId(key)} = ?`)
    .join(', ');
  const sql = `UPDATE ${mysql.escapeId(tableName)} SET ${sets} WHERE id = ?`;
  const result = await executeQuery(sql, [...Object.values(data), id]);
  return result.affectedRows > 0;
}

/**
 * Deleta um registro de uma tabela pelo ID.
 */
async function remove(tableName, id) {
  validateTableName(tableName);
  const sql = `DELETE FROM ${mysql.escapeId(tableName)} WHERE id = ?`;
  const result = await executeQuery(sql, [id]);
  return result.affectedRows > 0;
}

/**
 * Insere um registro se não existir, ou atualiza se já existir.
 */
async function upsert(tableName, data) {
  validateTableName(tableName);
  const updateData = { ...data };
  delete updateData.id;

  const keys = Object.keys(data);
  const values = Object.values(data);
  const updateSets = Object.entries(updateData)
    .map(([key]) => `${mysql.escapeId(key)} = ?`)
    .join(', ');

  const sql = `INSERT INTO ${mysql.escapeId(tableName)} (${keys.map((k) => mysql.escapeId(k)).join(', ')}) 
               VALUES (${keys.map(() => '?').join(', ')}) 
               ON DUPLICATE KEY UPDATE ${updateSets}`;

  const params = [...values, ...Object.values(updateData)];
  return await executeQuery(sql, params);
}

/**
 * Executa operações dentro de uma transação.
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
    throw err;
  } finally {
    connection.release();
  }
}

module.exports = {
  executeQuery,
  findAll,
  findById,
  create,
  bulkInsert,
  update,
  remove,
  upsert,
  withTransaction,
};
