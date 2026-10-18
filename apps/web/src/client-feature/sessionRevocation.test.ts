import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetEmbeddedSessionRevocationForTests,
  revokeEmbeddedSession,
  revokeAndReloadEmbeddedSession,
} from "./sessionRevocation";

vi.mock("@octo/base", () => {
  const logout = vi.fn<[], void | Promise<void>>();
  return { WKApp: { loginInfo: { logout } } };
});

import { WKApp } from "@octo/base";

afterEach(() => {
  resetEmbeddedSessionRevocationForTests();
  vi.resetAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function flushAll() {
  await vi.runAllTimersAsync();
}

describe("revokeEmbeddedSession", () => {
  it("returns the same promise on repeated calls", async () => {
    const p1 = revokeEmbeddedSession();
    const p2 = revokeEmbeddedSession();
    expect(p1).toBe(p2);
    await p1;
  });

  it("invokes logout exactly once regardless of call count", async () => {
    vi.useFakeTimers();
    try {
      revokeEmbeddedSession();
      revokeEmbeddedSession();
      await flushAll();
      expect(WKApp.loginInfo.logout).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs clearDrafts even when the shell listener fires before the runtime listener", async () => {
    vi.useFakeTimers();
    try {
      const draftPromise = Promise.resolve();
      const clearDrafts = vi.fn(() => draftPromise);

      void revokeEmbeddedSession();

      void revokeEmbeddedSession(clearDrafts);

      expect(clearDrafts).toHaveBeenCalledOnce();

      await flushAll();

      expect(clearDrafts).toHaveBeenCalledOnce();
      expect(WKApp.loginInfo.logout).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("still resolves even when clearDrafts rejects", async () => {
    vi.useFakeTimers();
    try {
      const clearDrafts = vi.fn(async () => { throw new Error("IndexedDB error"); });

      const promise = revokeEmbeddedSession();
      void revokeEmbeddedSession(clearDrafts);

      await flushAll();

      await expect(promise).resolves.toBeUndefined();
      expect(clearDrafts).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves via timeout even when logout hangs indefinitely", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(WKApp.loginInfo.logout).mockReturnValue(new Promise(() => {}));

      const settled = vi.fn();
      void revokeEmbeddedSession().then(settled);

      await Promise.resolve();
      await Promise.resolve();
      expect(settled).not.toHaveBeenCalled();

      await flushAll();
      expect(settled).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("accumulates multiple cleanup callbacks and runs all of them", async () => {
    vi.useFakeTimers();
    try {
      const cb1 = vi.fn(async () => {});
      const cb2 = vi.fn(async () => {});
      const cb3 = vi.fn(async () => {});

      void revokeEmbeddedSession(cb1);
      void revokeEmbeddedSession(cb2);
      void revokeEmbeddedSession(cb3);

      await flushAll();

      expect(cb1).toHaveBeenCalledOnce();
      expect(cb2).toHaveBeenCalledOnce();
      expect(cb3).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});

it.each(["hang", "reject", "throw"] as const)("reloads exactly once when logout can %s", async mode => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const reload = vi.fn();
  vi.stubGlobal("window", { location: { reload } });
  vi.mocked(WKApp.loginInfo.logout).mockImplementation(() => {
    if (mode === "throw") throw new Error("storage");
    if (mode === "reject") return Promise.reject(new Error("storage"));
    return new Promise<void>(() => {});
  });
  const pending = revokeAndReloadEmbeddedSession();
  expect(revokeAndReloadEmbeddedSession()).toBe(pending);
  await vi.advanceTimersByTimeAsync(5000);
  await pending;
  expect(reload).toHaveBeenCalledOnce();
  expect(WKApp.loginInfo.logout).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it.each([true, false])("waits for the remaining native cleanup after another task rejects (shell first=%s)", async shellFirst => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const reload = vi.fn();
  vi.stubGlobal("window", { location: { reload } });
  vi.mocked(WKApp.loginInfo.logout).mockRejectedValue(new Error("browser storage"));
  let finish!: () => void;
  const nativeCleanup = new Promise<void>(resolve => { finish = resolve; });
  if (shellFirst) void revokeAndReloadEmbeddedSession();
  const pending = revokeAndReloadEmbeddedSession(() => nativeCleanup);
  if (!shellFirst) void revokeAndReloadEmbeddedSession();
  await vi.advanceTimersByTimeAsync(0);
  expect(reload).not.toHaveBeenCalled();
  finish();
  await pending;
  expect(reload).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
