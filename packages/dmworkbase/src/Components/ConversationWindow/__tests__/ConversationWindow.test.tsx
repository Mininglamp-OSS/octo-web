import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatClientEvent,
  ChatClientStatus,
  type ChatChannelRef,
  type ChatClient,
  type ChatConversationLease,
} from "@octo/chat-core";
import {
  fireEvent,
  render,
  waitFor,
} from "../../../__tests__/testingLibraryReact17";

const conversationContext = {
  clearCheckedMessages: vi.fn(),
  setEditOn: vi.fn(),
};

vi.mock("../../Conversation", async () => {
  const ReactModule = await import("react");
  return {
    Conversation: (props: any) => {
      ReactModule.useEffect(() => {
        props.onContext?.(conversationContext);
      }, [props.onContext]);
      return (
        <div
          data-testid="legacy-conversation"
          data-channel-id={props.channel.channelID}
          data-auxiliary={String(props.isAuxiliary)}
        />
      );
    },
  };
});

vi.mock("../../ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));

import ConversationWindow from "../index";

function createClient() {
  const released: string[] = [];
  const opened: ChatChannelRef[] = [];
  const client: ChatClient = {
    status: ChatClientStatus.Connected,
    activeConversation: null,
    messages: {
      loadMessages: async () => [],
      subscribeMessages: () => () => {},
      subscribeMessageStatus: () => () => {},
      sendMessage: async () => ({}),
    },
    start: async () => {},
    stop: async () => {},
    openConversation: async (channel) => {
      opened.push(channel);
      let isReleased = false;
      const lease: ChatConversationLease = {
        channel,
        get released() {
          return isReleased;
        },
        release() {
          if (isReleased) return;
          isReleased = true;
          released.push(channel.channelId);
        },
      };
      return lease;
    },
    getSnapshot: () => ({
      status: ChatClientStatus.Connected,
      activeConversation: null,
    }),
    subscribe:
      (_event: ChatClientEvent, _listener: (...args: any[]) => void) =>
      () => {},
  };
  return { client, opened, released };
}

const channel = {
  channelID: "person-1",
  channelType: 1,
  getChannelKey: () => "person-1-1",
} as any;

describe("ConversationWindow", () => {
  beforeEach(() => {
    conversationContext.clearCheckedMessages.mockClear();
    conversationContext.setEditOn.mockClear();
  });

  it("renders a complete window without ChatPage or WKLayout", async () => {
    const { client, opened } = createClient();
    const bind = vi.fn(() => vi.fn());

    const view = render(
      <ConversationWindow
        client={client}
        channel={channel}
        errorModuleName="chat"
        bindConversationContext={bind}
        header={{
          avatar: <span data-testid="avatar">A</span>,
          title: <span>Direct chat</span>,
          actions: <button type="button">Details</button>,
        }}
      />
    );

    expect(view.getByText("Direct chat")).toBeTruthy();
    expect(view.getByTestId("avatar")).toBeTruthy();
    expect(
      view.getByTestId("legacy-conversation").getAttribute("data-channel-id")
    ).toBe("person-1");
    await waitFor(() =>
      expect(opened).toEqual([{ channelId: "person-1", channelType: 1 }])
    );
    await waitFor(() => expect(bind).toHaveBeenCalledWith(conversationContext));
  });

  it("owns selection header commands while preserving the conversation", () => {
    const { client } = createClient();
    const cancel = vi.fn();

    const view = render(
      <ConversationWindow
        client={client}
        channel={channel}
        errorModuleName="chat"
        header={{ title: "Direct chat" }}
        selection={{
          active: true,
          count: 2,
          label: "Selected 2",
          cancelLabel: "Cancel",
          onCancel: cancel,
        }}
      />
    );

    expect(view.getByText("Selected 2")).toBeTruthy();
    fireEvent.click(view.getByText("Cancel"));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(view.getByTestId("legacy-conversation")).toBeTruthy();
  });

  it("applies titleClassName to the header title and keeps --thread on thread titles", () => {
    const { client } = createClient();
    const threadChannel = {
      channelID: "thread-1",
      channelType: 5,
      getChannelKey: () => "thread-1-5",
    } as any;

    const view = render(
      <ConversationWindow
        client={client}
        channel={threadChannel}
        errorModuleName="chat"
        header={{
          title: "Thread title",
          titleClassName:
            "wk-chat-conversation-header-channel-info-name--thread",
        }}
      />
    );

    const nameDiv = view
      .getByText("Thread title")
      .closest(".wk-chat-conversation-header-channel-info-name");
    expect(nameDiv?.className).toContain(
      "wk-chat-conversation-header-channel-info-name"
    );
    expect(nameDiv?.className).toContain(
      "wk-chat-conversation-header-channel-info-name--thread"
    );
  });

  it("attaches surfaceRef and applies inactive", () => {
    const { client } = createClient();
    const surfaceRef = { current: null as HTMLDivElement | null };

    const view = render(
      <ConversationWindow
        client={client}
        channel={channel}
        errorModuleName="chat"
        surfaceRef={surfaceRef}
        inactive
        header={{ title: "Direct chat" }}
      />
    );

    expect(surfaceRef.current).toBeTruthy();
    expect(surfaceRef.current?.className).toContain("wk-chat-content-chat");
    expect(surfaceRef.current?.getAttribute("aria-hidden")).toBe("true");
    expect(surfaceRef.current?.hasAttribute("inert")).toBe(true);
    expect(view.getByTestId("legacy-conversation")).toBeTruthy();
  });

  it("clears checked messages on selection cancel", () => {
    const { client } = createClient();
    const view = render(
      <ConversationWindow
        client={client}
        channel={channel}
        errorModuleName="chat"
        header={{ title: "Direct chat" }}
        selection={{
          active: true,
          count: 3,
          label: "Selected 3",
          cancelLabel: "Cancel",
          onCancel: () => {
            conversationContext.clearCheckedMessages();
            conversationContext.setEditOn(false);
          },
        }}
      />
    );

    expect(view.getByText("Selected 3")).toBeTruthy();
    fireEvent.click(view.getByText("Cancel"));
    expect(conversationContext.clearCheckedMessages).toHaveBeenCalled();
    expect(conversationContext.setEditOn).toHaveBeenCalledWith(false);
  });

  it("does not acquire the primary conversation lease in auxiliary mode", async () => {
    const { client, opened } = createClient();

    const view = render(
      <ConversationWindow
        client={client}
        channel={channel}
        mode="auxiliary"
        errorModuleName="chat"
        header={{ title: "Thread" }}
      />
    );

    await Promise.resolve();
    expect(opened).toEqual([]);
    expect(
      view.getByTestId("legacy-conversation").getAttribute("data-auxiliary")
    ).toBe("true");
  });
});
