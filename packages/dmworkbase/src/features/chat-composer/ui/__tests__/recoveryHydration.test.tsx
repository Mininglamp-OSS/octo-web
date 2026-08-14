import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import ChatComposer, { type MessageInputContext } from "../ChatComposer";
import { createChatSendOutcome } from "../../domain";
import { createTestViewHost } from "./testViewHost";
import type {
  ComposeRecoveryRecord,
  RecoveredComposeHydration,
} from "../../recovery";

vi.mock("../../../../App", () => ({
  default: {
    mittBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
    shared: { avatarChannel: vi.fn() },
    dataSource: {
      commonDataSource: { getImageURL: vi.fn(() => "") },
    },
  },
}));

vi.mock("react-virtuoso", () => ({
  Virtuoso: () => null,
  TableVirtuoso: () => null,
}));

function failedCompose(text: string): ComposeRecoveryRecord {
  return {
    channelKey: "channel:2",
    attemptId: "attempt-A",
    snapshot: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text }],
        },
      ],
    },
    editorAttachments: [],
    editorObjectUrls: [],
    topAttachments: [],
    expanded: false,
  };
}

describe("MessageInput recovery hydration", () => {
  it("prepends a failed compose without overwriting the newer persisted draft", async () => {
    let inputContext: MessageInputContext | undefined;
    const recovered: RecoveredComposeHydration[] = [];

    render(
      <ChatComposer
        host={createTestViewHost()}
        recoveredComposes={[failedCompose("failed A")]}
        onContext={(context) => {
          inputContext = context;
          context.restoreDraft("new draft C");
        }}
        onRecoveredComposes={(hydration) => recovered.push(hydration)}
      />
    );

    await waitFor(() => {
      expect(inputContext?.text()).toContain("failed A");
      expect(inputContext?.text()).toContain("new draft C");
    });

    const text = inputContext?.text() ?? "";
    expect(text.indexOf("failed A")).toBeLessThan(text.indexOf("new draft C"));
    expect(recovered).toEqual([
      { attemptIds: ["attempt-A"], draftText: "failed A\nnew draft C" },
    ]);

    act(() => inputContext?.clear());
  });

  it("reclaims the recovered inline preview URL until the live compose clears", async () => {
    const revokeObjectURL = vi.fn();
    const originalRevoke = Object.getOwnPropertyDescriptor(
      URL,
      "revokeObjectURL"
    );
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    let inputContext: MessageInputContext | undefined;
    const recovery: ComposeRecoveryRecord = {
      ...failedCompose(""),
      snapshot: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "attachment",
                attrs: {
                  id: "inline-1",
                  name: "image.png",
                  type: "image/png",
                  previewUrl: "blob:inline-1",
                },
              },
            ],
          },
        ],
      },
      editorAttachments: [],
      editorObjectUrls: [{ id: "inline-1", url: "blob:inline-1" }],
    };

    try {
      render(
        <ChatComposer
          host={createTestViewHost()}
          recoveredComposes={[recovery]}
          onContext={(context) => {
            inputContext = context;
          }}
        />
      );

      await waitFor(() => expect(inputContext).toBeDefined());
      act(() => inputContext?.clear());

      expect(revokeObjectURL).toHaveBeenCalledOnce();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:inline-1");
    } finally {
      if (originalRevoke) {
        Object.defineProperty(URL, "revokeObjectURL", originalRevoke);
      } else {
        delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
      }
    }
  });

  it("does not acknowledge a malformed recovery record", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    let inputContext: MessageInputContext | undefined;
    const recovered: RecoveredComposeHydration[] = [];
    const recovery: ComposeRecoveryRecord = {
      ...failedCompose(""),
      editorBlocks: [{ type: "attachment", id: "unknown" }],
    };

    render(
      <ChatComposer
        host={createTestViewHost()}
        recoveredComposes={[recovery]}
        onContext={(context) => {
          inputContext = context;
        }}
        onRecoveredComposes={(hydration) => recovered.push(hydration)}
      />
    );

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        "[MessageInput] compose recovery hydration failed",
        expect.objectContaining({
          message: "cannot recover unknown editor compose part: unknown",
        })
      );
    });
    expect(recovered).toEqual([]);

    act(() => inputContext?.clear());
    consoleError.mockRestore();
  });

  it("does not partially hydrate a recovery batch", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    let inputContext: MessageInputContext | undefined;
    const recovered: RecoveredComposeHydration[] = [];
    const malformed: ComposeRecoveryRecord = {
      ...failedCompose("failed B"),
      attemptId: "attempt-B",
      editorBlocks: [{ type: "attachment", id: "unknown" }],
    };

    render(
      <ChatComposer
        host={createTestViewHost()}
        recoveredComposes={[failedCompose("failed A"), malformed]}
        onContext={(context) => {
          inputContext = context;
          context.restoreDraft("new draft C");
        }}
        onRecoveredComposes={(hydration) => recovered.push(hydration)}
      />
    );

    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(inputContext?.text()).toBe("new draft C");
    expect(recovered).toEqual([]);

    act(() => inputContext?.clear());
    consoleError.mockRestore();
  });

  it("rejects a recovery batch with conflicting inline resources", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    let inputContext: MessageInputContext | undefined;
    const recovered: RecoveredComposeHydration[] = [];
    const first: ComposeRecoveryRecord = {
      ...failedCompose("failed A"),
      editorAttachments: [{ id: "shared", file: new File(["A"], "A.png") }],
    };
    const second: ComposeRecoveryRecord = {
      ...failedCompose("failed B"),
      attemptId: "attempt-B",
      editorAttachments: [{ id: "shared", file: new File(["B"], "B.png") }],
    };

    render(
      <ChatComposer
        host={createTestViewHost()}
        recoveredComposes={[first, second]}
        onContext={(context) => {
          inputContext = context;
          context.restoreDraft("new draft C");
        }}
        onRecoveredComposes={(hydration) => recovered.push(hydration)}
      />
    );

    await waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith(
        "[MessageInput] compose recovery hydration failed",
        expect.objectContaining({
          message: "inline attachment already registered: shared",
        })
      )
    );
    expect(inputContext?.text()).toBe("new draft C");
    expect(recovered).toEqual([]);

    act(() => inputContext?.clear());
    consoleError.mockRestore();
  });

  it.each(["rejects", "throws"] as const)(
    "releases a leased preview once when recovery %s after unmount",
    async (behavior) => {
      const createObjectURL = vi.fn(() => "blob:leased");
      const revokeObjectURL = vi.fn();
      const originalCreate = Object.getOwnPropertyDescriptor(
        URL,
        "createObjectURL"
      );
      const originalRevoke = Object.getOwnPropertyDescriptor(
        URL,
        "revokeObjectURL"
      );
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: createObjectURL,
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: revokeObjectURL,
      });
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      let inputContext: MessageInputContext | undefined;
      let resolveSend: (
        outcome: ReturnType<typeof createChatSendOutcome>
      ) => void = () => undefined;
      const onSend = vi.fn(
        () =>
          new Promise<ReturnType<typeof createChatSendOutcome>>((resolve) => {
            resolveSend = resolve;
          })
      );
      const onComposeRecovery = vi.fn(() => {
        if (behavior === "throws") throw new Error("handoff failed");
        return false;
      });

      try {
        const view = render(
          <ChatComposer
            host={createTestViewHost()}
            onContext={(context) => {
              inputContext = context;
            }}
            onSend={onSend}
            onComposeRecovery={onComposeRecovery}
          />
        );
        await waitFor(() => expect(inputContext).toBeDefined());

        const file = new File(["image"], "image.png", {
          type: "image/png",
        });
        await act(async () => {
          await inputContext?.addAttachment([file], "paste");
        });

        let sendPromise: ReturnType<MessageInputContext["send"]> | undefined;
        act(() => {
          sendPromise = inputContext?.send();
        });
        await waitFor(() => expect(onSend).toHaveBeenCalledOnce());

        act(() => view.unmount());
        await act(async () => {
          resolveSend(createChatSendOutcome());
          await sendPromise;
        });

        expect(await sendPromise).toMatchObject({ editorConsumed: false });
        expect(onComposeRecovery).toHaveBeenCalledOnce();
        expect(revokeObjectURL).toHaveBeenCalledOnce();
        expect(revokeObjectURL).toHaveBeenCalledWith("blob:leased");
      } finally {
        consoleError.mockRestore();
        if (originalCreate) {
          Object.defineProperty(URL, "createObjectURL", originalCreate);
        } else {
          delete (URL as { createObjectURL?: unknown }).createObjectURL;
        }
        if (originalRevoke) {
          Object.defineProperty(URL, "revokeObjectURL", originalRevoke);
        } else {
          delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
        }
      }
    }
  );

  it("hands a partially rejected top attachment to recovery after unmount", async () => {
    let inputContext: MessageInputContext | undefined;
    let resolveSend: (
      outcome: ReturnType<typeof createChatSendOutcome>
    ) => void = () => undefined;
    const onSend = vi.fn(
      () =>
        new Promise<ReturnType<typeof createChatSendOutcome>>((resolve) => {
          resolveSend = resolve;
        })
    );
    const onComposeRecovery = vi.fn(() => true);
    const first = new File(["first"], "first.pdf", {
      type: "application/pdf",
    });
    const second = new File(["second"], "second.pdf", {
      type: "application/pdf",
    });

    const view = render(
      <ChatComposer
        host={createTestViewHost()}
        onContext={(context) => {
          inputContext = context;
        }}
        onSend={onSend}
        onComposeRecovery={onComposeRecovery}
      />
    );
    await waitFor(() => expect(inputContext).toBeDefined());

    await act(async () => {
      await inputContext?.addAttachment([first, second], "upload");
    });

    let sendPromise: ReturnType<MessageInputContext["send"]> | undefined;
    act(() => {
      sendPromise = inputContext?.send();
    });
    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());

    const request = onSend.mock.calls[0][0];
    const [firstTop, secondTop] = request.topFiles ?? [];
    expect(firstTop?.file).toBe(first);
    expect(secondTop?.file).toBe(second);

    act(() => view.unmount());
    await act(async () => {
      resolveSend(
        createChatSendOutcome({
          editorConsumed: true,
          consumedTopIds: [firstTop.id],
        })
      );
      await sendPromise;
    });

    expect(onComposeRecovery).toHaveBeenCalledOnce();
    expect(onComposeRecovery).toHaveBeenCalledWith(
      expect.objectContaining({
        topAttachments: [
          expect.objectContaining({ id: secondTop.id, file: second }),
        ],
      })
    );
  });
});
