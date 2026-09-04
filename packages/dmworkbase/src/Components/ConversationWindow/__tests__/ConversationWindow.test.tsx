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
const conversationTestState = vi.hoisted(() => ({ throwOnRender: false }));

vi.mock("../../Conversation", async () => {
  const ReactModule = await import("react");
  return {
    Conversation: (props: any) => {
      if (conversationTestState.throwOnRender) {
        throw new Error("conversation render failed");
      }
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

vi.mock("../../ErrorBoundary", async () => {
  const ReactModule = await import("react");
  class TestErrorBoundary extends ReactModule.Component<
    { children: React.ReactNode; onError?: (error: Error, info: React.ErrorInfo) => void },
    { hasError: boolean }
  > {
    state = { hasError: false };

    static getDerivedStateFromError() {
      return { hasError: true };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
      this.props.onError?.(error, info);
    }

    render() {
      return this.state.hasError
        ? <div data-testid="conversation-error-boundary" />
        : this.props.children;
    }
  }

  return { ErrorBoundary: TestErrorBoundary };
});

import ConversationWindow from "../index";

function createClient(options: { failOpenOnce?: boolean } = {}) {
  const released: string[] = [];
  const opened: ChatChannelRef[] = [];
  let shouldFailOpen = options.failOpenOnce === true;
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
      if (shouldFailOpen) {
        shouldFailOpen = false;
        throw new Error("open failed");
      }
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
    conversationTestState.throwOnRender = false;
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

  it("shows a recoverable state when opening the conversation fails", async () => {
    const { client, opened } = createClient({ failOpenOnce: true });
    const unbind = vi.fn();
    const bind = vi.fn(() => unbind);

    const view = render(
      <ConversationWindow
        client={client}
        channel={channel}
        errorModuleName="chat"
        bindConversationContext={bind}
        header={{ title: "Direct chat" }}
      />
    );

    await waitFor(() => expect(bind).toHaveBeenCalledWith(conversationContext));
    await waitFor(() => expect(view.getByRole("alert")).toBeTruthy());
    await waitFor(() => expect(unbind).toHaveBeenCalledTimes(1));
    expect(view.queryByTestId("legacy-conversation")).toBeNull();

    fireEvent.click(view.getByRole("button", { name: /retry|重试/i }));

    await waitFor(() => expect(view.getByTestId("legacy-conversation")).toBeTruthy());
    expect(opened).toEqual([{ channelId: "person-1", channelType: 1 }]);
  });

  it("releases the bound context when Conversation is caught by its error boundary", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = createClient();
    const unbind = vi.fn();
    const bind = vi.fn(() => unbind);
    const props = {
      client,
      channel,
      errorModuleName: "chat",
      bindConversationContext: bind,
      header: { title: "Direct chat" },
    };

    const view = render(<ConversationWindow {...props} />);
    await waitFor(() => expect(bind).toHaveBeenCalledWith(conversationContext));

    conversationTestState.throwOnRender = true;
    view.rerender(<ConversationWindow {...props} />);

    await waitFor(() => expect(view.getByTestId("conversation-error-boundary")).toBeTruthy());
    await waitFor(() => expect(unbind).toHaveBeenCalledTimes(1));
    consoleSpy.mockRestore();
  });
});
