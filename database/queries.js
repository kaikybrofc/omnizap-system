const pool = require('./connection');
const logger = require('../app/utils/logger/loggerModule');

/**
 * Função genérica para executar consultas SQL.
 */
async function executeQuery(sql, params = []) {
  try {
    logger.debug('Executando SQL:', { sql: sql, params: params });
    const [results] = await pool.query(sql, params);
    return results;
  } catch (error) {
    logger.error('Erro na consulta SQL:', { 
      sql: sql, 
      params: params, 
      error: error.message 
    });
    throw error; 
  }
}

/**
 * Busca todos os registros de uma tabela.
 */
async function findAll(tableName) {
  const sql = `SELECT * FROM ??`;
  return await executeQuery(sql, [tableName]);
}

/**
 * Busca um registro em uma tabela pelo ID.
 */
async function findById(tableName, id) {
  const sql = `SELECT * FROM ?? WHERE id = ?`;
  const results = await executeQuery(sql, [tableName, id]);
  return results[0] || null;
}

/**
 * Cria um novo registro em uma tabela.
 */
async function create(tableName, data) {
  const sql = `INSERT INTO ?? SET ?`;
  const result = await executeQuery(sql, [tableName, data]);
  return { id: result.insertId, ...data };
}

/**
 * Atualiza um registro em uma tabela pelo ID.
 */
async function update(tableName, id, data) {
  const sql = `UPDATE ?? SET ? WHERE id = ?`;
  const result = await executeQuery(sql, [tableName, data, id]);
  return result.affectedRows > 0;
}

/**
 * Deleta um registro de uma tabela pelo ID.
 */
async function remove(tableName, id) {
  const sql = `DELETE FROM ?? WHERE id = ?`;
  const result = await executeQuery(sql, [tableName, id]);
  return result.affectedRows > 0;
}

/**
 * Insere um registro se não existir, ou o atualiza se já existir (baseado na PRIMARY KEY).
 */
async function upsert(tableName, data) {
  // A cláusula ON DUPLICATE KEY UPDATE precisa de um objeto para a parte de UPDATE.
  // Criamos uma cópia dos dados para garantir que não modificamos o objeto original.
  const updateData = { ...data };
  // É uma boa prática remover a chave primária da cláusula UPDATE, pois ela não deve ser alterada.
  delete updateData.id;

  const sql = `INSERT INTO ?? SET ? ON DUPLICATE KEY UPDATE ?`;
  const params = [tableName, data, updateData];
  
  return await executeQuery(sql, params);
}


module.exports = {
  executeQuery,
  findAll,
  findById,
  create,
  update,
  remove,
  upsert
};