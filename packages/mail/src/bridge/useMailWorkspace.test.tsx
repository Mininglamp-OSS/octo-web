// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
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
});
