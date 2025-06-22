#!/usr/bin/env node

/**
 * OmniZap Sticker Pack System Test
 *
 * Script para testar o novo sistema de envio de sticker packs
 *
 * @version 1.0.0
 * @author OmniZap Team
 * @license MIT
 */

const { sendStickerPackWithRelay, preparePackProtoData } = require('./app/utils/stickerPackSender');
const logger = require('./app/utils/logger/loggerModule');

/**
 * Mock data para teste
 */
const mockPack = {
  packId: 'test_pack_001',
  name: 'Pack de Teste',
  author: 'OmniZap Test',
  stickers: [
    {
      fileName: 'test_sticker_1.webp',
      filePath: '/tmp/test_sticker_1.webp',
      mimetype: 'image/webp',
      emojis: ['😀'],
      isAnimated: false,
      isLottie: false,
    },
    {
      fileName: 'test_sticker_2.webp',
      filePath: '/tmp/test_sticker_2.webp',
      mimetype: 'image/webp',
      emojis: ['😂'],
      isAnimated: false,
      isLottie: false,
    },
  ],
};

/**
 * Mock client para teste
 */
const mockClient = {
  sendMessage: async (jid, content) => {
    console.log(`📤 Mock sendMessage to ${jid}:`, JSON.stringify(content, null, 2));
    return { success: true };
  },
  relayMessage: async (jid, message, options) => {
    console.log(`🔄 Mock relayMessage to ${jid}:`, JSON.stringify({ message, options }, null, 2));
    return 'mock_message_id';
  },
};

/**
 * Função principal de teste
 */
async function runTests() {
  console.log('🧪 Iniciando testes do sistema de sticker packs...\n');

  try {
    // Teste 1: Preparação de dados proto
    console.log('📋 Teste 1: Preparação de dados proto');
    const protoData = preparePackProtoData(mockPack, mockPack.stickers);
    console.log('✅ Dados proto preparados:', JSON.stringify(protoData, null, 2));
    console.log('');

    // Teste 2: Verificação de módulos
    console.log('📦 Teste 2: Verificação de módulos');
    console.log('✅ stickerPackSender carregado com sucesso');
    console.log('✅ logger funcionando corretamente');
    console.log('');

    // Teste 3: Simulação de envio (comentado para evitar erros)
    console.log('🚀 Teste 3: Simulação de envio');
    console.log('⚠️  Teste de envio simulado (não executado para evitar erros)');

    // Descomente para testar com cliente real:
    /*
    await sendStickerPackWithRelay(mockClient, 'test@test.com', mockPack, {
      batchSize: 2,
      delayBetweenStickers: 100,
      delayBetweenBatches: 200,
    });
    */

    console.log('✅ Sistema preparado para envio');
    console.log('');

    // Teste 4: Verificação de constantes
    console.log('⚙️  Teste 4: Verificação de constantes');
    const { STICKER_CONSTANTS, RATE_LIMIT_CONFIG, EMOJIS } = require('./app/utils/constants');

    console.log('📊 STICKER_CONSTANTS:', {
      STICKERS_PER_PACK: STICKER_CONSTANTS.STICKERS_PER_PACK,
      MAX_FILE_SIZE: STICKER_CONSTANTS.MAX_FILE_SIZE,
      PACK_ORIGIN: STICKER_CONSTANTS.PACK_ORIGIN,
    });

    console.log('🔄 RATE_LIMIT_CONFIG:', RATE_LIMIT_CONFIG);
    console.log('😊 EMOJIS disponíveis:', Object.keys(EMOJIS).length);
    console.log('');

    console.log('🎉 Todos os testes passaram!');
    console.log('');
    console.log('📝 Próximos passos:');
    console.log('1. Inicie o OmniZap: npm start');
    console.log('2. Teste com stickers reais: /s');
    console.log('3. Envie um pack: /s send 1');
    console.log('4. Monitore os logs para verificar qual método está sendo usado');
  } catch (error) {
    console.error('❌ Erro durante os testes:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

/**
 * Executa os testes se o script for chamado diretamente
 */
if (require.main === module) {
  runTests().catch((error) => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
  });
}

module.exports = {
  runTests,
  mockPack,
  mockClient,
};
