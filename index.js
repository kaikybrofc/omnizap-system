/**
 * Entry-point (bootstrap) do OmniZap System.
 *
 * Responsabilidades principais:
 * - Inicializar o banco (garantindo DB e tabelas).
 * - Subir servidor de métricas.
 * - Rodar backfill do lid_map (opcional, em background).
 * - Conectar ao WhatsApp (Baileys).
 * - Iniciar serviços auxiliares (ex: broadcast de notícias).
 * - Registrar handlers de shutdown gracioso (SIGINT/SIGTERM) e falhas fatais
 *   (uncaughtException/unhandledRejection).
 *
 * Observações:
 * - Este arquivo foi desenhado para ser "production-safe": tem timeouts, shutdown idempotente,
 *   e evita process.exit() imediato para não cortar logs/flush e não interromper fechamentos.
 */

import 'dotenv/config';

import logger from './app/utils/logger/loggerModule.js';
import { connectToWhatsApp, getActiveSocket } from './app/connection/socketController.js';
import { backfillLidMapFromMessagesOnce } from './app/services/lidMapService.js';
import {
  initializeNewsBroadcastService,
  stopNewsBroadcastService,
} from './app/services/newsBroadcastService.js';
import initializeDatabase from './database/init.js';
import { startMetricsServer, stopMetricsServer } from './app/observability/metrics.js';
import {
  startStickerClassificationBackground,
  stopStickerClassificationBackground,
} from './app/modules/stickerPackModule/stickerClassificationBackgroundRuntime.js';

/**
 * Timeout máximo para inicialização do banco (criar/verificar DB + tabelas).
 * Evita travar o processo em caso de MySQL indisponível ou DNS lento.
 * @type {number}
 */
const DB_INIT_TIMEOUT_MS = 15000;

/**
 * Timeout máximo para conexão inicial do WhatsApp.
 * Dependendo da rede/servidor, a conexão pode demorar, então é maior.
 * @type {number}
 */
const WHATSAPP_CONNECT_TIMEOUT_MS = 60000;

/**
 * Tempo máximo que o shutdown deve aguardar o backfill finalizar.
 * Como backfill é "best-effort", não devemos segurar o shutdown por muito tempo.
 * @type {number}
 */
const BACKFILL_SHUTDOWN_TIMEOUT_MS = 8000;

/**
 * Flag para impedir múltiplos shutdowns concorrentes.
 * @type {boolean}
 */
let isShuttingDown = false;

/**
 * Promise do shutdown em andamento (para idempotência).
 * Se o shutdown for chamado novamente, devolvemos essa mesma promise.
 * @type {Promise<void>|null}
 */
let shutdownPromise = null;

/**
 * Promise do backfill (quando habilitado).
 * Guardamos para poder aguardar com timeout durante o shutdown.
 * @type {Promise<any>|null}
 */
let backfillPromise = null;

/**
 * Executa uma Promise com um timeout.
 *
 * Útil para passos críticos que podem travar:
 * - init do banco
 * - conectar WhatsApp
 * - fechar recursos no shutdown
 *
 * @template T
 * @param {Promise<T>|T} promise - Promise (ou valor) a ser resolvido.
 * @param {number} ms - Tempo máximo em milissegundos.
 * @param {string} label - Nome curto do passo para mensagens de erro.
 * @returns {Promise<T>} Resolve com o valor da Promise, ou rejeita com erro ETIMEOUT.
 */
const withTimeout = (promise, ms, label) => {
  /** @type {NodeJS.Timeout|undefined} */
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`${label} excedeu ${ms}ms`);
      // Ajuda a filtrar em logs/telemetria
      // @ts-ignore - code é campo comum, mas não está no tipo padrão de Error
      error.code = 'ETIMEOUT';
      reject(error);
    }, ms);
  });

  return Promise.race([Promise.resolve(promise), timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
};

/**
 * Log helper para erros durante o shutdown, mantendo output consistente.
 *
 * @param {string} context - Texto curto do contexto (ex: "Detalhes do desligamento.").
 * @param {unknown} error - Erro (ou reason) para log.
 * @returns {void}
 */
const logShutdownError = (context, error) => {
  if (!error) return;

  if (error instanceof Error) {
    logger.error(context, { error: error.message, stack: error.stack });
    return;
  }

  logger.error(context, { reason: error });
};

/**
 * Encerra o pool de conexões do MySQL (se existir).
 *
 * Por que o import dinâmico?
 * - Evita problemas de "import cycle" em cenários onde o DB module importa coisas
 *   que acabam importando este entrypoint (ou dependências).
 * - Só carrega o módulo no momento do shutdown.
 *
 * @returns {Promise<void>}
 */
async function closeDatabasePool() {
  try {
    const dbModule = await import('./database/index.js');
    if (typeof dbModule.closePool !== 'function') {
      // O módulo não expõe closePool, então não há o que encerrar aqui.
      return;
    }

    logger.info('Encerrando pool MySQL...');
    await withTimeout(dbModule.closePool(), 8000, 'closePool');
    logger.info('Pool MySQL encerrado.');
  } catch (error) {
    logger.warn('Falha ao encerrar pool MySQL.', { error: error?.message });
  }
}

/**
 * Inicializa o sistema e seus serviços principais.
 *
 * Fluxo de startup:
 * 1) Inicializa DB (cria/verifica DB/tabelas)
 * 2) Sobe servidor de métricas
 * 3) Inicia backfill (opcional) em background
 * 4) Conecta no WhatsApp
 * 5) Inicia serviços auxiliares (news broadcast)
 * 6) Sinaliza readiness (se estiver rodando sob PM2/cluster com IPC)
 *
 * Em caso de falha: seta exitCode e aciona shutdown gracioso.
 *
 * @returns {Promise<void>}
 */
async function startApp() {
  try {
    logger.info('Iniciando OmniZap System...');

    logger.info('Iniciando banco de dados...');
    await withTimeout(initializeDatabase(), DB_INIT_TIMEOUT_MS, 'Inicializacao do banco');
    logger.info('Banco de dados pronto.');

    logger.info('Inicializando servidor de metricas...');
    startMetricsServer();
    startStickerClassificationBackground();

    // Backfill é opcional, rodando em background.
    const shouldBackfill = process.env.LID_BACKFILL_ON_START !== 'false';
    if (shouldBackfill) {
      const batchSize = Number(process.env.LID_BACKFILL_BATCH) || undefined;

      logger.info('Iniciando backfill lid_map...');
      backfillPromise = backfillLidMapFromMessagesOnce({ batchSize })
        .then((result) => {
          logger.info('Backfill lid_map concluido.', { batches: result?.batches });
          return result;
        })
        .catch((error) => {
          logger.warn('Backfill lid_map nao concluido.', { error: error.message });
          return null;
        });
    }

    logger.info('Conectando ao WhatsApp...');
    await withTimeout(connectToWhatsApp(), WHATSAPP_CONNECT_TIMEOUT_MS, 'Conexao WhatsApp');
    logger.info('WhatsApp conectado.');

    logger.info('Inicializando servico de noticias...');
    await initializeNewsBroadcastService();
    logger.info('Servico de noticias pronto.');

    logger.info('OmniZap System iniciado com sucesso.');

    // Compatível com gerenciadores que esperam "ready" via IPC.
    if (process.send) {
      process.send('ready');
    }
  } catch (err) {
    logger.error('Falha ao iniciar o OmniZap System:', { error: err.message, stack: err.stack });
    process.exitCode = 1;
    await shutdown('STARTUP_ERROR', err);
  }
}

startApp();

/**
 * Realiza desligamento gracioso do sistema (idempotente).
 *
 * O que fecha:
 * - serviço de notícias (se stop existir)
 * - aguarda backfill (com timeout curto)
 * - encerra socket do WhatsApp
 * - encerra servidor de métricas
 * - encerra pool do MySQL
 *
 * Regras:
 * - Se já estiver desligando, retorna a mesma promise.
 * - Define process.exitCode se ainda não estiver definido.
 * - Não chama process.exit() diretamente (deixa o processo encerrar naturalmente).
 *
 * @param {string} signal - Origem do shutdown (SIGINT, SIGTERM, uncaughtException, etc).
 * @param {unknown} [error] - Erro associado (se houver).
 * @returns {Promise<void>}
 */
async function shutdown(signal, error) {
  if (isShuttingDown) {
    return shutdownPromise;
  }
  isShuttingDown = true;

  if (process.exitCode === undefined || process.exitCode === null) {
    process.exitCode = error ? 1 : 0;
  }

  logger.warn(`${signal} recebido. Iniciando desligamento gracioso...`);
  logShutdownError('Detalhes do desligamento.', error);

  shutdownPromise = (async () => {
    // 1) Serviços com timers/intervals (news broadcast)
    try {
      if (typeof stopNewsBroadcastService === 'function') {
        logger.info('Encerrando servico de noticias...');
        stopNewsBroadcastService();
        logger.info('Servico de noticias encerrado.');
      }
    } catch (stopError) {
      logger.warn('Falha ao encerrar servico de noticias.', { error: stopError.message });
    }

    // 2) Esperar backfill (best-effort) com timeout
    if (backfillPromise) {
      try {
        logger.info('Aguardando backfill lid_map...');
        await withTimeout(backfillPromise, BACKFILL_SHUTDOWN_TIMEOUT_MS, 'Backfill lid_map');
        logger.info('Backfill lid_map finalizado.');
      } catch (backfillError) {
        logger.warn('Backfill lid_map nao finalizou antes do shutdown.', {
          error: backfillError.message,
        });
      }
    }

    // 3) Encerrar conexão WhatsApp
    const sock = getActiveSocket();
    if (sock) {
      try {
        logger.info('Encerrando conexão do WhatsApp...');
        await withTimeout(sock.end(), 8000, 'Encerramento WhatsApp');
        logger.info('Conexao do WhatsApp encerrada.');
      } catch (sockError) {
        logger.error('Erro ao encerrar a conexão do WhatsApp:', {
          error: sockError.message,
          stack: sockError.stack,
        });
      }
    }

    // 4) Encerrar servidor de métricas
    if (typeof stopMetricsServer === 'function') {
      try {
        logger.info('Encerrando servidor de metricas...');
        await withTimeout(stopMetricsServer(), 8000, 'Encerramento metricas');
        logger.info('Servidor de metricas encerrado.');
      } catch (metricsError) {
        logger.warn('Falha ao encerrar servidor de metricas.', { error: metricsError.message });
      }
    }

    // 4.1) Encerrar worker de classificação de stickers
    try {
      stopStickerClassificationBackground();
    } catch (workerError) {
      logger.warn('Falha ao encerrar worker de classificação de stickers.', {
        error: workerError?.message,
      });
    }

    // 5) Encerrar MySQL pool
    await closeDatabasePool();

    logger.info('OmniZap System desligado.');
  })();

  return shutdownPromise;
}

/**
 * Handler para interrupção no terminal (Ctrl+C).
 * @returns {void}
 */
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

/**
 * Handler para encerramento solicitado pelo sistema (ex: container/PM2).
 * @returns {void}
 */
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

/**
 * Handler para exceções não capturadas (fatal).
 * - seta exitCode=1
 * - inicia shutdown gracioso para tentar fechar recursos antes de morrer
 *
 * @param {Error} err
 * @returns {void}
 */
process.on('uncaughtException', (err) => {
  logger.error('Exceção não capturada:', { error: err.message, stack: err.stack });
  process.exitCode = 1;
  void shutdown('uncaughtException', err);
});

/**
 * Handler para rejeições de promise sem catch (fatal).
 * - loga reason
 * - seta exitCode=1
 * - inicia shutdown gracioso
 *
 * Observação: o parâmetro `promise` é incluído apenas para debug, mas geralmente não é útil.
 *
 * @param {unknown} reason
 * @param {Promise<unknown>} promise
 * @returns {void}
 */
process.on('unhandledRejection', (reason, promise) => {
  if (reason instanceof Error) {
    logger.error('Rejeição de promessa não tratada:', { error: reason.message, stack: reason.stack });
  } else {
    logger.error('Rejeição de promessa não tratada:', { reason, promise });
  }
  process.exitCode = 1;
  void shutdown('unhandledRejection', reason);
});
