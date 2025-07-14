/**
 * OmniZap Queue Configuration - BullMQ v5.56.4
 *
 * Configurações centralizadas para o sistema de filas BullMQ
 * Utiliza as melhores práticas do BullMQ para alta performance e confiabilidade
 *
 * @version 2.0.0
 * @author OmniZap Team
 */

const { cleanEnv, str, num, bool } = require('envalid');

// Validação das variáveis de ambiente
const env = cleanEnv(process.env, {
  USE_QUEUE: bool({ default: true, desc: 'Ativar sistema de filas' }),
  REDIS_HOST: str({ default: 'localhost', desc: 'Host do Redis' }),
  REDIS_PORT: num({ default: 6379, desc: 'Porta do Redis' }),
  REDIS_PASSWORD: str({ default: '', desc: 'Senha do Redis' }),
  REDIS_DB: num({ default: 0, desc: 'Database do Redis' }),
  REDIS_MAX_RETRIES: num({ default: 3, desc: 'Máximo de tentativas de reconexão' }),
  REDIS_RETRY_DELAY: num({ default: 2000, desc: 'Delay entre tentativas (ms)' }),

  // Configurações de concorrência por fila
  QUEUE_DATA_SAVE_CONCURRENCY: num({ default: 10, desc: 'Concorrência da fila de salvamento' }),
  QUEUE_MESSAGE_CONCURRENCY: num({ default: 5, desc: 'Concorrência da fila de mensagens' }),
  QUEUE_GROUP_CONCURRENCY: num({ default: 3, desc: 'Concorrência da fila de grupos' }),
  QUEUE_EVENT_CONCURRENCY: num({ default: 8, desc: 'Concorrência da fila de eventos' }),
  QUEUE_CLEANUP_CONCURRENCY: num({ default: 2, desc: 'Concorrência da fila de limpeza' }),

  // Configurações de retenção de jobs
  QUEUE_KEEP_COMPLETED: num({ default: 50, desc: 'Jobs completos mantidos' }),
  QUEUE_KEEP_FAILED: num({ default: 25, desc: 'Jobs falhados mantidos' }),
});

module.exports = {
  // Controle geral do sistema de filas
  QUEUE_ENABLED: env.USE_QUEUE,

  // Configurações Redis otimizadas para BullMQ
  REDIS: {
    HOST: env.REDIS_HOST,
    PORT: env.REDIS_PORT,
    PASSWORD: env.REDIS_PASSWORD || undefined,
    DB: env.REDIS_DB,
    MAX_RETRIES: env.REDIS_MAX_RETRIES,
    RETRY_DELAY: env.REDIS_RETRY_DELAY,
    // Configurações específicas do BullMQ
    CONNECT_TIMEOUT: 15000, // Aumentado para 15 segundos
    LAZY_CONNECT: false, // Conectar imediatamente
    ENABLE_READY_CHECK: true, // Habilitado para melhor detecção de estado
    MAX_RETRIES_PER_REQUEST: 3,
    RETRY_DELAY_ON_FAILOVER: 100,
    FAMILY: 4, // IPv4
    KEEP_ALIVE: 30000,
    // Configurações adicionais para estabilidade
    ENABLE_OFFLINE_QUEUE: true,
    AUTO_RESUBSCRIBE: true,
    AUTO_RESEND_UNFULFILLED_COMMANDS: true,
  },

  // Configurações das filas otimizadas
  QUEUES: {
    DATA_SAVE: {
      name: 'omnizap-data-save',
      concurrency: env.QUEUE_DATA_SAVE_CONCURRENCY,
      removeOnComplete: env.QUEUE_KEEP_COMPLETED * 2, // Mais histórico para salvamento
      removeOnFail: env.QUEUE_KEEP_FAILED,
      // Configurações específicas para salvamento de dados
      priority: 5, // Prioridade média-alta
      delay: 0, // Processamento imediato
      rateLimiter: {
        max: 100, // 100 jobs por minuto
        duration: 60000,
      },
    },
    MESSAGE_PROCESS: {
      name: 'omnizap-message-process',
      concurrency: env.QUEUE_MESSAGE_CONCURRENCY,
      removeOnComplete: env.QUEUE_KEEP_COMPLETED,
      removeOnFail: env.QUEUE_KEEP_FAILED,
      priority: 8, // Alta prioridade para mensagens
      delay: 100, // Pequeno delay para batch processing
      rateLimiter: {
        max: 200, // 200 mensagens por minuto
        duration: 60000,
      },
    },
    GROUP_METADATA: {
      name: 'omnizap-group-metadata',
      concurrency: env.QUEUE_GROUP_CONCURRENCY,
      removeOnComplete: env.QUEUE_KEEP_COMPLETED,
      removeOnFail: env.QUEUE_KEEP_FAILED,
      priority: 3, // Prioridade baixa, não é crítico
      delay: 500, // Delay maior para evitar rate limit do WhatsApp
      rateLimiter: {
        max: 30, // 30 grupos por minuto para evitar bloqueios
        duration: 60000,
      },
    },
    EVENT_PROCESS: {
      name: 'omnizap-event-process',
      concurrency: env.QUEUE_EVENT_CONCURRENCY,
      removeOnComplete: env.QUEUE_KEEP_COMPLETED,
      removeOnFail: env.QUEUE_KEEP_FAILED,
      priority: 6, // Prioridade média-alta
      delay: 50, // Processamento quase imediato
      rateLimiter: {
        max: 500, // 500 eventos por minuto
        duration: 60000,
      },
    },
    CLEANUP: {
      name: 'omnizap-cleanup',
      concurrency: env.QUEUE_CLEANUP_CONCURRENCY,
      removeOnComplete: 10, // Poucos logs para cleanup
      removeOnFail: 5,
      priority: 1, // Prioridade muito baixa
      delay: 60000, // 1 minuto de delay
      rateLimiter: {
        max: 10, // 10 jobs de limpeza por hora
        duration: 3600000,
      },
    },
  },

  // Configurações de jobs otimizadas por tipo
  JOB_OPTIONS: {
    DEFAULT_ATTEMPTS: 3,
    BACKOFF_TYPE: 'exponential',
    BACKOFF_DELAY: 2000,
    TTL: 24 * 60 * 60 * 1000, // 24 horas

    // Configurações específicas por tipo de job
    DATA_SAVE: {
      attempts: 5, // Mais tentativas para salvamento crítico
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      ttl: 2 * 60 * 60 * 1000, // 2 horas
      priority: 5,
    },
    MESSAGE_PROCESS: {
      attempts: 3,
      backoff: {
        type: 'fixed',
        delay: 5000,
      },
      ttl: 30 * 60 * 1000, // 30 minutos
      priority: 8,
    },
    GROUP_METADATA: {
      attempts: 2, // Poucas tentativas para não sobrecarregar API
      backoff: {
        type: 'exponential',
        delay: 10000, // Delay maior entre tentativas
      },
      ttl: 60 * 60 * 1000, // 1 hora
      priority: 3,
    },
    EVENT_PROCESS: {
      attempts: 4,
      backoff: {
        type: 'exponential',
        delay: 1500,
      },
      ttl: 45 * 60 * 1000, // 45 minutos
      priority: 6,
    },
    CLEANUP: {
      attempts: 2,
      backoff: {
        type: 'fixed',
        delay: 60000, // 1 minuto entre tentativas
      },
      ttl: 12 * 60 * 60 * 1000, // 12 horas
      priority: 1,
    },
  },

  // Configurações de monitoramento e observabilidade
  MONITORING: {
    ENABLED: true,
    METRICS_INTERVAL: 30000, // 30 segundos
    LOG_SLOW_JOBS: true,
    SLOW_JOB_THRESHOLD: 5000, // 5 segundos
    ENABLE_QUEUE_EVENTS: true,
    HEALTH_CHECK_INTERVAL: 60000, // 1 minuto
    ENABLE_METRICS: true,
    LOG_LEVEL: 'info',
  },

  // Configurações de performance otimizadas para BullMQ
  PERFORMANCE: {
    // Configurações para jobs em lote
    BATCH_SIZE: {
      DATA_SAVE: 50,
      MESSAGE_PROCESS: 20,
      GROUP_METADATA: 5,
      EVENT_PROCESS: 100,
      CLEANUP: 10,
    },

    // Configurações de timeout por tipo de job
    PROCESSING_TIMEOUT: {
      DATA_SAVE: 30000, // 30 segundos
      MESSAGE_PROCESS: 60000, // 1 minuto
      GROUP_METADATA: 120000, // 2 minutos (API pode ser lenta)
      EVENT_PROCESS: 45000, // 45 segundos
      CLEANUP: 300000, // 5 minutos
    },

    // Configurações de stall e concorrência
    MAX_STALLED_COUNT: 3,
    STALLED_INTERVAL: 30000, // 30 segundos
    MAX_CONCURRENCY_PER_WORKER: 10,
  },

  // Configurações de fallback e recuperação
  FALLBACK: {
    ENABLE_DIRECT_SAVE: true,
    RETRY_QUEUE_CONNECTION: true,
    MAX_FALLBACK_RETRIES: 3,
    FALLBACK_TIMEOUT: 5000, // 5 segundos para tentar fila antes de fallback
  },
};
