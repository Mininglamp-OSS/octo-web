import { afterEach, describe, expect, it, vi } from "vitest";
import { expireStandaloneSession } from "../standaloneSessionExpiry";

// Stub out the storage-level helper – not under test here.
vi.mock("../recoverSession", () => ({
  clearSessionsWithToken: vi.fn(),
}));
import { clearSessionsWithToken } from "../recoverSession";

// ---------------------------------------------------------------------------
// Shared fake "window-like" target factory.
// ---------------------------------------------------------------------------
function makeTarget() {
  return {
    sessionStorage: { removeItem: vi.fn(), getItem: vi.fn(), setItem: vi.fn(), key: vi.fn(), clear: vi.fn(), length: 0 },
    localStorage:   { removeItem: vi.fn(), getItem: vi.fn(), setItem: vi.fn(), key: vi.fn(), clear: vi.fn(), length: 0 },
    location: { reload: vi.fn() },
  };
}

afterEach(() => vi.clearAllMocks());

describe("expireStandaloneSession", () => {
  it("calls reload after a successful logout", async () => {
    const target = makeTarget();
    const login = { token: "tok1", logout: vi.fn(async () => {}) };

    await expireStandaloneSession(login, target);

    expect(login.logout).toHaveBeenCalledOnce();
    expect(target.location.reload).toHaveBeenCalledOnce();
  });

  it("clears token buckets when a token is present", async () => {
    const target = makeTarget();
    const login = { token: "tok1", logout: vi.fn(async () => {}) };

    await expireStandaloneSession(login, target);

    expect(clearSessionsWithToken).toHaveBeenCalledWith(
      "tok1",
      target.sessionStorage,
      target.localStorage,
    );
  });

  it("skips clearSessionsWithToken when token is absent", async () => {
    const target = makeTarget();
    const login = { logout: vi.fn(async () => {}) };

    await expireStandaloneSession(login, target);

    expect(clearSessionsWithToken).not.toHaveBeenCalled();
    expect(target.location.reload).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // REGRESSION: reload must run even when logout() rejects.
  //
  // Prior to the fix the rejected `await cleanup` propagated out of the
  // function and `target.location.reload()` was never reached, leaving the
  // expired standalone page in place and producing an unhandled rejection.
  // -------------------------------------------------------------------------
  it("still reloads when logout() rejects", async () => {
    const target = makeTarget();
    const logoutError = new Error("IndexedDB write failed");
    const login = { token: "tok1", logout: vi.fn(async () => { throw logoutError; }) };
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Must NOT throw to the caller (void call-site in Layout/index.tsx).
    await expect(expireStandaloneSession(login, target)).resolves.toBeUndefined();

    expect(target.location.reload).toHaveBeenCalledOnce();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("logout cleanup failed"),
      logoutError,
    );

    consoleSpy.mockRestore();
  });

  it("still reloads when logout() throws synchronously", async () => {
    const target = makeTarget();
    const syncError = new Error("sync throw");
    const login = {
      token: "",
      logout: vi.fn(() => { throw syncError; }) as () => void | Promise<void>,
    };
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(expireStandaloneSession(login, target)).resolves.toBeUndefined();

    expect(target.location.reload).toHaveBeenCalledOnce();

    consoleSpy.mockRestore();
  });
});


it("reloads after bounded cleanup and clears token buckets even on a synchronous logout failure", async () => {
  vi.useFakeTimers();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const target = makeTarget();
    const pending = expireStandaloneSession({ token: "tok1", logout: () => new Promise(() => {}) }, target);
    expect(clearSessionsWithToken).toHaveBeenCalledWith("tok1", target.sessionStorage, target.localStorage);
    await vi.advanceTimersByTimeAsync(4999);
    expect(target.location.reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(target.location.reload).toHaveBeenCalledOnce();
    vi.clearAllMocks();
    await expireStandaloneSession({ token: "tok1", logout: () => { throw new Error("storage"); } }, target);
    expect(clearSessionsWithToken).toHaveBeenCalledWith("tok1", target.sessionStorage, target.localStorage);
    expect(target.location.reload).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); log.mockRestore(); }
});
