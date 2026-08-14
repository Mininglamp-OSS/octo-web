import { describe, expect, it, vi } from "vitest";
import { createChatSendOutcome } from "../../domain";
import type {
  ChatComposerConsumeContext,
  ChatComposerEditorPort,
  ChatComposerHostPort,
} from "../../ports";
import { ChatComposerController } from "../ChatComposerController";
import { ChatComposerCoordinator } from "../ChatComposerCoordinator";
import { ComposeRestoreUnavailableError } from "../composeConsume";

function consumed(
  context: ChatComposerConsumeContext,
  overrides: Partial<ReturnType<ChatComposerEditorPort["consume"]>> = {}
): ReturnType<ChatComposerEditorPort["consume"]> {
  return {
    ids: { topIds: [], editorPartIds: [] },
    compose: {
      restoreEditor: context.onRestoreCompose,
      restoreEditorBlocks: () => undefined,
      restoreSendTarget: context.onRestoreSendTarget,
      disposeEditorParts: () => undefined,
      disposeTopAttachments: () => undefined,
      restoreTopAttachments: () => undefined,
      onRestoreError: context.onRestoreError,
    },
    snapshot: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "hello" }] },
      ],
    },
    recovery: {
      snapshot: { type: "doc", content: [] },
      editorAttachments: [],
      editorObjectUrls: [],
      topAttachments: [],
    },
    ...overrides,
  };
}

function host(
  overrides: Partial<ChatComposerHostPort> = {}
): ChatComposerHostPort {
  return {
    channelKey: () => "channel-1:2",
    isChannelActive: () => true,
    captureSendTarget: () => undefined,
    captureSendDraft: () => undefined,
    getExpanded: () => false,
    setExpanded: () => undefined,
    send: async () => createChatSendOutcome({ editorConsumed: true }),
    ...overrides,
  };
}

describe("ChatComposerCoordinator", () => {
  it("rejects non-cloneable extension payloads before consuming the editor", async () => {
    const controller = new ChatComposerController();
    const coordinator = new ChatComposerCoordinator(controller);
    const editor: ChatComposerEditorPort = {
      consume: vi.fn((context) => consumed(context)),
      handoffRecovery: vi.fn(),
    };

    await expect(
      coordinator.submit(
        {
          text: "",
          topFiles: [],
          editorBlocks: [
            {
              type: "extension:custom",
              id: "custom-1",
              payload: { callback: () => undefined },
            },
          ],
          pendingAttachments: [],
        },
        { host: host(), editor },
      ),
    ).resolves.toEqual({
      kind: "rejected",
      editorConsumed: false,
      reason: "unsupported-content",
    });

    expect(editor.consume).not.toHaveBeenCalled();
  });

  it("rejects cloneable malformed blocks before consuming the editor", async () => {
    const coordinator = new ChatComposerCoordinator(
      new ChatComposerController(),
    );
    const editor: ChatComposerEditorPort = {
      consume: vi.fn((context) => consumed(context)),
      handoffRecovery: vi.fn(),
    };

    await expect(
      coordinator.submit(
        {
          text: "",
          topFiles: [],
          editorBlocks: [
            {
              type: "extension:",
              id: "custom-1",
              payload: {},
            } as never,
          ],
          pendingAttachments: [],
        },
        { host: host(), editor },
      ),
    ).resolves.toEqual({
      kind: "rejected",
      editorConsumed: false,
      reason: "unsupported-content",
    });

    expect(editor.consume).not.toHaveBeenCalled();
  });

  it("owns capture, consume, queue, settlement and release ordering", async () => {
    const order: string[] = [];
    const controller = new ChatComposerController<{ id: string }>();
    const coordinator = new ChatComposerCoordinator(controller);
    const send = vi.fn(async (request) => {
      order.push("send");
      request.sendProgress?.setExpectedPartIds(["text:0"]);
      request.sendProgress?.markPartsEnqueued(["text:0"]);
      return createChatSendOutcome({ editorConsumed: true });
    });
    const onSendSettled = vi.fn(async () => {
      order.push("settled");
    });
    const currentHost = host({
      captureSendTarget: () => {
        order.push("target");
        return undefined;
      },
      channelKey: () => {
        order.push("channel");
        return "channel-1:2";
      },
      captureSendDraft: () => {
        order.push("draft");
        return {
          revision: 7,
          remoteDraft: "remote",
          protectedPendingAttemptIds: [],
        };
      },
      getExpanded: () => {
        order.push("expanded");
        return true;
      },
      setExpanded: (value) => order.push(`set-expanded:${value}`),
      send,
      onSendSettled,
    });
    const editor: ChatComposerEditorPort = {
      consume: (context) => {
        order.push("consume");
        return consumed(context);
      },
      handoffRecovery: vi.fn(),
    };

    await expect(
      coordinator.submit(
        {
          text: "hello",
          topFiles: [],
          editorBlocks: [],
          pendingAttachments: [{ id: "preview-1" }],
        },
        { host: currentHost, editor }
      )
    ).resolves.toMatchObject({ editorConsumed: true });

    expect(order).toEqual([
      "target",
      "channel",
      "expanded",
      "consume",
      "draft",
      "set-expanded:false",
      "send",
      "settled",
    ]);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "hello",
        sendDraft: {
          revision: 7,
          remoteDraft: "remote",
          draftText: "hello",
          protectedPendingAttemptIds: [],
        },
      })
    );
    expect(onSendSettled).toHaveBeenCalledWith(
      expect.objectContaining({ restoreFailed: false })
    );
    expect(controller.pendingSendCount()).toBe(0);
  });

  it("hands an unavailable compose to recovery after restoring host state", async () => {
    const restoreTarget = vi.fn();
    const setExpanded = vi.fn();
    const handoffRecovery = vi.fn(() => true);
    const notifyRestoreError = vi.fn();
    const handoffEditorRecovery = vi.fn();
    const settledError = new Error("draft cleanup failed");
    const controller = new ChatComposerController();
    const coordinator = new ChatComposerCoordinator(controller);
    const currentHost = host({
      captureSendTarget: () => ({
        replyMessage: { id: "reply-1" },
        handlerType: 1,
        restore: restoreTarget,
      }),
      getExpanded: () => true,
      setExpanded,
      send: async () =>
        createChatSendOutcome({
          restoreSendTarget: true,
        }),
      onSendSettled: async () => {
        throw settledError;
      },
      handoffRecovery,
      notifyRestoreError,
    });
    const editor: ChatComposerEditorPort = {
      consume: (context) => {
        const value = consumed(context, {
          recovery: {
            snapshot: { type: "doc", content: [] },
            editorAttachments: [],
            editorObjectUrls: [],
            topAttachments: [],
          },
        });
        value.compose.restoreEditor = () => {
          context.onRestoreCompose();
          throw new ComposeRestoreUnavailableError();
        };
        return value;
      },
      handoffRecovery: handoffEditorRecovery,
    };

    await expect(
      coordinator.submit(
        {
          text: "hello",
          topFiles: [],
          editorBlocks: [],
          pendingAttachments: [],
        },
        { host: currentHost, editor }
      )
    ).rejects.toBe(settledError);

    expect(setExpanded.mock.calls).toEqual([[false], [true]]);
    expect(restoreTarget).toHaveBeenCalledOnce();
    expect(notifyRestoreError).toHaveBeenCalledWith(
      expect.any(ComposeRestoreUnavailableError),
      "restoreEditor"
    );
    expect(handoffRecovery).toHaveBeenCalledWith(
      expect.objectContaining({
        channelKey: "channel-1:2",
        sendTarget: {
          replyMessage: { id: "reply-1" },
          handlerType: 1,
        },
        expanded: true,
      })
    );
    expect(handoffEditorRecovery).toHaveBeenCalledWith(
      handoffRecovery.mock.calls[0][0]
    );
  });

  it("consumes consecutive attempts synchronously and sends them in order", async () => {
    const controller = new ChatComposerController();
    const coordinator = new ChatComposerCoordinator(controller);
    const consumedLabels: string[] = [];
    const sentRequests: Array<{
      text: string;
      target?: unknown;
      draftRevision?: number;
    }> = [];
    let resolveFirst:
      | ((value: ReturnType<typeof createChatSendOutcome>) => void)
      | undefined;
    const firstResult = new Promise<ReturnType<typeof createChatSendOutcome>>(
      (resolve) => {
        resolveFirst = resolve;
      }
    );

    const submit = (label: "A" | "B", expanded: boolean) =>
      coordinator.submit(
        {
          text: label,
          topFiles: [],
          editorBlocks: [],
          pendingAttachments: [],
        },
        {
          host: host({
            channelKey: () => `channel-${label}:2`,
            captureSendTarget: () => ({
              replyMessage: { id: `target-${label}` },
              handlerType: 1,
              restore: vi.fn(),
            }),
            captureSendDraft: () => ({
              revision: label === "A" ? 1 : 2,
              remoteDraft: `remote-${label}`,
              protectedPendingAttemptIds: [],
            }),
            getExpanded: () => expanded,
            setExpanded: vi.fn(),
            send: async (request) => {
              sentRequests.push({
                text: request.text,
                target: request.sendTarget?.replyMessage,
                draftRevision: request.sendDraft?.revision,
              });
              return label === "A"
                ? firstResult
                : createChatSendOutcome({ editorConsumed: true });
            },
          }),
          editor: {
            consume: (context) => {
              consumedLabels.push(label);
              const value = consumed(context);
              value.snapshot = {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: label }],
                  },
                ],
              };
              return value;
            },
            handoffRecovery: vi.fn(),
          },
        }
      );

    const first = submit("A", true);
    const second = submit("B", false);

    expect(consumedLabels).toEqual(["A", "B"]);
    await Promise.resolve();
    expect(sentRequests.map(({ text }) => text)).toEqual(["A"]);

    resolveFirst?.(createChatSendOutcome({ editorConsumed: true }));
    await expect(first).resolves.toMatchObject({ editorConsumed: true });
    await expect(second).resolves.toMatchObject({ editorConsumed: true });

    expect(sentRequests).toEqual([
      { text: "A", target: { id: "target-A" }, draftRevision: 1 },
      { text: "B", target: { id: "target-B" }, draftRevision: 2 },
    ]);
    expect(controller.pendingSendCount()).toBe(0);
  });

  it("restores a captured target when editor consumption throws", async () => {
    const restoreTarget = vi.fn();
    const captureSendDraft = vi.fn();
    const controller = new ChatComposerController();
    const coordinator = new ChatComposerCoordinator(controller);
    const editor: ChatComposerEditorPort = {
      consume: () => {
        throw new Error("unsupported compose part");
      },
      handoffRecovery: vi.fn(),
    };

    await expect(
      coordinator.submit(
        {
          text: "hello",
          topFiles: [],
          editorBlocks: [],
          pendingAttachments: [],
        },
        {
          host: host({
            captureSendTarget: () => ({
              handlerType: 1,
              restore: restoreTarget,
            }),
            captureSendDraft,
          }),
          editor,
        }
      )
    ).rejects.toThrow("unsupported compose part");

    expect(restoreTarget).toHaveBeenCalledOnce();
    expect(captureSendDraft).not.toHaveBeenCalled();
    expect(controller.pendingSendCount()).toBe(0);
  });
});
