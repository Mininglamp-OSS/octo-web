import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFeaturePresentation } from "./featurePresentation";
import type { DesktopPresentation, DesktopReadyCapability } from "./presentation";

const geometry: DesktopPresentation = {
  version: 1, revision: 1, platform: "win32", canFuse: true,
  headerHeight: 48, fallbackHeight: 48,
  topArea: { x: 0, y: 0, width: 1000, height: 48 },
  controls: [{ x: 862, y: 0, width: 138, height: 48 }],
  focused: true, maximized: false, fullScreen: false,
};
type State = { bridgeVersion: 1; rendererVersion: string; spaceId: string; route?: { view: string } };
const ready: State = { bridgeVersion: 1, rendererVersion: "test", spaceId: "a" };

function restore() {
  window.dispatchEvent(new Event("pagehide"));
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: true });
  window.dispatchEvent(event);
}

describe("feature desktop negotiation", () => {
  const releases: (() => void)[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    document.body.innerHTML = '<div id="root"><header data-desktop-chrome="header"><button>Action</button></header></div>';
    vi.spyOn(document.querySelector("header")!, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1000, 48));
  });
  afterEach(() => {
    releases.splice(0).forEach(dispose => dispose());
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function fixture(pages: string[]) {
    let context: Partial<State> = { spaceId: "a", route: { view: pages[0] } };
    const host = {
      getDesktopPresentation: vi.fn(async (): Promise<DesktopPresentation | null> => geometry),
      onDesktopPresentation: vi.fn(() => vi.fn()),
      reportReady: vi.fn(async (_report: State & DesktopReadyCapability) => {}),
    };
    const root = document.getElementById("root")!;
    const lifecycle = installFeaturePresentation<State, string>(host, {
      root, pages, getContext: () => context,
    });
    releases.push(lifecycle.dispose);
    return { host, root, lifecycle, setContext: (next: Partial<State>) => { context = next; } };
  }

  it.each([{ pages: ["apps"] }, { pages: ["list", "create", "detail", "share", "confirm", "schedules"] }])(
    "advertises only the explicitly supported pages ($pages)", async ({ pages }) => {
      const expected = [...pages];
      const f = fixture(pages);
      pages.push("unsupported");
      await vi.advanceTimersByTimeAsync(50);
      await f.lifecycle.reportReady(ready);
      expect(f.host.reportReady).toHaveBeenLastCalledWith(expect.objectContaining({
        desktopPresentationVersion: 1, desktopPresentationPages: expected,
      }));
      expect(f.root.querySelector("header")!.style.getPropertyValue("--desktop-safe-right")).toBe("138px");
      const sentPages = f.host.reportReady.mock.calls.at(-1)![0].desktopPresentationPages as string[];
      sentPages.push("caller-mutation");
      await f.lifecycle.reportReady(ready);
      expect(f.host.reportReady).toHaveBeenLastCalledWith(expect.objectContaining({
        desktopPresentationPages: expected,
      }));
      expect(f.root.dataset.desktopPlatform).toBe("win32");
    },
  );

  it("restores against live route and Space without a second business ready", async () => {
    const f = fixture(["list", "detail"]);
    await vi.advanceTimersByTimeAsync(50);
    await f.lifecycle.reportReady(ready);
    f.setContext({ spaceId: "b", route: { view: "detail" } });
    restore();
    await vi.advanceTimersByTimeAsync(50);
    expect(f.host.reportReady).toHaveBeenCalledTimes(2);
    expect(f.host.reportReady).toHaveBeenLastCalledWith(expect.objectContaining({
      spaceId: "b", route: { view: "detail" }, desktopPresentationPages: ["list", "detail"],
    }));
  });

  it("measures a positioned-control surface without treating its content as a titlebar", async () => {
    const f = fixture(["list"]);
    const surface = document.createElement("main");
    surface.dataset.desktopChrome = "surface";
    f.root.append(surface);
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(new DOMRect(500, 0, 500, 700));
    await vi.advanceTimersByTimeAsync(50);
    expect(surface).toHaveAttribute("data-desktop-surface", "");
    expect(surface).not.toHaveAttribute("data-desktop-header");
    expect(surface.style.getPropertyValue("--desktop-safe-right")).toBe("138px");
    f.lifecycle.dispose();
    expect(surface).not.toHaveAttribute("data-desktop-surface");
    expect(surface.style.getPropertyValue("--desktop-safe-right")).toBe("");
  });

  it("revokes capability and removes geometry after restoration falls back", async () => {
    const f = fixture(["apps"]);
    await vi.advanceTimersByTimeAsync(50);
    await f.lifecycle.reportReady(ready);
    f.host.getDesktopPresentation.mockResolvedValue(null);
    restore();
    await vi.advanceTimersByTimeAsync(50);
    const report = f.host.reportReady.mock.calls.at(-1)![0];
    expect(report).not.toHaveProperty("desktopPresentationVersion");
    expect(report).not.toHaveProperty("desktopPresentationPages");
    expect(f.root.dataset.desktopPlatform).toBeUndefined();
    expect(f.root.querySelector("header")!.style.getPropertyValue("--desktop-safe-right")).toBe("");
  });

  it("supports an old host without installing observers or advertising pages", async () => {
    const host = { reportReady: vi.fn(async (_report: State & DesktopReadyCapability) => {}) };
    const lifecycle = installFeaturePresentation<State, string>(host, {
      root: document.getElementById("root")!, pages: ["apps"], getContext: () => ({}),
    });
    releases.push(lifecycle.dispose);
    expect(await lifecycle.available).toBe(false);
    await lifecycle.reportReady(ready);
    expect(host.reportReady).toHaveBeenLastCalledWith(ready);
    expect(document.querySelector("[data-desktop-platform]")).toBeNull();
  });

  it("times out an unavailable host and cleans up its subscription", async () => {
    const off = vi.fn();
    const host = {
      getDesktopPresentation: () => new Promise<null>(() => {}),
      onDesktopPresentation: () => off,
      reportReady: vi.fn(async (_report: State & DesktopReadyCapability) => {}),
    };
    const lifecycle = installFeaturePresentation<State, string>(host, {
      root: document.getElementById("root")!, pages: ["apps"], getContext: () => ({}),
    });
    releases.push(lifecycle.dispose);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await lifecycle.available).toBe(false);
    await lifecycle.reportReady(ready);
    expect(host.reportReady).toHaveBeenLastCalledWith(ready);
    expect(off).toHaveBeenCalledOnce();
  });
});
