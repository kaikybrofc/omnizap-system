// app/modules/adminModule/groupEventHandlers.js

const groupConfigStore = require('../../store/groupConfigStore');
const store = require('../../store/dataStore');
const logger = require('../../utils/logger/loggerModule');
const groupUtils = require('../../utils/groupUtils'); // Import groupUtils
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');

/**
 * Handles group update events (add, remove, promote, demote) and sends
 * welcome/farewell/promotion/demotion messages based on group configurations.
 * @param {import('@adiwajshing/baileys').WASocket} sock - The Baileys socket instance.
 * @param {string} groupId - The JID of the group where the event occurred.
 * @param {string[]} participants - The JIDs of the participants involved in the event.
 * @param {'add' | 'remove' | 'promote' | 'demote'} action - The action that occurred.
 */

/**
 * Replaces placeholders in a message string with actual group information.
 * @param {string} message - The message string potentially containing placeholders.
 * @param {import('@adiwajshing/baileys').WASocket} sock - The Baileys socket instance.
 * @param {string} groupId - The JID of the group.
 * @returns {Promise<{updatedMessage: string, mentions: string[]}>} The message string with placeholders replaced and an array of JIDs to mention.
 */
const replacePlaceholders = async (message, sock, groupId) => {
    let updatedMessage = message;
    const mentions = [];

    try {
        const metadata = await groupUtils.getGroupMetadata(sock, groupId);

        // @date: Current date and time
        if (updatedMessage.includes('@date')) {
            updatedMessage = updatedMessage.replace(/@date/g, moment().format('DD/MM/YYYY HH:mm:ss'));
        }

        // @desc: Group description
        if (updatedMessage.includes('@desc') && metadata.desc) {
            updatedMessage = updatedMessage.replace(/@desc/g, metadata.desc);
        }

        // @admins: List of admin names and add them to mentions
        if (updatedMessage.includes('@admins') && metadata.participants) {
            const adminJids = metadata.participants
                .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
                .map(p => p.id);
            
            const adminNames = adminJids.map(jid => {
                const contact = store.contacts && store.contacts[jid];
                mentions.push(jid);
                return `@${jid.split('@')[0]}`;
            });
            updatedMessage = updatedMessage.replace(/@admins/g, adminNames.join(', '));
        }

        // @groupname: Group subject
        if (updatedMessage.includes('@groupname') && metadata.subject) {
            updatedMessage = updatedMessage.replace(/@groupname/g, metadata.subject);
        }

        // @membercount: Current member count
        if (updatedMessage.includes('@membercount') && metadata.participants) {
            updatedMessage = updatedMessage.replace(/@membercount/g, metadata.participants.length.toString());
        }

        // @owner: Group owner's name or JID
        if (updatedMessage.includes('@owner') && metadata.owner) {
            const ownerJid = metadata.owner;
            const ownerName = (store.contacts && store.contacts[ownerJid]?.notify) || ownerJid.split('@')[0];
            mentions.push(ownerJid);
            updatedMessage = updatedMessage.replace(/@owner/g, `@${ownerName}`);
        }

        // @creationtime: Group creation timestamp
        if (updatedMessage.includes('@creationtime') && metadata.creation) {
            updatedMessage = updatedMessage.replace(/@creationtime/g, moment.unix(metadata.creation).format('DD/MM/YYYY HH:mm:ss'));
        }

        // @invitecode: Group invite code
        if (updatedMessage.includes('@invitecode')) {
            try {
                const inviteCode = await groupUtils.getGroupInviteCode(sock, groupId);
                updatedMessage = updatedMessage.replace(/@invitecode/g, inviteCode);
            } catch (e) {
                logger.warn(`Could not get invite code for group ${groupId}: ${e.message}`);
                updatedMessage = updatedMessage.replace(/@invitecode/g, '[Código de convite não disponível]');
            }
        }

        // @isrestricted: Is group restricted?
        if (updatedMessage.includes('@isrestricted')) {
            updatedMessage = updatedMessage.replace(/@isrestricted/g, metadata.restrict ? 'Sim' : 'Não');
        }

        // @isannounceonly: Is group announcement only?
        if (updatedMessage.includes('@isannounceonly')) {
            updatedMessage = updatedMessage.replace(/@isannounceonly/g, metadata.announce ? 'Sim' : 'Não');
        }

    } catch (error) {
        logger.error(`Error replacing placeholders for group ${groupId}: ${error.message}`);
    }
    return { updatedMessage, mentions };
};

const handleGroupUpdate = async (sock, groupId, participants, action) => {

    try {
        const groupConfig = groupConfigStore.getGroupConfig(groupId);
        let message = '';
        const allMentions = [];

        for (const participantJid of participants) {
            const participantName = (store.contacts && store.contacts[participantJid]?.notify) || participantJid.split('@')[0];
            allMentions.push(participantJid);

            switch (action) {
                case 'add':
                    if (groupConfig.welcomeMessageEnabled && groupConfig.welcomeMessage) {
                        let msg = groupConfig.welcomeMessage.replace('{participant}', `@${participantName}`);
                        msg = msg.replace(/@user/g, `@${participantName}`); // Add this line for @user
                        message += `${msg}\n`;
                    }
                    break;
                case 'remove':
                    if (groupConfig.farewellMessageEnabled && groupConfig.farewellMessage) {
                        let msg = groupConfig.farewellMessage.replace('{participant}', `@${participantName}`);
                        msg = msg.replace(/@user/g, `@${participantName}`); // Add this line for @user
                        message += `${msg}\n`;
                    }
                    break;
                case 'promote':
                    if (groupConfig.promoteMessageEnabled && groupConfig.promoteMessage) {
                        let msg = groupConfig.promoteMessage.replace('{participant}', `@${participantName}`);
                        msg = msg.replace(/@user/g, `@${participantName}`); // Add this line for @user
                        message += `${msg}\n`;
                    }
                    break;
                case 'demote':
                    if (groupConfig.demoteMessageEnabled && groupConfig.demoteMessage) {
                        let msg = groupConfig.demoteMessage.replace('{participant}', `@${participantName}`);
                        msg = msg.replace(/@user/g, `@${participantName}`); // Add this line for @user
                        message += `${msg}\n`;
                    }
                    break;
            }
        }

        if (message) {
            let messageOptions = {};
            let mediaPath = null;

            // Replace group-level placeholders in the message and get additional mentions
            const { updatedMessage, mentions: groupMentions } = await replacePlaceholders(message, sock, groupId);
            message = updatedMessage;

            // Combine all mentions
            const finalMentions = [...new Set([...allMentions, ...groupMentions])];

            if (action === 'add' && groupConfig.welcomeMedia) {
                mediaPath = groupConfig.welcomeMedia;
            } else if (action === 'remove' && groupConfig.farewellMedia) {
                mediaPath = groupConfig.farewellMedia;
            }

            if (mediaPath) {
                logger.info(`Attempting to send media. Configured mediaPath: ${mediaPath}`);
                const absoluteMediaPath = path.resolve(mediaPath);
                logger.info(`Resolved absoluteMediaPath: ${absoluteMediaPath}`);

                if (fs.existsSync(absoluteMediaPath)) {
                    logger.info(`Media file found at ${absoluteMediaPath}. Preparing to send.`);
                    const mediaType = absoluteMediaPath.endsWith('.mp4') ? 'video' : 'image';
                    const mediaBuffer = fs.readFileSync(absoluteMediaPath);

                    if (mediaType === 'image') {
                        messageOptions = { image: mediaBuffer, caption: message.trim(), mentions: finalMentions };
                    } else if (mediaType === 'video') {
                        messageOptions = { video: mediaBuffer, caption: message.trim(), mentions: finalMentions };
                    }
                } else {
                    logger.warn(`Media file not found at ${absoluteMediaPath} for group ${groupId}, action ${action}. Sending text message instead.`);
                    messageOptions = { text: message.trim(), mentions: finalMentions };
                }
            } else {
                messageOptions = { text: message.trim(), mentions: finalMentions };
            }
            await sock.sendMessage(groupId, messageOptions);
            logger.info(`Sent group update message for group ${groupId}, action: ${action}`);
        }
    } catch (error) {
        logger.error(`Error handling group update for group ${groupId}, action ${action}:`, error);
    }
};

module.exports = {
    handleGroupUpdate,
};
