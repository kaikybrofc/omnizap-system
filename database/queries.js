const pool = require('./connection');

/**
 * Função genérica para executar consultas SQL.
 * @param {string} sql A instrução SQL a ser executada.
 * @param {Array} params Um array de parâmetros para a consulta SQL, para evitar SQL Injection.
 * @returns {Promise<Array>} Retorna as linhas resultantes da consulta.
 */
async function executeQuery(sql, params = []) {
  try {
    const [results] = await pool.execute(sql, params);
    return results;
  } catch (error) {
    console.error('Erro na consulta SQL:', {
      sql: sql,
      params: params,
      error: error.message,
    });
    throw error;
  }
}

module.exports = {
  executeQuery,
};
