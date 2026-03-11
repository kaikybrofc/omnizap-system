export const createPostProcessingMiddleware = ({
  runCommand,
  maybeCaptureIncomingSticker,
  extractSupportedStickerMediaDetails,
  ensureGroupConfigForContext,
  mergeAnalysisMetadata,
  processSticker,
  normalizeAnalysisErrorCode,
}) => {
  return async (ctx) => {
    if (!ctx.isMessageFromBot) {
      await runCommand('pack-capture', () =>
        maybeCaptureIncomingSticker({
          messageInfo: ctx.messageInfo,
          senderJid: ctx.senderJid,
          isMessageFromBot: ctx.isMessageFromBot,
        }),
      );
    }

    if (!ctx.isGroupMessage || ctx.isCommandMessage || ctx.isMessageFromBot) return;

    const autoStickerMedia = extractSupportedStickerMediaDetails(ctx.messageInfo, {
      includeQuoted: false,
    });

    if (!autoStickerMedia || autoStickerMedia.mediaType === 'sticker') return;

    const activeGroupConfig = await ensureGroupConfigForContext(ctx);
    if (!activeGroupConfig?.autoStickerEnabled) return;

    ctx.analysisPayload.processingResult = 'autosticker_triggered';
    mergeAnalysisMetadata(ctx.analysisPayload, {
      auto_sticker_media_type: autoStickerMedia.mediaType || null,
    });

    const autoStickerResult = await runCommand('autosticker', () =>
      processSticker(ctx.sock, ctx.messageInfo, ctx.senderJid, ctx.remoteJid, ctx.expirationMessage, ctx.senderName, '', {
        includeQuotedMedia: false,
        showAutoPackNotice: false,
        commandPrefix: ctx.commandPrefix,
      }),
    );

    if (!autoStickerResult.ok) {
      ctx.analysisPayload.errorCode = normalizeAnalysisErrorCode(autoStickerResult.error);
    }
  };
};
