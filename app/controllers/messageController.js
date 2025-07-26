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
    return `[Contatos] ${message.contactsArrayArrayMessage.contacts
      .map((c) => c.displayName)
      .join(', ')}`;
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

  const messageTypes = [
    'conversation',
    'viewOnceMessageV2',
    'imageMessage',
    'videoMessage',
    'extendedTextMessage',
    'viewOnceMessage',
    'documentWithCaptionMessage',
    'buttonsMessage',
    'buttonsResponseMessage',
    'listResponseMessage',
    'templateButtonReplyMessage',
    'interactiveResponseMessage',
  ];

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
          const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';

          const getParticipantJids = (messageInfo, args) => {
            const mentionedJids =
              messageInfo.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
            if (mentionedJids.length > 0) {
              return mentionedJids;
            }
            const repliedTo = messageInfo.message?.extendedTextMessage?.contextInfo?.participant;
            if (repliedTo && args.length === 0) {
              return [repliedTo];
            }
            return args.filter((arg) => arg.includes('@s.whatsapp.net'));
          };

          const isUserAdmin = async (groupId, userId) => {
            return groupUtils.isUserAdmin(groupId, userId);
          };

          const isBotAdmin = isGroupMessage ? await isUserAdmin(remoteJid, botJid) : false;

          switch (command) {
            case 'info': {
              let targetGroupId = args[0] || (isGroupMessage ? remoteJid : null);

              if (!targetGroupId) {
                logger.warn('ID do grupo não fornecido para /info em chat privado.');
                await sock.sendMessage(
                  remoteJid,
                  {
                    text: '⚠️ *Por favor, forneça o ID do grupo!\n\nExemplo: `/info 1234567890@g.us`',
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

              const reply =
                `📋 *Informações do Grupo:*\n\n` +
                `🆔 *ID:* ${groupInfo.id}\n` +
                `📝 *Assunto:* ${groupInfo.subject || 'N/A'}\n` +
                `👑 *Proprietário:* ${groupUtils.getGroupOwner(targetGroupId) || 'N/A'}\n` +
                `📅 *Criado em:* ${
                  groupUtils.getGroupCreationTime(targetGroupId)
                    ? new Date(
                        groupUtils.getGroupCreationTime(targetGroupId) * 1000,
                      ).toLocaleString()
                    : 'N/A'
                }\n` +
                `👥 *Tamanho:* ${groupUtils.getGroupSize(targetGroupId) || 'N/A'}\n` +
                `🔒 *Restrito:* ${groupUtils.isGroupRestricted(targetGroupId) ? 'Sim' : 'Não'}\n` +
                `📢 *Somente anúncios:* ${
                  groupUtils.isGroupAnnounceOnly(targetGroupId) ? 'Sim' : 'Não'
                }\n` +
                `🏘️ *Comunidade:* ${groupUtils.isGroupCommunity(targetGroupId) ? 'Sim' : 'Não'}\n` +
                `🗣️ *Descrição:* ${groupUtils.getGroupDescription(targetGroupId) || 'N/A'}\n` +
                `🛡️ *Administradores:* ${
                  groupUtils.getGroupAdmins(targetGroupId).join(', ') || 'Nenhum'
                }\n` +
                `👤 *Total de Participantes:* ${
                  groupUtils.getGroupParticipants(targetGroupId)?.length || 'Nenhum'
                }`;

              await sock.sendMessage(
                remoteJid,
                { text: reply },
                { quoted: messageInfo, ephemeralExpiration: expirationMessage },
              );
              break;
            }

            case 'menuadm': {
              if (!isGroupMessage) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Este comando só pode ser usado em grupos.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Você não tem permissão para usar este comando.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              const menuText = `\n👑 *Menu de Administração de Grupos* 👑\n\n*Comandos para Gerenciamento de Membros:*\n\n👤 */add @user1 @user2...* - Adiciona um ou mais participantes ao grupo.\n👋 */ban @user1 @user2...* - Remove um ou mais participantes do grupo.\n⬆️ */up @user1 @user2...* - Promove um ou mais participantes a administradores.\n⬇️ */down @user1 @user2...* - Remove o cargo de administrador de um ou mais participantes.\n\n*Comandos para Gerenciamento do Grupo:*\n\n📝 */setsubject <novo_assunto>* - Altera o nome do grupo.\nℹ️ */setdesc <nova_descrição>* - Altera a descrição do grupo.\n⚙️ */setgroup <announcement|not_announcement|locked|unlocked>* - Altera as configurações de envio de mensagens e edição de dados do grupo.\n🚪 */leave* - O bot sai do grupo.\n🔗 */invite* - Mostra o código de convite do grupo.\n🔄 */revoke* - Revoga o código de convite do grupo.\n\n*Comandos para Gerenciamento de Solicitações:*\n\n📋 */requests* - Lista as solicitações de entrada no grupo.\n✅ */updaterequests <approve|reject> @user1 @user2...* - Aprova ou rejeita solicitações de entrada.\n\n*Comandos Gerais:*\n\n➕ */newgroup <título> <participante1> <participante2>...* - Cria um novo grupo.\n➡️ */join <código_de_convite>* - Entra em um grupo usando um código de convite.\n🔍 */info [id_do_grupo]* - Mostra informações de um grupo. Se nenhum ID for fornecido, mostra as informações do grupo atual.\n📬 */infofrominvite <código_de_convite>* - Mostra informações de um grupo pelo código de convite.\n📄 */metadata [id_do_grupo]* - Obtém os metadados de um grupo. Se nenhum ID for fornecido, obtém os do grupo atual.\n🌐 */groups* - Lista todos os grupos em que o bot está.\n\n*Outros Comandos:*\n\n⏳ */temp <duração_em_segundos>* - Ativa ou desativa as mensagens efêmeras no grupo.\n🔒 */addmode <all_member_add|admin_add>* - Altera quem pode adicionar novos membros ao grupo.\n    `;
              await sock.sendMessage(
                remoteJid,
                { text: menuText.trim() },
                { quoted: messageInfo, ephemeralExpiration: expirationMessage },
              );
              break;
            }

            case 'newgroup': {
              if (args.length < 2) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Uso: /newgroup <título> <participante1> <participante2>...' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              const title = args[0];
              const participants = args.slice(1);
              try {
                const group = await groupUtils.createGroup(sock, title, participants);
                await sock.sendMessage(
                  remoteJid,
                  { text: `Grupo "${group.subject}" criado com sucesso!` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              } catch (error) {
                await sock.sendMessage(
                  remoteJid,
                  { text: `Erro ao criar o grupo: ${error.message}` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              }
              break;
            }

            case 'add': {
              if (!isGroupMessage) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Este comando só pode ser usado em grupos.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Você não tem permissão para usar este comando.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (!isBotAdmin) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'O bot precisa ser administrador para executar este comando.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              const participants = getParticipantJids(messageInfo, args);
              if (participants.length === 0) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Uso: /add @participante1 @participante2... ou forneça os JIDs.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              try {
                await groupUtils.updateGroupParticipants(sock, remoteJid, participants, 'add');
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Participantes adicionados com sucesso!' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              } catch (error) {
                await sock.sendMessage(
                  remoteJid,
                  { text: `Erro ao adicionar participantes: ${error.message}` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              }
              break;
            }

            case 'ban': {
              if (!isGroupMessage) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Este comando só pode ser usado em grupos.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Você não tem permissão para usar este comando.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (!isBotAdmin) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'O bot precisa ser administrador para executar este comando.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              const participants = getParticipantJids(messageInfo, args);
              if (participants.length === 0) {
                await sock.sendMessage(
                  remoteJid,
                  {
                    text: 'Uso: /ban @participante1 @participante2... ou responda a uma mensagem.',
                  },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (participants.includes(botJid)) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'O bot não pode remover a si mesmo.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              try {
                await groupUtils.updateGroupParticipants(sock, remoteJid, participants, 'remove');
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Participantes removidos com sucesso!' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                const repliedTo = messageInfo.message?.extendedTextMessage?.contextInfo;
                if (repliedTo && participants.includes(repliedTo.participant)) {
                  const key = {
                    remoteJid: remoteJid,
                    fromMe: false,
                    id: repliedTo.stanzaId,
                    participant: repliedTo.participant,
                  };
                  await sock.sendMessage(remoteJid, {
                    delete: messageInfo.message?.extendedTextMessage?.contextInfo?.key,
                  });
                }
              } catch (error) {
                await sock.sendMessage(
                  remoteJid,
                  { text: `Erro ao remover participantes: ${error.message}` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              }
              break;
            }

            case 'up': {
              if (!isGroupMessage) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Este comando só pode ser usado em grupos.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Você não tem permissão para usar este comando.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (!isBotAdmin) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'O bot precisa ser administrador para executar este comando.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              const participants = getParticipantJids(messageInfo, args);
              if (participants.length === 0) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Uso: /up @participante1 @participante2... ou forneça os JIDs.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (participants.includes(botJid)) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'O bot não pode promover a si mesmo.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              try {
                await groupUtils.updateGroupParticipants(sock, remoteJid, participants, 'promote');
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Participantes promovidos a administradores com sucesso!' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              } catch (error) {
                await sock.sendMessage(
                  remoteJid,
                  { text: `Erro ao promover participantes: ${error.message}` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              }
              break;
            }

            case 'down': {
              if (!isGroupMessage) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Este comando só pode ser usado em grupos.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Você não tem permissão para usar este comando.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (!isBotAdmin) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'O bot precisa ser administrador para executar este comando.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              const participants = getParticipantJids(messageInfo, args);
              if (participants.length === 0) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Uso: /down @participante1 @participante2... ou forneça os JIDs.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (participants.includes(botJid)) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'O bot não pode rebaixar a si mesmo.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              try {
                await groupUtils.updateGroupParticipants(sock, remoteJid, participants, 'demote');
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Administradores demovidos a participantes com sucesso!' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              } catch (error) {
                await sock.sendMessage(
                  remoteJid,
                  { text: `Erro ao demoter administradores: ${error.message}` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              }
              break;
            }

            case 'setsubject': {
              if (!isGroupMessage) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Este comando só pode ser usado em grupos.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Você não tem permissão para usar este comando.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (!isBotAdmin) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'O bot precisa ser administrador para executar este comando.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (args.length < 1) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Uso: /setsubject <novo_assunto>' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              const newSubject = args.join(' ');
              try {
                await groupUtils.updateGroupSubject(sock, remoteJid, newSubject);
                await sock.sendMessage(
                  remoteJid,
                  { text: `Assunto do grupo alterado para "${newSubject}" com sucesso!` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              } catch (error) {
                await sock.sendMessage(
                  remoteJid,
                  { text: `Erro ao alterar o assunto do grupo: ${error.message}` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              }
              break;
            }

            case 'setdesc': {
              if (!isGroupMessage) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Este comando só pode ser usado em grupos.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Você não tem permissão para usar este comando.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (!isBotAdmin) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'O bot precisa ser administrador para executar este comando.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (args.length < 1) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Uso: /setdesc <nova_descrição>' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              const newDescription = args.join(' ');
              try {
                await groupUtils.updateGroupDescription(sock, remoteJid, newDescription);
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Descrição do grupo alterada com sucesso!' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              } catch (error) {
                await sock.sendMessage(
                  remoteJid,
                  { text: `Erro ao alterar a descrição do grupo: ${error.message}` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              }
              break;
            }

            case 'setgroup': {
              if (!isGroupMessage) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Este comando só pode ser usado em grupos.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Você não tem permissão para usar este comando.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (!isBotAdmin) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'O bot precisa ser administrador para executar este comando.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (
                args.length < 1 ||
                !['announcement', 'not_announcement', 'locked', 'unlocked'].includes(args[0])
              ) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Uso: /setgroup <announcement|not_announcement|locked|unlocked>' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              const setting = args[0];
              try {
                await groupUtils.updateGroupSettings(sock, remoteJid, setting);
                await sock.sendMessage(
                  remoteJid,
                  { text: `Configuração do grupo alterada para "${setting}" com sucesso!` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              } catch (error) {
                await sock.sendMessage(
                  remoteJid,
                  { text: `Erro ao alterar a configuração do grupo: ${error.message}` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              }
              break;
            }

            case 'leave': {
              if (!isGroupMessage) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Este comando só pode ser usado em grupos.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Você não tem permissão para usar este comando.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              try {
                await groupUtils.leaveGroup(sock, remoteJid);
                await sock.sendMessage(
                  remoteJid,
                  { text: `Saí do grupo ${remoteJid} com sucesso.` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              } catch (error) {
                await sock.sendMessage(
                  remoteJid,
                  { text: `Erro ao sair do grupo: ${error.message}` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              }
              break;
            }

            case 'invite': {
              if (!isGroupMessage) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Este comando só pode ser usado em grupos.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Você não tem permissão para usar este comando.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (!isBotAdmin) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'O bot precisa ser administrador para executar este comando.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              try {
                const code = await groupUtils.getGroupInviteCode(sock, remoteJid);
                await sock.sendMessage(
                  remoteJid,
                  { text: `Código de convite para o grupo: ${code}` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              } catch (error) {
                await sock.sendMessage(
                  remoteJid,
                  { text: `Erro ao obter o código de convite: ${error.message}` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              }
              break;
            }

            case 'revoke': {
              if (!isGroupMessage) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Este comando só pode ser usado em grupos.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Você não tem permissão para usar este comando.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (!isBotAdmin) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'O bot precisa ser administrador para executar este comando.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              try {
                const code = await groupUtils.revokeGroupInviteCode(sock, remoteJid);
                await sock.sendMessage(
                  remoteJid,
                  { text: `Código de convite revogado. Novo código: ${code}` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              } catch (error) {
                await sock.sendMessage(
                  remoteJid,
                  { text: `Erro ao revogar o código de convite: ${error.message}` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              }
              break;
            }

            case 'join': {
              if (args.length < 1) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Uso: /join <código_de_convite>' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              const code = args[0];
              try {
                const response = await groupUtils.acceptGroupInvite(sock, code);
                await sock.sendMessage(
                  remoteJid,
                  { text: `Entrou no grupo: ${response}` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              } catch (error) {
                await sock.sendMessage(
                  remoteJid,
                  { text: `Erro ao entrar no grupo: ${error.message}` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              }
              break;
            }

            case 'infofrominvite': {
              if (args.length < 1) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Uso: /infofrominvite <código_de_convite>' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              const code = args[0];
              try {
                const response = await groupUtils.getGroupInfoFromInvite(sock, code);
                await sock.sendMessage(
                  remoteJid,
                  { text: `Informações do grupo: ${JSON.stringify(response, null, 2)}` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              } catch (error) {
                await sock.sendMessage(
                  remoteJid,
                  { text: `Erro ao obter informações do grupo: ${error.message}` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              }
              break;
            }

            case 'metadata': {
              let groupId = args[0] || remoteJid;
              if (!(await isUserAdmin(groupId, senderJid))) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Você não tem permissão para usar este comando.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              try {
                const metadata = groupUtils.getGroupInfo(groupId);
                await sock.sendMessage(
                  remoteJid,
                  { text: `Metadados do grupo: ${JSON.stringify(metadata, null, 2)}` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              } catch (error) {
                await sock.sendMessage(
                  remoteJid,
                  { text: `Erro ao obter metadados do grupo: ${error.message}` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              }
              break;
            }

            case 'requests': {
              if (!isGroupMessage) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Este comando só pode ser usado em grupos.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Você não tem permissão para usar este comando.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (!isBotAdmin) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'O bot precisa ser administrador para executar este comando.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              try {
                const response = await groupUtils.getGroupRequestParticipantsList(sock, remoteJid);
                await sock.sendMessage(
                  remoteJid,
                  { text: `Solicitações de entrada: ${JSON.stringify(response, null, 2)}` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              } catch (error) {
                await sock.sendMessage(
                  remoteJid,
                  { text: `Erro ao listar solicitações de entrada: ${error.message}` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              }
              break;
            }

            case 'updaterequests': {
              if (!isGroupMessage) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Este comando só pode ser usado em grupos.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Você não tem permissão para usar este comando.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (!isBotAdmin) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'O bot precisa ser administrador para executar este comando.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (args.length < 1 || !['approve', 'reject'].includes(args[0])) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Uso: /updaterequests <approve|reject> @participante1...' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              const action = args[0];
              const participants = getParticipantJids(messageInfo, args.slice(1));
              if (participants.length === 0) {
                await sock.sendMessage(
                  remoteJid,
                  {
                    text: 'Uso: /updaterequests <approve|reject> @participante1... (mencione os usuários)',
                  },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              try {
                const response = await groupUtils.updateGroupRequestParticipants(
                  sock,
                  remoteJid,
                  participants,
                  action,
                );
                await sock.sendMessage(
                  remoteJid,
                  {
                    text: `Solicitações de entrada atualizadas: ${JSON.stringify(
                      response,
                      null,
                      2,
                    )}`,
                  },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              } catch (error) {
                await sock.sendMessage(
                  remoteJid,
                  { text: `Erro ao atualizar solicitações de entrada: ${error.message}` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              }
              break;
            }

            case 'groups': {
              try {
                const response = groupUtils.getAllGroupIds();
                await sock.sendMessage(
                  remoteJid,
                  { text: `Grupos participantes: ${JSON.stringify(response, null, 2)}` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              } catch (error) {
                await sock.sendMessage(
                  remoteJid,
                  { text: `Erro ao listar os grupos: ${error.message}` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              }
              break;
            }

            case 'temp': {
              if (!isGroupMessage) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Este comando só pode ser usado em grupos.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Você não tem permissão para usar este comando.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (!isBotAdmin) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'O bot precisa ser administrador para executar este comando.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (args.length < 1) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Uso: /temp <duração_em_segundos>' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              const duration = parseInt(args[0]);
              try {
                await groupUtils.toggleEphemeral(sock, remoteJid, duration);
                await sock.sendMessage(
                  remoteJid,
                  { text: `Mensagens efêmeras atualizadas para ${duration} segundos.` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              } catch (error) {
                await sock.sendMessage(
                  remoteJid,
                  { text: `Erro ao atualizar mensagens efêmeras: ${error.message}` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              }
              break;
            }

            case 'addmode': {
              if (!isGroupMessage) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Este comando só pode ser usado em grupos.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Você não tem permissão para usar este comando.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (!isBotAdmin) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'O bot precisa ser administrador para executar este comando.' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              if (args.length < 1 || !['all_member_add', 'admin_add'].includes(args[0])) {
                await sock.sendMessage(
                  remoteJid,
                  { text: 'Uso: /addmode <all_member_add|admin_add>' },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
                break;
              }
              const mode = args[0];
              try {
                await groupUtils.updateGroupAddMode(sock, remoteJid, mode);
                await sock.sendMessage(
                  remoteJid,
                  { text: `Modo de adição de membros atualizado para ${mode}.` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              } catch (error) {
                await sock.sendMessage(
                  remoteJid,
                  { text: `Erro ao atualizar o modo de adição de membros: ${error.message}` },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
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
