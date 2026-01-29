import 'dotenv/config';

import logger from './app/utils/logger/loggerModule.js';
import { connectToWhatsApp, getActiveSocket } from './app/connection/socketController.js';
import { backfillLidMapFromMessagesOnce } from './app/services/lidMapService.js';
import { initializeNewsBroadcastService } from './app/services/newsBroadcastService.js';
import initializeDatabase from './database/init.js';
import { startMetricsServer } from './app/observability/metrics.js';

async function startApp() {
  try {
    logger.info('Iniciando OmniZap System...');

    logger.info('Verificando e inicializando o banco de dados...');
    await initializeDatabase();

    startMetricsServer();

    const shouldBackfill = process.env.LID_BACKFILL_ON_START !== 'false';
    if (shouldBackfill) {
      const batchSize = Number(process.env.LID_BACKFILL_BATCH) || undefined;
      backfillLidMapFromMessagesOnce({ batchSize }).catch((error) => {
        logger.warn('Backfill lid_map nao concluido.', { error: error.message });
      });
    }

    await connectToWhatsApp();
    logger.info('OmniZap System iniciado com sucesso.');
    initializeNewsBroadcastService();
    if (process.send) {
      process.send('ready');
    }
  } catch (err) {
    logger.error('Falha ao iniciar o OmniZap System:', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

startApp();

async function shutdown(signal) {
  logger.warn(`${signal} recebido. Iniciando desligamento gracioso...`);
  const sock = getActiveSocket();
  if (sock) {
    try {
      await sock.end();
      logger.info('Conexão do WhatsApp encerrada.');
    } catch (e) {
      logger.error('Erro ao encerrar a conexão do WhatsApp:', { error: e.message, stack: e.stack });
    }
  }
  logger.info('OmniZap System desligado.');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  logger.error('Exceção não capturada:', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Rejeição de promessa não tratada:', { reason: reason, promise: promise });
  process.exit(1);
});
