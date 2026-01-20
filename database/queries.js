import { pool } from './connection.js';
import mysql from 'mysql2/promise';
import logger from '../app/utils/logger/loggerModule.js';
import { TABLES } from './config.js';
import { DatabaseError } from './errors.js';

const VALID_TABLES = Object.values(TABLES);

/**
 * Valida se o nome da tabela está na lista de tabelas permitidas.
 * @param {string} tableName - Nome da tabela a ser validada.
 * @throws {Error} Se a tabela não estiver na lista de tabelas válidas.
 */
export function validateTableName(tableName) {
  if (!VALID_TABLES.includes(tableName)) {
    throw new Error(`Tabela inválida: ${tableName}`);
  }
}

/**
 * Sanitiza os parâmetros da consulta SQL, convertendo undefined para null.
 * @param {Array<any>} params - Array de parâmetros a serem sanitizados.
 * @returns {Array<any>} Array de parâmetros sanitizados.
 */
export function sanitizeParams(params) {
  return params.map((param) => (param === undefined ? null : param));
}

/**
 * Executa uma consulta SQL com parâmetros sanitizados.
 * @param {string} sql - Consulta SQL a ser executada.
 * @param {Array<any>} [params=[]] - Parâmetros da consulta.
 * @param {object} [connection=null] - Conexão opcional do banco de dados.
 * @returns {Promise<Array>} Resultado da consulta.
 * @throws {DatabaseError} Se houver erro na execução da consulta.
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
 * Busca todos os registros de uma tabela com suporte a paginação.
 * @param {string} tableName - Nome da tabela.
 * @param {number} [limit=100] - Limite de registros por página.
 * @param {number} [offset=0] - Número de registros para pular.
 * @returns {Promise<Array>} Lista de registros encontrados.
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
 * Busca um registro específico em uma tabela pelo seu ID.
 * @param {string} tableName - Nome da tabela.
 * @param {number|string} id - ID do registro.
 * @returns {Promise<object|null>} Registro encontrado ou null se não existir.
 */
export async function findById(tableName, id) {
  validateTableName(tableName);
  const sql = `SELECT * FROM ${mysql.escapeId(tableName)} WHERE id = ?`;
  const results = await executeQuery(sql, [id]);
  return results[0] || null;
}

/**
 * Busca registros com base em um conjunto de condições.
 * @param {string} tableName - Nome da tabela.
 * @param {object} criteria - Objeto com os critérios de busca (ex: { name: 'John', age: 30 }).
 * @param {object} [options] - Opções de consulta.
 * @param {number} [options.limit] - Limite de registros.
 * @param {number} [options.offset] - Deslocamento de registros.
 * @param {string} [options.orderBy] - Campo para ordenação.
 * @param {'ASC'|'DESC'} [options.orderDirection='ASC'] - Direção da ordenação.
 * @returns {Promise<Array>} Lista de registros encontrados.
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
 * Conta o número de registros em uma tabela, opcionalmente com um filtro.
 * @param {string} tableName - Nome da tabela.
 * @param {object} [criteria] - Critérios de contagem.
 * @returns {Promise<number>} O número de registros.
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
 * @param {string} tableName - Nome da tabela.
 * @param {object} data - Dados a serem inseridos.
 * @returns {Promise<object>} Objeto criado com o ID gerado.
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
 * Insere múltiplos registros de uma vez em uma tabela.
 * @param {string} tableName - Nome da tabela.
 * @param {Array<object>} records - Array de objetos a serem inseridos.
 * @returns {Promise<number>} Número de registros inseridos.
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
 * Atualiza um registro existente em uma tabela pelo seu ID.
 * @param {string} tableName - Nome da tabela.
 * @param {number|string} id - ID do registro a ser atualizado.
 * @param {object} data - Dados a serem atualizados.
 * @returns {Promise<boolean>} true se o registro foi atualizado, false caso contrário.
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
 * Remove um registro de uma tabela pelo seu ID.
 * @param {string} tableName - Nome da tabela.
 * @param {number|string} id - ID do registro a ser removido.
 * @returns {Promise<boolean>} true se o registro foi removido, false caso contrário.
 */
export async function remove(tableName, id) {
  validateTableName(tableName);
  const sql = `DELETE FROM ${mysql.escapeId(tableName)} WHERE id = ?`;
  const result = await executeQuery(sql, [id]);
  return result.affectedRows > 0;
}

/**
 * Insere um novo registro ou atualiza se já existir (upsert).
 * @param {string} tableName - Nome da tabela.
 * @param {object} data - Dados a serem inseridos ou atualizados. O ID deve estar em `data.id`.
 * @returns {Promise<object>} Resultado da operação.
 */
export async function upsert(tableName, data) {
  validateTableName(tableName);
  const keys = Object.keys(data);
  if (keys.length === 0) {
    throw new Error('Não é possível fazer upsert com dados vazios.');
  }

  const updateData = { ...data };
  // O ID não deve ser atualizado no ON DUPLICATE KEY UPDATE
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
 * Executa operações dentro de uma transação SQL.
 * @param {Function} callback - Função de callback que recebe a conexão e executa as operações.
 * @returns {Promise<any>} Resultado do callback.
 * @throws {Error} Se houver erro durante a transação, realiza rollback automático.
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
    throw err; // Re-lança o erro original após o rollback
  } finally {
    connection.release();
  }
}
