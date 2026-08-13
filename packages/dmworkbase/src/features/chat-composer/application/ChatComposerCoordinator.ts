import type {
  AttachmentFile,
  ChatMention,
  ChatComposerSendResult,
  EditorContentBlock,
  SendProgressSnapshot,
} from "../domain";
import {
  disposeComposeRecoveryObjectUrls,
  type ComposeRecoveryRecord,
} from "../recovery";
import type {
  ChatComposerEditorPort,
  ChatComposerHostPort,
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
  TMessage = unknown,
> {
  constructor(
    private readonly controller: ChatComposerController<TAttachmentPreview>,
  ) {}

  async submit(
    input: ChatComposerSubmitInput<TAttachmentPreview>,
    ports: ChatComposerSubmitPorts<TMessage>,
  ): Promise<ChatComposerSendResult> {
    const { host, editor } = ports;
    const sendTarget = host.captureSendTarget();
    const channelKey = host.channelKey();
    const sendDraftBaseline = host.captureSendDraft();
    this.controller.resetRestoreOffsets();
    const expandedAtSend = host.getExpanded();

    let consumed;
    try {
      consumed = editor.consume({
        getRestoreOffsets: () => this.controller.getRestoreOffsets(),
        onRestored: (offsets) =>
          this.controller.advanceRestoreOffsets(offsets),
        onRestoreCompose: () => {
          if (!host.isChannelActive(channelKey)) return;
          sendTarget?.restore();
          if (expandedAtSend) host.setExpanded(true);
        },
        onRestoreSendTarget: () => {
          if (host.isChannelActive(channelKey)) sendTarget?.restore();
        },
        onRestoreError: (error, step) =>
          host.notifyRestoreError?.(error, step),
      });
    } catch (error) {
      if (host.isChannelActive(channelKey)) sendTarget?.restore();
      throw error;
    }

    const draftText = composeSnapshotDraftText(consumed.snapshot);
    const attempt = this.controller.capture({
      previewText: composeSnapshotPreviewText(consumed.snapshot),
      draftText,
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
          host.send({
            attemptId,
            text: input.text,
            mention: input.mention,
            topFiles: input.topFiles.length > 0 ? input.topFiles : undefined,
            editorBlocks:
              input.editorBlocks.length > 0 ? input.editorBlocks : undefined,
            sendTarget,
            sendDraft,
            sendProgress,
          }),
        consumed.ids,
        consumed.compose,
      );

      const ledgerSettlement = this.controller.settle(
        attemptId,
        settlement.outcome,
      );
      try {
        if (ledgerSettlement) {
          await host.onSendSettled?.({
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
    sendTarget: ReturnType<ChatComposerHostPort<TMessage>["captureSendTarget"]>;
    consumed: ReturnType<ChatComposerEditorPort["consume"]>;
    settlement: Awaited<ReturnType<typeof settleConsumedCompose>>;
  }): ComposeRecoveryRecord | undefined {
    if (settlement.restoreErrors.length === 0) return undefined;

    const failedSteps = new Set(
      settlement.restoreErrors.map(({ step }) => step),
    );
    const unavailable = settlement.restoreErrors.some(
      ({ error }) => error instanceof ComposeRestoreUnavailableError,
    );
    const editorFailed =
      unavailable ||
      failedSteps.has("restoreEditor") ||
      failedSteps.has("restoreEditorBlocks");
    const topFailed =
      unavailable || failedSteps.has("restoreTopAttachments");
    if (!editorFailed && !topFailed) return undefined;

    const partialEditorRestore = failedSteps.has("restoreEditorBlocks");
    const unsentAttachmentIds = new Set(
      settlement.outcome.unsentEditorBlocks
        .filter((block) => block.type === "attachment")
        .map((block) => block.id),
    );

    return {
      channelKey,
      attemptId,
      snapshot: consumed.recovery.snapshot,
      editorAttachments: editorFailed
        ? consumed.recovery.editorAttachments.filter(
            ({ id }) =>
              !partialEditorRestore || unsentAttachmentIds.has(id),
          )
        : [],
      editorObjectUrls: editorFailed
        ? consumed.recovery.editorObjectUrls.filter(
            ({ id }) =>
              !partialEditorRestore || unsentAttachmentIds.has(id),
          )
        : [],
      topAttachments: topFailed
        ? consumed.recovery.topAttachments.filter(
            ({ id }) => !settlement.outcome.consumedTopIds.includes(id),
          )
        : [],
      editorBlocks: partialEditorRestore
        ? settlement.outcome.unsentEditorBlocks
        : undefined,
      sendTarget:
        unavailable && settlement.outcome.restoreSendTarget && sendTarget
          ? {
              replyMessage: sendTarget.replyMessage,
              handlerType: sendTarget.handlerType,
            }
          : undefined,
      expanded: unavailable && expandedAtSend,
    };
  }

  private handoffRecovery(
    recovery: ComposeRecoveryRecord,
    ports: ChatComposerSubmitPorts<TMessage>,
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
