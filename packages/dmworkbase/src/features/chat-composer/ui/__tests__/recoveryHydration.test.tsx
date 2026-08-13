import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { Channel, ChannelTypeGroup } from "wukongimjssdk";
import ChatComposer, { type MessageInputContext } from "../ChatComposer";
import { createChatSendOutcome } from "../../domain";
import type { ComposeRecoveryRecord } from "../../recovery";

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

function conversationContext() {
  return {
    channel: () => new Channel("channel", ChannelTypeGroup),
  } as any;
}

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
    const recovered: string[][] = [];

    render(
      <ChatComposer
        context={conversationContext()}
        recoveredComposes={[failedCompose("failed A")]}
        onContext={(context) => {
          inputContext = context;
          context.restoreDraft("new draft C");
        }}
        onRecoveredComposes={(attemptIds) => recovered.push(attemptIds)}
      />
    );

    await waitFor(() => {
      expect(inputContext?.text()).toContain("failed A");
      expect(inputContext?.text()).toContain("new draft C");
    });

    const text = inputContext?.text() ?? "";
    expect(text.indexOf("failed A")).toBeLessThan(text.indexOf("new draft C"));
    expect(recovered).toEqual([["attempt-A"]]);

    act(() => inputContext?.clear());
  });

  it("reclaims the recovered inline preview URL until the live compose clears", async () => {
    const revokeObjectURL = vi.fn();
    const originalRevoke = Object.getOwnPropertyDescriptor(
      URL,
      "revokeObjectURL",
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
          context={conversationContext()}
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
    const recovered: string[][] = [];
    const recovery: ComposeRecoveryRecord = {
      ...failedCompose(""),
      editorBlocks: [{ type: "attachment", id: "unknown" }],
    };

    render(
      <ChatComposer
        context={conversationContext()}
        recoveredComposes={[recovery]}
        onContext={(context) => {
          inputContext = context;
        }}
        onRecoveredComposes={(attemptIds) => recovered.push(attemptIds)}
      />
    );

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        "[MessageInput] compose recovery hydration failed",
        expect.objectContaining({
          message: "cannot recover unknown editor attachment: unknown",
        }),
      );
    });
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
        "createObjectURL",
      );
      const originalRevoke = Object.getOwnPropertyDescriptor(
        URL,
        "revokeObjectURL",
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
        outcome: ReturnType<typeof createChatSendOutcome>,
      ) => void = () => undefined;
      const onSend = vi.fn(
        () =>
          new Promise<ReturnType<typeof createChatSendOutcome>>((resolve) => {
            resolveSend = resolve;
          }),
      );
      const onComposeRecovery = vi.fn(() => {
        if (behavior === "throws") throw new Error("handoff failed");
        return false;
      });

      try {
        const view = render(
      <ChatComposer
            context={conversationContext()}
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

        let sendPromise: Promise<boolean | void> | undefined;
        act(() => {
          sendPromise = Promise.resolve(inputContext?.send());
        });
        await waitFor(() => expect(onSend).toHaveBeenCalledOnce());

        act(() => view.unmount());
        await act(async () => {
          resolveSend(createChatSendOutcome());
          await sendPromise;
        });

        expect(await sendPromise).toBe(false);
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
    },
  );
});
