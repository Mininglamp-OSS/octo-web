import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installDesktopPresentationLifecycle } from "./desktopPresentationLifecycle";
import { installDesktopPresentation } from "./desktopPresentation";
import type { CommunicationPage, OctoBuddyCommunicationBridge } from "./hostBridge";

vi.mock("./desktopPresentation", () => ({
  installDesktopPresentation: vi.fn(),
}));

const mockInstall = vi.mocked(installDesktopPresentation);

function makeBridge(): OctoBuddyCommunicationBridge {
  return {
    getDesktopPresentation: vi.fn().mockResolvedValue(null),
    onDesktopPresentation: vi.fn(() => vi.fn()),
  } as unknown as OctoBuddyCommunicationBridge;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

function persistedPageshow(): Event {
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: true });
  return event;
}

function nonPersistedPageshow(): Event {
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: false });
  return event;
}

const flush = () => vi.advanceTimersByTimeAsync(0);

/** Tracks how many adapters are still alive (handed out, not yet disposed). */
interface Recorder {
  live: number;
  order: string[];
  next: () => Promise<() => void>;
}

function makeRecorder(events?: string[]) {
  const recorder: Recorder = { live: 0, order: events ?? [], next: async () => vi.fn() };
  mockInstall.mockReset();
  mockInstall.mockImplementation(async () => {
    const name = `adapter-${recorder.order.filter(e => e.startsWith("install:")).length + 1}`;
    recorder.order.push(`install:${name}`);
    recorder.live++;
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      recorder.live--;
      recorder.order.push(`dispose:${name}`);
    };
  });
  return recorder;
}

const ctx = (page: CommunicationPage = "chat", spaceId = "space-a") => () => ({ page, spaceId });

describe("DesktopPresentationLifecycle", () => {
  let root: HTMLElement;
  let target: EventTarget;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("ResizeObserver", class {
      observe() {} unobserve() {} disconnect() {}
    });
    document.body.innerHTML = '<div id="root"></div>';
    root = document.getElementById("root")!;
    target = new EventTarget();
    mockInstall.mockReset();
    mockInstall.mockImplementation(async () => vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("registers pagehide/pageshow, installs on start, and removes listeners on dispose", async () => {
    const addSpy = vi.spyOn(target, "addEventListener");
    const removeSpy = vi.spyOn(target, "removeEventListener");
    const lifecycle = installDesktopPresentationLifecycle(
      target as unknown as Window,
      makeBridge(),
      root,
      ctx(),
    );
    expect(addSpy).toHaveBeenCalledWith("pagehide", expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith("pageshow", expect.any(Function));
    await flush();
    expect(mockInstall).toHaveBeenCalledTimes(1);
    expect(await lifecycle.available).toBe(true);
    lifecycle.dispose();
    expect(removeSpy).toHaveBeenCalledWith("pagehide", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("pageshow", expect.any(Function));
  });

  it("tears down on pagehide and re-installs on persisted pageshow", async () => {
    const events: string[] = [];
    const recorder = makeRecorder(events);
    const lifecycle = installDesktopPresentationLifecycle(
      target as unknown as Window,
      makeBridge(),
      root,
      ctx(),
    );
    await flush();
    expect(recorder.live).toBe(1);
    expect(events).toEqual(["install:adapter-1"]);
    expect(await lifecycle.available).toBe(true);

    target.dispatchEvent(new Event("pagehide"));
    expect(recorder.live).toBe(0);
    expect(events).toEqual(["install:adapter-1", "dispose:adapter-1"]);

    target.dispatchEvent(persistedPageshow());
    await flush();
    expect(mockInstall).toHaveBeenCalledTimes(2);
    expect(recorder.live).toBe(1);
    expect(events).toEqual(["install:adapter-1", "dispose:adapter-1", "install:adapter-2"]);
    expect(await lifecycle.available).toBe(true);
    lifecycle.dispose();
    expect(recorder.live).toBe(0);
    expect(events).toEqual(["install:adapter-1", "dispose:adapter-1", "install:adapter-2", "dispose:adapter-2"]);
  });

  it("does not re-install on non-persisted pageshow", async () => {
    const recorder = makeRecorder();
    const lifecycle = installDesktopPresentationLifecycle(
      target as unknown as Window,
      makeBridge(),
      root,
      ctx(),
    );
    await flush();
    expect(mockInstall).toHaveBeenCalledTimes(1);
    target.dispatchEvent(nonPersistedPageshow());
    await flush();
    expect(mockInstall).toHaveBeenCalledTimes(1);
    expect(recorder.live).toBe(1);
    lifecycle.dispose();
  });

  it("keeps the adapter active when a cancelable beforeunload is cancelled", async () => {
    const addSpy = vi.spyOn(target, "addEventListener");
    const recorder = makeRecorder();
    const lifecycle = installDesktopPresentationLifecycle(
      target as unknown as Window,
      makeBridge(),
      root,
      ctx(),
    );
    await flush();
    expect(recorder.live).toBe(1);

    const cancelable = new Event("beforeunload", { cancelable: true });
    cancelable.preventDefault();
    target.dispatchEvent(cancelable);
    expect(recorder.live).toBe(1);
    expect(addSpy).not.toHaveBeenCalledWith("beforeunload", expect.any(Function));
    lifecycle.dispose();
    expect(recorder.live).toBe(0);
  });

  it("releases a stale pending install whose promise resolves after pagehide", async () => {
    const pending = deferred<() => void>();
    let disposed = 0;
    const dispose = () => { disposed++; };
    mockInstall.mockReset();
    mockInstall.mockReturnValueOnce(pending.promise);
    const lifecycle = installDesktopPresentationLifecycle(
      target as unknown as Window,
      makeBridge(),
      root,
      ctx(),
    );
    await flush();
    expect(mockInstall).toHaveBeenCalledTimes(1);

    target.dispatchEvent(new Event("pagehide"));
    expect(await lifecycle.available).toBe(false);

    pending.resolve(dispose);
    await flush();
    expect(disposed).toBe(1);
    expect(mockInstall).toHaveBeenCalledTimes(1);
    lifecycle.dispose();
  });

  it("settles available and releases when disposed during negotiation", async () => {
    const pending = deferred<() => void>();
    let disposed = 0;
    const dispose = () => { disposed++; };
    mockInstall.mockReset();
    mockInstall.mockReturnValueOnce(pending.promise);
    const lifecycle = installDesktopPresentationLifecycle(
      target as unknown as Window,
      makeBridge(),
      root,
      ctx(),
    );
    await flush();
    expect(mockInstall).toHaveBeenCalledTimes(1);

    lifecycle.dispose();
    expect(await lifecycle.available).toBe(false);

    pending.resolve(dispose);
    await flush();
    expect(disposed).toBe(1);
  });

  it("does not re-install after dispose", async () => {
    const recorder = makeRecorder();
    const lifecycle = installDesktopPresentationLifecycle(
      target as unknown as Window,
      makeBridge(),
      root,
      ctx(),
    );
    await flush();
    expect(recorder.live).toBe(1);
    lifecycle.dispose();
    expect(recorder.live).toBe(0);

    target.dispatchEvent(persistedPageshow());
    await flush();
    expect(mockInstall).toHaveBeenCalledTimes(1);
    expect(recorder.live).toBe(0);
  });

  it("serializes installs: a pending round is released before the next begins", async () => {
    const events: string[] = [];
    const first = deferred<() => void>();
    mockInstall.mockReset();
    mockInstall.mockImplementationOnce(() => {
      events.push("install:1");
      return first.promise;
    });
    mockInstall.mockImplementationOnce(async () => {
      events.push("install:2");
      return () => { events.push("dispose:2"); };
    });
    const lifecycle = installDesktopPresentationLifecycle(
      target as unknown as Window,
      makeBridge(),
      root,
      ctx(),
    );
    await flush();
    expect(events).toEqual(["install:1"]);
    expect(mockInstall).toHaveBeenCalledTimes(1);

    target.dispatchEvent(persistedPageshow());
    await flush();
    expect(events).toEqual(["install:1"]);
    expect(mockInstall).toHaveBeenCalledTimes(1);

    first.resolve(() => { events.push("dispose:1"); });
    await flush();
    expect(events).toEqual(["install:1", "dispose:1", "install:2"]);
    expect(mockInstall).toHaveBeenCalledTimes(2);
    expect(await lifecycle.available).toBe(true);

    lifecycle.dispose();
    expect(events).toEqual(["install:1", "dispose:1", "install:2", "dispose:2"]);
  });

  it("releases a superseded round only after the newer round has adopted, with no overlap", async () => {
    const first = deferred<() => void>();
    const second = deferred<() => void>();
    let firstDisposed = 0;
    let secondLiveDispose = 0;
    const firstDispose = () => { firstDisposed++; };
    const secondDispose = () => { secondLiveDispose++; };
    mockInstall.mockReset();
    mockInstall.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const lifecycle = installDesktopPresentationLifecycle(
      target as unknown as Window,
      makeBridge(),
      root,
      ctx(),
    );
    await flush();
    expect(mockInstall).toHaveBeenCalledTimes(1);

    target.dispatchEvent(persistedPageshow());
    await flush();
    expect(mockInstall).toHaveBeenCalledTimes(1);
    expect(firstDisposed).toBe(0);

    first.resolve(firstDispose);
    await flush();
    expect(firstDisposed).toBe(1);
    expect(mockInstall).toHaveBeenCalledTimes(2);
    expect(secondLiveDispose).toBe(0);

    second.resolve(secondDispose);
    await flush();
    expect(secondLiveDispose).toBe(0);
    expect(await lifecycle.available).toBe(true);
    lifecycle.dispose();
    expect(secondLiveDispose).toBe(1);
    expect(firstDisposed).toBe(1);
  });

  it("reads live getContext on restore without re-reportReady", async () => {
    let contextPage: CommunicationPage = "chat";
    let contextSpace = "space-a";
    const report = vi.fn(async () => {});
    const bridge = {
      getDesktopPresentation: vi.fn().mockResolvedValue(null),
      onDesktopPresentation: vi.fn(() => vi.fn()),
      reportReady: report,
    } as unknown as OctoBuddyCommunicationBridge;
    mockInstall.mockReset();
    mockInstall.mockImplementation(async () => vi.fn());
    const lifecycle = installDesktopPresentationLifecycle(
      target as unknown as Window,
      bridge,
      root,
      () => ({ page: contextPage, spaceId: contextSpace }),
    );
    await flush();
    await lifecycle.reportReady({ bridgeVersion: 1, rendererVersion: "t", page: "chat", spaceId: "space-a" });
    // Simulate Shell navigating internally without calling reportReady again.
    contextPage = "contacts";
    contextSpace = "space-b";
    target.dispatchEvent(new Event("pagehide"));
    target.dispatchEvent(persistedPageshow());
    await flush();
    // Restore must use live getContext, not a stale snapshot from initial reportReady.
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({
      page: "contacts", spaceId: "space-b",
    }));
    lifecycle.dispose();
  });
});
