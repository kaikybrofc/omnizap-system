const pool = require('./connection');
const logger = require('../app/utils/logger/loggerModule');

/**
 * Função genérica para executar consultas SQL.
 * @param {string} sql A instrução SQL a ser executada.
 * @param {Array} params Um array de parâmetros para a consulta SQL, para evitar SQL Injection.
 * @returns {Promise<Array>} Retorna as linhas resultantes da consulta.
 */
async function executeQuery(sql, params = []) {
  try {
    const [results] = await pool.query(sql, params);
    return results;
  } catch (error) {
    logger.error('Erro na consulta SQL:', { 
      sql: sql, 
      params: params, 
      error: error.message 
    });
    // Lançar o erro permite que a função que chamou trate-o como preferir
    throw error; 
  }
}

// --- Funções de Exemplo (Adapte para suas tabelas) ---

/**
 * Exemplo: Busca um registro em uma tabela pelo ID.
 * @param {string} tableName O nome da tabela.
 * @param {number} id O ID do registro a ser buscado.
 */
async function findById(tableName, id) {
  // A sintaxe ?? é para identificar nomes de tabelas/colunas de forma segura
  const sql = `SELECT * FROM ?? WHERE id = ?`;
  const results = await executeQuery(sql, [tableName, id]);
  return results[0] || null; // Retorna o primeiro resultado ou null se não encontrar
}

/**
 * Exemplo: Cria um novo registro em uma tabela.
 * @param {string} tableName O nome da tabela.
 * @param {object} data Um objeto onde as chaves são os nomes das colunas e os valores são os dados a serem inseridos.
 */
async function create(tableName, data) {
  // A sintaxe `SET ?` é um atalho para inserir um objeto, onde as chaves do objeto são mapeadas para os nomes das colunas.
  const sql = `INSERT INTO ?? SET ?`;
  // Os parâmetros devem ser um array: [nomeDaTabela, objetoDeDados]
  const result = await executeQuery(sql, [tableName, data]);
  return { id: result.insertId, ...data };
}

/**
 * Exemplo: Atualiza um registro em uma tabela pelo ID.
 * @param {string} tableName O nome da tabela.
 * @param {number} id O ID do registro a ser atualizado.
 * @param {object} data Um objeto com as colunas e os novos valores.
 */
async function update(tableName, id, data) {
  const fields = Object.keys(data).map(key => `${key} = ?`).join(', '); // Gera field1 = ?, field2 = ?
  const values = [...Object.values(data), id];

  const sql = `UPDATE ?? SET ${fields} WHERE id = ?`;
  const result = await executeQuery(sql, [tableName, ...values]);
  return result.affectedRows > 0;
}

/**
 * Exemplo: Deleta um registro de uma tabela pelo ID.
 * @param {string} tableName O nome da tabela.
 * @param {number} id O ID do registro a ser deletado.
 */
async function remove(tableName, id) {
  const sql = `DELETE FROM ?? WHERE id = ?`;
  const result = await executeQuery(sql, [tableName, id]);
  return result.affectedRows > 0;
}


module.exports = {
  executeQuery,
  findById,
  create,
  update,
  remove
};
