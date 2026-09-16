import { afterEach, describe, expect, it, vi } from "vitest";
import { createLazyCommunicationUi } from "./lazyUi";

afterEach(() => vi.useRealTimers());
describe("lazy communication UI", () => {
  it("does not import UI until requested and mounts only once", async () => {
    const unmount = vi.fn();
    const mount = vi.fn(async (ready: () => void) => { ready(); return unmount; });
    const load = vi.fn(async () => ({ mount }));
    const ui = createLazyCommunicationUi(load);
    expect(load).not.toHaveBeenCalled();
    await Promise.all([ui.ensureReady(), ui.ensureReady(), ui.start()]);
    expect(load).toHaveBeenCalledOnce();
    expect(mount).toHaveBeenCalledOnce();
    ui.dispose();
    ui.dispose();
    expect(unmount).toHaveBeenCalledOnce();
  });
  it("drops pre-mount targets on scope switch and replays only the latest target", async () => {
    const ui = createLazyCommunicationUi(async () => ({ mount: async () => () => {} }));
    ui.dispatch({ type: "navigate", page: "chat", target: { channelId: "old", channelType: 1 } });
    ui.dispatch({ type: "spaceChanged", space: { id: "b", name: "" } });
    ui.dispatch({ type: "navigate", page: "contacts" });
    const first = vi.fn(), second = vi.fn();
    ui.subscribe(first);
    ui.subscribe(second);
    await Promise.resolve();
    const expected = [
      [{ type: "spaceChanged", space: { id: "b", name: "" } }],
      [{ type: "navigate", page: "contacts" }],
    ];
    expect(first.mock.calls).toEqual(expected);
    expect(second.mock.calls).toEqual(expected);
    ui.dispose();
  });
  it("does not mount after disposal while import is pending", async () => {
    let finish!: (value: { mount: ReturnType<typeof vi.fn> }) => void;
    const ui = createLazyCommunicationUi(() => new Promise(resolve => { finish = resolve; }));
    const pending = ui.start();
    ui.dispose();
    const mount = vi.fn();
    finish({ mount });
    await pending;
    expect(mount).not.toHaveBeenCalled();
    await expect(ui.ensureReady()).rejects.toThrow("disposed");
  });
  it("delivers every mounted scope transition synchronously, including A-B-A", () => {
    const ui = createLazyCommunicationUi(async () => ({ mount: async () => () => {} }));
    const listener = vi.fn();
    ui.subscribe(listener);
    ui.dispatch({ type: "spaceChanged", space: { id: "b", name: "" } });
    ui.dispatch({ type: "spaceChanged", space: { id: "a", name: "" } });
    expect(listener.mock.calls.map(([command]) => command.space.id)).toEqual(["b", "a"]);
    ui.dispose();
  });
  it("bounds UI-dependent requests and cancels readiness waiters on disposal", async () => {
    vi.useFakeTimers();
    const ui = createLazyCommunicationUi(async () => ({ mount: async () => () => {} }));
    const ready = ui.ensureReady();
    const rejection = expect(ready).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    const next = ui.ensureReady();
    const cancelled = expect(next).rejects.toThrow("disposed");
    await Promise.resolve();
    ui.dispose();
    await cancelled;
    expect(vi.getTimerCount()).toBe(0);
  });
});
