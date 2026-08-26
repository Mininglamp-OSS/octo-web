// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    listeners,
    currentSpaceId: "space-a",
    listAgentMailboxes: vi.fn(),
    listMailboxes: vi.fn(),
    on(event: string, listener: (...args: unknown[]) => void) {
      const current = listeners.get(event) ?? new Set();
      current.add(listener);
      listeners.set(event, current);
    },
    off(event: string, listener: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(listener);
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
  };
});

vi.mock("@octo/base", () => ({
  WKApp: {
    shared: {
      get currentSpaceId() {
        return testState.currentSpaceId;
      },
    },
    mittBus: {
      on: testState.on,
      off: testState.off,
      emit: testState.emit,
    },
  },
}));

vi.mock("../Service/MailService", () => ({
  default: {
    listAgentMailboxes: testState.listAgentMailboxes,
    listMailboxes: testState.listMailboxes,
  },
}));

import useMailNavigation from "./useMailNavigation";
import {
  getAgentMailboxContext,
  replaceAgentMailboxContext,
  resetAgentMailboxContextForTests,
} from "./mailboxContext";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("useMailNavigation", () => {
  beforeEach(() => {
    testState.listeners.clear();
    testState.currentSpaceId = "space-a";
    testState.listAgentMailboxes.mockReset();
    testState.listMailboxes.mockReset();
    resetAgentMailboxContextForTests();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("clears old state and ignores a stale mailbox-account response", async () => {
    const oldAccounts = deferred<
      Array<{
        id: string;
        address: string;
        connectState: "connected" | "unconnected";
      }>
    >();
    const newAccounts = deferred<
      Array<{
        id: string;
        address: string;
        connectState: "connected" | "unconnected";
      }>
    >();

    testState.listAgentMailboxes
      .mockReturnValueOnce(oldAccounts.promise)
      .mockReturnValueOnce(newAccounts.promise);
    testState.listMailboxes.mockResolvedValue([
      { id: "new-inbox", name: "Inbox", total: 1, unread: 1 },
    ]);

    const { result, unmount } = renderHook(() => useMailNavigation("fallback"));

    expect(testState.listAgentMailboxes).toHaveBeenCalledTimes(1);

    act(() => {
      testState.currentSpaceId = "space-b";
      testState.emit("space-changed");
    });

    expect(result.current.mailboxes).toEqual([]);
    expect(result.current.selectedAgentMailbox).toBeNull();
    expect(result.current.loading).toBe(true);
    expect(testState.listAgentMailboxes).toHaveBeenCalledTimes(2);

    await act(async () => {
      newAccounts.resolve([
        {
          id: "22",
          address: "new-space@demo.octo.test",
          connectState: "unconnected",
        },
      ]);
      await newAccounts.promise;
      await Promise.resolve();
    });

    expect(testState.listMailboxes).toHaveBeenCalledWith("22");
    expect(result.current.identity?.address).toBe("new-space@demo.octo.test");
    expect(result.current.mailboxes[0]?.id).toBe("new-inbox");
    expect(result.current.loading).toBe(false);

    await act(async () => {
      oldAccounts.resolve([
        {
          id: "11",
          address: "old-space@demo.octo.test",
          connectState: "connected",
        },
      ]);
      await oldAccounts.promise;
    });

    expect(result.current.identity?.address).toBe("new-space@demo.octo.test");
    expect(result.current.selectedAgentMailbox?.id).toBe("22");

    unmount();
  });

  it("does not let an in-flight refresh restore the previously selected mailbox", async () => {
    const initial = [
      {
        id: "11",
        address: "a@demo.octo.test",
        connectState: "unconnected" as const,
        outboundMode: "manual_confirmation" as const,
      },
      {
        id: "12",
        address: "b@demo.octo.test",
        connectState: "unconnected" as const,
        outboundMode: "manual_confirmation" as const,
      },
    ];
    const refresh = deferred<typeof initial>();
    testState.listAgentMailboxes
      .mockResolvedValueOnce(initial)
      .mockReturnValueOnce(refresh.promise);
    testState.listMailboxes.mockResolvedValue([]);
    replaceAgentMailboxContext({ spaceId: "space-a", mailbox: initial[0] });

    const { result } = renderHook(() => useMailNavigation("fallback"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => testState.emit("mail-refresh"));
    act(() => {
      result.current.selectAgentMailbox(initial[1]);
    });
    expect(result.current.selectedAgentMailbox?.id).toBe("12");

    await act(async () => {
      refresh.resolve(initial);
      await refresh.promise;
      await Promise.resolve();
    });

    expect(result.current.selectedAgentMailbox?.id).toBe("12");
  });

  it("refreshes Agent mailbox binding after returning from an authorization tab", async () => {
    const refreshedAccounts = deferred<
      Array<{
        id: string;
        address: string;
        connectState: "connected" | "unconnected";
      }>
    >();
    testState.listAgentMailboxes
      .mockResolvedValueOnce([
        {
          id: "11",
          address: "agent@demo.octo.test",
          connectState: "unconnected",
        },
      ])
      .mockReturnValueOnce(refreshedAccounts.promise);
    testState.listMailboxes.mockResolvedValue([]);

    const { result, unmount } = renderHook(() => useMailNavigation("fallback"));
    await waitFor(() =>
      expect(result.current.selectedAgentMailbox?.connectState).toBe(
        "unconnected"
      )
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => window.dispatchEvent(new Event("focus")));
    expect(testState.listAgentMailboxes).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
    });

    expect(testState.listAgentMailboxes).toHaveBeenCalledTimes(2);
    expect(result.current.loading).toBe(false);

    await act(async () => {
      refreshedAccounts.resolve([
        {
          id: "11",
          address: "agent@demo.octo.test",
          connectState: "connected",
        },
      ]);
      await refreshedAccounts.promise;
    });

    await waitFor(() =>
      expect(result.current.selectedAgentMailbox?.connectState).toBe(
        "connected"
      )
    );
    expect(testState.listAgentMailboxes).toHaveBeenCalledTimes(2);
    expect(result.current.loading).toBe(false);
    unmount();
  });

  it("refreshes mailbox unread counts without showing a loading state", async () => {
    const account = {
      id: "11",
      address: "agent@demo.octo.test",
      connectState: "connected" as const,
    };
    testState.listAgentMailboxes.mockResolvedValue([account]);
    testState.listMailboxes
      .mockResolvedValueOnce([
        { id: "drafts", name: "Drafts", total: 1, unread: 1 },
      ])
      .mockResolvedValueOnce([
        { id: "drafts", name: "Drafts", total: 1, unread: 0 },
      ]);

    const { result, unmount } = renderHook(() => useMailNavigation("fallback"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.mailboxes[0]?.unread).toBe(1);

    act(() => testState.emit("mail-navigation-refresh"));

    expect(result.current.loading).toBe(false);
    await waitFor(() => expect(result.current.mailboxes[0]?.unread).toBe(0));
    expect(result.current.loading).toBe(false);
    unmount();
  });

  it("keeps existing navigation state when a background refresh fails", async () => {
    const account = {
      id: "11",
      address: "agent@demo.octo.test",
      connectState: "connected" as const,
    };
    const inbox = { id: "inbox", name: "Inbox", total: 3, unread: 1 };
    testState.listAgentMailboxes
      .mockResolvedValueOnce([account])
      .mockRejectedValueOnce(new Error("background refresh failed"))
      .mockRejectedValueOnce(new Error("manual refresh failed"));
    testState.listMailboxes.mockResolvedValue([inbox]);

    const { result } = renderHook(() => useMailNavigation("fallback"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.mailboxes).toEqual([inbox]);

    act(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() =>
      expect(testState.listAgentMailboxes).toHaveBeenCalledTimes(2)
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.agentMailboxes).toEqual([account]);
    expect(result.current.selectedAgentMailbox).toEqual(account);
    expect(result.current.mailboxes).toEqual([inbox]);
    expect(getAgentMailboxContext()?.mailbox).toEqual(account);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("");

    act(() => testState.emit("mail-refresh"));

    await waitFor(() => expect(result.current.error).toBe("fallback"));
    expect(result.current.agentMailboxes).toEqual([]);
    expect(result.current.selectedAgentMailbox).toBeNull();
    expect(getAgentMailboxContext()).toBeNull();
  });

  it("clears a stale mailbox error after a silent refresh succeeds", async () => {
    const account = {
      id: "11",
      address: "agent@demo.octo.test",
      connectState: "connected" as const,
    };
    const inbox = { id: "inbox", name: "Inbox", total: 3, unread: 1 };
    testState.listAgentMailboxes.mockResolvedValue([account]);
    testState.listMailboxes
      .mockRejectedValueOnce(new Error("mailbox refresh failed"))
      .mockResolvedValueOnce([inbox]);

    const { result } = renderHook(() => useMailNavigation("fallback"));
    await waitFor(() => expect(result.current.error).toBe("fallback"));
    expect(result.current.mailboxes).toEqual([]);

    act(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => expect(result.current.error).toBe(""));
    expect(result.current.mailboxes).toEqual([inbox]);
    expect(result.current.loading).toBe(false);
  });

  it("coalesces visible and focus events into one binding refresh", async () => {
    let visibilityState: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visibilityState
    );
    testState.listAgentMailboxes.mockResolvedValue([
      {
        id: "11",
        address: "agent@demo.octo.test",
        connectState: "unconnected",
      },
    ]);
    testState.listMailboxes.mockResolvedValue([]);

    const { unmount } = renderHook(() => useMailNavigation("fallback"));
    await waitFor(() =>
      expect(testState.listAgentMailboxes).toHaveBeenCalledTimes(1)
    );

    act(() => {
      visibilityState = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
      visibilityState = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() =>
      expect(testState.listAgentMailboxes).toHaveBeenCalledTimes(2)
    );
    unmount();
  });
});
