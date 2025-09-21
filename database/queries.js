const { pool } = require('./connection');
const mysql = require('mysql2/promise');
const logger = require('../app/utils/logger/loggerModule');

const VALID_TABLES = ['chats', 'groups_metadata', 'messages'];

/**
 * Valida se o nome da tabela é permitido
 * @throws {Error} Se a tabela não for válida
 */
function validateTableName(tableName) {
  if (!VALID_TABLES.includes(tableName)) {
    const error = new Error(`Tabela inválida: ${tableName}`);
    logger.error('Erro de validação de tabela:', {
      tableName: tableName,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Converte undefined para null nos parâmetros SQL
 */
function sanitizeParams(params) {
  return params.map((param) => (param === undefined ? null : param));
}

/**
 * Função genérica para executar consultas SQL.
 */
async function executeQuery(sql, params = []) {
  try {
    const sanitizedParams = sanitizeParams(params);
    logger.debug('Executando SQL:', { sql: sql, params: sanitizedParams });
    const [results] = await pool.execute(sql, sanitizedParams);
    return results;
  } catch (error) {
    logger.error('Erro na consulta SQL:', {
      sql: sql,
      params: params,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Busca todos os registros de uma tabela.
 */
async function findAll(tableName) {
  validateTableName(tableName);
  const sql = `SELECT * FROM ${mysql.escapeId(tableName)}`;
  return await executeQuery(sql, []);
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
 * Insere um registro se não existir, ou o atualiza se já existir (baseado na PRIMARY KEY).
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

module.exports = {
  executeQuery,
  findAll,
  findById,
  create,
  update,
  remove,
  upsert,
};
