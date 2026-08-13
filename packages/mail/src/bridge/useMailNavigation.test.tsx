// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("useMailNavigation Space isolation", () => {
  beforeEach(() => {
    testState.listeners.clear();
    testState.currentSpaceId = "space-a";
    testState.listAgentMailboxes.mockReset();
    testState.listMailboxes.mockReset();
    resetAgentMailboxContextForTests();
    window.sessionStorage.clear();
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
});
