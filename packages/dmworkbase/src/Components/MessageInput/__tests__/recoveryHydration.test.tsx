import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { Channel, ChannelTypeGroup } from "wukongimjssdk";
import MessageInput, {
  type MessageInputContext,
  type MessageInputRecovery,
} from "..";

vi.mock("../../../App", () => ({
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

function failedCompose(text: string): MessageInputRecovery {
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
    topAttachments: [],
    expanded: false,
  };
}

describe("MessageInput recovery hydration", () => {
  it("prepends a failed compose without overwriting the newer persisted draft", async () => {
    let inputContext: MessageInputContext | undefined;
    const recovered: string[][] = [];

    render(
      <MessageInput
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
});
