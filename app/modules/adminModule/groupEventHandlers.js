// app/modules/adminModule/groupEventHandlers.js

const groupConfigStore = require('../../store/groupConfigStore');
const { store } = require('../../store/dataStore');
const logger = require('../../utils/logger/loggerModule');
const fs = require('fs');
const path = require('path');

/**
 * Handles group update events (add, remove, promote, demote) and sends
 * welcome/farewell/promotion/demotion messages based on group configurations.
 * @param {import('@adiwajshing/baileys').WASocket} sock - The Baileys socket instance.
 * @param {string} groupId - The JID of the group where the event occurred.
 * @param {string[]} participants - The JIDs of the participants involved in the event.
 * @param {'add' | 'remove' | 'promote' | 'demote'} action - The action that occurred.
 */
const handleGroupUpdate = async (sock, groupId, participants, action) => {
    try {
        const groupConfig = groupConfigStore.getGroupConfig(groupId);
        let message = '';

        for (const participantJid of participants) {
            const participantName = store.contacts[participantJid]?.notify || participantJid.split('@')[0];

            switch (action) {
                case 'add':
                    if (groupConfig.welcomeMessageEnabled && groupConfig.welcomeMessage) {
                        message += `${groupConfig.welcomeMessage.replace('{participant}', participantName)}\n`;
                    }
                    break;
                case 'remove':
                    if (groupConfig.farewellMessageEnabled && groupConfig.farewellMessage) {
                        message += `${groupConfig.farewellMessage.replace('{participant}', participantName)}\n`;
                    }
                    break;
                case 'promote':
                    if (groupConfig.promoteMessageEnabled && groupConfig.promoteMessage) {
                        message += `${groupConfig.promoteMessage.replace('{participant}', participantName)}\n`;
                    }
                    break;
                case 'demote':
                    if (groupConfig.demoteMessageEnabled && groupConfig.demoteMessage) {
                        message += `${groupConfig.demoteMessage.replace('{participant}', participantName)}\n`;
                    }
                    break;
            }
        }

        if (message) {
            const messageOptions = { text: message.trim() };

            let mediaPath = null;
            if (action === 'add' && groupConfig.welcomeMedia) {
                mediaPath = groupConfig.welcomeMedia;
            } else if (action === 'remove' && groupConfig.farewellMedia) {
                mediaPath = groupConfig.farewellMedia;
            }

            if (mediaPath) {
                const absoluteMediaPath = path.resolve(mediaPath);
                if (fs.existsSync(absoluteMediaPath)) {
                    const mediaType = absoluteMediaPath.endsWith('.mp4') ? 'video' : 'image';
                    const mediaBuffer = fs.readFileSync(absoluteMediaPath);

                    if (mediaType === 'image') {
                        messageOptions.image = mediaBuffer;
                        messageOptions.caption = message.trim();
                    } else if (mediaType === 'video') {
                        messageOptions.video = mediaBuffer;
                        messageOptions.caption = message.trim();
                    }
                } else {
                    logger.warn(`Media file not found at ${absoluteMediaPath} for group ${groupId}, action ${action}`);
                }
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
