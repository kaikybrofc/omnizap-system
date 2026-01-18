require('dotenv').config();
const { handleMenuCommand, handleMenuAdmCommand } = require('../modules/menuModule/menus');
const { processSticker } = require('../modules/stickerModule/stickerCommand');
const { getExpiration } = require('../config/baileysConfig');
const groupUtils = require('../utils/groupUtils');
const dataStore = require('../store/dataStore');
const groupConfigStore = require('../store/groupConfigStore');
const { downloadMediaMessage } = require('../utils/mediaDownloader/mediaDownloaderModule');
const logger = require('../utils/logger/loggerModule');
const COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';

/**
 * Extrai o conteúdo de texto de uma mensagem do WhatsApp.
 * @param {Object} messageInfo
 * @returns {string}
 */
const extractMessageContent = ({ message }) => {
  if (!message) return 'Mensagem vazia';

  const text = message.conversation?.trim() || message.extendedTextMessage?.text;

  if (text) return text;

  const handlers = [
    [message.imageMessage, (m) => m.caption || '[Imagem]'],
    [message.videoMessage, (m) => m.caption || '[Vídeo]'],
    [message.documentMessage, (m) => m.fileName || '[Documento]'],
    [message.audioMessage, () => '[Áudio]'],
    [message.stickerMessage, () => '[Figurinha]'],
    [message.locationMessage, (m) => `[Localização] Lat: ${m.degreesLatitude}, Long: ${m.degreesLongitude}`],
    [message.contactMessage, (m) => `[Contato] ${m.displayName}`],
    [message.contactsArrayMessage, (m) => `[Contatos] ${m.contacts.map((c) => c.displayName).join(', ')}`],
    [message.listMessage, (m) => m.description || '[Mensagem de Lista]'],
    [message.buttonsMessage, (m) => m.contentText || '[Mensagem de Botões]'],
    [message.templateButtonReplyMessage, (m) => `[Resposta de Botão] ${m.selectedDisplayText}`],
    [message.productMessage, (m) => m.product?.title || '[Mensagem de Produto]'],
    [message.reactionMessage, (m) => `[Reação] ${m.text}`],
    [message.pollCreationMessage, (m) => `[Enquete] ${m.name}`],
  ];

  for (const [msg, fn] of handlers) {
    if (msg) return fn(msg);
  }

  return 'Tipo de mensagem não suportado ou sem conteúdo.';
};

/**
 * Lida com atualizações do WhatsApp, sejam mensagens ou eventos genéricos.
 *
 * @param {Object} update - Objeto contendo a atualização do WhatsApp.
 */
const handleMessages = async (update, sock) => {
  if (update.messages && Array.isArray(update.messages)) {
    try {
      for (const messageInfo of update.messages) {
        const extractedText = extractMessageContent(messageInfo);
        const remoteJid = messageInfo.key.remoteJid;
        const isGroupMessage = remoteJid.endsWith('@g.us');
        const senderJid = isGroupMessage ? messageInfo.key.participant : remoteJid;
        const senderName = messageInfo.pushName;
        const expirationMessage = getExpiration(messageInfo);
        const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';

        // Antilink Feature
        if (isGroupMessage) {
          const groupConfig = groupConfigStore.getGroupConfig(remoteJid);
          if (groupConfig && groupConfig.antilinkEnabled) {
            let linkFound = false;

            // Primary verification (Regex for common patterns)
            const primaryRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(chat\.whatsapp\.com\/[A-Za-z0-9]+)/gi;
            if (primaryRegex.test(extractedText)) {
              linkFound = true;
            }

            // Secondary verification for domain-like words (e.g., example.com)
            if (!linkFound) {
              const tlds = ['com', 'net', 'org', 'gov', 'edu', 'biz', 'info', 'io', 'co', 'app', 'xyz', 'br', 'pt', 'us', 'uk', 'de', 'jp', 'fr', 'au', 'ca', 'cn', 'ru', 'in'];
              const secondaryRegex = new RegExp(`\\b[a-zA-Z0-9-]+\\.(${tlds.join('|')})\\b`, 'i');
              if (secondaryRegex.test(extractedText)) {
                linkFound = true;
              }
            }

            if (linkFound) {
              const isAdmin = await groupUtils.isUserAdmin(remoteJid, senderJid);
              const senderIsBot = senderJid === botJid;

              if (!isAdmin && !senderIsBot) {
                try {
                  await groupUtils.updateGroupParticipants(sock, remoteJid, [senderJid], 'remove');
                  await sock.sendMessage(remoteJid, { text: `🚫 @${senderJid.split('@')[0]} foi removido por enviar um link.`, mentions: [senderJid] });
                  await sock.sendMessage(remoteJid, { delete: messageInfo.key });

                  logger.info(`Usuário ${senderJid} removido do grupo ${remoteJid} por enviar link.`, {
                    action: 'antilink_remove',
                    groupId: remoteJid,
                    userId: senderJid,
                  });

                  continue; // Skip further processing
                } catch (error) {
                  logger.error(`Falha ao remover usuário com antilink: ${error.message}`, {
                    action: 'antilink_error',
                    groupId: remoteJid,
                    userId: senderJid,
                    error: error.stack,
                  });
                }
              } else if (isAdmin && !senderIsBot) {
                try {
                  await sock.sendMessage(remoteJid, { text: `ⓘ @${senderJid.split('@')[0]} (admin) enviou um link.`, mentions: [senderJid] });
                  logger.info(`Admin ${senderJid} enviou um link no grupo ${remoteJid} (aviso enviado).`, {
                    action: 'antilink_admin_link_detected',
                    groupId: remoteJid,
                    userId: senderJid,
                  });
                } catch (error) {
                  logger.error(`Falha ao enviar aviso de link de admin: ${error.message}`, {
                    action: 'antilink_admin_warning_error',
                    groupId: remoteJid,
                    userId: senderJid,
                    error: error.stack,
                  });
                }
              }
            }
          }
        }

        if (extractedText.startsWith(COMMAND_PREFIX)) {
          const commandBody = extractedText.substring(COMMAND_PREFIX.length);
          const match = commandBody.match(/^(\S+)([\s\S]*)$/);
          const command = match ? match[1].toLowerCase() : '';
          const args = match && match[2] !== undefined ? [match[2].trimStart()] : [];
          const text = match && match[2] !== undefined ? match[2] : '';

          const getParticipantJids = (messageInfo, args) => {
            const mentionedJids = messageInfo.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
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

          const isUserMod = (senderJid) => senderJid === process.env.USER_ADMIN;

          switch (command) {
            case 'menu': {
              await handleMenuCommand(sock, remoteJid, messageInfo, expirationMessage, senderName, COMMAND_PREFIX);
              break;
            }

            case 'sticker':
            case 's':
              processSticker(sock, messageInfo, senderJid, remoteJid, expirationMessage, senderName, args.join(' '));
              break;

            case 'menuadm': {
              if (!isGroupMessage) {
                await sock.sendMessage(remoteJid, { text: 'Este comando só pode ser usado em grupos.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              await handleMenuAdmCommand(sock, remoteJid, messageInfo, expirationMessage);
              break;
            }

            case 'newgroup': {
              if (args.length < 2) {
                await sock.sendMessage(remoteJid, { text: 'Uso: /newgroup <título> <participante1> <participante2>...' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              const title = args[0];
              const participants = args.slice(1);
              try {
                const group = await groupUtils.createGroup(sock, title, participants);
                await sock.sendMessage(remoteJid, { text: `Grupo \"${group.subject}\" criado com sucesso!` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao criar o grupo: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'add': {
              if (!isGroupMessage) {
                await sock.sendMessage(remoteJid, { text: 'Este comando só pode ser usado em grupos.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }

              const participants = getParticipantJids(messageInfo, args);
              if (participants.length === 0) {
                await sock.sendMessage(remoteJid, { text: 'Uso: /add @participante1 @participante2... ou forneça os JIDs.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              try {
                await groupUtils.updateGroupParticipants(sock, remoteJid, participants, 'add');
                await sock.sendMessage(remoteJid, { text: 'Participantes adicionados com sucesso!' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao adicionar participantes: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'ban': {
              if (!isGroupMessage) {
                await sock.sendMessage(remoteJid, { text: 'Este comando só pode ser usado em grupos.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
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
                await sock.sendMessage(remoteJid, { text: 'O bot não pode remover a si mesmo.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              try {
                await groupUtils.updateGroupParticipants(sock, remoteJid, participants, 'remove');
                await sock.sendMessage(remoteJid, { text: 'Participantes removidos com sucesso!' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
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
                await sock.sendMessage(remoteJid, { text: `Erro ao remover participantes: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'up': {
              if (!isGroupMessage) {
                await sock.sendMessage(remoteJid, { text: 'Este comando só pode ser usado em grupos.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }

              const participants = getParticipantJids(messageInfo, args);
              if (participants.length === 0) {
                await sock.sendMessage(remoteJid, { text: 'Uso: /up @participante1 @participante2... ou forneça os JIDs.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (participants.includes(botJid)) {
                await sock.sendMessage(remoteJid, { text: 'O bot não pode promover a si mesmo.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              try {
                await groupUtils.updateGroupParticipants(sock, remoteJid, participants, 'promote');
                await sock.sendMessage(remoteJid, { text: 'Participantes promovidos a administradores com sucesso!' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao promover participantes: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'down': {
              if (!isGroupMessage) {
                await sock.sendMessage(remoteJid, { text: 'Este comando só pode ser usado em grupos.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }

              const participants = getParticipantJids(messageInfo, args);
              if (participants.length === 0) {
                await sock.sendMessage(remoteJid, { text: 'Uso: /down @participante1 @participante2... ou forneça os JIDs.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (participants.includes(botJid)) {
                await sock.sendMessage(remoteJid, { text: 'O bot não pode rebaixar a si mesmo.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              try {
                await groupUtils.updateGroupParticipants(sock, remoteJid, participants, 'demote');
                await sock.sendMessage(remoteJid, { text: 'Administradores demovidos a participantes com sucesso!' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao demoter administradores: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'setsubject': {
              if (!isGroupMessage) {
                await sock.sendMessage(remoteJid, { text: 'Este comando só pode ser usado em grupos.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }

              if (args.length < 1) {
                await sock.sendMessage(remoteJid, { text: 'Uso: /setsubject <novo_assunto>' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              const newSubject = args.join(' ');
              try {
                await groupUtils.updateGroupSubject(sock, remoteJid, newSubject);
                await sock.sendMessage(remoteJid, { text: `Assunto do grupo alterado para \"${newSubject}\" com sucesso!` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao alterar o assunto do grupo: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'setdesc': {
              if (!isGroupMessage) {
                await sock.sendMessage(remoteJid, { text: 'Este comando só pode ser usado em grupos.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }

              if (args.length < 1) {
                await sock.sendMessage(remoteJid, { text: 'Uso: /setdesc <nova_descrição>' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              const newDescription = args.join(' ');
              try {
                await groupUtils.updateGroupDescription(sock, remoteJid, newDescription);
                await sock.sendMessage(remoteJid, { text: 'Descrição do grupo alterada com sucesso!' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao alterar a descrição do grupo: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'setgroup': {
              if (!isGroupMessage) {
                await sock.sendMessage(remoteJid, { text: 'Este comando só pode ser usado em grupos.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }

              if (args.length < 1 || !['announcement', 'not_announcement', 'locked', 'unlocked'].includes(args[0])) {
                await sock.sendMessage(remoteJid, { text: 'Uso: /setgroup <announcement|not_announcement|locked|unlocked>' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              const setting = args[0];
              try {
                await groupUtils.updateGroupSettings(sock, remoteJid, setting);
                await sock.sendMessage(remoteJid, { text: `Configuração do grupo alterada para \"${setting}\" com sucesso!` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao alterar a configuração do grupo: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'leave': {
              if (!isGroupMessage) {
                await sock.sendMessage(remoteJid, { text: 'Este comando só pode ser usado em grupos.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              try {
                await groupUtils.leaveGroup(sock, remoteJid);
                await sock.sendMessage(remoteJid, { text: `Saí do grupo ${remoteJid} com sucesso.` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao sair do grupo: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'invite': {
              if (!isGroupMessage) {
                await sock.sendMessage(remoteJid, { text: 'Este comando só pode ser usado em grupos.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }

              try {
                const code = await groupUtils.getGroupInviteCode(sock, remoteJid);
                await sock.sendMessage(remoteJid, { text: `Código de convite para o grupo: ${code}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao obter o código de convite: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'revoke': {
              if (!isGroupMessage) {
                await sock.sendMessage(remoteJid, { text: 'Este comando só pode ser usado em grupos.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }

              try {
                const code = await groupUtils.revokeGroupInviteCode(sock, remoteJid);
                await sock.sendMessage(remoteJid, { text: `Código de convite revogado. Novo código: ${code}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
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

            case 'infofrominvite': {
              if (args.length < 1) {
                await sock.sendMessage(remoteJid, { text: 'Uso: /infofrominvite <código_de_convite>' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
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

            case 'metadata': {
              let groupId = args[0] || remoteJid;
              if (!(await isUserAdmin(groupId, senderJid))) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              try {
                const metadata = groupUtils.getGroupInfo(groupId);
                await sock.sendMessage(remoteJid, { text: `Metadados do grupo: ${JSON.stringify(metadata, null, 2)}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao obter metadados do grupo: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'requests': {
              if (!isGroupMessage) {
                await sock.sendMessage(remoteJid, { text: 'Este comando só pode ser usado em grupos.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }

              try {
                const response = await groupUtils.getGroupRequestParticipantsList(sock, remoteJid);
                await sock.sendMessage(remoteJid, { text: `Solicitações de entrada: ${JSON.stringify(response, null, 2)}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao listar solicitações de entrada: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'updaterequests': {
              if (!isGroupMessage) {
                await sock.sendMessage(remoteJid, { text: 'Este comando só pode ser usado em grupos.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }

              if (args.length < 1 || !['approve', 'reject'].includes(args[0])) {
                await sock.sendMessage(remoteJid, { text: 'Uso: /updaterequests <approve|reject> @participante1...' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
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
                const response = await groupUtils.updateGroupRequestParticipants(sock, remoteJid, participants, action);
                await sock.sendMessage(
                  remoteJid,
                  {
                    text: `Solicitações de entrada atualizadas: ${JSON.stringify(response, null, 2)}`,
                  },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                );
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao atualizar solicitações de entrada: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            /*   
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
              */

            case 'temp': {
              if (!isGroupMessage) {
                await sock.sendMessage(remoteJid, { text: 'Este comando só pode ser usado em grupos.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }

              if (args.length < 1) {
                await sock.sendMessage(remoteJid, { text: 'Uso: /temp <duração_em_segundos>' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              const duration = parseInt(args[0]);
              try {
                await groupUtils.toggleEphemeral(sock, remoteJid, duration);
                await sock.sendMessage(remoteJid, { text: `Mensagens efêmeras atualizadas para ${duration} segundos.` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao atualizar mensagens efêmeras: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'addmode': {
              if (!isGroupMessage) {
                await sock.sendMessage(remoteJid, { text: 'Este comando só pode ser usado em grupos.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }

              if (args.length < 1 || !['all_member_add', 'admin_add'].includes(args[0])) {
                await sock.sendMessage(remoteJid, { text: 'Uso: /addmode <all_member_add|admin_add>' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              const mode = args[0];
              try {
                await groupUtils.updateGroupAddMode(sock, remoteJid, mode);
                await sock.sendMessage(remoteJid, { text: `Modo de adição de membros atualizado para ${mode}.` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao atualizar o modo de adição de membros: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'welcome': {
              if (!isGroupMessage) {
                await sock.sendMessage(remoteJid, { text: 'Este comando só pode ser usado em grupos.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }

              const subCommandMatch = text.trimStart().match(/^(\S+)([\s\S]*)$/);
              const subCommand = subCommandMatch ? subCommandMatch[1].toLowerCase() : '';
              const messageOrPath = subCommandMatch ? subCommandMatch[2].trimStart() : '';

              if (!subCommand || !['on', 'off', 'set'].includes(subCommand)) {
                await sock.sendMessage(remoteJid, { text: 'Uso: /welcome <on|off|set> [mensagem ou caminho da mídia]' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }

              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              const currentConfig = groupConfigStore.getGroupConfig(remoteJid);

              try {
                if (subCommand === 'on') {
                  groupConfigStore.updateGroupConfig(remoteJid, { welcomeMessageEnabled: true });
                  await sock.sendMessage(remoteJid, { text: 'Mensagens de boas-vindas ativadas para este grupo.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                } else if (subCommand === 'off') {
                  groupConfigStore.updateGroupConfig(remoteJid, { welcomeMessageEnabled: false });
                  await sock.sendMessage(remoteJid, { text: 'Mensagens de boas-vindas desativadas para este grupo.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                } else if (subCommand === 'set') {
                  if (!messageOrPath && !(messageInfo.message.imageMessage || messageInfo.message.videoMessage)) {
                    await sock.sendMessage(
                      remoteJid,
                      {
                        text: 'Uso: /welcome set <mensagem ou caminho da mídia> ou envie uma mídia com o comando.',
                      },
                      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                    );
                    break;
                  }

                  const quotedMessage = messageInfo.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                  let mediaToDownload = null;
                  let mediaType = null;

                  if (messageInfo.message.imageMessage) {
                    mediaToDownload = messageInfo.message.imageMessage;
                    mediaType = 'image';
                  } else if (messageInfo.message.videoMessage) {
                    mediaToDownload = messageInfo.message.videoMessage;
                    mediaType = 'video';
                  } else if (quotedMessage) {
                    if (quotedMessage.imageMessage) {
                      mediaToDownload = quotedMessage.imageMessage;
                      mediaType = 'image';
                    } else if (quotedMessage.videoMessage) {
                      mediaToDownload = quotedMessage.videoMessage;
                      mediaType = 'video';
                    }
                  }

                  if (mediaToDownload) {
                    const downloadedMediaPath = await downloadMediaMessage(mediaToDownload, mediaType, './temp');
                    if (downloadedMediaPath) {
                      groupConfigStore.updateGroupConfig(remoteJid, {
                        welcomeMedia: downloadedMediaPath,
                      });
                      await sock.sendMessage(remoteJid, { text: `Mídia de boas-vindas definida para: ${downloadedMediaPath}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                    } else {
                      await sock.sendMessage(remoteJid, { text: 'Erro ao baixar a mídia. Por favor, tente novamente.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                    }
                  } else if (messageOrPath.startsWith('/') || messageOrPath.startsWith('.') || messageOrPath.startsWith('~')) {
                    groupConfigStore.updateGroupConfig(remoteJid, {
                      welcomeMedia: messageOrPath,
                    });
                    await sock.sendMessage(remoteJid, { text: `Mídia de boas-vindas definida para: ${messageOrPath}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                  } else {
                    groupConfigStore.updateGroupConfig(remoteJid, {
                      welcomeMessage: messageOrPath,
                    });
                    await sock.sendMessage(remoteJid, { text: `Mensagem de boas-vindas definida para: ${messageOrPath}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                  }
                }
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao configurar mensagens de boas-vindas: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'farewell': {
              if (!isGroupMessage) {
                await sock.sendMessage(remoteJid, { text: 'Este comando só pode ser usado em grupos.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              const subCommandMatch = text.trimStart().match(/^(\S+)([\s\S]*)$/);
              const subCommand = subCommandMatch ? subCommandMatch[1].toLowerCase() : '';
              const messageOrPath = subCommandMatch ? subCommandMatch[2].trimStart() : '';
              const currentConfig = groupConfigStore.getGroupConfig(remoteJid);

              if (!subCommand || !['on', 'off', 'set'].includes(subCommand)) {
                await sock.sendMessage(remoteJid, { text: 'Uso: /farewell <on|off|set> [mensagem ou caminho da mídia]' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }

              try {
                if (subCommand === 'on') {
                  groupConfigStore.updateGroupConfig(remoteJid, { farewellMessageEnabled: true });
                  await sock.sendMessage(remoteJid, { text: 'Mensagens de saída ativadas para este grupo.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                } else if (subCommand === 'off') {
                  groupConfigStore.updateGroupConfig(remoteJid, { farewellMessageEnabled: false });
                  await sock.sendMessage(remoteJid, { text: 'Mensagens de saída desativadas para este grupo.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                } else if (subCommand === 'set') {
                  if (!messageOrPath && !(messageInfo.message.imageMessage || messageInfo.message.videoMessage)) {
                    await sock.sendMessage(
                      remoteJid,
                      {
                        text: 'Uso: /farewell set <mensagem ou caminho da mídia> ou envie uma mídia com o comando.',
                      },
                      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                    );
                    break;
                  }

                  const quotedMessage = messageInfo.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                  let mediaToDownload = null;
                  let mediaType = null;

                  if (messageInfo.message.imageMessage) {
                    mediaToDownload = messageInfo.message.imageMessage;
                    mediaType = 'image';
                  } else if (messageInfo.message.videoMessage) {
                    mediaToDownload = messageInfo.message.videoMessage;
                    mediaType = 'video';
                  } else if (quotedMessage) {
                    if (quotedMessage.imageMessage) {
                      mediaToDownload = quotedMessage.imageMessage;
                      mediaType = 'image';
                    } else if (quotedMessage.videoMessage) {
                      mediaToDownload = quotedMessage.videoMessage;
                      mediaType = 'video';
                    }
                  }

                  if (mediaToDownload) {
                    const downloadedMediaPath = await downloadMediaMessage(mediaToDownload, mediaType, './temp');
                    if (downloadedMediaPath) {
                      groupConfigStore.updateGroupConfig(remoteJid, {
                        farewellMedia: downloadedMediaPath,
                      });
                      await sock.sendMessage(remoteJid, { text: `Mídia de saída definida para: ${downloadedMediaPath}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                    } else {
                      await sock.sendMessage(remoteJid, { text: 'Erro ao baixar a mídia. Por favor, tente novamente.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                    }
                  } else if (messageOrPath.startsWith('/') || messageOrPath.startsWith('.') || messageOrPath.startsWith('~')) {
                    groupConfigStore.updateGroupConfig(remoteJid, {
                      farewellMedia: messageOrPath,
                    });
                    await sock.sendMessage(remoteJid, { text: `Mídia de saída definida para: ${messageOrPath}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                  } else {
                    groupConfigStore.updateGroupConfig(remoteJid, {
                      farewellMessage: messageOrPath,
                    });
                    await sock.sendMessage(remoteJid, { text: `Mensagem de saída definida para: ${messageOrPath}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                  }
                }
              } catch (error) {
                await sock.sendMessage(remoteJid, { text: `Erro ao configurar mensagens de saída: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            case 'antilink': {
              if (!isGroupMessage) {
                await sock.sendMessage(remoteJid, { text: 'Este comando só pode ser usado em grupos.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }
              if (!(await isUserAdmin(remoteJid, senderJid))) {
                await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }

              const subCommand = args[0] ? args[0].toLowerCase() : '';

              if (!['on', 'off'].includes(subCommand)) {
                const currentConfig = groupConfigStore.getGroupConfig(remoteJid);
                const status = currentConfig.antilinkEnabled ? 'ativado' : 'desativado';
                await sock.sendMessage(remoteJid, { text: `Uso: /antilink <on|off>\n\nO antilink está atualmente ${status}.` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
                break;
              }

              try {
                const isEnabled = subCommand === 'on';
                groupConfigStore.updateGroupConfig(remoteJid, { antilinkEnabled: isEnabled });
                await sock.sendMessage(remoteJid, { text: `✅ Antilink foi ${isEnabled ? 'ativado' : 'desativado'} para este grupo.` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              } catch (error) {
                logger.error('Erro ao configurar o antilink:', { error: error.message, groupId: remoteJid });
                await sock.sendMessage(remoteJid, { text: `Erro ao configurar o antilink: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
              }
              break;
            }

            default:
              logger.info(`Comando desconhecido recebido: ${command}`);

              await sock.sendMessage(
                remoteJid,
                {
                  text: `❌ *Comando não reconhecido*

O comando *${command}* não está configurado ou ainda não existe.

ℹ️ *Dica:*  
Digite *${COMMAND_PREFIX}menu* para ver a lista de comandos disponíveis.

🚧 *Fase Beta*  
O omnizap-system ainda está em desenvolvimento e novos comandos estão sendo adicionados constantemente.

📩 *Contato do Desenvolvedor*  
• Instagram: *@kaikybrofc*  
• WhatsApp: +55 95 99112-2954`,
                },
                {
                  quoted: messageInfo,
                  ephemeralExpiration: expirationMessage,
                },
              );

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
  handleMessages,
  extractMessageContent,
};
