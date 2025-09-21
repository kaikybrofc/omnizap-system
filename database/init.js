
require('dotenv').config();
const mysql = require('mysql2/promise');

const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME } = process.env;

async function initializeDatabase() {
  let connection;
  try {
    // Conecta ao servidor MySQL sem especificar um banco de dados ainda
    connection = await mysql.createConnection({
      host: DB_HOST,
      user: DB_USER,
      password: DB_PASSWORD,
    });

    console.log('Conectado ao servidor MySQL.');

    // Cria o banco de dados se ele não existir
    await connection.query(`CREATE DATABASE IF NOT EXISTS 
${DB_NAME}
;`);

    console.log(`Banco de dados '${DB_NAME}' verificado/criado com sucesso.`);

  } catch (error) {
    console.error('Erro ao inicializar o banco de dados:', error);
    process.exit(1); // Encerra o script com um código de erro
  } finally {
    if (connection) {
      await connection.end();
      console.log('Conexão com o MySQL encerrada.');
    }
  }
}

initializeDatabase();
