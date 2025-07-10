/**
 * OmniZap Menu Command
 *
 * Comando para exibir o menu de comandos disponíveis no sistema OmniZap
 *
 * @version 1.0.0
 * @author OmniZap Team
 * @license MIT
 */

const logger = require('../../app/utils/logger/loggerModule');
const { formatSuccessMessage } = require('../../app/utils/messageUtils');
const { COMMAND_PREFIX, EMOJIS } = require('../../app/utils/constants');

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
• \`${prefix}sticker\` - Cria sticker de imagem/vídeo
• \`${prefix}pack\` - Gerencia pacotes de stickers
• \`${prefix}s\` - Atalho para criar sticker

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
    '🎭 Menu de Comandos de Stickers',
    'Comandos para criação e gerenciamento de stickers:',
    `*Criar Stickers:*
• \`${prefix}sticker\` - Cria sticker da imagem/vídeo enviado ou respondido
• \`${prefix}s\` - Atalho para criar sticker
• \`${prefix}sticker crop\` - Cria sticker recortado (quadrado)
• \`${prefix}sticker full\` - Cria sticker sem recorte

*Gerenciar Pacotes:*
• \`${prefix}pack list\` - Lista seus pacotes de stickers
• \`${prefix}pack create <nome>\` - Cria um novo pacote
• \`${prefix}pack info <id>\` - Mostra informações do pacote
• \`${prefix}pack rename <id> <nome>\` - Renomeia um pacote
• \`${prefix}pack delete <id>\` - Exclui um pacote
• \`${prefix}pack author <nome>\` - Define seu nome de autor

*Enviar Stickers:*
• \`${prefix}pack send <id>\` - Envia todos os stickers do pacote

*Observações:*
• Tamanho máximo de arquivo: 10MB
• Formatos suportados: JPEG, PNG, MP4, WEBM
• Vídeos serão convertidos para stickers animados

_Use \`${prefix}menu\` para ver todos os comandos disponíveis_`,
  );
};

module.exports = {
  processMenuCommand,
};
