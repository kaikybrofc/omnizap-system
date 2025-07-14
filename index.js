/**
 * OmniZap - Sistema de Automação WhatsApp
 *
 * Sistema profissional para automação e gerenciamento de mensagens WhatsApp
 * Desenvolvido com tecnologia Baileys para máxima compatibilidade
 *
 * @version 1.0.5
 * @author OmniZap Team
 * @license MIT
 */

const OmniZapMessageProcessor = require('./app/controllers/messageController');
const { eventHandler } = require('./app/events/eventHandler');
const logger = require('./app/utils/logger/loggerModule');

// Variáveis globais para controle de estado
let activeSocketController = null;
let systemInitialized = false;
let lastProcessingTime = 0;

/**
 * Registra o socketController ativo para melhor integração
 *
 * @param {Object} socketController - Referência ao controlador de socket
 */
function registerSocketController(socketController) {
  activeSocketController = socketController;
  logger.info('🔗 SocketController registrado no sistema principal');

  // Registra evento no eventHandler
  if (eventHandler) {
    eventHandler.processGenericEvent('socketController.registered', {
      timestamp: Date.now(),
      hasConnectionStats: !!socketController?.getConnectionStats,
      hasSendMessage: !!socketController?.sendMessage,
      hasActiveSocket: !!socketController?.getActiveSocket,
    });
  }
}

/**
 * Obtém estatísticas detalhadas do sistema
 *
 * @returns {Object} Estatísticas completas do sistema
 */
function getSystemStats() {
  const baseStats = {
    systemInitialized,
    lastProcessingTime,
    hasActiveSocketController: !!activeSocketController,
    version: '1.0.5',
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    timestamp: Date.now(),
  };

  // Adiciona estatísticas do socketController se disponível
  if (activeSocketController?.getConnectionStats) {
    try {
      baseStats.connection = activeSocketController.getConnectionStats();
    } catch (error) {
      logger.warn('⚠️ Erro ao obter estatísticas de conexão:', error.message);
      baseStats.connection = { error: error.message };
    }
  }

  // Adiciona estatísticas do eventHandler se disponível
  if (eventHandler?.getCacheStats) {
    try {
      baseStats.eventHandler = eventHandler.getCacheStats();
    } catch (error) {
      logger.warn('⚠️ Erro ao obter estatísticas do eventHandler:', error.message);
      baseStats.eventHandler = { error: error.message };
    }
  }

  return baseStats;
}

/**
 * Valida se o sistema está pronto para processar mensagens
 *
 * @param {Object} whatsappClient - Cliente WhatsApp ativo
 * @param {Object} socketController - Referência ao controlador de socket
 * @returns {Object} Resultado da validação
 */
function validateSystemReadiness(whatsappClient, socketController) {
  const validationResult = {
    isReady: true,
    warnings: [],
    errors: [],
    details: {},
  };

  // Verifica cliente WhatsApp
  if (!whatsappClient) {
    validationResult.isReady = false;
    validationResult.errors.push('Cliente WhatsApp não disponível');
  } else {
    validationResult.details.whatsappClient = {
      hasUser: !!whatsappClient.user,
      userId: whatsappClient.user?.id || null,
      wsState: whatsappClient.ws?.readyState || 'unknown',
    };
  }

  // Verifica socketController
  if (!socketController) {
    validationResult.warnings.push('SocketController não fornecido');
  } else {
    validationResult.details.socketController = {
      hasActiveSocket: !!socketController.getActiveSocket?.(),
      hasConnectionStats: !!socketController.getConnectionStats,
      hasSendMessage: !!socketController.sendMessage,
    };
  }

  // Verifica eventHandler
  if (!eventHandler) {
    validationResult.warnings.push('EventHandler não disponível');
  } else {
    validationResult.details.eventHandler = {
      hasWhatsAppClient: !!eventHandler.whatsappClient,
      cacheStats: eventHandler.getCacheStats?.() || null,
    };
  }

  // Verifica se o sistema foi inicializado
  if (!systemInitialized) {
    validationResult.warnings.push('Sistema ainda não foi completamente inicializado');
  }

  return validationResult;
}

/**
 * Processador principal de mensagens do OmniZap com integração melhorada
 *
 * @param {Object} messageUpdate - Atualização de mensagens recebidas
 * @param {Object} whatsappClient - Cliente WhatsApp ativo
 * @param {String} qrCodePath - Caminho do QR Code para autenticação (opcional)
 * @param {Object} socketController - Referência ao controlador de socket (opcional)
 * @returns {Promise<void>}
 */
const OmniZapMainHandler = async (messageUpdate, whatsappClient, qrCodePath = null, socketController = null) => {
  const startTime = Date.now();

  try {
    // Registra o socketController se fornecido e ainda não registrado
    if (socketController && socketController !== activeSocketController) {
      registerSocketController(socketController);
    }

    // Valida se o sistema está pronto
    const validation = validateSystemReadiness(whatsappClient, socketController);

    // Log detalhado do início do processamento
    logger.info('🎯 OmniZap: Iniciando processamento principal', {
      messageCount: messageUpdate?.messages?.length || 0,
      hasSocketController: !!socketController,
      hasEventHandler: !!eventHandler,
      qrCodePath: qrCodePath || 'não especificado',
      systemReady: validation.isReady,
      warnings: validation.warnings,
      processingId: startTime,
    });

    // Log warnings se houver
    if (validation.warnings.length > 0) {
      logger.warn('⚠️ Avisos do sistema:', validation.warnings);
    }

    // Para se houver erros críticos
    if (!validation.isReady) {
      throw new Error(`Sistema não está pronto: ${validation.errors.join(', ')}`);
    }

    // Garantir sincronização entre eventHandler e whatsappClient
    if (eventHandler && whatsappClient) {
      eventHandler.setWhatsAppClient(whatsappClient);
      logger.debug('🔄 WhatsApp client sincronizado com eventHandler');
    }

    // Atualizar estatísticas antes do processamento
    const preStats = getSystemStats();
    logger.debug('📊 Estatísticas pré-processamento:', {
      memoryUsage: preStats.memoryUsage,
      connection: preStats.connection?.isConnected || false,
      cacheStats: preStats.eventHandler,
    });

    // Processar mensagens com todas as integrações
    await OmniZapMessageProcessor(messageUpdate, whatsappClient, socketController);

    // Atualizar tempo de último processamento
    lastProcessingTime = Date.now();
    const processingDuration = lastProcessingTime - startTime;

    // Log de sucesso com métricas
    logger.info('✅ OmniZap: Processamento principal concluído', {
      duration: `${processingDuration}ms`,
      messageCount: messageUpdate?.messages?.length || 0,
      processingId: startTime,
      lastProcessingTime,
    });

    // Registra evento de sucesso no eventHandler
    if (eventHandler) {
      eventHandler.processGenericEvent('main.handler.success', {
        processingDuration,
        messageCount: messageUpdate?.messages?.length || 0,
        timestamp: lastProcessingTime,
        processingId: startTime,
        systemStats: getSystemStats(),
      });
    }

    // Atualizar estatísticas pós-processamento para comparação
    if (logger.level === 'debug') {
      const postStats = getSystemStats();
      logger.debug('📊 Estatísticas pós-processamento:', {
        memoryDelta: {
          rss: postStats.memoryUsage.rss - preStats.memoryUsage.rss,
          heapUsed: postStats.memoryUsage.heapUsed - preStats.memoryUsage.heapUsed,
        },
        processingDuration,
      });
    }
  } catch (error) {
    const processingDuration = Date.now() - startTime;

    logger.error('❌ OmniZap: Erro no processamento principal:', {
      error: error.message,
      stack: error.stack,
      messageCount: messageUpdate?.messages?.length || 0,
      duration: `${processingDuration}ms`,
      processingId: startTime,
      systemStats: getSystemStats(),
    });

    // Registrar erro detalhado no eventHandler
    if (eventHandler) {
      eventHandler.processGenericEvent('main.handler.error', {
        error: error.message,
        stack: error.stack,
        timestamp: Date.now(),
        messageCount: messageUpdate?.messages?.length || 0,
        processingDuration,
        processingId: startTime,
        systemStats: getSystemStats(),
      });
    }

    // Re-propagar o erro para que possa ser tratado upstream
    throw error;
  }
};

if (require.main === module) {
  const start = async () => {
    logger.info('🔌 Iniciando OmniZap System...');

    // Marcar início da inicialização
    const initStartTime = Date.now();

    // Registrar início da aplicação no eventHandler com mais detalhes
    if (eventHandler) {
      eventHandler.processGenericEvent('application.startup', {
        timestamp: initStartTime,
        version: '1.0.6',
        nodeVersion: process.version,
        platform: process.platform,
        architecture: process.arch,
        pid: process.pid,
        memoryUsage: process.memoryUsage(),
        uptime: 0,
      });
    }

    try {
      logger.info('🔗 Iniciando controlador de conexão...');

      // Importar e configurar socketController
      const socketControllerModule = require('./app/connection/socketController');

      // Registrar o socketController se ele exporta as funções necessárias
      if (socketControllerModule && typeof socketControllerModule === 'object') {
        registerSocketController(socketControllerModule);
      }

      // Marcar sistema como inicializado
      systemInitialized = true;
      const initDuration = Date.now() - initStartTime;

      logger.info('✅ OmniZap System inicializado com sucesso', {
        duration: `${initDuration}ms`,
        timestamp: Date.now(),
        hasSocketController: !!activeSocketController,
        systemStats: getSystemStats(),
      });

      // Registrar sucesso da inicialização
      if (eventHandler) {
        eventHandler.processGenericEvent('application.initialization.success', {
          initDuration,
          timestamp: Date.now(),
          version: '1.0.6',
          systemStats: getSystemStats(),
        });
      }
    } catch (error) {
      const initDuration = Date.now() - initStartTime;

      logger.error('❌ Erro na inicialização do sistema:', {
        error: error.message,
        stack: error.stack,
        duration: `${initDuration}ms`,
        timestamp: Date.now(),
      });

      // Registrar erro crítico no eventHandler
      if (eventHandler) {
        eventHandler.processGenericEvent('application.initialization.error', {
          error: error.message,
          stack: error.stack,
          initDuration,
          timestamp: Date.now(),
        });
      }

      // Não encerrar o processo, apenas log do erro
      systemInitialized = false;
    }
  };

  start();
}

// Manipuladores de encerramento gracioso
process.on('SIGINT', async () => {
  logger.info('🛑 Recebido SIGINT - Encerrando aplicação graciosamente...');

  if (eventHandler) {
    eventHandler.processGenericEvent('application.shutdown', {
      signal: 'SIGINT',
      timestamp: Date.now(),
      uptime: process.uptime(),
      systemStats: getSystemStats(),
    });

    // Salvar dados persistentes
    try {
      if (eventHandler.savePersistedData) {
        await eventHandler.savePersistedData();
        logger.info('💾 Dados persistentes salvos com sucesso');
      }
    } catch (error) {
      logger.error('❌ Erro ao salvar dados persistentes:', error.message);
    }
  }

  if (activeSocketController?.forceDisconnect) {
    try {
      await activeSocketController.forceDisconnect();
      logger.info('🔌 Socket desconectado com sucesso');
    } catch (error) {
      logger.error('❌ Erro ao desconectar socket:', error.message);
    }
  }

  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('🛑 Recebido SIGTERM - Encerrando aplicação graciosamente...');

  if (eventHandler) {
    eventHandler.processGenericEvent('application.shutdown', {
      signal: 'SIGTERM',
      timestamp: Date.now(),
      uptime: process.uptime(),
      systemStats: getSystemStats(),
    });
  }

  process.exit(0);
});

// Exportar funções úteis além do handler principal
module.exports = {
  // Handler principal
  default: OmniZapMainHandler,
  OmniZapMainHandler,

  // Funções utilitárias
  registerSocketController,
  getSystemStats,
  validateSystemReadiness,

  // Getters de estado
  getActiveSocketController: () => activeSocketController,
  isSystemInitialized: () => systemInitialized,
  getLastProcessingTime: () => lastProcessingTime,
};
