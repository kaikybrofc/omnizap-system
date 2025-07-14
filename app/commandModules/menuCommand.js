/**
 * OmniZap Menu Command
 *
 * Comando para exibir o menu de comandos disponíveis no sistema OmniZap
 *
 * @version 1.0.5
 * @author OmniZap Team
 * @license MIT
 */

const logger = require('../../app/utils/logger/loggerModule');
const { formatSuccessMessage } = require('../../app/utils/messageUtils');
const { COMMAND_PREFIX, EMOJIS } = require('../../app/utils/constants');
const { STICKERS_PER_PACK } = require('../commandModules/stickerModules/stickerPackManager');

/**
 * Processa o comando de menu, exibindo todos os comandos disponíveis
 *
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @param {Object} messageInfo - Informações da mensagem
 * @param {String} senderJid - JID do remetente
 * @param {String} groupJid - JID do grupo (pode ser null)
 * @param {String} args - Argumentos do comando
 * @returns {Promise<Object>} - Resultado da operação
 */
const processMenuCommand = async (omniZapClient, messageInfo, senderJid, groupJid, args) => {
  logger.info('Processando comando menu', { senderJid, groupJid, args });

  try {
    // Verifica argumentos para exibir menus específicos
    const arg = args ? args.trim().toLowerCase() : '';

    switch (arg) {
      case 'admin':
        return {
          success: true,
          message: buildAdminMenu(),
        };
      case 'sticker':
        return {
          success: true,
          message: buildStickerMenu(),
        };
      default:
        return {
          success: true,
          message: buildMainMenu(),
        };
    }
  } catch (error) {
    logger.error('Erro ao processar comando menu', {
      error: error.message,
      stack: error.stack,
      senderJid,
      groupJid,
      args,
    });

    return {
      success: false,
      message: `${EMOJIS.ERROR} *Erro ao exibir menu*\n\nOcorreu um erro ao processar o comando. Por favor, tente novamente mais tarde.`,
    };
  }
};

/**
 * Constrói o menu principal com todos os comandos disponíveis
 *
 * @returns {String} - Mensagem formatada com o menu principal
 */
const buildMainMenu = () => {
  const prefix = COMMAND_PREFIX;

  return formatSuccessMessage(
    '📋 Menu de Comandos OmniZap',
    'Abaixo estão todos os comandos disponíveis no sistema:',
    `*🛡️ Comandos de Administração:*
• \`${prefix}ban\` - Bane usuário do grupo
• \`${prefix}banlist\` - Lista usuários banidos
• \`${prefix}add\` - Adiciona usuário ao grupo
• \`${prefix}promote\` - Promove usuário a admin
• \`${prefix}demote\` - Remove admin de um usuário
• \`${prefix}setname\` - Altera nome do grupo
• \`${prefix}setdesc\` - Altera descrição do grupo
• \`${prefix}group\` - Configurações do grupo
• \`${prefix}ephemeral\` - Mensagens temporárias
• \`${prefix}addmode\` - Configura modo de entrada
• \`${prefix}link\` - Obtém link do grupo
• \`${prefix}groupinfo\` - Informações do grupo

*🎭 Comandos de Stickers:*
• \`${prefix}sticker\` ou \`${prefix}s\` - Cria sticker de imagem/vídeo
• \`${prefix}s <nome> | <autor>\` - Personaliza nome e autor do sticker
• \`${prefix}s packs\` - Lista seus pacotes de stickers
• \`${prefix}s info <número>\` - Ver detalhes de um pack
• \`${prefix}s send <número>\` - Envia pack completo
• \`${prefix}s help\` - Instruções detalhadas

*🔧 Outros Comandos:*
• \`${prefix}menu admin\` - Menu de comandos admin
• \`${prefix}menu sticker\` - Menu de comandos de stickers

_Desenvolvido por OmniZap Team_`,
  );
};

/**
 * Constrói o menu de comandos de administração
 *
 * @returns {String} - Mensagem formatada com o menu de administração
 */
const buildAdminMenu = () => {
  const prefix = COMMAND_PREFIX;

  return formatSuccessMessage(
    '🛡️ Menu de Comandos de Administração',
    'Comandos para gerenciamento de grupos:',
    `*Gerenciamento de Usuários:*
• \`${prefix}ban <número/@menção> [motivo]\` - Bane usuário do grupo
• \`${prefix}banlist\` - Lista usuários banidos
• \`${prefix}banlist grupo\` - Lista banidos do grupo atual
• \`${prefix}banlist user <número>\` - Histórico de bans de um usuário
• \`${prefix}banlist total\` - Estatísticas de banimentos
• \`${prefix}add <número1> [número2...]\` - Adiciona usuários ao grupo
• \`${prefix}promote <@menção>\` - Promove usuário a administrador
• \`${prefix}demote <@menção>\` - Remove privilégios de administrador

*Configurações de Grupo:*
• \`${prefix}setname <nome>\` - Altera o nome do grupo
• \`${prefix}setdesc <descrição>\` - Altera a descrição do grupo
• \`${prefix}group open/close\` - Abre/fecha o grupo
• \`${prefix}ephemeral <off/24h/7d/90d>\` - Configura mensagens temporárias
• \`${prefix}addmode <on/off>\` - Ativa/desativa aprovação de entrada
• \`${prefix}link\` - Obtém o link de convite do grupo
• \`${prefix}groupinfo\` - Exibe informações do grupo

*Observações:*
• Comandos só funcionam para administradores do grupo
• O bot precisa ser administrador para executar a maioria dos comandos

_Use \`${prefix}menu\` para ver todos os comandos disponíveis_`,
  );
};

/**
 * Constrói o menu de comandos de stickers
 *
 * @returns {String} - Mensagem formatada com o menu de stickers
 */
const buildStickerMenu = () => {
  const prefix = COMMAND_PREFIX;

  return formatSuccessMessage(
    '🎭 Menu Completo de Comandos de Stickers',
    'Guia detalhado para criação e gerenciamento de stickers personalizados:',
    `*📸 Criação de Stickers:*
• \`${prefix}sticker\` ou \`${prefix}s\` - Cria sticker da imagem/vídeo enviado ou respondido
• \`${prefix}s <nome> | <autor>\` - Cria sticker com nome de pacote e autor personalizados
  _Exemplo: \`${prefix}s Meus Stickers | João Silva\`_
• Para criar um sticker, envie uma imagem/vídeo e digite \`${prefix}s\` na legenda
• Você também pode responder a uma mídia com \`${prefix}s\` para criar sticker

*📦 Gerenciamento de Pacotes:*
• \`${prefix}s packs\` ou \`${prefix}s list\` - Lista todos os seus pacotes de stickers com status
  _Mostra: nome, autor, progresso (✅ Completo ou ⏳ Em progresso) e data de criação_
• \`${prefix}s info <número>\` - Mostra detalhes completos de um pacote específico
  _Exemplo: \`${prefix}s info 1\` mostra detalhes como nome, autor, ID, status, quantidade de stickers e comandos úteis_
• \`${prefix}s rename <número> <nome> | <autor>\` - Renomeia um pacote e seu autor
  _Exemplo: \`${prefix}s rename 2 Animais | Coleção 2025\`_
• \`${prefix}s delete <número>\` ou \`${prefix}s del <número>\` - Exclui permanentemente um pacote
  _Exemplo: \`${prefix}s delete 3\` remove completamente o terceiro pack e seus stickers_
• \`${prefix}s stats\` ou \`${prefix}s status\` - Exibe estatísticas detalhadas dos seus stickers
  _Mostra: total de stickers, total de packs, packs completos/incompletos, progresso atual e preferências_
• \`${prefix}s prefs <nome> | <autor>\` - Define preferências padrão para novos stickers
  _Exemplo: \`${prefix}s prefs Meus Stickers | João\` define o padrão para todos os novos stickers_

*🔄 Compartilhamento de Stickers:*
• \`${prefix}s send <número>\` ou \`${prefix}s share <número>\` - Envia todos os stickers do pacote
  _Exemplo: \`${prefix}s send 1\` envia todos os stickers do primeiro pack_
• Se estiver em um grupo, os stickers serão enviados para seu chat privado para evitar spam
• Você pode compartilhar packs completos ou incompletos sem restrições

*ℹ️ Informações Importantes:*
• Cada pacote comporta até ${STICKERS_PER_PACK} stickers
• Os pacotes são criados automaticamente quando você cria seu primeiro sticker
• Quando um pack atinge ${STICKERS_PER_PACK} stickers, um novo é criado automaticamente
• Seus packs são armazenados individualmente e podem ser acessados pelo seu número
• Stickers de vídeo terão duração limitada de acordo com as restrições do WhatsApp

*🔍 Recursos Avançados:*
• Variáveis especiais nos nomes dos packs e autores:
  → \`#nome\` - Substitui pelo seu nome de exibição no WhatsApp
  → \`#id\` - Substitui pelo seu número de telefone
  → \`#data\` - Substitui pela data atual (formato brasileiro)
• Seus packs e preferências ficam salvos mesmo após reiniciar o bot
• Se você não definir um nome/autor, serão usados os valores padrão das suas preferências

_Para um tutorial completo passo a passo, envie \`${prefix}s help\`_`,
  );
};

module.exports = {
  processMenuCommand,
};
