import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import {
  createChatSendOutcome,
  type ChatComposerSendResult,
} from "../../domain";
import ChatComposer, { type MessageInputContext } from "../ChatComposer";
import { createDefaultChatComposerExtensions } from "../createDefaultChatComposerExtensions";
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

describe("ChatComposer extension injection", () => {
  it("keeps the mount-time extension bundle for in-flight attempts", async () => {
    const extensionsA = createDefaultChatComposerExtensions();
    const extensionsB = createDefaultChatComposerExtensions();
    extensionsA.render.pending.register({
      id: "test-a",
      priority: 100,
      canRender: () => true,
      render: () => <div data-testid="pending-a" />,
    });
    extensionsB.render.pending.register({
      id: "test-b",
      priority: 100,
      canRender: () => true,
      render: () => <div data-testid="pending-b" />,
    });

    let inputContext: MessageInputContext | undefined;
    let resolveSend:
      | ((value: ReturnType<typeof createChatSendOutcome>) => void)
      | undefined;
    const onSend = vi.fn(
      () =>
        new Promise<ReturnType<typeof createChatSendOutcome>>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const props = {
      host: createTestViewHost(),
      onSend,
      onContext: (value: MessageInputContext) => {
        inputContext = value;
      },
    };
    const view = render(<ChatComposer {...props} extensions={extensionsA} />);
    await waitFor(() => expect(inputContext).toBeDefined());

    let sendPromise: Promise<ChatComposerSendResult> | undefined;
    act(() => {
      inputContext?.restoreDraft("hello");
      sendPromise = inputContext?.send();
    });
    await waitFor(() =>
      expect(view.queryByTestId("pending-a")).not.toBeNull(),
    );

    view.rerender(<ChatComposer {...props} extensions={extensionsB} />);

    expect(view.queryByTestId("pending-a")).not.toBeNull();
    expect(view.queryByTestId("pending-b")).toBeNull();

    await act(async () => {
      resolveSend?.(createChatSendOutcome({ editorConsumed: true }));
      await sendPromise;
    });
  });
});
