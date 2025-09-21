require('dotenv').config();
const mysql = require('mysql2/promise');

const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
const pool = mysql.createPool({
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true, // Espera por uma conexão disponível se todas estiverem em uso
  connectionLimit: 10, // Número máximo de conexões no pool
  queueLimit: 0, // Fila de espera ilimitada
});

console.log('Pool de conexões com o MySQL criado com sucesso.');

module.exports = pool;
