import type {
  AttachmentFile,
  ChatMention,
  ChatComposerSendResult,
  EditorContentBlock,
  SendProgressSnapshot,
} from "../domain";
import {
  cloneEditorContentBlocks,
  isEditorContentBlock,
  rejectChatComposerSend,
} from "../domain";
import {
  disposeComposeRecoveryObjectUrls,
  type ComposeRecoveryRecord,
} from "../recovery";
import type {
  ChatComposerEditorPort,
  ChatComposerHostPort,
  ChatComposerSendTransaction,
} from "../ports";
import { ChatComposerController } from "./ChatComposerController";
import {
  ComposeRestoreUnavailableError,
  composeSnapshotDraftText,
  composeSnapshotPreviewText,
} from "./composeConsume";
import { settleConsumedCompose } from "./sendFlow";

export interface ChatComposerSubmitInput<TAttachmentPreview = unknown> {
  text: string;
  mention?: ChatMention;
  topFiles: AttachmentFile[];
  editorBlocks: EditorContentBlock[];
  pendingAttachments: TAttachmentPreview[];
}

export interface ChatComposerSubmitPorts<TMessage = unknown> {
  host: ChatComposerHostPort<TMessage>;
  editor: ChatComposerEditorPort;
}

/** Application coordinator for capture -> consume -> send -> settle -> recovery. */
export class ChatComposerCoordinator<
  TAttachmentPreview = unknown,
  TMessage = unknown
> {
  constructor(
    private readonly controller: ChatComposerController<TAttachmentPreview>
  ) {}

  async submit(
    input: ChatComposerSubmitInput<TAttachmentPreview>,
    ports: ChatComposerSubmitPorts<TMessage>
  ): Promise<ChatComposerSendResult> {
    const { host, editor } = ports;
    let editorBlocks: EditorContentBlock[];
    try {
      editorBlocks = cloneEditorContentBlocks(input.editorBlocks);
      if (!editorBlocks.every(isEditorContentBlock)) {
        return rejectChatComposerSend("unsupported-content");
      }
    } catch {
      return rejectChatComposerSend("unsupported-content");
    }
    const transaction = host.captureSendTransaction();
    const sendTarget = transaction.captureSendTarget();
    const { channelKey } = transaction;
    const expandedAtSend = host.getExpanded();

    let consumed;
    try {
      consumed = editor.consume({
        isRestoreTargetActive: () => host.isChannelActive(channelKey),
        getRestoreOffsets: (livePrefix) =>
          this.controller.getRestoreOffsets(livePrefix),
        onRestored: (offsets, restoredPrefix) =>
          this.controller.advanceRestoreOffsets(offsets, restoredPrefix),
        onRestoreCompose: () => {
          if (!host.isChannelActive(channelKey)) return;
          sendTarget?.restore();
          if (expandedAtSend) host.setExpanded(true);
        },
        onRestoreSendTarget: () => {
          if (host.isChannelActive(channelKey)) sendTarget?.restore();
        },
        onRestoreError: (error, step) => host.notifyRestoreError?.(error, step),
      });
      // A successful consume removes every live restored block/attachment from
      // the editor, so later queued failures must start a fresh restore prefix.
      this.controller.resetRestoreOffsets();
    } catch (error) {
      if (host.isChannelActive(channelKey)) sendTarget?.restore();
      throw error;
    }

    const sendDraftBaseline = transaction.captureSendDraft();
    const draftText = composeSnapshotDraftText(consumed.snapshot);
    const attempt = this.controller.capture({
      channelKey,
      previewText: composeSnapshotPreviewText(consumed.snapshot),
      draftText,
      editorBlocks,
      attachments: input.pendingAttachments,
    });
    const attemptId = attempt.id;
    const sendDraft = sendDraftBaseline
      ? { ...sendDraftBaseline, draftText }
      : undefined;
    const sendProgress: SendProgressSnapshot = {
      setExpectedPartIds: (partIds) =>
        this.controller.setExpectedPartIds(attemptId, partIds),
      markPartsEnqueued: (partIds) =>
        this.controller.markPartsEnqueued(attemptId, partIds),
    };

    if (expandedAtSend) host.setExpanded(false);

    return this.controller.enqueueAttempt(attemptId, async () => {
      const settlement = await settleConsumedCompose(
        () =>
          transaction.send({
            attemptId,
            text: input.text,
            mention: input.mention,
            topFiles: input.topFiles.length > 0 ? input.topFiles : undefined,
            editorBlocks: editorBlocks.length > 0 ? editorBlocks : undefined,
            sendTarget,
            sendDraft,
            sendProgress,
          }),
        consumed.ids,
        consumed.compose
      );

      const ledgerSettlement = this.controller.settle(
        attemptId,
        settlement.outcome
      );
      try {
        if (ledgerSettlement) {
          await transaction.onSendSettled?.({
            attemptId,
            outcome: settlement.outcome,
            sendDraft,
            restoreFailed: settlement.restoreErrors.length > 0,
          });
        }
      } finally {
        const recovery = this.buildRecovery({
          attemptId,
          channelKey,
          expandedAtSend,
          sendTarget,
          consumed,
          settlement,
        });
        if (recovery) this.handoffRecovery(recovery, ports);
      }

      return {
        kind: "attempted",
        attemptId,
        outcome: settlement.outcome,
        editorConsumed: settlement.editorConsumed,
      };
    });
  }

  private buildRecovery({
    attemptId,
    channelKey,
    expandedAtSend,
    sendTarget,
    consumed,
    settlement,
  }: {
    attemptId: string;
    channelKey: string;
    expandedAtSend: boolean;
    sendTarget: ReturnType<
      ChatComposerSendTransaction<TMessage>["captureSendTarget"]
    >;
    consumed: ReturnType<ChatComposerEditorPort["consume"]>;
    settlement: Awaited<ReturnType<typeof settleConsumedCompose>>;
  }): ComposeRecoveryRecord | undefined {
    if (settlement.restoreErrors.length === 0) return undefined;

    const failedSteps = new Set(
      settlement.restoreErrors.map(({ step }) => step)
    );
    const unavailableSteps = new Set(
      settlement.restoreErrors
        .filter(
          ({ error }) => error instanceof ComposeRestoreUnavailableError
        )
        .map(({ step }) => step)
    );
    const editorUnavailable =
      unavailableSteps.has("restoreEditor") ||
      unavailableSteps.has("restoreEditorBlocks");
    const editorFailed =
      failedSteps.has("restoreEditor") ||
      failedSteps.has("restoreEditorBlocks");
    const topFailed = failedSteps.has("restoreTopAttachments");
    if (!editorFailed && !topFailed) return undefined;

    const partialEditorRestore = failedSteps.has("restoreEditorBlocks");
    const unsentEditorPartIds = new Set(
      settlement.outcome.unsentEditorBlocks
        .filter((block) => block.type !== "text")
        .map((block) => block.id)
    );

    return {
      channelKey,
      attemptId,
      snapshot: editorFailed
        ? consumed.recovery.snapshot
        : { type: "doc", content: [] },
      editorAttachments: editorFailed
        ? consumed.recovery.editorAttachments.filter(
            ({ id }) => !partialEditorRestore || unsentEditorPartIds.has(id)
          )
        : [],
      editorObjectUrls: editorFailed
        ? consumed.recovery.editorObjectUrls.filter(
            ({ id }) => !partialEditorRestore || unsentEditorPartIds.has(id)
          )
        : [],
      topAttachments: topFailed
        ? consumed.recovery.topAttachments.filter(
            ({ id }) => !settlement.outcome.consumedTopIds.includes(id)
          )
        : [],
      editorBlocks: partialEditorRestore
        ? settlement.outcome.unsentEditorBlocks
        : undefined,
      sendTarget:
        editorUnavailable && settlement.outcome.restoreSendTarget && sendTarget
          ? {
              replyMessage: sendTarget.replyMessage,
              handlerType: sendTarget.handlerType,
            }
          : undefined,
      expanded: editorUnavailable && expandedAtSend,
    };
  }

  private handoffRecovery(
    recovery: ComposeRecoveryRecord,
    ports: ChatComposerSubmitPorts<TMessage>
  ): void {
    let accepted = false;
    try {
      accepted = ports.host.handoffRecovery?.(recovery) ?? false;
    } catch (error) {
      console.error("[ChatComposer] compose recovery handoff failed", error);
    }
    if (!accepted) disposeComposeRecoveryObjectUrls(recovery);
    ports.editor.handoffRecovery(recovery);
  }
}
