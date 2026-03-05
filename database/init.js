import mysql from 'mysql2/promise';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import logger from '../app/utils/logger/loggerModule.js';
import { dbConfig } from './index.js';

const dbToCreate = dbConfig.database;

const createDatabaseSQL = `
  CREATE DATABASE IF NOT EXISTS \`${dbToCreate}\`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;
`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCHEMA_SQL_PATH = path.join(__dirname, 'schema.sql');

/**
 * Divide um arquivo SQL em statements individuais.
 * Suporta aspas simples e duplas para não quebrar strings.
 *
 * @param {string} sql
 * @returns {string[]}
 */
function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (const char of sql) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      current += char;
      escaped = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }

    if (char === ';' && !inSingleQuote && !inDoubleQuote) {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = '';
      continue;
    }

    current += char;
  }

  const trailing = current.trim();
  if (trailing) statements.push(trailing);

  return statements;
}

/**
 * Executa o schema consolidado para garantir que todas as tabelas existam.
 *
 * @param {import('mysql2/promise').Connection} connection
 * @returns {Promise<number>} Quantidade de statements executados.
 */
async function runSchemaBootstrap(connection) {
  let sqlContent = '';
  try {
    sqlContent = await fs.readFile(SCHEMA_SQL_PATH, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      const wrapped = new Error(`Arquivo de schema não encontrado em ${SCHEMA_SQL_PATH}.`);
      wrapped.code = 'SCHEMA_SQL_NOT_FOUND';
      throw wrapped;
    }
    throw error;
  }

  const statements = splitSqlStatements(sqlContent);
  if (statements.length === 0) {
    logger.warn('Arquivo schema.sql está vazio. Nenhuma tabela será criada.');
    return 0;
  }

  for (const statement of statements) {
    await connection.query(statement);
  }

  return statements.length;
}

/**
 * Inicializa o banco de dados:
 * 1) Conecta ao MySQL sem database
 * 2) Cria o banco se não existir
 * 3) Muda para o database correto
 * 4) Executa o schema consolidado (sem migrations)
 * 5) Encerra a conexão
 *
 * @returns {Promise<void>}
 */
export default async function initializeDatabase() {
  let connection;

  try {
    connection = await mysql.createConnection({
      host: dbConfig.host,
      user: dbConfig.user,
      password: dbConfig.password,
    });

    await connection.query(createDatabaseSQL);
    logger.info(`Banco de dados '${dbToCreate}' verificado/criado com sucesso.`);

    await connection.changeUser({ database: dbToCreate });

    const executedStatements = await runSchemaBootstrap(connection);

    logger.info('Schema consolidado verificado/aplicado com sucesso (sem migrations).', {
      executedStatements,
    });
  } catch (error) {
    logger.error(`Erro ao inicializar o banco: ${error.code || ''} ${error.message}`);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      logger.info('Conexão com o MySQL encerrada após inicialização.');
    }
  }
}

if (process.argv[1] === __filename) {
  initializeDatabase();
}
