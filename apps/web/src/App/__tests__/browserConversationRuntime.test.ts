import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  loggedIn: true,
  listeners: new Set<() => void>(),
  retain: vi.fn(),
  release: vi.fn(),
}));

vi.mock("@octo/base", () => ({
  WKApp: {
    loginInfo: { isLogined: () => state.loggedIn },
    mittBus: {
      on: (_event: string, listener: () => void) => state.listeners.add(listener),
      off: (_event: string, listener: () => void) => state.listeners.delete(listener),
    },
  },
  getCurrentImConversationStore: () => ({ retain: state.retain }),
}));

import { startBrowserConversationRuntime } from "../browserConversationRuntime";

function authChanged(): void {
  for (const listener of [...state.listeners]) listener();
}

beforeEach(() => {
  state.loggedIn = true;
  state.listeners.clear();
  state.release.mockReset();
  state.retain.mockReset().mockReturnValue(state.release);
});

describe("ordinary Web conversation ownership", () => {
  it("holds data for the application without needing a chat page", () => {
    const stop = startBrowserConversationRuntime();
    expect(state.retain).toHaveBeenCalledOnce();
    expect(state.release).not.toHaveBeenCalled();
    authChanged();
    authChanged();
    expect(state.retain).toHaveBeenCalledOnce();
    stop();
    expect(state.release).toHaveBeenCalledOnce();
    expect(state.listeners.size).toBe(0);
  });

  it("waits for login and releases on logout", () => {
    state.loggedIn = false;
    const stop = startBrowserConversationRuntime();
    expect(state.retain).not.toHaveBeenCalled();
    state.loggedIn = true;
    authChanged();
    expect(state.retain).toHaveBeenCalledOnce();
    state.loggedIn = false;
    authChanged();
    expect(state.release).toHaveBeenCalledOnce();
    stop();
    expect(state.release).toHaveBeenCalledOnce();
  });

  it("can acquire a new login after the previous session ended", () => {
    const stop = startBrowserConversationRuntime();
    state.loggedIn = false;
    authChanged();
    state.loggedIn = true;
    authChanged();
    expect(state.retain).toHaveBeenCalledTimes(2);
    stop();
    expect(state.release).toHaveBeenCalledTimes(2);
  });

  it("ignores captured auth callbacks after an idempotent stop", () => {
    const stop = startBrowserConversationRuntime();
    const callback = [...state.listeners][0];
    stop();
    stop();
    callback();
    expect(state.retain).toHaveBeenCalledOnce();
    expect(state.release).toHaveBeenCalledOnce();
  });

  it("cleans a failed start before another mount", () => {
    state.retain.mockImplementationOnce(() => { throw new Error("start failed"); });
    expect(() => startBrowserConversationRuntime()).toThrow("start failed");
    expect(state.listeners.size).toBe(0);
    const stop = startBrowserConversationRuntime();
    expect(state.listeners.size).toBe(1);
    stop();
    expect(state.release).toHaveBeenCalledOnce();
  });

  it("balances StrictMode start-stop-start without orphan listeners", () => {
    const firstStop = startBrowserConversationRuntime();
    firstStop();
    const secondStop = startBrowserConversationRuntime();
    expect(state.listeners.size).toBe(1);
    expect(state.retain).toHaveBeenCalledTimes(2);
    secondStop();
    expect(state.listeners.size).toBe(0);
    expect(state.release).toHaveBeenCalledTimes(2);
  });

  it("does not acquire twice when startup synchronously emits auth", () => {
    state.retain.mockImplementationOnce(() => {
      authChanged();
      return state.release;
    });
    const stop = startBrowserConversationRuntime();
    expect(state.retain).toHaveBeenCalledOnce();
    stop();
    expect(state.release).toHaveBeenCalledOnce();
  });

  it("releases an acquisition that synchronously logs out, then accepts a later login", () => {
    state.retain.mockImplementationOnce(() => {
      state.loggedIn = false;
      authChanged();
      return state.release;
    });
    const stop = startBrowserConversationRuntime();
    expect(state.release).toHaveBeenCalledOnce();
    state.loggedIn = true;
    authChanged();
    expect(state.retain).toHaveBeenCalledTimes(2);
    stop();
    expect(state.release).toHaveBeenCalledTimes(2);
  });

  it("releases an acquisition if the app stops during a subsequent login", () => {
    state.loggedIn = false;
    const stop = startBrowserConversationRuntime();
    state.retain.mockImplementationOnce(() => {
      stop();
      return state.release;
    });
    state.loggedIn = true;
    authChanged();
    expect(state.release).toHaveBeenCalledOnce();
    expect(state.listeners.size).toBe(0);
    stop();
    expect(state.release).toHaveBeenCalledOnce();
  });
});
