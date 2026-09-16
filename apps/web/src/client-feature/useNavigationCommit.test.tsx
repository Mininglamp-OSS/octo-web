import React from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNavigationCommit } from "./useNavigationCommit";

describe("navigation controller bridge lifetime", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps one controller for a stable bridge", () => {
    const bridge = { reportNavigationCommitted: vi.fn(async () => {}) };
    const hook = renderHook(() => useNavigationCommit(bridge));
    const first = hook.result.current;
    hook.rerender();
    expect(hook.result.current).toBe(first);
  });

  it("negotiates capability again when the bridge changes", () => {
    const bridge = {} as { reportNavigationCommitted?: (input: { navigationId: number }) => Promise<void> };
    const hook = renderHook(({ bridge }) => useNavigationCommit(bridge), { initialProps: { bridge } });
    expect(hook.result.current).toBeUndefined();
    hook.rerender({ bridge: { reportNavigationCommitted: vi.fn(async () => {}) } });
    expect(hook.result.current).toBeDefined();
  });

  it("disposes an old controller without allowing its colliding token to release the new one", async () => {
    const first = { reportNavigationCommitted: vi.fn(async () => {}) };
    const next = { reportNavigationCommitted: vi.fn(async () => {}) };
    const hook = renderHook(({ bridge }) => useNavigationCommit(bridge), { initialProps: { bridge: first } });
    const oldController = hook.result.current!;
    const oldToken = oldController.start({ navigationId: 1 })!;
    hook.rerender({ bridge: next });
    const current = hook.result.current!;
    const newToken = current.start({ navigationId: 2 })!;
    expect(newToken).toBe(oldToken);
    await act(async () => oldController.pageCommitted(oldToken));
    expect(first.reportNavigationCommitted).not.toHaveBeenCalled();
    expect(next.reportNavigationCommitted).not.toHaveBeenCalled();
    await act(async () => current.pageCommitted(newToken));
    expect(next.reportNavigationCommitted).toHaveBeenCalledExactlyOnceWith({ navigationId: 2 });
  });

  it.each(["unmount", "replace"])("cancels scheduled retries on %s", async (action) => {
    vi.useFakeTimers();
    const first = { reportNavigationCommitted: vi.fn(async () => { throw new Error("transient"); }) };
    const hook = renderHook(({ bridge }) => useNavigationCommit(bridge), { initialProps: { bridge: first } });
    await act(async () => {
      hook.result.current!.start({ navigationId: 1, pageCommitted: true });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(first.reportNavigationCommitted).toHaveBeenCalledTimes(1);
    if (action === "unmount") hook.unmount();
    else hook.rerender({ bridge: { reportNavigationCommitted: vi.fn(async () => {}) } });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(first.reportNavigationCommitted).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("remains usable after StrictMode's setup-cleanup-setup cycle", async () => {
    const bridge = { reportNavigationCommitted: vi.fn(async () => {}) };
    const hook = renderHook(() => useNavigationCommit(bridge), {
      wrapper: ({ children }) => <React.StrictMode>{children}</React.StrictMode>,
    });
    await act(async () => hook.result.current!.start({ navigationId: 1, pageCommitted: true }));
    expect(bridge.reportNavigationCommitted).toHaveBeenCalledExactlyOnceWith({ navigationId: 1 });
  });
});
