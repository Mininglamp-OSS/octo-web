import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { Channel, ChannelTypeGroup } from "wukongimjssdk";
import { createChatSendOutcome } from "../../domain";
import ChatComposer, { type MessageInputContext } from "../ChatComposer";

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

describe("MessageInput keyboard integration", () => {
  it("does not send when Enter confirms an IME composition", async () => {
    let inputContext: MessageInputContext | undefined;
    const onSend = vi.fn(() =>
      createChatSendOutcome({ editorConsumed: true }),
    );
    const view = render(
      <ChatComposer
        context={conversationContext()}
        onContext={(context) => {
          inputContext = context;
        }}
        onSend={onSend}
      />
    );
    await waitFor(() => expect(inputContext).toBeDefined());
    act(() => inputContext?.restoreDraft("中文输入"));
    const editor = view.container.querySelector(".ProseMirror");
    expect(editor).not.toBeNull();

    const composingEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    fireEvent(editor!, composingEnter);

    expect(onSend).not.toHaveBeenCalled();
    expect(inputContext?.text()).toContain("中文输入");

    fireEvent.keyDown(editor!, { key: "Enter" });
    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    act(() => inputContext?.clear());
  });
});
