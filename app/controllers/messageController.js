/**
 * OmniZap Message Controller
 *
 * Controlador responsável pelo processamento e tratamento de mensagens
 * recebidas através do WhatsApp via tecnologia Baileys
 *
 * @version 2.0.0
 * @license MIT
 * @source https://github.com/Kaikygr/omnizap-system
 */

require('dotenv').config();
const logger = require('../utils/logger/loggerModule');
const groupUtils = require('../utils/groupUtils');
const dataStore = require('../store/dataStore');

const COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';

/**
 * Extrai o conteúdo de texto de uma mensagem do WhatsApp.
 *
 * @param {Object} messageInfo - Objeto da mensagem do WhatsApp.
 * @returns {string} O conteúdo de texto da mensagem ou uma string indicando o tipo de mídia.
 */
const extractMessageContent = (messageInfo) => {
  const message = messageInfo.message;

  if (!message) {
    return 'Mensagem vazia';
  }

  if (message.conversation) {
    return message.conversation;
  }
  if (message.extendedTextMessage?.text) {
    return message.extendedTextMessage.text;
  }
  if (message.imageMessage) {
    return message.imageMessage.caption || '[Imagem]';
  }
  if (message.videoMessage) {
    return message.videoMessage.caption || '[Vídeo]';
  }
  if (message.documentMessage) {
    return message.documentMessage.fileName || '[Documento]';
  }
  if (message.audioMessage) {
    return '[Áudio]';
  }
  if (message.stickerMessage) {
    return '[Figurinha]';
  }
  if (message.locationMessage) {
    return `[Localização] Latitude: ${message.locationMessage.degreesLatitude}, Longitude: ${message.locationMessage.degreesLongitude}`;
  }
  if (message.contactMessage) {
    return `[Contato] ${message.contactMessage.displayName}`;
  }
  if (message.contactsArrayMessage) {
    return `[Contatos] ${message.contactsArrayArrayMessage.contacts.map((c) => c.displayName).join(', ')}`;
  }
  if (message.listMessage) {
    return message.listMessage.description || '[Mensagem de Lista]';
  }
  if (message.buttonsMessage) {
    return message.buttonsMessage.contentText || '[Mensagem de Botões]';
  }
  if (message.templateButtonReplyMessage) {
    return `[Resposta de Botão de Modelo] ${message.templateButtonReplyMessage.selectedDisplayText}`;
  }
  if (message.productMessage) {
    return message.productMessage.product?.title || '[Mensagem de Produto]';
  }
  if (message.reactionMessage) {
    return `[Reação] ${message.reactionMessage.text}`;
  }
  if (message.pollCreationMessage) {
    return `[Enquete] ${message.pollCreationMessage.name}`;
  }

  return 'Tipo de mensagem não suportado ou sem conteúdo de texto.';
};

/**
 * Extrai o valor de expiração de uma mensagem do WhatsApp, ou retorna 24 horas (em segundos) por padrão.
 * @param {object} info - Objeto da mensagem recebido via Baileys.
 * @returns {number} Timestamp de expiração (em segundos).
 */
function getExpiration(sock) {
  const DEFAULT_EXPIRATION_SECONDS = 24 * 60 * 60;

  if (!sock || typeof sock !== 'object' || !sock.message) {
    return DEFAULT_EXPIRATION_SECONDS;
  }

  const messageTypes = ['conversation', 'viewOnceMessageV2', 'imageMessage', 'videoMessage', 'extendedTextMessage', 'viewOnceMessage', 'documentWithCaptionMessage', 'buttonsMessage', 'buttonsResponseMessage', 'listResponseMessage', 'templateButtonReplyMessage', 'interactiveResponseMessage'];

  for (const type of messageTypes) {
    const rawMessage = sock.message[type];
    const messageContent = rawMessage?.message ?? rawMessage;

    const expiration = messageContent?.contextInfo?.expiration;
    if (typeof expiration === 'number') {
      return expiration;
    }
  }

  const deepSearch = (obj) => {
    if (typeof obj !== 'object' || obj === null) return null;

    if (obj.contextInfo?.expiration && typeof obj.contextInfo.expiration === 'number') {
      return obj.contextInfo.expiration;
    }

    for (const key of Object.keys(obj)) {
      const value = obj[key];
      const result = deepSearch(value);
      if (result !== null) return result;
    }

    return null;
  };

  const found = deepSearch(sock.message);
  return typeof found === 'number' ? found : null;
}

/**
 * Lida com atualizações do WhatsApp, sejam mensagens ou eventos genéricos.
 *
 * @param {Object} update - Objeto contendo a atualização do WhatsApp.
 */
const handleWhatsAppUpdate = async (update, sock) => {
  if (update.messages && Array.isArray(update.messages)) {
    dataStore.saveIncomingRawMessages(update.messages);
    try {
      for (const messageInfo of update.messages) {
        const extractedText = extractMessageContent(messageInfo);
        if (extractedText.startsWith(COMMAND_PREFIX)) {
          const commandArgs = extractedText.substring(COMMAND_PREFIX.length).split(' ');
          const command = commandArgs[0];
          const args = commandArgs.slice(1);

          const isGroupMessage = messageInfo.key.remoteJid.endsWith('@g.us');
          const remoteJid = messageInfo.key.remoteJid;
          const senderJid = isGroupMessage ? messageInfo.key.participant : remoteJid;
          const expirationMessage = getExpiration(messageInfo);

          switch (command) {
            case 'grupoinfo': {
              let targetGroupId = args[0] || (isGroupMessage ? remoteJid : null);

              if (!targetGroupId) {
                logger.warn('ID do grupo não fornecido para /grupoinfo em chat privado.');
                await sock.sendMessage(
                  remoteJid,
                  {
                    text: '⚠️ *Por favor, forneça o ID do grupo!\n\nExemplo: `/grupoinfo 1234567890@g.us`',
                  },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }

              const groupInfo = groupUtils.getGroupInfo(targetGroupId);

              if (!groupInfo) {
                logger.info(`Grupo com ID ${targetGroupId} não encontrado.`);
                await sock.sendMessage(
                  remoteJid,
                  {
                    text: `❌ *Grupo com ID ${targetGroupId} não encontrado.*`,
                  },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }

              const reply = `📋 *Informações do Grupo:*\n\n` + `🆔 *ID:* ${groupInfo.id}\n` + `📝 *Assunto:* ${groupInfo.subject || 'N/A'}\n` + `👑 *Proprietário:* ${groupUtils.getGroupOwner(targetGroupId) || 'N/A'}\n` + `📅 *Criado em:* ${groupUtils.getGroupCreationTime(targetGroupId) ? new Date(groupUtils.getGroupCreationTime(targetGroupId) * 1000).toLocaleString() : 'N/A'}\n` + `👥 *Tamanho:* ${groupUtils.getGroupSize(targetGroupId) || 'N/A'}\n` + `🔒 *Restrito:* ${groupUtils.isGroupRestricted(targetGroupId) ? 'Sim' : 'Não'}\n` + `📢 *Somente anúncios:* ${groupUtils.isGroupAnnounceOnly(targetGroupId) ? 'Sim' : 'Não'}\n` + `🏘️ *Comunidade:* ${groupUtils.isGroupCommunity(targetGroupId) ? 'Sim' : 'Não'}\n` + `🗣️ *Descrição:* ${groupUtils.getGroupDescription(targetGroupId) || 'N/A'}\n` + `🛡️ *Administradores:* ${groupUtils.getGroupAdmins(targetGroupId).join(', ') || 'Nenhum'}\n` + `👤 *Total de Participantes:* ${groupUtils.getGroupParticipants(targetGroupId)?.length || 'Nenhum'}`;

              await sock.sendMessage(remoteJid, { text: reply }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              break;
            }

            case 'menuadmin': {
              if (!isGroupMessage) {
                await sock.sendMessage(remoteJid, { text: 'Este comando só pode ser usado em grupos.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (!groupUtils.isUserAdmin(remoteJid, senderJid)) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              const menuText = `
*Menu de Administração de Grupos*

*/creategroup <título> <participante1> <participante2>...* - Cria um novo grupo.
*/addparticipant <id_do_grupo> <participante1> <participante2>...* - Adiciona participantes a um grupo.
*/removeparticipant <id_do_grupo> <participante1> <participante2>...* - Remove participantes de um grupo.
*/promote <id_do_grupo> <participante1> <participante2>...* - Promove participantes a administradores.
*/demote <id_do_grupo> <participante1> <participante2>...* - Demote administradores a participantes.
*/changesubject <id_do_grupo> <novo_assunto>* - Altera o assunto do grupo.
*/changedescription <id_do_grupo> <nova_descrição>* - Altera a descrição do grupo.
*/groupsetting <id_do_grupo> <announcement|not_announcement|locked|unlocked>* - Altera as configurações do grupo.
*/leavegroup <id_do_grupo>* - O bot sai de um grupo.
*/invitecode <id_do_grupo>* - Obtém o código de convite do grupo.
*/revokeinvite <id_do_grupo>* - Revoga o código de convite do grupo.
*/join <código_de_convite>* - Entra em um grupo usando um código de convite.
*/groupinfofrominvite <código_de_convite>* - Obtém informações do grupo a partir de um código de convite.
*/groupmetadata <id_do_grupo>* - Obtém os metadados do grupo.
*/listrequests <id_do_grupo>* - Lista as solicitações de entrada no grupo.
*/updaterequests <id_do_grupo> <approve|reject> <participante1> <participante2>...* - Aprova ou rejeita solicitações de entrada.
*/listgroups* - Lista todos os grupos em que o bot está.
*/toggleephemeral <id_do_grupo> <duração_em_segundos>* - Ativa/desativa mensagens efêmeras.
*/addmode <id_do_grupo> <all_member_add|admin_add>* - Altera o modo de adição de membros.
    `;
              await sock.sendMessage(remoteJid, { text: menuText.trim() }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              break;
            }

            case 'creategroup': {
              if (!groupUtils.isUserAdmin(remoteJid, senderJid)) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (args.length < 2) {
                await sock.sendMessage(remoteJid, { text: 'Uso: /creategroup <título> <participante1> <participante2>...' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              const title = args[0];
              const participants = args.slice(1);
              try {
                const group = await groupUtils.createGroup(sock, title, participants);
                await sock.sendMessage(remoteJid, { text: `Grupo "${group.subject}" criado com sucesso!` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao criar o grupo: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'addparticipant': {
              if (!groupUtils.isUserAdmin(remoteJid, senderJid)) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (args.length < 2) {
                await sock.sendMessage(remoteJid, { text: 'Uso: /addparticipant <id_do_grupo> <participante1> <participante2>...' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              const groupId = args[0];
              const participants = args.slice(1);
              try {
                await groupUtils.updateGroupParticipants(sock, groupId, participants, 'add');
                await sock.sendMessage(remoteJid, { text: 'Participantes adicionados com sucesso!' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao adicionar participantes: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'removeparticipant': {
              if (!groupUtils.isUserAdmin(remoteJid, senderJid)) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (args.length < 2) {
                await sock.sendMessage(remoteJid, { text: 'Uso: /removeparticipant <id_do_grupo> <participante1> <participante2>...' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              const groupId = args[0];
              const participants = args.slice(1);
              try {
                await groupUtils.updateGroupParticipants(sock, groupId, participants, 'remove');
                await sock.sendMessage(remoteJid, { text: 'Participantes removidos com sucesso!' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao remover participantes: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'promote': {
              if (!groupUtils.isUserAdmin(remoteJid, senderJid)) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (args.length < 2) {
                await sock.sendMessage(remoteJid, { text: 'Uso: /promote <id_do_grupo> <participante1> <participante2>...' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              const groupId = args[0];
              const participants = args.slice(1);
              try {
                await groupUtils.updateGroupParticipants(sock, groupId, participants, 'promote');
                await sock.sendMessage(remoteJid, { text: 'Participantes promovidos a administradores com sucesso!' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao promover participantes: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'demote': {
              if (!groupUtils.isUserAdmin(remoteJid, senderJid)) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (args.length < 2) {
                await sock.sendMessage(remoteJid, { text: 'Uso: /demote <id_do_grupo> <participante1> <participante2>...' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              const groupId = args[0];
              const participants = args.slice(1);
              try {
                await groupUtils.updateGroupParticipants(sock, groupId, participants, 'demote');
                await sock.sendMessage(remoteJid, { text: 'Administradores demovidos a participantes com sucesso!' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao demoter administradores: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'changesubject': {
              if (!groupUtils.isUserAdmin(remoteJid, senderJid)) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (args.length < 2) {
                await sock.sendMessage(remoteJid, { text: 'Uso: /changesubject <id_do_grupo> <novo_assunto>' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              const groupId = args[0];
              const newSubject = args.slice(1).join(' ');
              try {
                await groupUtils.updateGroupSubject(sock, groupId, newSubject);
                await sock.sendMessage(remoteJid, { text: `Assunto do grupo alterado para "${newSubject}" com sucesso!` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao alterar o assunto do grupo: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'changedescription': {
              if (!groupUtils.isUserAdmin(remoteJid, senderJid)) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (args.length < 2) {
                await sock.sendMessage(remoteJid, { text: 'Uso: /changedescription <id_do_grupo> <nova_descrição>' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              const groupId = args[0];
              const newDescription = args.slice(1).join(' ');
              try {
                await groupUtils.updateGroupDescription(sock, groupId, newDescription);
                await sock.sendMessage(remoteJid, { text: 'Descrição do grupo alterada com sucesso!' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao alterar a descrição do grupo: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'groupsetting': {
              if (!groupUtils.isUserAdmin(remoteJid, senderJid)) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (args.length < 2 || !['announcement', 'not_announcement', 'locked', 'unlocked'].includes(args[1])) {
                await sock.sendMessage(remoteJid, { text: 'Uso: /groupsetting <id_do_grupo> <announcement|not_announcement|locked|unlocked>' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              const groupId = args[0];
              const setting = args[1];
              try {
                await groupUtils.updateGroupSettings(sock, groupId, setting);
                await sock.sendMessage(remoteJid, { text: `Configuração do grupo alterada para "${setting}" com sucesso!` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao alterar a configuração do grupo: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'leavegroup': {
              if (!groupUtils.isUserAdmin(remoteJid, senderJid)) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (args.length < 1) {
                await sock.sendMessage(remoteJid, { text: 'Uso: /leavegroup <id_do_grupo>' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              const groupId = args[0];
              try {
                await groupUtils.leaveGroup(sock, groupId);
                await sock.sendMessage(remoteJid, { text: `Saí do grupo ${groupId} com sucesso.` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao sair do grupo: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'invitecode': {
              if (!groupUtils.isUserAdmin(remoteJid, senderJid)) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (args.length < 1) {
                await sock.sendMessage(remoteJid, { text: 'Uso: /invitecode <id_do_grupo>' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              const groupId = args[0];
              try {
                const code = await groupUtils.getGroupInviteCode(sock, groupId);
                await sock.sendMessage(remoteJid, { text: `Código de convite para o grupo ${groupId}: ${code}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao obter o código de convite: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'revokeinvite': {
              if (!groupUtils.isUserAdmin(remoteJid, senderJid)) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (args.length < 1) {
                await sock.sendMessage(remoteJid, { text: 'Uso: /revokeinvite <id_do_grupo>' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              const groupId = args[0];
              try {
                const code = await groupUtils.revokeGroupInviteCode(sock, groupId);
                await sock.sendMessage(remoteJid, { text: `Código de convite para o grupo ${groupId} revogado. Novo código: ${code}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao revogar o código de convite: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'join': {
              if (args.length < 1) {
                await sock.sendMessage(remoteJid, { text: 'Uso: /join <código_de_convite>' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              const code = args[0];
              try {
                const response = await groupUtils.acceptGroupInvite(sock, code);
                await sock.sendMessage(remoteJid, { text: `Entrou no grupo: ${response}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao entrar no grupo: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'groupinfofrominvite': {
              if (args.length < 1) {
                await sock.sendMessage(remoteJid, { text: 'Uso: /groupinfofrominvite <código_de_convite>' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              const code = args[0];
              try {
                const response = await groupUtils.getGroupInfoFromInvite(sock, code);
                await sock.sendMessage(remoteJid, { text: `Informações do grupo: ${JSON.stringify(response, null, 2)}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao obter informações do grupo: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'groupmetadata': {
              if (!groupUtils.isUserAdmin(remoteJid, senderJid)) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (args.length < 1) {
                await sock.sendMessage(remoteJid, { text: 'Uso: /groupmetadata <id_do_grupo>' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              const groupId = args[0];
              try {
                const metadata = await groupUtils.getGroupMetadata(sock, groupId);
                await sock.sendMessage(remoteJid, { text: `Metadados do grupo: ${JSON.stringify(metadata, null, 2)}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao obter metadados do grupo: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'listrequests': {
              if (!groupUtils.isUserAdmin(remoteJid, senderJid)) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (args.length < 1) {
                await sock.sendMessage(remoteJid, { text: 'Uso: /listrequests <id_do_grupo>' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              const groupId = args[0];
              try {
                const response = await groupUtils.getGroupRequestParticipantsList(sock, groupId);
                await sock.sendMessage(remoteJid, { text: `Solicitações de entrada: ${JSON.stringify(response, null, 2)}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao listar solicitações de entrada: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'updaterequests': {
              if (!groupUtils.isUserAdmin(remoteJid, senderJid)) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (args.length < 3 || !['approve', 'reject'].includes(args[1])) {
                await sock.sendMessage(remoteJid, { text: 'Uso: /updaterequests <id_do_grupo> <approve|reject> <participante1> <participante2>...' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              const groupId = args[0];
              const action = args[1];
              const participants = args.slice(2);
              try {
                const response = await groupUtils.updateGroupRequestParticipants(sock, groupId, participants, action);
                await sock.sendMessage(remoteJid, { text: `Solicitações de entrada atualizadas: ${JSON.stringify(response, null, 2)}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao atualizar solicitações de entrada: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'listgroups': {
              if (!groupUtils.isUserAdmin(remoteJid, senderJid)) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              try {
                const response = await groupUtils.getAllParticipatingGroups(sock);
                await sock.sendMessage(remoteJid, { text: `Grupos participantes: ${JSON.stringify(response, null, 2)}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao listar os grupos: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'toggleephemeral': {
              if (!groupUtils.isUserAdmin(remoteJid, senderJid)) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (args.length < 2) {
                await sock.sendMessage(remoteJid, { text: 'Uso: /toggleephemeral <id_do_grupo> <duração_em_segundos>' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              const groupId = args[0];
              const duration = parseInt(args[1]);
              try {
                await groupUtils.toggleEphemeral(sock, groupId, duration);
                await sock.sendMessage(remoteJid, { text: `Mensagens efêmeras atualizadas para ${duration} segundos.` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao atualizar mensagens efêmeras: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'addmode': {
              if (!groupUtils.isUserAdmin(remoteJid, senderJid)) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (args.length < 2 || !['all_member_add', 'admin_add'].includes(args[1])) {
                await sock.sendMessage(remoteJid, { text: 'Uso: /addmode <id_do_grupo> <all_member_add|admin_add>' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              const groupId = args[0];
              const mode = args[1];
              try {
                await groupUtils.updateGroupAddMode(sock, groupId, mode);
                await sock.sendMessage(remoteJid, { text: `Modo de adição de membros atualizado para ${mode}.` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao atualizar o modo de adição de membros: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            default:
              logger.info(`Comando desconhecido: ${command}`);
              //await sock.sendMessage(remoteJid, { text: 'ℹ️ Nenhum comando configurado encontrado.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              break;
          }
        }
      }
    } catch (error) {
      logger.error('Erro ao processar mensagens:', error.message);
    }
  } else {
    logger.info('🔄 Processando evento recebido:', {
      eventType: update?.type || 'unknown',
      eventData: update,
    });
  }
};

module.exports = {
  handleWhatsAppUpdate,
  extractMessageContent,
};
