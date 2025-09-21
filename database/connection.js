require('dotenv').config();
const mysql = require('mysql2/promise');

// Validação das variáveis de ambiente necessárias
const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const missingEnvVars = requiredEnvVars.filter((varName) => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error('Erro: Variáveis de ambiente necessárias não encontradas:', missingEnvVars.join(', '));
  process.exit(1);
}

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

// Testa a conexão imediatamente
async function validateConnection() {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    console.log('Pool de conexões com o MySQL criado e testado com sucesso.');
  } catch (error) {
    console.error('Erro ao conectar ao MySQL:', error.message);
    process.exit(1);
  }
}

// Executa a validação
validateConnection();

module.exports = pool;
