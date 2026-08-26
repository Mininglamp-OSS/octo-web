// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  getState: vi.fn(),
  listMailboxes: vi.fn(),
  listMessages: vi.fn(),
  updateKeywords: vi.fn(),
}));

vi.mock("@octo/base", () => ({
  WKApp: {
    mittBus: {
      emit: testState.emit,
      on: testState.on,
      off: testState.off,
    },
  },
}));

vi.mock("../Service/MailService", () => ({
  default: {
    getState: testState.getState,
    listMailboxes: testState.listMailboxes,
    listMessages: testState.listMessages,
    updateKeywords: testState.updateKeywords,
  },
}));

import useMailWorkspace from "./useMailWorkspace";
import {
  replaceAgentMailboxContext,
  resetAgentMailboxContextForTests,
} from "./mailboxContext";

describe("useMailWorkspace read state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAgentMailboxContextForTests();
    testState.getState.mockResolvedValue("1");
    testState.listMailboxes.mockResolvedValue([
      { id: "inbox", name: "Inbox", total: 1, unread: 1 },
    ]);
    testState.listMessages.mockResolvedValue({
      messages: [
        {
          id: "E1",
          mailbox: "Inbox",
          subject: "Unread",
          from: "sender@example.test",
          to: ["agent@example.test"],
          preview: "body",
          receivedAt: "2026-08-10T00:00:00Z",
          size: 4,
          keywords: [],
          unread: true,
        },
      ],
      total: 1,
      offset: 0,
      limit: 30,
    });
    testState.updateKeywords.mockResolvedValue({ updated: "E1" });
    replaceAgentMailboxContext({
      spaceId: "space-a",
      mailbox: {
        id: "42",
        address: "agent@example.test",
        connectState: "connected",
        outboundMode: "manual_confirmation",
      },
    });
  });

  it("marks Seen locally without a full refresh or losing selection", async () => {
    const { result, unmount } = renderHook(() => useMailWorkspace("fallback"));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    await act(async () => {
      result.current.selectMessage("E1");
      result.current.markMessageRead(result.current.messages[0]!);
      await Promise.resolve();
    });

    expect(result.current.selectedMessageId).toBe("E1");
    expect(result.current.messages[0]?.unread).toBe(false);
    expect(testState.updateKeywords).toHaveBeenCalledWith(
      "42",
      "E1",
      ["\\Seen"],
      []
    );
    expect(testState.emit).toHaveBeenCalledWith("mail-navigation-refresh");
    expect(testState.emit).not.toHaveBeenCalledWith("mail-refresh");

    unmount();
  });

  it("keeps a successful star optimistic without reloading the workspace", async () => {
    const { result, unmount } = renderHook(() => useMailWorkspace("fallback"));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    const initialListCalls = testState.listMessages.mock.calls.length;

    await act(async () => {
      result.current.toggleStar(result.current.messages[0]!);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.messages[0]?.keywords).toContain("\\Flagged");
    expect(testState.listMessages).toHaveBeenCalledTimes(initialListCalls);
    expect(result.current.starringMessageIds).toEqual([]);
    unmount();
  });

  it("refreshes folder counts and the open message list in the background", async () => {
    const { result, unmount } = renderHook(() => useMailWorkspace("fallback"));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    const initialListCalls = testState.listMessages.mock.calls.length;

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    await waitFor(() => expect(testState.getState).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(testState.listMessages.mock.calls.length).toBeGreaterThan(
        initialListCalls
      )
    );
    const unchangedListCalls = testState.listMessages.mock.calls.length;

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(testState.listMessages).toHaveBeenCalledTimes(unchangedListCalls);

    testState.getState.mockResolvedValue("2");
    testState.listMailboxes.mockResolvedValue([
      { id: "inbox", name: "Inbox", total: 2, unread: 2 },
      { id: "sent", name: "Sent", total: 4, unread: 0 },
    ]);
    testState.listMessages.mockResolvedValue({
      messages: [
        {
          id: "E2",
          mailbox: "Inbox",
          subject: "New message",
          from: "new@example.test",
          to: ["agent@example.test"],
          preview: "new body",
          receivedAt: "2026-08-10T00:01:00Z",
          size: 8,
          keywords: [],
          unread: true,
        },
        ...result.current.messages,
      ],
      total: 2,
      offset: 0,
      limit: 30,
    });

    act(() => document.dispatchEvent(new Event("visibilitychange")));

    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    expect(result.current.mailboxes).toEqual([
      { id: "inbox", name: "Inbox", total: 2, unread: 2 },
      { id: "sent", name: "Sent", total: 4, unread: 0 },
    ]);
    expect(result.current.messages[0]?.id).toBe("E2");
    expect(result.current.total).toBe(2);
    expect(result.current.loading).toBe(false);
    expect(testState.getState).toHaveBeenCalledWith(
      "42",
      expect.any(AbortSignal)
    );

    unmount();
  });

  it("keeps later user navigation foreground after a silent refresh", async () => {
    testState.listMailboxes.mockResolvedValue([
      { id: "inbox", name: "Inbox", total: 1, unread: 1 },
      { id: "sent", name: "Sent", total: 0, unread: 0 },
    ]);
    const { result, unmount } = renderHook(() => useMailWorkspace("fallback"));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(testState.getState).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    testState.listMessages.mockRejectedValue(new Error("network down"));
    act(() => result.current.selectMailbox("Sent"));

    await waitFor(() => expect(result.current.error).toBe("fallback"));
    expect(result.current.loading).toBe(false);
    unmount();
  });

  it("clears a stale error after a successful silent refresh", async () => {
    testState.listMessages.mockRejectedValueOnce(new Error("network down"));
    const { result, unmount } = renderHook(() => useMailWorkspace("fallback"));
    await waitFor(() => expect(result.current.error).toBe("fallback"));

    act(() => document.dispatchEvent(new Event("visibilitychange")));

    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.error).toBe("");
    expect(result.current.loading).toBe(false);
    unmount();
  });

  it("keeps a message error when only mailbox resources refresh", async () => {
    testState.listMessages.mockRejectedValue(new Error("network down"));
    const { result, unmount } = renderHook(() => useMailWorkspace("fallback"));
    await waitFor(() => expect(result.current.error).toBe("fallback"));
    const initialMailboxCalls = testState.listMailboxes.mock.calls.length;

    act(() => document.dispatchEvent(new Event("visibilitychange")));

    await waitFor(() =>
      expect(testState.listMailboxes.mock.calls.length).toBeGreaterThan(
        initialMailboxCalls
      )
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.error).toBe("fallback");
    unmount();
  });

  it("keeps a mailbox-resource error when only messages refresh", async () => {
    const { result, unmount } = renderHook(() => useMailWorkspace("fallback"));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    testState.listMailboxes.mockRejectedValue(new Error("network down"));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.error).toBe("fallback"));
    const initialMessageCalls = testState.listMessages.mock.calls.length;

    act(() => document.dispatchEvent(new Event("visibilitychange")));

    await waitFor(() =>
      expect(testState.listMessages.mock.calls.length).toBeGreaterThan(
        initialMessageCalls
      )
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.error).toBe("fallback");
    unmount();
  });

  it("keeps a poll foreground while a user request is in flight", async () => {
    testState.listMailboxes.mockResolvedValue([
      { id: "inbox", name: "Inbox", total: 1, unread: 1 },
      { id: "sent", name: "Sent", total: 0, unread: 0 },
    ]);
    const { result, unmount } = renderHook(() => useMailWorkspace("fallback"));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    const initialMessageCalls = testState.listMessages.mock.calls.length;
    let resolveUserRequest!: (value: {
      messages: never[];
      total: number;
      offset: number;
      limit: number;
    }) => void;
    const userRequest = new Promise<{
      messages: never[];
      total: number;
      offset: number;
      limit: number;
    }>((resolve) => {
      resolveUserRequest = resolve;
    });
    testState.listMessages
      .mockImplementationOnce(() => userRequest)
      .mockRejectedValueOnce(new Error("network down"));

    act(() => result.current.selectMailbox("Sent"));
    await waitFor(() =>
      expect(testState.listMessages).toHaveBeenCalledTimes(
        initialMessageCalls + 1
      )
    );

    act(() => document.dispatchEvent(new Event("visibilitychange")));

    await waitFor(() => expect(result.current.error).toBe("fallback"));
    expect(result.current.loading).toBe(false);

    await act(async () => {
      resolveUserRequest({ messages: [], total: 0, offset: 0, limit: 30 });
      await userRequest;
    });
    unmount();
  });

  it("keeps a queued reload foreground when a poll settles in the same batch", async () => {
    const { result, unmount } = renderHook(() => useMailWorkspace("fallback"));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    let resolveState!: (value: string) => void;
    const pendingState = new Promise<string>((resolve) => {
      resolveState = resolve;
    });
    testState.getState.mockImplementationOnce(() => pendingState);
    testState.listMailboxes.mockRejectedValue(new Error("network down"));
    testState.listMessages.mockRejectedValue(new Error("network down"));

    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(testState.getState).toHaveBeenCalledTimes(1));

    await act(async () => {
      result.current.reload();
      resolveState("2");
      await pendingState;
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.error).toBe("fallback"));
    expect(result.current.loading).toBe(false);
    unmount();
  });

  it("keeps the open message during a silent unread-only refresh", async () => {
    const secondMessage = {
      id: "E2",
      mailbox: "Inbox",
      subject: "Another unread message",
      from: "another@example.test",
      to: ["agent@example.test"],
      preview: "another body",
      receivedAt: "2026-08-10T00:01:00Z",
      size: 8,
      keywords: [],
      unread: true,
    };
    testState.listMessages.mockResolvedValue({
      messages: [
        {
          id: "E1",
          mailbox: "Inbox",
          subject: "Unread",
          from: "sender@example.test",
          to: ["agent@example.test"],
          preview: "body",
          receivedAt: "2026-08-10T00:00:00Z",
          size: 4,
          keywords: [],
          unread: true,
        },
        secondMessage,
      ],
      total: 2,
      offset: 0,
      limit: 30,
    });
    const { result, unmount } = renderHook(() => useMailWorkspace("fallback"));
    await waitFor(() => expect(result.current.messages).toHaveLength(2));

    act(() => result.current.setUnreadOnly(true));
    await waitFor(() =>
      expect(testState.listMessages).toHaveBeenLastCalledWith(
        expect.objectContaining({ unread: true })
      )
    );
    await act(async () => {
      result.current.selectMessage("E1");
      result.current.markMessageRead(result.current.messages[0]!);
      await Promise.resolve();
    });
    expect(result.current.messages[0]?.unread).toBe(false);

    testState.getState.mockResolvedValue("2");
    testState.listMessages.mockResolvedValue({
      messages: [secondMessage],
      total: 1,
      offset: 0,
      limit: 30,
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    await waitFor(() => expect(result.current.total).toBe(1));
    expect(result.current.selectedMessageId).toBe("E1");
    expect(result.current.messages.map((message) => message.id)).toEqual([
      "E2",
    ]);
    expect(result.current.loading).toBe(false);

    act(() => result.current.reload());
    await waitFor(() => expect(result.current.selectedMessageId).toBe(""));
    unmount();
  });

  it("keeps the selection when a silent refresh moves it off the page", async () => {
    const { result, unmount } = renderHook(() => useMailWorkspace("fallback"));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    act(() => result.current.selectMessage("E1"));

    testState.getState.mockResolvedValue("2");
    testState.listMessages.mockResolvedValue({
      messages: [
        {
          id: "E2",
          mailbox: "Inbox",
          subject: "New message",
          from: "new@example.test",
          to: ["agent@example.test"],
          preview: "new body",
          receivedAt: "2026-08-10T00:01:00Z",
          size: 8,
          keywords: [],
          unread: true,
        },
      ],
      total: 1,
      offset: 0,
      limit: 30,
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    await waitFor(() => expect(result.current.messages[0]?.id).toBe("E2"));
    expect(result.current.selectedMessageId).toBe("E1");
    expect(result.current.loading).toBe(false);

    act(() => result.current.reload());
    await waitFor(() => expect(result.current.selectedMessageId).toBe(""));
    unmount();
  });
});
