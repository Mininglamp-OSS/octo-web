import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installDesktopPresentationLifecycle } from "./desktopPresentationLifecycle";
import type { DesktopPresentation } from "./desktopPresentation";
import type { CommunicationPage, OctoBuddyCommunicationBridge } from "./hostBridge";

const desktop: DesktopPresentation = {
  version: 1, revision: 1, platform: "win32", canFuse: true,
  headerHeight: 48, fallbackHeight: 48,
  topArea: { x: 0, y: 0, width: 1000, height: 48 },
  controls: [{ x: 862, y: 0, width: 138, height: 48 }],
  focused: true, maximized: false, fullScreen: false,
};
const readyBase = { bridgeVersion: 1 as const, rendererVersion: "test", documentForwardVersion: 1 };

function pageShow(target: EventTarget) {
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: true });
  target.dispatchEvent(event);
}

describe("desktop lifecycle ready capability integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    document.body.innerHTML = '<div id="root"><header data-desktop-chrome="header"></header></div>';
    vi.spyOn(document.querySelector("header")!, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, 0, 1000, 48));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  interface Fixture {
    lifecycle: ReturnType<typeof installDesktopPresentationLifecycle>;
    target: EventTarget;
    root: HTMLElement;
    reportReady: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    setContext: (page: CommunicationPage, spaceId: string) => void;
  }

  function fixture(initial: () => Promise<DesktopPresentation | null>): Fixture {
    const target = new EventTarget();
    const root = document.getElementById("root")!;
    const reportReady = vi.fn(async () => {});
    const get = vi.fn(initial);
    let contextPage: CommunicationPage = "chat";
    let contextSpace = "space-a";
    const host = {
      getDesktopPresentation: get,
      onDesktopPresentation: () => () => {},
      reportReady,
    } as unknown as OctoBuddyCommunicationBridge;
    const lifecycle = installDesktopPresentationLifecycle(
      target as unknown as Window, host, root,
      () => ({ page: contextPage, spaceId: contextSpace }),
    );
    return {
      lifecycle, target, root, reportReady, get,
      setContext: (page, spaceId) => { contextPage = page; contextSpace = spaceId; },
    };
  }

  it("reports a newly restored capability even if initial startup settled false during pagehide", async () => {
    let resolve!: (state: DesktopPresentation) => void;
    const pending = new Promise<DesktopPresentation>(done => { resolve = done; });
    const f = fixture(() => pending);
    await vi.advanceTimersByTimeAsync(0);
    f.target.dispatchEvent(new Event("pagehide"));
    expect(await f.lifecycle.available).toBe(false);
    await f.lifecycle.reportReady({ ...readyBase, page: "chat", spaceId: "space-a" });
    expect(f.reportReady).toHaveBeenLastCalledWith(expect.objectContaining({ page: "chat", spaceId: "space-a" }));

    f.get.mockResolvedValue(desktop);
    pageShow(f.target);
    resolve(desktop);
    await vi.advanceTimersByTimeAsync(50);
    expect(f.root.dataset.desktopPlatform).toBe("win32");
    expect(f.root.querySelector("header")!.style.getPropertyValue("--desktop-safe-right")).toBe("138px");
    // Restore reads fresh context and includes capability
    expect(f.reportReady).toHaveBeenLastCalledWith(expect.objectContaining({
      page: "chat", spaceId: "space-a", desktopPresentationVersion: 1,
      desktopPresentationPages: ["chat", "contacts"],
    }));
    f.lifecycle.dispose();
  });

  it("removes the capability from ready reports when restoration negotiates a fallback", async () => {
    const f = fixture(async () => desktop);
    await vi.advanceTimersByTimeAsync(50);
    await f.lifecycle.reportReady({ ...readyBase, page: "chat", spaceId: "space-a" });
    expect(f.reportReady).toHaveBeenLastCalledWith(expect.objectContaining({ desktopPresentationVersion: 1 }));
    f.target.dispatchEvent(new Event("pagehide"));
    f.get.mockResolvedValue(null);
    pageShow(f.target);
    await vi.advanceTimersByTimeAsync(50);
    expect(f.root.dataset.desktopPlatform).toBeUndefined();
    expect(f.root.querySelector("header")!.style.getPropertyValue("--desktop-safe-right")).toBe("");
    expect(f.reportReady).toHaveBeenLastCalledWith(expect.objectContaining({
      page: "chat", spaceId: "space-a",
    }));
    expect(f.reportReady).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ desktopPresentationVersion: expect.any(Number) }),
    );
    expect(f.reportReady.mock.calls.at(-1)?.[0]).not.toHaveProperty("desktopPresentationPages");
    f.lifecycle.dispose();
  });

  it("retries a restored ready report and stops retries on disposal", async () => {
    const f = fixture(async () => desktop);
    await vi.advanceTimersByTimeAsync(50);
    f.setContext("contacts", "space-b");
    await f.lifecycle.reportReady({ ...readyBase, page: "chat", spaceId: "space-a" });
    f.target.dispatchEvent(new Event("pagehide"));
    f.reportReady.mockRejectedValueOnce(new Error("IPC unavailable"));
    pageShow(f.target);
    await vi.advanceTimersByTimeAsync(300);
    expect(f.reportReady).toHaveBeenCalledTimes(3);
    // Restore reads getContext, not the stale readyBase page/space.
    expect(f.reportReady).toHaveBeenLastCalledWith(expect.objectContaining({
      page: "contacts", spaceId: "space-b", desktopPresentationVersion: 1,
      desktopPresentationPages: ["chat", "contacts"],
    }));
    f.lifecycle.dispose();
    await vi.advanceTimersByTimeAsync(6000);
    // No more retries after dispose.
    expect(f.reportReady).toHaveBeenCalledTimes(3);
  });

  it("reads live context on restore even after navigation without re-reportReady", async () => {
    const f = fixture(async () => desktop);
    await vi.advanceTimersByTimeAsync(50);
    await f.lifecycle.reportReady({ ...readyBase, page: "chat", spaceId: "space-a" });
    expect(f.reportReady).toHaveBeenLastCalledWith(expect.objectContaining({ page: "chat", spaceId: "space-a" }));

    // Simulate Shell navigating internally without calling reportReady again.
    f.setContext("contacts", "space-b");

    f.target.dispatchEvent(new Event("pagehide"));
    pageShow(f.target);
    await vi.advanceTimersByTimeAsync(50);
    // Restore must use the live context, not the stale "chat"/"space-a".
    expect(f.reportReady).toHaveBeenLastCalledWith(expect.objectContaining({
      page: "contacts", spaceId: "space-b", desktopPresentationVersion: 1,
    }));
    f.lifecycle.dispose();
  });
});
