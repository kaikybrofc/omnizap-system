const { pool } = require('./connection');
const mysql = require('mysql2/promise');
const logger = require('../app/utils/logger/loggerModule');

const VALID_TABLES = ['chats', 'groups_metadata', 'messages'];

/**
 * Valida se o nome da tabela está na lista de tabelas permitidas
 * @param {string} tableName - Nome da tabela a ser validada
 * @throws {Error} Se a tabela não estiver na lista de tabelas válidas
 */
function validateTableName(tableName) {
  if (!VALID_TABLES.includes(tableName)) {
    const error = new Error(`Tabela inválida: ${tableName}`);
    logger.error('Erro de validação de tabela:', { tableName, error: error.message });
    throw error;
  }
}

/**
 * Sanitiza os parâmetros da consulta SQL, convertendo undefined para null
 * @param {Array<any>} params - Array de parâmetros a serem sanitizados
 * @returns {Array<any>} Array de parâmetros sanitizados
 */
function sanitizeParams(params) {
  return params.map((param) => (param === undefined ? null : param));
}

/**
 * Executa uma consulta SQL com parâmetros sanitizados
 * @param {string} sql - Consulta SQL a ser executada
 * @param {Array<any>} [params=[]] - Parâmetros da consulta
 * @param {object} [connection=null] - Conexão opcional do banco de dados
 * @returns {Promise<Array>} Resultado da consulta
 * @throws {Error} Se houver erro na execução da consulta
 */
async function executeQuery(sql, params = [], connection = null) {
  try {
    const sanitizedParams = sanitizeParams(params);

    // Log mais detalhado incluindo tipos dos parâmetros
    logger.debug('Executando SQL:', {
      sql,
      params: sanitizedParams,
      paramTypes: sanitizedParams.map((p) => typeof p),
    });

    const executor = connection || pool;
    const [results] = await executor.execute(sql, sanitizedParams);

    return results;
  } catch (error) {
    // Log mais detalhado do erro
    logger.error('Erro na consulta SQL:', {
      sql,
      params,
      errorCode: error.code,
      errorNumber: error.errno,
      sqlState: error.sqlState,
      message: error.message,
    });

    // Reempacota o erro com mais contexto
    const enhancedError = new Error(`Erro na execução da consulta SQL: ${error.message}`);
    enhancedError.originalError = error;
    enhancedError.sql = sql;
    enhancedError.params = params;
    throw enhancedError;
  }
}

/**
 * Busca todos os registros de uma tabela com suporte a paginação
 * @param {string} tableName - Nome da tabela
 * @param {number} [limit=100] - Limite de registros por página
 * @param {number} [offset=0] - Número de registros para pular
 * @returns {Promise<Array>} Lista de registros encontrados
 * @throws {Error} Se a tabela for inválida ou houver erro na consulta
 */
async function findAll(tableName, limit = 100, offset = 0) {
  validateTableName(tableName);
  // Converte limit e offset para números inteiros
  const safeLimit = parseInt(limit, 10);
  const safeOffset = parseInt(offset, 10);

  // Valida se os valores são números válidos
  if (isNaN(safeLimit) || isNaN(safeOffset)) {
    throw new Error('Limit e offset devem ser números válidos');
  }

  try {
    // Usando query diretamente com o pool para consultas com LIMIT/OFFSET
    const [results] = await pool.query(`SELECT * FROM ${mysql.escapeId(tableName)} LIMIT ? OFFSET ?`, [safeLimit, safeOffset]);
    return results;
  } catch (error) {
    logger.error('Erro ao buscar registros:', {
      tableName,
      limit: safeLimit,
      offset: safeOffset,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Busca um registro específico em uma tabela pelo seu ID
 * @param {string} tableName - Nome da tabela
 * @param {number|string} id - ID do registro
 * @returns {Promise<object|null>} Registro encontrado ou null se não existir
 * @throws {Error} Se a tabela for inválida ou houver erro na consulta
 */
async function findById(tableName, id) {
  validateTableName(tableName);
  const sql = `SELECT * FROM ${mysql.escapeId(tableName)} WHERE id = ?`;
  const results = await executeQuery(sql, [id]);
  return results[0] || null;
}

/**
 * Cria um novo registro em uma tabela
 * @param {string} tableName - Nome da tabela
 * @param {object} data - Dados a serem inseridos
 * @returns {Promise<object>} Objeto criado com o ID gerado
 * @throws {Error} Se a tabela for inválida ou houver erro na inserção
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
 * Insere múltiplos registros de uma vez em uma tabela
 * @param {string} tableName - Nome da tabela
 * @param {Array<object>} records - Array de objetos a serem inseridos
 * @returns {Promise<number>} Número de registros inseridos
 * @throws {Error} Se a tabela for inválida ou houver erro na inserção em lote
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
 * Atualiza um registro existente em uma tabela pelo seu ID
 * @param {string} tableName - Nome da tabela
 * @param {number|string} id - ID do registro a ser atualizado
 * @param {object} data - Dados a serem atualizados
 * @returns {Promise<boolean>} true se o registro foi atualizado, false caso contrário
 * @throws {Error} Se a tabela for inválida ou houver erro na atualização
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
 * Remove um registro de uma tabela pelo seu ID
 * @param {string} tableName - Nome da tabela
 * @param {number|string} id - ID do registro a ser removido
 * @returns {Promise<boolean>} true se o registro foi removido, false caso contrário
 * @throws {Error} Se a tabela for inválida ou houver erro na remoção
 */
async function remove(tableName, id) {
  validateTableName(tableName);
  const sql = `DELETE FROM ${mysql.escapeId(tableName)} WHERE id = ?`;
  const result = await executeQuery(sql, [id]);
  return result.affectedRows > 0;
}

/**
 * Insere um novo registro ou atualiza se já existir (upsert)
 * @param {string} tableName - Nome da tabela
 * @param {object} data - Dados a serem inseridos ou atualizados
 * @returns {Promise<object>} Resultado da operação
 * @throws {Error} Se a tabela for inválida ou houver erro na operação
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
 * Executa operações dentro de uma transação SQL
 * @param {Function} callback - Função de callback que recebe a conexão e executa as operações
 * @returns {Promise<any>} Resultado do callback
 * @throws {Error} Se houver erro durante a transação, realiza rollback automático
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
