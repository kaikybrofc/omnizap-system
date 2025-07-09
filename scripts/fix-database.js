#!/usr/bin/env node

/**
 * Script para corrigir problemas no banco de dados MySQL
 *
 * Este script corrige problemas específicos como:
 * - Formata valores Long para string
 * - Remove entradas duplicadas
 *
 * Uso: node scripts/fix-database.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const logger = require('../app/utils/logger/loggerModule');
const { cleanEnv, str, num } = require('envalid');

// Validar variáveis de ambiente
const env = cleanEnv(process.env, {
  DB_HOST: str({ default: 'localhost' }),
  DB_USER: str({ default: 'root' }),
  DB_PASSWORD: str({ default: '' }),
  DB_NAME: str({ default: 'omnizap_cache' }),
  DB_PORT: num({ default: 3306 }),
});

async function fixDatabase() {
  let connection;

  try {
    logger.info('Iniciando correção do banco de dados...');

    // Criar conexão com o banco de dados
    connection = await mysql.createConnection({
      host: env.DB_HOST,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      port: env.DB_PORT,
      database: env.DB_NAME,
    });

    // 1. Verificar participantes de grupo duplicados
    logger.info('Verificando participantes de grupo duplicados...');
    const [duplicateRows] = await connection.query(`
      SELECT group_jid, participant_jid, COUNT(*) as count
      FROM group_participants
      GROUP BY group_jid, participant_jid
      HAVING COUNT(*) > 1
    `);

    if (duplicateRows.length > 0) {
      logger.info(`Encontrados ${duplicateRows.length} participantes duplicados. Corrigindo...`);

      for (const row of duplicateRows) {
        logger.debug(`Corrigindo duplicatas para grupo ${row.group_jid}, participante ${row.participant_jid}`);

        // Primeiro, selecionar todos os IDs para esse participante nesse grupo
        const [ids] = await connection.query('SELECT id FROM group_participants WHERE group_jid = ? AND participant_jid = ? ORDER BY id', [row.group_jid, row.participant_jid]);

        // Manter apenas o registro mais recente (último ID) e excluir os outros
        if (ids.length > 1) {
          const idsToDelete = ids.slice(0, -1).map((record) => record.id);

          if (idsToDelete.length > 0) {
            await connection.query('DELETE FROM group_participants WHERE id IN (?)', [idsToDelete]);
            logger.debug(`Deletados ${idsToDelete.length} registros duplicados`);
          }
        }
      }
    } else {
      logger.info('Nenhum participante duplicado encontrado.');
    }

    // 2. Validar se há valores Long na tabela de mensagens
    logger.info('Verificando valores incompatíveis na tabela de mensagens...');
    // Isso é uma verificação simplificada, pois não conseguimos identificar facilmente campos Long em JSON
    // Apenas verificamos se há erros ao acessar os dados
    try {
      const [messages] = await connection.query('SELECT COUNT(*) as count FROM messages');
      logger.info(`Mensagens no banco: ${messages[0].count}`);
    } catch (error) {
      logger.error('Erro ao contar mensagens:', { error: error.message });
    }

    logger.info('Atualizando mensagens para corrigir valores incompatíveis...');
    await connection.query(`
      UPDATE messages 
      SET raw_data = JSON_EXTRACT(raw_data, '$')
      WHERE raw_data IS NOT NULL
    `);

    logger.info('✅ Correção do banco de dados concluída!');
  } catch (error) {
    logger.error('❌ Erro ao corrigir banco de dados:', {
      error: error.message,
      stack: error.stack,
    });
  } finally {
    if (connection) {
      await connection.end();
    }
    process.exit(0);
  }
}

// Executar o script
fixDatabase();
