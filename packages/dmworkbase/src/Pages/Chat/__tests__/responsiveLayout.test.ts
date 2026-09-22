// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { observeChatLayout, resolveChatLayout, type Auxiliary } from "../responsiveLayout";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("message content layout", () => {
  it.each([
    [1600, 300, true, false, "split"],
    [1164, 300, true, false, "split"],
    [1163, 300, true, true, "split"],
    [1000, 300, true, true, "split"],
    [884, 300, true, true, "split"],
    [864, 300, true, true, "split"],
    [863, 300, true, true, "overlay"],
    [768, 300, true, true, "overlay"],
    [600, 300, true, true, "overlay"],
    [390, 300, true, true, "overlay"],
    [1000, 300, false, false, "overlay"],
    [732, 300, false, false, "overlay"],
    [731, 300, false, true, "overlay"],
  ])("resolves %i px with %i px navigation", (width, nav, auxiliary, collapsed, panelLayout) => {
    expect(resolveChatLayout(width, nav, auxiliary)).toEqual({
      navigationCollapsed: collapsed,
      panelLayout,
    });
  });

  it("uses resized navigation width without changing the content minimum", () => {
    expect(resolveChatLayout(1200, 300, true).navigationCollapsed).toBe(false);
    expect(resolveChatLayout(1200, 360, true).navigationCollapsed).toBe(true);
  });

  it("does not reserve navigation space in a standalone embedded content surface", () => {
    expect(resolveChatLayout(864, 0, true)).toEqual({
      navigationCollapsed: false,
      panelLayout: "split",
    });
  });

  it.each([
    [1164, 300, false, "split"],
    [1052, 300, false, "split"],
    [1051, 300, false, "overlay"],
    [1000, 300, false, "overlay"],
    [746, 300, false, "overlay"],
    [732, 300, false, "overlay"],
    [731, 300, true, "overlay"],
    [752, 0, false, "split"],
    [751.5, 0, false, "overlay"],
    [1224, 360, false, "split"],
  ])("resolves %i px search shell with %i px navigation", (width, nav, collapsed, panelLayout) => {
    expect(resolveChatLayout(width, nav, "search")).toEqual({
      navigationCollapsed: collapsed,
      panelLayout,
    });
  });

  it("splits search in a standalone embedded content surface with visible navigation", () => {
    expect(resolveChatLayout(752, 0, "search")).toEqual({
      navigationCollapsed: false,
      panelLayout: "split",
    });
  });

  it.each([
    [1052, 300, false, "split"],
    [1051, 300, false, "overlay"],
    [731, 300, true, "overlay"],
    [752, 0, false, "split"],
    [751, 0, false, "overlay"],
    [390, 0, true, "overlay"],
  ])("resolves %i px summary shell with %i px navigation", (width, nav, collapsed, panelLayout) => {
    expect(resolveChatLayout(width, nav, "summary")).toEqual({
      navigationCollapsed: collapsed,
      panelLayout,
    });
  });

  it("splits thread in a standalone embedded content surface with visible navigation", () => {
    expect(resolveChatLayout(752, 0, "thread")).toEqual({
      navigationCollapsed: false,
      panelLayout: "split",
    });
  });

  it.each([
    [1164, 300, false, "split"],
    [1052, 300, false, "split"],
    [1051, 300, false, "overlay"],
    [1000, 300, false, "overlay"],
    [746, 300, false, "overlay"],
    [732, 300, false, "overlay"],
    [731, 300, true, "overlay"],
    [752, 0, false, "split"],
    [751.5, 0, false, "overlay"],
    [1224, 360, false, "split"],
  ])("resolves %i px thread shell with %i px navigation", (width, nav, collapsed, panelLayout) => {
    expect(resolveChatLayout(width, nav, "thread")).toEqual({
      navigationCollapsed: collapsed,
      panelLayout,
    });
  });

  it("uses resized thread navigation width without changing the content minimum", () => {
    expect(resolveChatLayout(760, 300, "thread").navigationCollapsed).toBe(false);
    expect(resolveChatLayout(760, 360, "thread").navigationCollapsed).toBe(true);
  });

  it.each([
    [1164, 300, false, "split"],
    [1163, 300, false, "overlay"],
    [1000, 300, false, "overlay"],
    [731, 300, true, "overlay"],
    [864, 0, false, "split"],
    [863.5, 0, false, "overlay"],
  ])("resolves %i px thread preview shell with %i px navigation", (width, nav, collapsed, panelLayout) => {
    expect(resolveChatLayout(width, nav, "threadPreview")).toEqual({
      navigationCollapsed: collapsed,
      panelLayout,
    });
  });

  it("keeps the old 864 split budget for thread preview without extra nav collapse", () => {
    expect(resolveChatLayout(1163, 300, "threadPreview")).toEqual({
      navigationCollapsed: false,
      panelLayout: "overlay",
    });
    expect(resolveChatLayout(1163, 300, true)).toEqual({
      navigationCollapsed: true,
      panelLayout: "split",
    });
  });

  it("responds to container changes, restores navigation and cleans up shell state", () => {
    let resize = () => {};
    let frame: FrameRequestCallback | undefined;
    const requestFrame = vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1; });
    const cancelFrame = vi.fn(() => { frame = undefined; });
    const flushFrame = () => { const callback = frame; frame = undefined; callback?.(0); };
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect = disconnect;
    });
    document.body.innerHTML = '<div class="wk-layout-content" style="--wk-width-layout-content-left:300px"><div class="wk-layout-content-left"></div><div class="wk-layout-content-right"><div id="chat"></div></div></div>';
    const shell = document.querySelector<HTMLElement>(".wk-layout-content")!;
    const element = document.getElementById("chat")!;
    let width = 1200;
    shell.getBoundingClientRect = () => ({ width } as DOMRect);
    const changed = vi.fn();
    const observer = observeChatLayout(element, changed);
    observer.update(true);
    expect(shell.dataset.chatNavigation).toBe("visible");
    width = 1000;
    resize();
    resize();
    expect(requestFrame).toHaveBeenCalledOnce();
    expect(shell.dataset.chatNavigation).toBe("visible");
    flushFrame();
    expect(shell.dataset.chatNavigation).toBe("collapsed");
    expect(changed).toHaveBeenLastCalledWith({ panelLayout: "split", navigationCollapsed: true });
    width = 768;
    resize();
    flushFrame();
    expect(changed).toHaveBeenLastCalledWith({ panelLayout: "overlay", navigationCollapsed: true });
    observer.update(false);
    expect(shell.dataset.chatNavigation).toBe("visible");
    resize();
    observer.dispose();
    expect(cancelFrame).toHaveBeenCalledWith(1);
    flushFrame();
    resize();
    expect(frame).toBeUndefined();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(shell.dataset.chatNavigation).toBeUndefined();
  });

  it("keeps navigation intact across thread/search/embedded switches and container resizes", () => {
    let resize = () => {};
    let frame: FrameRequestCallback | undefined;
    const requestFrame = vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1; });
    const cancelFrame = vi.fn(() => { frame = undefined; });
    const flushFrame = () => { const callback = frame; frame = undefined; callback?.(0); };
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect = disconnect;
    });
    document.body.innerHTML = '<div class="wk-layout-content" style="--wk-width-layout-content-left:300px"><div class="wk-layout-content-left"></div><div class="wk-layout-content-right"><div id="chat"></div></div></div>';
    const shell = document.querySelector<HTMLElement>(".wk-layout-content")!;
    const element = document.getElementById("chat")!;
    let width = 1200;
    shell.getBoundingClientRect = () => ({ width } as DOMRect);
    const changed = vi.fn();
    const observer = observeChatLayout(element, changed);
    expect(shell.dataset.chatNavigation).toBe("visible");
    expect(changed).toHaveBeenLastCalledWith({ panelLayout: "split", navigationCollapsed: false });
    observer.update("thread");
    observer.update("search");
    observer.update(false);
    expect(shell.dataset.chatNavigation).toBe("visible");
    expect(changed).toHaveBeenCalledTimes(1);
    width = 1000;
    observer.update("thread");
    resize();
    flushFrame();
    expect(shell.dataset.chatNavigation).toBe("visible");
    expect(changed).toHaveBeenLastCalledWith({ panelLayout: "overlay", navigationCollapsed: false });
    observer.dispose();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(shell.dataset.chatNavigation).toBeUndefined();
  });
});

describe("layout observer navigation ownership", () => {
  function mountShell(width: number, display: string) {
    document.body.innerHTML = '<div class="wk-layout-content" style="--wk-width-layout-content-left:300px"><div class="wk-layout-content-left"></div><div class="wk-layout-content-right"><div id="chat"></div></div></div>';
    const shell = document.querySelector<HTMLElement>(".wk-layout-content")!;
    const navigation = shell.querySelector<HTMLElement>(".wk-layout-content-left")!;
    const element = document.getElementById("chat")!;
    navigation.style.display = display;
    shell.getBoundingClientRect = () => ({ width } as DOMRect);
    return { shell, navigation, element };
  }

  for (const auxiliary of ["summary", "search", "thread"] as const) {
    it.each([
      ["none", 751, "overlay"],
      ["none", 752, "split"],
      ["none", 900, "split"],
      ["block", 1051, "overlay"],
      ["block", 1052, "split"],
    ] as const)(`${auxiliary}: display %s at %i px selects %s`, (display, width, panelLayout) => {
      const { shell, element } = mountShell(width, display);
      const changed = vi.fn();
      const observer = observeChatLayout(element, changed);
      observer.update(auxiliary);
      expect(changed).toHaveBeenLastCalledWith({ panelLayout, navigationCollapsed: false });
      expect(shell.style.getPropertyValue("--wk-width-layout-content-left")).toBe("300px");
      observer.dispose();
    });
  }

  it.each([
    [true, 863, "overlay", true],
    [true, 864, "split", false],
    ["threadPreview", 863, "overlay", false],
    ["threadPreview", 864, "split", false],
  ] satisfies [Auxiliary, number, string, boolean][])("keeps the larger %s budget at %i px", (auxiliary, width, panelLayout, navigationCollapsed) => {
    const { element } = mountShell(width, "none");
    const changed = vi.fn();
    const observer = observeChatLayout(element, changed);
    observer.update(auxiliary);
    expect(changed).toHaveBeenLastCalledWith({ panelLayout, navigationCollapsed });
    observer.dispose();
  });

  it("observes hidden list changes without a shell resize and retains the collapse budget", () => {
    let resize = () => {};
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resize = callback; }
      observe = observe;
      disconnect = disconnect;
    });
    const flushResize = () => {
      resize();
      const callback = frame;
      frame = undefined;
      callback?.(0);
    };
    const { shell, navigation, element } = mountShell(1000, "none");
    const changed = vi.fn();
    const observer = observeChatLayout(element, changed);
    observer.update("summary");
    expect(observe).toHaveBeenCalledWith(navigation);
    expect(changed).toHaveBeenLastCalledWith({ panelLayout: "split", navigationCollapsed: false });

    navigation.style.display = "block";
    flushResize();
    expect(changed).toHaveBeenLastCalledWith({ panelLayout: "overlay", navigationCollapsed: false });
    navigation.style.display = "none";
    flushResize();
    expect(changed).toHaveBeenLastCalledWith({ panelLayout: "split", navigationCollapsed: false });

    navigation.style.display = "block";
    observer.update(true);
    expect(changed).toHaveBeenLastCalledWith({ panelLayout: "split", navigationCollapsed: true });
    // Chat's own collapse hides the list without changing its display.
    navigation.style.visibility = "hidden";
    changed.mockClear();
    flushResize();
    flushResize();
    expect(changed).not.toHaveBeenCalled();
    expect(shell.dataset.chatNavigation).toBe("collapsed");
    observer.dispose();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(shell.dataset.chatNavigation).toBeUndefined();
  });
});
