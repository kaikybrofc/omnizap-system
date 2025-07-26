const groupUtils = require('../../utils/groupUtils');
const logger = require('../../utils/logger/loggerModule');

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

    const reply =
        `📋 *Informações do Grupo:*\n\n` +
        `🆔 *ID:* ${groupInfo.id}\n` +
        `📝 *Assunto:* ${groupInfo.subject || 'N/A'}\n` +
        `👑 *Proprietário:* ${groupUtils.getGroupOwner(targetGroupId) || 'N/A'}\n` +
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
        `🛡️ *Administradores:* ${groupUtils.getGroupAdmins(targetGroupId).join(', ') || 'Nenhum'
        }\n` +
        `👤 *Total de Participantes:* ${groupUtils.getGroupParticipants(targetGroupId)?.length || 'Nenhum'
        }`;

    await sock.sendMessage(
        remoteJid,
        { text: reply },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
};

module.exports = {
    handleInfoCommand,
};
