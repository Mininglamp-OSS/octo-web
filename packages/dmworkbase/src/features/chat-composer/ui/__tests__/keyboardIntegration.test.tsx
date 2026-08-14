import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { createChatSendOutcome } from "../../domain";
import ChatComposer, { type MessageInputContext } from "../ChatComposer";
import { createTestViewHost } from "./testViewHost";

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

describe("MessageInput keyboard integration", () => {
  it("renders channel titles supplied by the view host", async () => {
    let publishTitle: ((title: string) => void) | undefined;
    const unsubscribe = vi.fn();
    const host = createTestViewHost("channel", 2, {
      getChannelTitle: () => "Initial room",
      subscribeChannelTitle: (listener) => {
        publishTitle = listener;
        return unsubscribe;
      },
    });
    const view = render(<ChatComposer host={host} />);

    await waitFor(() =>
      expect(
        view.container
          .querySelector(".ProseMirror p")
          ?.getAttribute("data-placeholder"),
      ).toContain("Initial room"),
    );

    act(() => publishTitle?.("Renamed room"));
    await waitFor(() =>
      expect(
        view.container
          .querySelector(".ProseMirror p")
          ?.getAttribute("data-placeholder"),
      ).toContain("Renamed room"),
    );

    view.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("does not send when Enter confirms an IME composition", async () => {
    let inputContext: MessageInputContext | undefined;
    const onSend = vi.fn(() =>
      createChatSendOutcome({ editorConsumed: true }),
    );
    const view = render(
      <ChatComposer
        host={createTestViewHost()}
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
