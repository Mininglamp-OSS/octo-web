import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { Node } from "@tiptap/core";
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
  it("carries a custom editor node into pending UI and the send request", async () => {
    const extensions = createDefaultChatComposerExtensions();
    extensions.editor.tiptap.push(
      Node.create({
        name: "poll",
        group: "block",
        atom: true,
        addAttributes: () => ({
          id: { default: "" },
          question: { default: "" },
        }),
        parseHTML: () => [{ tag: "div[data-poll-node]" }],
        renderHTML: ({ node }) => [
          "div",
          { "data-poll-node": node.attrs.id },
          node.attrs.question,
        ],
      }),
    );
    extensions.editor.composeParts.register({
      id: "poll",
      canCapture: (node) => node.type === "poll",
      capture: (node) => ({
        id: String(node.attrs?.id),
        kind: "poll",
        extensionId: "poll",
        placement: "block",
        node,
      }),
      restore: (part) => part.node,
      toSendBlock: (part) => ({
        type: "extension:poll",
        id: part.id,
        payload: { question: part.node.attrs?.question },
      }),
    });
    extensions.render.pending.register({
      id: "poll",
      priority: 100,
      canRender: (item) =>
        item.editorBlocks.some((block) => block.type === "extension:poll"),
      render: () => <div data-testid="pending-poll" />,
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
    const view = render(
      <ChatComposer
        host={createTestViewHost()}
        extensions={extensions}
        onContext={(value) => {
          inputContext = value;
        }}
        onSend={onSend}
      />,
    );
    await waitFor(() => expect(inputContext).toBeDefined());

    let sendPromise: Promise<ChatComposerSendResult> | undefined;
    act(() => {
      inputContext?.insertContent({
        type: "poll",
        attrs: { id: "poll-1", question: "Ship it?" },
      });
      sendPromise = inputContext?.send();
    });

    await waitFor(() => expect(view.queryByTestId("pending-poll")).not.toBeNull());
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({
        editorBlocks: [
          {
            type: "extension:poll",
            id: "poll-1",
            payload: { question: "Ship it?" },
          },
        ],
      }),
    );

    await act(async () => {
      resolveSend?.(createChatSendOutcome({ editorConsumed: true }));
      await sendPromise;
    });
  });

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
