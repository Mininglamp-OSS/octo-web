import { describe, expect, it, vi } from "vitest";
import { createChatSendOutcome } from "../../domain";
import type {
  ChatComposerConsumeContext,
  ChatComposerEditorPort,
  ChatComposerHostPort,
  ChatComposerSendTransaction,
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

interface TestHostOverrides
  extends Partial<Omit<ChatComposerHostPort, "captureSendTransaction">> {
  captureSendTransaction?: () => ChatComposerSendTransaction;
  channelKey?: () => string;
  captureSendTarget?: ChatComposerSendTransaction["captureSendTarget"];
  captureSendDraft?: ChatComposerSendTransaction["captureSendDraft"];
  send?: ChatComposerSendTransaction["send"];
  onSendSettled?: ChatComposerSendTransaction["onSendSettled"];
}

function host(overrides: TestHostOverrides = {}): ChatComposerHostPort {
  const {
    captureSendTransaction,
    channelKey,
    captureSendTarget,
    captureSendDraft,
    send,
    onSendSettled,
    ...hostOverrides
  } = overrides;
  return {
    captureSendTransaction:
      captureSendTransaction ??
      (() => ({
        channelKey: channelKey?.() ?? "channel-1:2",
        captureSendTarget: captureSendTarget ?? (() => undefined),
        captureSendDraft: captureSendDraft ?? (() => undefined),
        send:
          send ??
          (async () => createChatSendOutcome({ editorConsumed: true })),
        onSendSettled,
      })),
    isChannelActive: () => true,
    getExpanded: () => false,
    setExpanded: () => undefined,
    ...hostOverrides,
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
        { host: host(), editor }
      )
    ).resolves.toEqual({
      kind: "rejected",
      editorConsumed: false,
      reason: "unsupported-content",
    });

    expect(editor.consume).not.toHaveBeenCalled();
  });

  it("rejects cloneable malformed blocks before consuming the editor", async () => {
    const coordinator = new ChatComposerCoordinator(
      new ChatComposerController()
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
        { host: host(), editor }
      )
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
      "channel",
      "target",
      "draft",
      "expanded",
      "consume",
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

  it("captures the send draft before consume mutates host draft state", async () => {
    let draft = {
      revision: 7,
      remoteDraft: "remote-before-consume",
      protectedPendingAttemptIds: [] as string[],
    };
    const send = vi.fn(async () =>
      createChatSendOutcome({ editorConsumed: true })
    );
    const coordinator = new ChatComposerCoordinator(
      new ChatComposerController()
    );
    const editor: ChatComposerEditorPort = {
      consume: (context) => {
        draft = {
          revision: 8,
          remoteDraft: "remote-after-consume",
          protectedPendingAttemptIds: [],
        };
        return consumed(context);
      },
      handoffRecovery: vi.fn(),
    };

    await coordinator.submit(
      {
        text: "hello",
        topFiles: [],
        editorBlocks: [],
        pendingAttachments: [],
      },
      {
        host: host({
          captureSendDraft: () => ({ ...draft }),
          send,
        }),
        editor,
      }
    );

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        sendDraft: {
          revision: 7,
          remoteDraft: "remote-before-consume",
          draftText: "hello",
          protectedPendingAttemptIds: [],
        },
      })
    );
  });

  it("does not recover sent editor content when only top restoration is unavailable", async () => {
    const handoffRecovery = vi.fn(() => true);
    const handoffEditorRecovery = vi.fn();
    const first = new File(["first"], "first.pdf");
    const second = new File(["second"], "second.pdf");
    const coordinator = new ChatComposerCoordinator(
      new ChatComposerController()
    );
    const editor: ChatComposerEditorPort = {
      consume: (context) => {
        const value = consumed(context, {
          ids: { topIds: ["top-1", "top-2"], editorPartIds: [] },
          recovery: {
            snapshot: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "sent body" }],
                },
              ],
            },
            editorAttachments: [],
            editorObjectUrls: [],
            topAttachments: [
              { id: "top-1", file: first },
              { id: "top-2", file: second },
            ],
          },
        });
        value.compose.restoreTopAttachments = () => {
          throw new ComposeRestoreUnavailableError();
        };
        return value;
      },
      handoffRecovery: handoffEditorRecovery,
    };

    await coordinator.submit(
      {
        text: "sent body",
        topFiles: [
          { id: "top-1", file: first },
          { id: "top-2", file: second },
        ],
        editorBlocks: [],
        pendingAttachments: [],
      },
      {
        host: host({
          send: async () =>
            createChatSendOutcome({
              editorConsumed: true,
              consumedTopIds: ["top-1"],
            }),
          handoffRecovery,
        }),
        editor,
      }
    );

    expect(handoffRecovery).toHaveBeenCalledWith({
      channelKey: "channel-1:2",
      attemptId: expect.any(String),
      snapshot: { type: "doc", content: [] },
      editorAttachments: [],
      editorObjectUrls: [],
      topAttachments: [{ id: "top-2", file: second }],
      editorBlocks: undefined,
      sendTarget: undefined,
      expanded: false,
    });
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

  it("keeps queued sends on the transaction captured before a channel switch", async () => {
    const controller = new ChatComposerController();
    const coordinator = new ChatComposerCoordinator(controller);
    const sent: Array<{ channelKey: string; text: string }> = [];
    const settled: string[] = [];
    let activeChannelKey = "channel-x:2";
    let resolveFirst!: (
      outcome: ReturnType<typeof createChatSendOutcome>,
    ) => void;
    const firstResult = new Promise<ReturnType<typeof createChatSendOutcome>>(
      (resolve) => {
        resolveFirst = resolve;
      },
    );
    const currentHost = host({
      captureSendTransaction: () => {
        const channelKey = activeChannelKey;
        return {
          channelKey,
          captureSendTarget: () => undefined,
          captureSendDraft: () => undefined,
          send: async (request) => {
            sent.push({ channelKey, text: request.text });
            return request.text === "A"
              ? firstResult
              : createChatSendOutcome({ editorConsumed: true });
          },
          onSendSettled: () => {
            settled.push(channelKey);
          },
        };
      },
    });
    const editor: ChatComposerEditorPort = {
      consume: (context) => consumed(context),
      handoffRecovery: vi.fn(),
    };
    const submit = (text: string) =>
      coordinator.submit(
        {
          text,
          topFiles: [],
          editorBlocks: [],
          pendingAttachments: [],
        },
        { host: currentHost, editor },
      );

    const first = submit("A");
    const second = submit("B");
    activeChannelKey = "channel-y:2";

    await Promise.resolve();
    expect(sent).toEqual([{ channelKey: "channel-x:2", text: "A" }]);

    resolveFirst(createChatSendOutcome({ editorConsumed: true }));
    await first;
    await second;

    expect(sent).toEqual([
      { channelKey: "channel-x:2", text: "A" },
      { channelKey: "channel-x:2", text: "B" },
    ]);
    expect(settled).toEqual(["channel-x:2", "channel-x:2"]);
  });

  it("hands failed content to recovery instead of restoring into a switched channel", async () => {
    const restoreCurrentEditor = vi.fn();
    const handoffRecovery = vi.fn(() => true);
    const handoffEditorRecovery = vi.fn();
    let activeChannelKey = "channel-x:2";
    const currentHost = host({
      captureSendTransaction: () => {
        const channelKey = activeChannelKey;
        return {
          channelKey,
          captureSendTarget: () => undefined,
          captureSendDraft: () => undefined,
          send: async () => {
            activeChannelKey = "channel-y:2";
            return createChatSendOutcome();
          },
        };
      },
      isChannelActive: (channelKey) => channelKey === activeChannelKey,
      handoffRecovery,
    });
    const editor: ChatComposerEditorPort = {
      consume: (context) => {
        const value = consumed(context, {
          recovery: {
            snapshot: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "channel x draft" }],
                },
              ],
            },
            editorAttachments: [],
            editorObjectUrls: [],
            topAttachments: [],
          },
        });
        value.compose.restoreEditor = () => {
          context.onRestoreCompose();
          if (!context.isRestoreTargetActive()) {
            throw new ComposeRestoreUnavailableError();
          }
          restoreCurrentEditor();
        };
        return value;
      },
      handoffRecovery: handoffEditorRecovery,
    };

    await new ChatComposerCoordinator(new ChatComposerController()).submit(
      {
        text: "channel x draft",
        topFiles: [],
        editorBlocks: [],
        pendingAttachments: [],
      },
      { host: currentHost, editor },
    );

    expect(restoreCurrentEditor).not.toHaveBeenCalled();
    expect(handoffRecovery).toHaveBeenCalledWith(
      expect.objectContaining({
        channelKey: "channel-x:2",
        snapshot: expect.objectContaining({ type: "doc" }),
      }),
    );
    expect(handoffEditorRecovery).toHaveBeenCalledWith(
      handoffRecovery.mock.calls[0][0],
    );
  });

  it("keeps consecutive queued failures before the live draft", async () => {
    const controller = new ChatComposerController();
    const coordinator = new ChatComposerCoordinator(controller);
    const liveBlocks: string[] = [];
    let resolveA!: (value: ReturnType<typeof createChatSendOutcome>) => void;
    let resolveB!: (value: ReturnType<typeof createChatSendOutcome>) => void;
    const aResult = new Promise<ReturnType<typeof createChatSendOutcome>>(
      (resolve) => {
        resolveA = resolve;
      }
    );
    const bResult = new Promise<ReturnType<typeof createChatSendOutcome>>(
      (resolve) => {
        resolveB = resolve;
      }
    );

    const submit = (label: "A" | "B") => {
      liveBlocks.push(label);
      return coordinator.submit(
        {
          text: label,
          topFiles: [],
          editorBlocks: [],
          pendingAttachments: [],
        },
        {
          host: host({
            send: async () => (label === "A" ? aResult : bResult),
          }),
          editor: {
            consume: (context) => {
              const captured = liveBlocks.splice(0);
              const value = consumed(context);
              value.compose.restoreEditor = () => {
                const offset = context.getRestoreOffsets().blocks;
                liveBlocks.splice(offset, 0, ...captured);
                context.onRestored({
                  blocks: captured.length,
                  topAttachments: 0,
                });
              };
              return value;
            },
            handoffRecovery: vi.fn(),
          },
        }
      );
    };

    const first = submit("A");
    const second = submit("B");
    liveBlocks.push("D");

    resolveA(createChatSendOutcome());
    await first;
    resolveB(createChatSendOutcome());
    await second;

    expect(liveBlocks).toEqual(["A", "B", "D"]);
  });

  it("resets restore offsets after restored content is consumed again", async () => {
    const controller = new ChatComposerController();
    const coordinator = new ChatComposerCoordinator(controller);
    const liveBlocks: string[] = [];
    let resolveA!: (value: ReturnType<typeof createChatSendOutcome>) => void;
    let resolveB!: (value: ReturnType<typeof createChatSendOutcome>) => void;
    let markBStarted!: () => void;
    const aResult = new Promise<ReturnType<typeof createChatSendOutcome>>(
      (resolve) => {
        resolveA = resolve;
      }
    );
    const bResult = new Promise<ReturnType<typeof createChatSendOutcome>>(
      (resolve) => {
        resolveB = resolve;
      }
    );
    const bStarted = new Promise<void>((resolve) => {
      markBStarted = resolve;
    });

    const submit = (label: "A" | "B" | "C") => {
      liveBlocks.push(label);
      return coordinator.submit(
        {
          text: label,
          topFiles: [],
          editorBlocks: [],
          pendingAttachments: [],
        },
        {
          host: host({
            send: async () => {
              if (label === "A") return aResult;
              if (label === "B") {
                markBStarted();
                return bResult;
              }
              return createChatSendOutcome({ editorConsumed: true });
            },
          }),
          editor: {
            consume: (context) => {
              const captured = liveBlocks.splice(0);
              const value = consumed(context);
              value.compose.restoreEditor = () => {
                const offset = context.getRestoreOffsets().blocks;
                liveBlocks.splice(offset, 0, ...captured);
                context.onRestored({
                  blocks: captured.length,
                  topAttachments: 0,
                });
              };
              return value;
            },
            handoffRecovery: vi.fn(),
          },
        }
      );
    };

    const first = submit("A");
    const second = submit("B");
    resolveA(createChatSendOutcome());
    await first;
    await bStarted;

    const third = submit("C");
    liveBlocks.push("D");
    resolveB(createChatSendOutcome());
    await second;
    await third;

    expect(liveBlocks).toEqual(["B", "D"]);
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
    expect(captureSendDraft).toHaveBeenCalledOnce();
    expect(controller.pendingSendCount()).toBe(0);
  });
});
