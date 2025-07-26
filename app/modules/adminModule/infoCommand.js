const groupUtils = require('../../utils/groupUtils');
const logger = require('../../utils/logger/loggerModule');
const store = require('../../store/dataStore');

const handleInfoCommand = async (sock, messageInfo, args, isGroupMessage, remoteJid, expirationMessage) => {
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
        return;
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
        return;
    }

    const mentions = [];
    let ownerText = 'N/A';
    const ownerJid = groupUtils.getGroupOwner(targetGroupId);
    if (ownerJid) {
        ownerText = `@${ownerJid.split('@')[0]}`;
        mentions.push(ownerJid);
    }

    let adminsText = 'Nenhum';
    const adminJids = groupUtils.getGroupAdmins(targetGroupId);
    if (adminJids && adminJids.length > 0) {
        adminsText = adminJids.map(jid => {
            mentions.push(jid);
            return `@${jid.split('@')[0]}`;
        }).join(', ');
    }

    let reply =
        `📋 *Informações do Grupo:*\n\n` +
        `🆔 *ID:* ${groupInfo.id.split('@')[0]}\n` +
        `📝 *Assunto:* ${groupInfo.subject || 'N/A'}\n` +
        `👑 *Proprietário:* ${ownerText}\n` +
        `📅 *Criado em:* ${groupUtils.getGroupCreationTime(targetGroupId)
            ? new Date(
                groupUtils.getGroupCreationTime(targetGroupId) * 1000,
            ).toLocaleString()
            : 'N/A'
        }\n` +
        `👥 *Tamanho:* ${groupUtils.getGroupSize(targetGroupId) || 'N/A'}\n` +
        `🔒 *Restrito:* ${groupUtils.isGroupRestricted(targetGroupId) ? 'Sim' : 'Não'}\n` +
        `📢 *Somente anúncios:* ${groupUtils.isGroupAnnounceOnly(targetGroupId) ? 'Sim' : 'Não'
        }\n` +
        `🏘️ *Comunidade:* ${groupUtils.isGroupCommunity(targetGroupId) ? 'Sim' : 'Não'}\n` +
        `🗣️ *Descrição:* ${groupUtils.getGroupDescription(targetGroupId) || 'N/A'}\n` +
        `🛡️ *Administradores:* ${adminsText}\n` +
        `👤 *Total de Participantes:* ${groupUtils.getGroupParticipants(targetGroupId)?.length || 'Nenhum'
        }`;

    const messages = store.rawMessages[targetGroupId] || [];
    let messageRanking = '';

    if (messages.length > 0) {
        const participantCounts = {};
        let firstMessageTimestamp = Infinity;
        let lastMessageTimestamp = -Infinity;

        messages.forEach(msg => {
            const participant = msg.key.fromMe ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : msg.key.participant || msg.participant;

            if (participant) {
                if (!participantCounts[participant]) {
                    participantCounts[participant] = 0;
                }
                participantCounts[participant]++;
            }

            const timestamp = msg.messageTimestamp;
            if (timestamp < firstMessageTimestamp) {
                firstMessageTimestamp = timestamp;
            }
            if (timestamp > lastMessageTimestamp) {
                lastMessageTimestamp = timestamp;
            }
        });

        const sortedParticipants = Object.entries(participantCounts).sort((a, b) => b[1] - a[1]);

        messageRanking += '\n\n📊 *Ranking de Mensagens por Participante*\n';
        sortedParticipants.forEach(([jid, count], index) => {
            if (!mentions.includes(jid)) {
                mentions.push(jid);
            }
            const name = `@${jid.split('@')[0]}`;
            messageRanking += `${index + 1}. ${name}: ${count} mensagens\n`;
        });

        const totalMessages = messages.length;
        messageRanking += `\n*Total de mensagens enviadas:* ${totalMessages}\n`;

        const durationInSeconds = lastMessageTimestamp - firstMessageTimestamp;
        if (durationInSeconds > 0) {
            const durationInHours = durationInSeconds / 3600;
            const durationInDays = durationInHours / 24;

            if (durationInDays >= 1) {
                const avgPerDay = (totalMessages / durationInDays).toFixed(2);
                messageRanking += `*Média de mensagens por dia:* ${avgPerDay}\n`;
            } else {
                const avgPerHour = (totalMessages / durationInHours).toFixed(2);
                messageRanking += `*Média de mensagens por hora:* ${avgPerHour}\n`;
            }
        }
    } else {
        messageRanking = '\n\n📊 *Ranking de Mensagens:* Nenhuma mensagem encontrada no histórico.';
    }

    reply += messageRanking;

    await sock.sendMessage(
        remoteJid,
        { text: reply, mentions: mentions },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
};

module.exports = {
    handleInfoCommand,
};
