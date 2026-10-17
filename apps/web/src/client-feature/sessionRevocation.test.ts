import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetEmbeddedSessionRevocationForTests,
  revokeEmbeddedSession,
} from "./sessionRevocation";

// ---------------------------------------------------------------------------
// WKApp stub – hoisted so the factory sees no outer-scope `let` bindings.
// ---------------------------------------------------------------------------
vi.mock("@octo/base", () => {
  const logout = vi.fn<[], void | Promise<void>>();
  return { WKApp: { loginInfo: { logout } } };
});

import { WKApp } from "@octo/base";

afterEach(() => {
  resetEmbeddedSessionRevocationForTests();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helper: fast-forward the 5 s macro timer and drain microtask queues.
// ---------------------------------------------------------------------------
async function flushAll() {
  vi.runAllTimers();
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("revokeEmbeddedSession", () => {
  it("returns the same promise on repeated calls", () => {
    const p1 = revokeEmbeddedSession();
    const p2 = revokeEmbeddedSession();
    expect(p1).toBe(p2);
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

  // -------------------------------------------------------------------------
  // REGRESSION: Shell listener registered BEFORE runtime listener.
  //
  // Prior to the fix, the Shell call (no cleanup) created the singleton and
  // the subsequent Runtime call (with clearDrafts) was silently ignored because
  // the singleton body ran synchronously, snapshotting an empty callback list
  // before clearDrafts could be pushed.
  //
  // The fix defers singleton execution by one microtask so both synchronous
  // callers in the same event-loop turn can register their callbacks first.
  //
  // In production the Runtime handler pre-invokes clearDrafts synchronously
  // (for invocation-order guarantees) and passes the resulting promise as a
  // callback; this test mirrors that pattern.
  // -------------------------------------------------------------------------
  it("runs clearDrafts even when the shell listener fires before the runtime listener", async () => {
    vi.useFakeTimers();
    try {
      let draftsCleared = false;
      const draftPromise = Promise.resolve().then(() => { draftsCleared = true; });
      const clearDrafts = vi.fn(() => draftPromise);

      // 1. Shell listener fires first — no cleanup callback.
      void revokeEmbeddedSession();

      // 2. Runtime listener fires immediately after — with clearDrafts.
      // The callback is invoked synchronously when revokeEmbeddedSession is
      // called, so clearDrafts is already running by this point.
      void revokeEmbeddedSession(clearDrafts);

      // clearDrafts is invoked synchronously; logout is called inside the
      // singleton body before the first await (synchronous prologue).
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

      await Promise.resolve(); // singleton microtask fires
      await Promise.resolve(); // logout is invoked but doesn't settle
      expect(settled).not.toHaveBeenCalled();

      await flushAll(); // 5 s timeout fires
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
