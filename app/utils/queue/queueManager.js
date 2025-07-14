/**
 * OmniZap Queue Manager - Processamento com BullMQ v5.56.4
 *
 * Módulo responsável pelo gerenciamento de filas de processamento
 * usando BullMQ com Redis para persistência e processamento assíncrono
 *
 * Implementa as melhores práticas do BullMQ para alta performance,
 * confiabilidade e observabilidade
 *
 * @version 2.0.0
 * @author OmniZap Team
 * @license MIT
 */

const { Queue, Worker, QueueEvents } = require('bullmq');
const IORedis = require('ioredis');
const logger = require('../logger/loggerModule');
const queueConfig = require('./queueConfig');

/**
 * Cria uma conexão Redis otimizada para BullMQ
 */
const createRedisConnection = () => {
  return new IORedis({
    host: queueConfig.REDIS.HOST,
    port: queueConfig.REDIS.PORT,
    password: queueConfig.REDIS.PASSWORD,
    db: queueConfig.REDIS.DB,
    maxRetriesPerRequest: null, // Importante para BullMQ
    retryDelayOnFailover: queueConfig.REDIS.RETRY_DELAY_ON_FAILOVER || 100,
    enableReadyCheck: queueConfig.REDIS.ENABLE_READY_CHECK || true,
    lazyConnect: false, // Conectar imediatamente para evitar problemas
    connectTimeout: queueConfig.REDIS.CONNECT_TIMEOUT || 10000, // Reduzir para 10 segundos
    keepAlive: queueConfig.REDIS.KEEP_ALIVE || 30000,
    family: queueConfig.REDIS.FAMILY || 4,
    enableOfflineQueue: queueConfig.REDIS.ENABLE_OFFLINE_QUEUE || true,
    autoResubscribe: queueConfig.REDIS.AUTO_RESUBSCRIBE || true,
    autoResendUnfulfilledCommands: queueConfig.REDIS.AUTO_RESEND_UNFULFILLED_COMMANDS || true,
    commandTimeout: queueConfig.REDIS.COMMAND_TIMEOUT || 10000, // Reduzir timeout de comando
    // Configurações de reconexão
    reconnectOnError: (err) => {
      const targetError = 'READONLY';
      return err.message.includes(targetError);
    },
    // Configurações de retry
    retryDelayOnClusterDown: 300,
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: null, // Garantir que está null
  });
};

/**
 * Classe principal do gerenciador de filas com BullMQ v5.56.4
 */
class QueueManager {
  constructor() {
    this.initialized = false;
    this.connection = null;
    this.queues = new Map();
    this.workers = new Map();
    this.queueEvents = new Map();

    // Estatísticas avançadas
    this.stats = {
      totalJobsAdded: 0,
      totalJobsCompleted: 0,
      totalJobsFailed: 0,
      totalJobsDelayed: 0,
      totalJobsActive: 0,
      totalJobsWaiting: 0,
      startTime: Date.now(),
      lastHealthCheck: null,
      connectionStatus: 'disconnected',
      workerStatus: new Map(),
    };

    this.eventHandler = null;
    this.healthCheckInterval = null;
    this.metricsInterval = null;

    // Circuit breaker para proteção
    this.circuitBreaker = {
      failures: 0,
      lastFailure: null,
      isOpen: false,
      threshold: 10,
      timeout: 60000, // 1 minuto
    };
  }

  /**
   * Inicializa o gerenciador de filas com configurações otimizadas
   */
  async init() {
    try {
      logger.info('🚀 QueueManager: Inicializando sistema de filas BullMQ v5.56.4...');

      // Verificar se o sistema de filas está habilitado
      if (!queueConfig.QUEUE_ENABLED) {
        logger.warn('⚠️ QueueManager: Sistema de filas desabilitado via configuração');
        return false;
      }

      // Criar conexão Redis otimizada
      await this.createRedisConnection();

      // Inicializar filas com configurações específicas
      await this.initializeQueues();

      // Inicializar workers com processadores otimizados
      await this.initializeWorkers();

      // Inicializar eventos de fila para monitoramento
      await this.initializeQueueEvents();

      // Configurar monitoramento e health checks
      this.setupMonitoring();

      this.initialized = true;
      this.stats.connectionStatus = 'connected';

      logger.info('✅ QueueManager: Sistema de filas inicializado com sucesso');
      await this.logSystemStatus();

      return true;
    } catch (error) {
      logger.error('❌ QueueManager: Erro ao inicializar sistema de filas:', {
        error: error.message,
        stack: error.stack,
      });

      this.handleCircuitBreaker();
      throw error;
    }
  }

  /**
   * Cria conexão Redis otimizada para BullMQ
   */
  async createRedisConnection() {
    try {
      logger.info('🔗 QueueManager: Criando conexão Redis...');
      
      this.connection = createRedisConnection();

      // Event listeners para monitoramento da conexão
      this.connection.on('connect', () => {
        logger.info('🔗 QueueManager: Conectado ao Redis');
        this.stats.connectionStatus = 'connected';
        this.resetCircuitBreaker();
      });

      this.connection.on('ready', () => {
        logger.info('✅ QueueManager: Redis pronto para uso');
        this.stats.connectionStatus = 'ready';
      });

      this.connection.on('error', (error) => {
        logger.error('❌ QueueManager: Erro na conexão Redis:', {
          message: error.message,
          code: error.code,
          errno: error.errno
        });
        this.stats.connectionStatus = 'error';
        // Não chamar handleCircuitBreaker para todos os erros, apenas para falhas críticas
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
          this.handleCircuitBreaker();
        }
      });

      this.connection.on('close', () => {
        logger.warn('⚠️ QueueManager: Conexão Redis fechada');
        this.stats.connectionStatus = 'closed';
      });

      this.connection.on('reconnecting', (delay) => {
        logger.info(`🔄 QueueManager: Reconectando ao Redis em ${delay}ms...`);
        this.stats.connectionStatus = 'reconnecting';
      });

      this.connection.on('end', () => {
        logger.warn('🔚 QueueManager: Conexão Redis finalizada');
        this.stats.connectionStatus = 'ended';
      });

      // Aguardar conexão com timeout e melhor tratamento de erro
      const connectionPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          logger.error('❌ QueueManager: Timeout na conexão Redis');
          reject(new Error('Timeout ao conectar com Redis após 10 segundos'));
        }, 10000);

        const onReady = () => {
          clearTimeout(timeout);
          this.connection.removeListener('error', onError);
          logger.debug('✅ QueueManager: Evento "ready" recebido do Redis');
          resolve();
        };

        const onError = (error) => {
          clearTimeout(timeout);
          this.connection.removeListener('ready', onReady);
          logger.error('❌ QueueManager: Erro durante conexão:', error.message);
          reject(error);
        };

        this.connection.once('ready', onReady);
        this.connection.once('error', onError);
      });

      await connectionPromise;

      // Testar conexão com ping
      logger.debug('🏓 QueueManager: Testando conexão com ping...');
      const pong = await this.connection.ping();
      logger.debug(`✅ QueueManager: Ping bem-sucedido: ${pong}`);
      
      // Testar seleção do database
      await this.connection.select(queueConfig.REDIS.DB);
      logger.debug(`✅ QueueManager: Database ${queueConfig.REDIS.DB} selecionado`);
      
    } catch (error) {
      logger.error('❌ QueueManager: Falha ao criar conexão Redis:', {
        error: error.message,
        code: error.code,
        stack: error.stack,
        redisConfig: {
          host: queueConfig.REDIS.HOST,
          port: queueConfig.REDIS.PORT,
          db: queueConfig.REDIS.DB,
          hasPassword: !!queueConfig.REDIS.PASSWORD
        }
      });
      
      // Limpar conexão em caso de erro
      if (this.connection) {
        try {
          await this.connection.disconnect();
        } catch (disconnectError) {
          logger.warn('⚠️ QueueManager: Erro ao desconectar Redis:', disconnectError.message);
        }
        this.connection = null;
      }
      
      throw new Error(`Conexão Redis falhou: ${error.message}`);
    }
  }

  /**
   * Inicializa todas as filas com configurações otimizadas
   */
  async initializeQueues() {
    try {
      logger.info('🎯 QueueManager: Inicializando filas...');

      for (const [queueType, config] of Object.entries(queueConfig.QUEUES)) {
        const queue = new Queue(config.name, {
          connection: this.connection,
          defaultJobOptions: {
            removeOnComplete: config.removeOnComplete,
            removeOnFail: config.removeOnFail,
            attempts: queueConfig.JOB_OPTIONS[queueType]?.attempts || queueConfig.JOB_OPTIONS.DEFAULT_ATTEMPTS,
            backoff: queueConfig.JOB_OPTIONS[queueType]?.backoff || {
              type: queueConfig.JOB_OPTIONS.BACKOFF_TYPE,
              delay: queueConfig.JOB_OPTIONS.BACKOFF_DELAY,
            },
            delay: config.delay || 0,
          },
        });

        this.queues.set(queueType, queue);
        logger.debug(`📋 QueueManager: Fila ${config.name} inicializada`);
      }

      logger.info(`✅ QueueManager: ${this.queues.size} filas inicializadas`);
    } catch (error) {
      logger.error('❌ QueueManager: Erro ao inicializar filas:', error.message);
      throw error;
    }
  }

  /**
   * Inicializa workers com processadores específicos
   */
  async initializeWorkers() {
    try {
      logger.info('👷 QueueManager: Inicializando workers...');

      // Worker para salvamento de dados
      await this.createWorker('DATA_SAVE', this.processDataSaveJob.bind(this));

      // Worker para processamento de mensagens
      await this.createWorker('MESSAGE_PROCESS', this.processMessageJob.bind(this));

      // Worker para metadados de grupos
      await this.createWorker('GROUP_METADATA', this.processGroupMetadataJob.bind(this));

      // Worker para processamento de eventos
      await this.createWorker('EVENT_PROCESS', this.processEventJob.bind(this));

      // Worker para limpeza
      await this.createWorker('CLEANUP', this.processCleanupJob.bind(this));

      logger.info(`✅ QueueManager: ${this.workers.size} workers inicializados`);
    } catch (error) {
      logger.error('❌ QueueManager: Erro ao inicializar workers:', error.message);
      throw error;
    }
  }

  /**
   * Cria um worker específico com configurações otimizadas
   */
  async createWorker(queueType, processor) {
    const config = queueConfig.QUEUES[queueType];
    if (!config) {
      throw new Error(`Configuração não encontrada para fila: ${queueType}`);
    }

    const worker = new Worker(config.name, processor, {
      connection: this.connection,
      concurrency: config.concurrency,
      limiter: config.rateLimiter
        ? {
            max: config.rateLimiter.max,
            duration: config.rateLimiter.duration,
          }
        : undefined,
      settings: {
        stalledInterval: queueConfig.PERFORMANCE.STALLED_INTERVAL,
        maxStalledCount: queueConfig.PERFORMANCE.MAX_STALLED_COUNT,
      },
    });

    // Event listeners para monitoramento
    worker.on('completed', (job) => {
      this.stats.totalJobsCompleted++;
      this.stats.workerStatus.set(`${queueType}_completed`, Date.now());
      logger.debug(`✅ QueueManager: Job ${job.id} concluído na fila ${queueType}`);
    });

    worker.on('failed', (job, err) => {
      this.stats.totalJobsFailed++;
      this.stats.workerStatus.set(`${queueType}_failed`, Date.now());
      logger.error(`❌ QueueManager: Job ${job?.id} falhou na fila ${queueType}:`, err.message);
    });

    worker.on('error', (err) => {
      // Filtrar erros que não devem acionar o circuit breaker
      const isTimeoutError = err.message && err.message.includes('Command timed out');
      const isConnectionError = err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND';

      if (isTimeoutError) {
        logger.warn(`⚠️ QueueManager: Timeout no worker ${queueType}:`, err.message);
        // Para timeouts, não acionar circuit breaker imediatamente
      } else {
        logger.error(`❌ QueueManager: Erro no worker ${queueType}:`, err.message);
        if (isConnectionError) {
          this.handleCircuitBreaker();
        }
      }
    });

    this.workers.set(queueType, worker);
    logger.debug(`👷 QueueManager: Worker ${queueType} criado com concorrência ${config.concurrency}`);

    return worker;
  }

  /**
   * Inicializa eventos de fila para monitoramento
   */
  async initializeQueueEvents() {
    try {
      logger.info('📊 QueueManager: Inicializando eventos de monitoramento...');

      for (const [queueType, config] of Object.entries(queueConfig.QUEUES)) {
        const queueEvents = new QueueEvents(config.name, {
          connection: this.connection,
        });

        // Monitoramento de eventos globais
        queueEvents.on('waiting', ({ jobId }) => {
          this.stats.totalJobsWaiting++;
          logger.debug(`⏳ QueueManager: Job ${jobId} aguardando na fila ${queueType}`);
        });

        queueEvents.on('active', ({ jobId }) => {
          this.stats.totalJobsActive++;
          logger.debug(`🏃 QueueManager: Job ${jobId} ativo na fila ${queueType}`);
        });

        queueEvents.on('completed', ({ jobId }) => {
          logger.debug(`✅ QueueManager: Job ${jobId} completado na fila ${queueType}`);
        });

        queueEvents.on('failed', ({ jobId, failedReason }) => {
          logger.error(`❌ QueueManager: Job ${jobId} falhou na fila ${queueType}: ${failedReason}`);
        });

        this.queueEvents.set(queueType, queueEvents);
      }

      logger.info('✅ QueueManager: Eventos de monitoramento inicializados');
    } catch (error) {
      logger.error('❌ QueueManager: Erro ao inicializar eventos:', error.message);
      throw error;
    }
  }

  /**
   * Configura monitoramento e health checks
   */
  setupMonitoring() {
    if (!queueConfig.MONITORING.ENABLED) {
      return;
    }

    // Health check periódico
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthCheck();
    }, queueConfig.MONITORING.HEALTH_CHECK_INTERVAL);

    // Coleta de métricas
    this.metricsInterval = setInterval(async () => {
      await this.collectMetrics();
    }, queueConfig.MONITORING.METRICS_INTERVAL);

    logger.info('📊 QueueManager: Monitoramento configurado');
  }

  /**
   * Realiza health check do sistema
   */
  async performHealthCheck() {
    try {
      this.stats.lastHealthCheck = Date.now();

      // Verificar conexão Redis
      await this.connection.ping();

      // Verificar status das filas
      for (const [queueType, queue] of this.queues) {
        const waiting = await queue.getWaiting();
        const active = await queue.getActive();
        const failed = await queue.getFailed();

        if (failed.length > 100) {
          // Muitos jobs falhando
          logger.warn(`⚠️ QueueManager: Muitos jobs falhando na fila ${queueType}: ${failed.length}`);
        }

        if (waiting.length > 1000) {
          // Fila muito cheia
          logger.warn(`⚠️ QueueManager: Fila ${queueType} com muitos jobs aguardando: ${waiting.length}`);
        }
      }

      logger.debug('✅ QueueManager: Health check concluído');
    } catch (error) {
      logger.error('❌ QueueManager: Falha no health check:', error.message);
      this.handleCircuitBreaker();
    }
  }

  /**
   * Coleta métricas do sistema
   */
  async collectMetrics() {
    try {
      const metrics = {
        timestamp: Date.now(),
        uptime: Date.now() - this.stats.startTime,
        stats: { ...this.stats },
        queues: {},
      };

      for (const [queueType, queue] of this.queues) {
        const queueStats = await queue.getJobCounts();
        metrics.queues[queueType] = queueStats;
      }

      logger.debug('📊 QueueManager: Métricas coletadas', metrics);
    } catch (error) {
      logger.error('❌ QueueManager: Erro ao coletar métricas:', error.message);
    }
  }

  /**
   * Adiciona job de salvamento de dados à fila
   */
  async addDataSaveJob(type, key, data, priority = 5) {
    return this.addJobSafely(
      'DATA_SAVE',
      {
        type,
        key,
        data,
        timestamp: Date.now(),
      },
      {
        priority,
        attempts: queueConfig.JOB_OPTIONS.DATA_SAVE.attempts,
        backoff: queueConfig.JOB_OPTIONS.DATA_SAVE.backoff,
      },
    );
  }

  /**
   * Adiciona job de forma segura com fallback
   */
  async addJobSafely(queueType, jobData, options = {}) {
    try {
      // Verificar circuit breaker
      if (this.circuitBreaker.isOpen) {
        throw new Error('Circuit breaker aberto - usando fallback direto');
      }

      if (!this.initialized || !this.queues.has(queueType)) {
        throw new Error(`Fila ${queueType} não inicializada`);
      }

      const queue = this.queues.get(queueType);
      const job = await queue.add(`${queueType}_job`, jobData, {
        ...options,
        removeOnComplete: queueConfig.QUEUES[queueType].removeOnComplete,
        removeOnFail: queueConfig.QUEUES[queueType].removeOnFail,
      });

      this.stats.totalJobsAdded++;
      logger.debug(`📤 QueueManager: Job ${job.id} adicionado à fila ${queueType}`);

      return job;
    } catch (error) {
      logger.warn(`⚠️ QueueManager: Erro ao adicionar job à fila ${queueType}, usando fallback:`, error.message);

      // Fallback para salvamento direto
      if (queueConfig.FALLBACK.ENABLE_DIRECT_SAVE && queueType === 'DATA_SAVE') {
        // Usar salvamento direto sem passar pela fila para evitar recursão
        if (this.eventHandler) {
          const { type, key, data } = jobData;
          try {
            await this.eventHandler.saveDataImmediately(this.getDataType(type), this.formatKey(type, key), data);
            logger.debug(`💾 QueueManager: Fallback - dados salvos diretamente para ${type}`);
            return { id: 'fallback', data: jobData };
          } catch (fallbackError) {
            logger.error('❌ QueueManager: Falha no fallback de salvamento:', fallbackError.message);
          }
        }
      }

      throw error;
    }
  }

  /**
   * Processa job de salvamento de dados
   */
  async processDataSaveJob(job) {
    try {
      const { type, key, data } = job.data;

      if (!this.eventHandler) {
        throw new Error('EventHandler não disponível');
      }

      // Usar os métodos de salvamento do eventHandler
      switch (type) {
        case 'message':
          await this.eventHandler.setMessage(key.remoteJid, key.messageId, data);
          break;
        case 'group':
          await this.eventHandler.setGroup(key, data);
          break;
        case 'contact':
          await this.eventHandler.setContact(key, data);
          break;
        case 'chat':
          await this.eventHandler.setChat(key, data);
          break;
        case 'event':
          await this.eventHandler.setEvent(key, data);
          break;
        default:
          throw new Error(`Tipo de dados não suportado: ${type}`);
      }

      return { success: true, type, key };
    } catch (error) {
      logger.error('❌ QueueManager: Erro ao processar salvamento:', {
        error: error.message,
        type: job.data?.type,
        key: typeof job.data?.key === 'string' ? job.data.key.substring(0, 50) : 'complex_key',
      });
      throw error;
    }
  }

  /**
   * Processa job de mensagem
   */
  async processMessageJob(job) {
    const { messageData } = job.data;
    logger.debug('📨 QueueManager: Processando mensagem via fila');
    return { success: true, messageId: messageData?.key?.id };
  }

  /**
   * Processa job de metadados de grupo
   */
  async processGroupMetadataJob(job) {
    const { groupJid } = job.data;

    try {
      if (!this.eventHandler) {
        throw new Error('EventHandler não disponível');
      }

      const metadata = await this.eventHandler.getOrFetchGroupMetadata(groupJid);
      return { success: true, groupJid, metadata };
    } catch (error) {
      logger.error('❌ QueueManager: Erro ao processar metadados do grupo:', error.message);
      throw error;
    }
  }

  /**
   * Processa job de evento
   */
  async processEventJob(job) {
    logger.debug('🎯 QueueManager: Processando evento via fila');
    return { success: true };
  }

  /**
   * Processa job de limpeza
   */
  async processCleanupJob(job) {
    logger.debug('🧹 QueueManager: Executando limpeza via fila');
    return { success: true };
  }

  /**
   * Manipula circuit breaker
   */
  handleCircuitBreaker() {
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailure = Date.now();

    if (this.circuitBreaker.failures >= this.circuitBreaker.threshold) {
      this.circuitBreaker.isOpen = true;
      logger.warn('⚠️ QueueManager: Circuit breaker aberto devido a falhas consecutivas');

      // Fechar circuit breaker após timeout
      setTimeout(() => {
        this.resetCircuitBreaker();
      }, this.circuitBreaker.timeout);
    }
  }

  /**
   * Reseta circuit breaker
   */
  resetCircuitBreaker() {
    this.circuitBreaker.failures = 0;
    this.circuitBreaker.isOpen = false;
    this.circuitBreaker.lastFailure = null;
    logger.info('✅ QueueManager: Circuit breaker resetado');
  }

  /**
   * Define o EventHandler para processamento
   */
  setEventHandler(eventHandler) {
    this.eventHandler = eventHandler;
    logger.info('🔗 QueueManager: EventHandler configurado');
  }

  /**
   * Obtém estatísticas completas das filas
   */
  async getStats() {
    try {
      const queueStats = {};

      for (const [queueType, queue] of this.queues) {
        const counts = await queue.getJobCounts();
        queueStats[queueType] = {
          ...counts,
          name: queueConfig.QUEUES[queueType].name,
        };
      }

      return {
        ...this.stats,
        queues: queueStats,
        circuitBreaker: this.circuitBreaker,
        uptime: Date.now() - this.stats.startTime,
      };
    } catch (error) {
      logger.error('❌ QueueManager: Erro ao obter estatísticas:', error.message);
      return { error: error.message };
    }
  }

  /**
   * Log do status do sistema
   */
  async logSystemStatus() {
    try {
      const stats = await this.getStats();
      logger.info('📊 QueueManager: Status do sistema', {
        initialized: this.initialized,
        connectionStatus: this.stats.connectionStatus,
        totalQueues: this.queues.size,
        totalWorkers: this.workers.size,
        stats,
      });
    } catch (error) {
      logger.error('❌ QueueManager: Erro ao registrar status:', error.message);
    }
  }

  /**
   * Shutdown graceful do sistema de filas
   */
  async shutdown() {
    try {
      logger.info('🛑 QueueManager: Iniciando shutdown graceful...');

      // Parar intervals
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
      }
      if (this.metricsInterval) {
        clearInterval(this.metricsInterval);
      }

      // Fechar workers
      for (const [queueType, worker] of this.workers) {
        await worker.close();
        logger.debug(`👷 QueueManager: Worker ${queueType} fechado`);
      }

      // Fechar eventos
      for (const [queueType, queueEvents] of this.queueEvents) {
        await queueEvents.close();
        logger.debug(`📊 QueueManager: Eventos ${queueType} fechados`);
      }

      // Fechar filas
      for (const [queueType, queue] of this.queues) {
        await queue.close();
        logger.debug(`📋 QueueManager: Fila ${queueType} fechada`);
      }

      // Fechar conexão Redis
      if (this.connection) {
        await this.connection.quit();
        logger.debug('🔗 QueueManager: Conexão Redis fechada');
      }

      this.initialized = false;
      logger.info('✅ QueueManager: Shutdown concluído');

      return { success: true };
    } catch (error) {
      logger.error('❌ QueueManager: Erro durante shutdown:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Converte tipo de dados para formato esperado pelo saveDataImmediately
   */
  getDataType(type) {
    const typeMap = {
      message: 'messages',
      group: 'groups',
      contact: 'contacts',
      chat: 'chats',
      event: 'events',
    };
    return typeMap[type] || type;
  }

  /**
   * Formata a chave baseada no tipo de dados
   */
  formatKey(type, key) {
    if (type === 'message' && typeof key === 'object') {
      return `${key.remoteJid}:${key.messageId}`;
    }
    return key;
  }
}

// Instância única do QueueManager
const queueManager = new QueueManager();

module.exports = {
  queueManager,
  QueueManager,
};
