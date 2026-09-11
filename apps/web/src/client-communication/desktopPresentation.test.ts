import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { headerInsets, installDesktopPresentation, isDesktopPresentation, isDesktopAppearance, type DesktopPresentation, type DesktopAppearance } from "./desktopPresentation";
import type { OctoBuddyCommunicationBridge } from "./hostBridge";

const desktop: DesktopPresentation = {
  version: 1, revision: 0, platform: "darwin", canFuse: true,
  headerHeight: 52, fallbackHeight: 52,
  topArea: { x: 0, y: 0, width: 1056, height: 52 },
  controls: [{ x: 0, y: 0, width: 32, height: 52 }],
  focused: true, maximized: false, fullScreen: false,
};

describe("desktop geometry", () => {
  it("reserves only the controls intersecting this particular header", () => {
    expect(headerInsets({ x: 0, y: 0, width: 300, height: 48 }, desktop)).toEqual({ left: 32, right: 0 });
    expect(headerInsets({ x: 300, y: 0, width: 756, height: 48 }, desktop)).toEqual({ left: 0, right: 0 });
    const windows = { ...desktop, platform: "win32" as const, controls: [{ x: 918, y: 0, width: 138, height: 52 }] };
    expect(headerInsets({ x: 300, y: 0, width: 756, height: 48 }, windows)).toEqual({ left: 0, right: 138 });
    expect(headerInsets({ x: 0, y: 52, width: 1056, height: 48 }, windows)).toBeNull();
  });

  it("handles both sides, fullscreen, invisible headers and unknown overlays", () => {
    const both = { ...desktop, controls: [...desktop.controls, { x: 918, y: 0, width: 138, height: 52 }] };
    expect(headerInsets({ x: 0, y: 0, width: 1056, height: 52 }, both)).toEqual({ left: 32, right: 138 });
    expect(headerInsets({ x: 0, y: 0, width: 1056, height: 52 }, { ...both, controls: [], fullScreen: true })).toEqual({ left: 0, right: 0 });
    expect(headerInsets({ x: 0, y: 0, width: 0, height: 0 }, both)).toBeNull();
    expect(headerInsets({ x: 0, y: 0, width: 1056, height: 52 }, { ...both, canFuse: false })).toBeNull();
  });

  it("rejects unsupported versions and malformed geometry", () => {
    expect(isDesktopPresentation(desktop)).toBe(true);
    for (const value of [
      null, {}, { ...desktop, version: 2 }, { ...desktop, platform: "linux" },
      { ...desktop, headerHeight: Infinity }, { ...desktop, revision: -1 },
      { ...desktop, controls: [{ x: -1, y: 0, width: 10, height: 10 }] },
      { ...desktop, topArea: { ...desktop.topArea, width: NaN } },
    ]) expect(isDesktopPresentation(value)).toBe(false);
  });
  it("validates optional appearance fields", () => {
    const valid: DesktopAppearance = { background: "#ffffff", foreground: "#1a1a1a", separator: "#e0e0e0" };
    expect(isDesktopAppearance(valid)).toBe(true);
    expect(isDesktopAppearance(null)).toBe(false);
    expect(isDesktopAppearance(undefined)).toBe(false);
    expect(isDesktopAppearance({})).toBe(false);
    expect(isDesktopAppearance({ background: "#ffffff", foreground: "#1a1a1a" })).toBe(false);
    expect(isDesktopAppearance({ background: "#ffffff", foreground: "#1a1a1a", separator: "e0e0e0" })).toBe(false);
    expect(isDesktopAppearance({ background: "#fff", foreground: "#1a1a1a", separator: "#e0e0e0" })).toBe(false);
    expect(isDesktopAppearance({ background: "#fffffff", foreground: "#1a1a1a", separator: "#e0e0e0" })).toBe(false);
    expect(isDesktopPresentation({ ...desktop, appearance: valid })).toBe(true);
    expect(isDesktopPresentation({ ...desktop, appearance: { background: "#z1a1a1", foreground: "#ffffff", separator: "#cccccc" } })).toBe(true);
  });

});

describe("optional embedded adapter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    document.body.innerHTML = '<div id="root"><div class="wk-chat-conversation-header" data-desktop-chrome="header"><button>Search</button></div></div>';
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  function setup(initial: DesktopPresentation | null = desktop) {
    let listener: (state: DesktopPresentation) => void = () => undefined;
    const off = vi.fn();
    const bridge = {
      getDesktopPresentation: vi.fn().mockResolvedValue(initial),
      onDesktopPresentation: vi.fn(callback => { listener = callback; return off; }),
    } as unknown as OctoBuddyCommunicationBridge;
    return { bridge, off, send: (state: DesktopPresentation) => listener(state) };
  }

  it("does nothing for old hosts, ordinary browsers and disabled experiments", async () => {
    const root = document.getElementById("root")!;
    const before = root.outerHTML;
    expect(await installDesktopPresentation({} as OctoBuddyCommunicationBridge, root)).toBeNull();
    const disabled = setup(null);
    expect(await installDesktopPresentation(disabled.bridge, root)).toBeNull();
    expect(disabled.off).toHaveBeenCalledOnce();
    expect(root.outerHTML).toBe(before);
  });

  it("updates existing headers without replacing the business DOM, and cleans up", async () => {
    const root = document.getElementById("root")!;
    const header = root.firstElementChild as HTMLElement;
    const button = header.firstElementChild;
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 300, 48));
    const host = setup();
    const dispose = await installDesktopPresentation(host.bridge, root);
    await vi.advanceTimersByTimeAsync(32);
    expect(root.dataset.desktopPlatform).toBe("darwin");
    expect(header.style.getPropertyValue("--desktop-safe-left")).toBe("32px");
    expect(header.hasAttribute("data-desktop-header")).toBe(true);
    expect(header.firstElementChild).toBe(button);
    host.send({ ...desktop, revision: 2, controls: [], fullScreen: true });
    host.send({ ...desktop, revision: 1 });
    await vi.advanceTimersByTimeAsync(32);
    expect(header.style.getPropertyValue("--desktop-safe-left")).toBe("0px");
    expect(root.dataset.desktopFullscreen).toBe("true");
    dispose?.();
    expect(root.dataset.desktopPlatform).toBeUndefined();
    expect(header.hasAttribute("data-desktop-header")).toBe(false);
    expect(header.style.getPropertyValue("--desktop-safe-left")).toBe("");
    expect(header.firstElementChild).toBe(button);
    expect(host.off).toHaveBeenCalledOnce();
  });

  it("bounds optional negotiation and never blocks the messaging startup indefinitely", async () => {
    const host = setup();
    host.bridge.getDesktopPresentation = () => new Promise(() => undefined);
    const pending = installDesktopPresentation(host.bridge, document.getElementById("root")!);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toBeNull();
    expect(host.off).toHaveBeenCalledOnce();
  });

  it("keeps messaging usable when optional subscription or initial state fails", async () => {
    const root = document.getElementById("root")!;
    const before = root.outerHTML;
    const subscription = setup();
    subscription.bridge.onDesktopPresentation = () => { throw new Error("unsupported"); };
    expect(await installDesktopPresentation(subscription.bridge, root)).toBeNull();
    const initial = setup();
    initial.bridge.getDesktopPresentation = vi.fn().mockRejectedValue(new Error("unavailable"));
    expect(await installDesktopPresentation(initial.bridge, root)).toBeNull();
    expect(initial.off).toHaveBeenCalledOnce();
    expect(root.outerHTML).toBe(before);
  });

  it("reserves Windows controls for a channel settings header and releases inactive headers", async () => {
    const root = document.getElementById("root")!;
    root.innerHTML = '<section class="wk-channelsetting wk-route"><div class="wk-route-header" data-desktop-chrome="header"></div></section><div class="wk-viewqueueheader" data-desktop-chrome="header"></div>';
    const section = root.firstElementChild as HTMLElement;
    const settings = section.firstElementChild as HTMLElement;
    const queue = root.lastElementChild as HTMLElement;
    vi.spyOn(settings, "getBoundingClientRect").mockReturnValue(new DOMRect(756, 0, 300, 56));
    vi.spyOn(queue, "getBoundingClientRect").mockReturnValue(new DOMRect(1056, 0, 300, 50));
    const host = setup({
      ...desktop, platform: "win32", controls: [{ x: 918, y: 0, width: 138, height: 52 }],
    });
    const dispose = await installDesktopPresentation(host.bridge, root);
    await vi.advanceTimersByTimeAsync(32);
    expect(settings.style.getPropertyValue("--desktop-safe-right")).toBe("138px");
    expect(queue.hasAttribute("data-desktop-header")).toBe(false);
    section.setAttribute("inert", "");
    await vi.advanceTimersByTimeAsync(32);
    expect(settings.hasAttribute("data-desktop-header")).toBe(false);
    section.removeAttribute("inert");
    section.setAttribute("aria-hidden", "true");
    await vi.advanceTimersByTimeAsync(32);
    expect(settings.hasAttribute("data-desktop-header")).toBe(false);
    section.removeAttribute("aria-hidden");
    await vi.advanceTimersByTimeAsync(32);
    expect(settings.hasAttribute("data-desktop-header")).toBe(true);
    section.setAttribute("hidden", "");
    await vi.advanceTimersByTimeAsync(32);
    expect(settings.hasAttribute("data-desktop-header")).toBe(false);
    section.removeAttribute("hidden");
    settings.style.visibility = "hidden";
    await vi.advanceTimersByTimeAsync(32);
    expect(settings.hasAttribute("data-desktop-header")).toBe(false);
    settings.style.visibility = "";
    await vi.advanceTimersByTimeAsync(32);
    expect(settings.hasAttribute("data-desktop-header")).toBe(true);
    section.remove();
    await vi.advanceTimersByTimeAsync(32);
    expect(settings.style.getPropertyValue("--desktop-safe-right")).toBe("");
    dispose?.();
    host.send({ ...desktop, revision: 10 });
    await vi.advanceTimersByTimeAsync(32);
    expect(root.dataset.desktopPlatform).toBeUndefined();
  });

  it("tracks a translating panel even when its size does not change", async () => {
    const root = document.getElementById("root")!;
    root.innerHTML = '<section><div class="wk-route-header" data-desktop-chrome="header"></div></section>';
    const panel = root.firstElementChild as HTMLElement;
    const header = panel.firstElementChild as HTMLElement;
    let x = 1100;
    vi.spyOn(header, "getBoundingClientRect").mockImplementation(() => new DOMRect(x, 0, 300, 52));
    const host = setup({
      ...desktop, platform: "win32", controls: [{ x: 918, y: 0, width: 138, height: 52 }],
    });
    const dispose = await installDesktopPresentation(host.bridge, root);
    await vi.advanceTimersByTimeAsync(32);
    expect(header.hasAttribute("data-desktop-header")).toBe(false);
    const transition = (type: string) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperty(event, "propertyName", { value: "transform" });
      panel.dispatchEvent(event);
    };
    transition("transitionrun");
    x = 850;
    await vi.advanceTimersByTimeAsync(32);
    expect(header.style.getPropertyValue("--desktop-safe-right")).toBe("232px");
    x = 756;
    await vi.advanceTimersByTimeAsync(32);
    expect(header.style.getPropertyValue("--desktop-safe-right")).toBe("138px");
    transition("transitionend");
    await vi.advanceTimersByTimeAsync(64);
    dispose?.();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sets desktopIntegrated for integrated top band and clears on disposal", async () => {
    const root = document.getElementById("root")!;
    root.innerHTML = '<div class="wk-route-header" data-desktop-chrome="header"></div>';
    const header = root.firstElementChild as HTMLElement;
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 300, 52));
    // topArea.y === 0 => integrated
    const host1 = setup({ ...desktop, topArea: { x: 0, y: 0, width: 1056, height: 52 } });
    const dispose1 = await installDesktopPresentation(host1.bridge, root);
    await vi.advanceTimersByTimeAsync(32);
    expect(root.dataset.desktopIntegrated).toBe("true");
    // topArea.y !== 0 => not integrated
    host1.send({ ...desktop, revision: 2, topArea: { x: 0, y: 48, width: 1056, height: 52 } });
    await vi.advanceTimersByTimeAsync(32);
    expect(root.dataset.desktopIntegrated).toBe("false");
    dispose1?.();
    expect(root.dataset.desktopIntegrated).toBeUndefined();
    // topArea null => not integrated
    const root2 = document.getElementById("root")!;
    root2.innerHTML = '<div class="wk-route-header" data-desktop-chrome="header"></div>';
    const host2 = setup({ ...desktop, revision: 0, topArea: null });
    const dispose2 = await installDesktopPresentation(host2.bridge, root2);
    await vi.advanceTimersByTimeAsync(32);
    expect(root2.dataset.desktopIntegrated).toBe("false");
    dispose2?.();
  });

  it("sets appearance CSS variables only for valid appearance and clears on disposal", async () => {
    const root = document.getElementById("root")!;
    root.innerHTML = '<div class="wk-route-header" data-desktop-chrome="header"></div>';
    const header = root.firstElementChild as HTMLElement;
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 300, 52));
    const validAppearance: DesktopAppearance = { background: "#123456", foreground: "#abcdef", separator: "#ff8800", sidebarBackground: "#f7f8fa" };
    const host = setup({ ...desktop, appearance: validAppearance });
    const dispose = await installDesktopPresentation(host.bridge, root);
    await vi.advanceTimersByTimeAsync(32);
    expect(root.style.getPropertyValue("--desktop-chrome-background")).toBe("#123456");
    expect(root.style.getPropertyValue("--desktop-chrome-foreground")).toBe("#abcdef");
    expect(root.style.getPropertyValue("--desktop-chrome-separator")).toBe("#ff8800");
    expect(root.style.getPropertyValue("--desktop-sidebar-background")).toBe("#f7f8fa");
    // malformed => fallback to empty
    host.send({ ...desktop, revision: 2, appearance: { background: "#xyz", foreground: "#000000", separator: "#cccccc" } });
    await vi.advanceTimersByTimeAsync(32);
    expect(root.style.getPropertyValue("--desktop-chrome-background")).toBe("");
    expect(root.style.getPropertyValue("--desktop-chrome-foreground")).toBe("");
    expect(root.style.getPropertyValue("--desktop-chrome-separator")).toBe("");
    expect(root.style.getPropertyValue("--desktop-sidebar-background")).toBe("");
    // absent => fallback to empty
    host.send({ ...desktop, revision: 3 });
    await vi.advanceTimersByTimeAsync(32);
    expect(root.style.getPropertyValue("--desktop-chrome-background")).toBe("");
    // valid again
    host.send({ ...desktop, revision: 4, appearance: { background: "#ffffff", foreground: "#000000", separator: "#cccccc" } });
    await vi.advanceTimersByTimeAsync(32);
    expect(root.style.getPropertyValue("--desktop-chrome-background")).toBe("#ffffff");
    expect(root.style.getPropertyValue("--desktop-sidebar-background")).toBe("");
    host.send({ ...desktop, revision: 5, appearance: { ...validAppearance, sidebarBackground: "url(invalid)" } });
    await vi.advanceTimersByTimeAsync(32);
    expect(root.style.getPropertyValue("--desktop-chrome-background")).toBe("#123456");
    expect(root.style.getPropertyValue("--desktop-sidebar-background")).toBe("");
    host.send({ ...desktop, revision: 6, appearance: validAppearance });
    await vi.advanceTimersByTimeAsync(32);
    dispose?.();
    expect(root.style.getPropertyValue("--desktop-chrome-background")).toBe("");
    expect(root.style.getPropertyValue("--desktop-chrome-foreground")).toBe("");
    expect(root.style.getPropertyValue("--desktop-chrome-separator")).toBe("");
    expect(root.style.getPropertyValue("--desktop-sidebar-background")).toBe("");
  });

  it("only registers elements with explicit data-desktop-chrome attribute", async () => {
    const root = document.getElementById("root")!;
    root.innerHTML = '<div class="wk-route-header"><span class="incidental-class" data-desktop-chrome="header"></span></div>';
    const headerDiv = root.firstElementChild as HTMLElement;
    const spanEl = root.querySelector("span") as HTMLElement;
    vi.spyOn(headerDiv, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 300, 52));
    vi.spyOn(spanEl, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 300, 52));
    const host = setup();
    const dispose = await installDesktopPresentation(host.bridge, root);
    await vi.advanceTimersByTimeAsync(32);
    // wk-route-header WITHOUT data-desktop-chrome should be ignored
    expect(headerDiv.hasAttribute("data-desktop-header")).toBe(false);
    // span WITH data-desktop-chrome should be found
    expect(spanEl.hasAttribute("data-desktop-header")).toBe(true);
    expect(spanEl.style.getPropertyValue("--desktop-safe-left")).toBe("32px");
    dispose?.();
  });
});
