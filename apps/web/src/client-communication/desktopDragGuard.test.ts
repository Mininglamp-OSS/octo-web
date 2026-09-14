import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installDesktopDragGuard } from "./desktopDragGuard";

describe("embedded desktop drag guard", () => {
  let root: HTMLElement;
  let dispose: (() => void) | undefined;
  const disconnect = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect = disconnect;
    });
    document.body.innerHTML = '<main id="root"></main>';
    root = document.getElementById("root")!;
  });
  afterEach(() => {
    dispose?.();
    dispose = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function overlay(attributes: Record<string, string> = { "data-desktop-overlay": "" }, parent: HTMLElement = root) {
    const element = document.createElement("section");
    element.innerHTML = '<div><span>Action</span></div>';
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue(new DOMRect(400, 0, 200, 300));
    parent.append(element);
    return element;
  }

  async function flush() {
    await vi.advanceTimersByTimeAsync(32);
  }

  function motion(element: Element, type: string, endTime = 300, pseudoElement = "") {
    const transition = type.startsWith("transition");
    const name = transition ? "propertyName" : "animationName";
    Object.assign(element, {
      getAnimations: () => [{
        [transition ? "transitionProperty" : "animationName"]: "fixture",
        playState: "running",
        playbackRate: 1,
        effect: { pseudoElement, getComputedTiming: () => ({ endTime }) },
      }],
    });
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, name, { value: "fixture" });
    Object.defineProperty(event, "pseudoElement", { value: pseudoElement });
    element.dispatchEvent(event);
  }

  it("has no business side effects and restores the previous root state on cleanup", async () => {
    root.dataset.desktopDragSuspended = "previous";
    const panel = overlay();
    const child = panel.firstElementChild;
    dispose = installDesktopDragGuard(root);
    expect(root.dataset.desktopDragSuspended).toBe("true");
    expect(panel.firstElementChild).toBe(child);
    dispose();
    dispose = undefined;
    expect(root.dataset.desktopDragSuspended).toBe("previous");
    panel.remove();
    await flush();
    expect(root.dataset.desktopDragSuspended).toBe("previous");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps dragging paused until the last independent overlay closes", async () => {
    dispose = installDesktopDragGuard(root);
    expect(root.dataset.desktopDragSuspended).toBe("false");
    const first = overlay();
    const second = overlay({ role: "menu" }, document.body);
    await flush();
    expect(root.dataset.desktopDragSuspended).toBe("true");
    first.remove();
    await flush();
    expect(root.dataset.desktopDragSuspended).toBe("true");
    second.remove();
    await flush();
    expect(root.dataset.desktopDragSuspended).toBe("false");
  });

  it.each(["dialog", "alertdialog", "menu", "listbox", "tooltip"])(
    "recognizes a body portal with role=%s without a business class selector",
    async role => {
      dispose = installDesktopDragGuard(root);
      const panel = overlay({ role }, document.body);
      await flush();
      expect(root.dataset.desktopDragSuspended).toBe("true");
      panel.setAttribute("hidden", "");
      await flush();
      expect(root.dataset.desktopDragSuspended).toBe("false");
    },
  );

  it.each(["hidden", "inert", "aria-hidden"])("ignores %s on an ancestor and resumes when shown", async attribute => {
    const parent = document.createElement("div");
    document.body.append(parent);
    parent.setAttribute(attribute, attribute === "aria-hidden" ? "true" : "");
    overlay({ role: "dialog" }, parent);
    dispose = installDesktopDragGuard(root);
    expect(root.dataset.desktopDragSuspended).toBe("false");
    parent.removeAttribute(attribute);
    await flush();
    expect(root.dataset.desktopDragSuspended).toBe("true");
  });

  it("does not count display:none, hidden visibility, or a completely offscreen panel", async () => {
    const panel = overlay();
    panel.style.display = "none";
    dispose = installDesktopDragGuard(root);
    expect(root.dataset.desktopDragSuspended).toBe("false");
    panel.style.display = "";
    panel.style.visibility = "hidden";
    await flush();
    expect(root.dataset.desktopDragSuspended).toBe("false");
    panel.style.visibility = "";
    vi.mocked(panel.getBoundingClientRect).mockReturnValue(new DOMRect(2000, 0, 200, 300));
    await flush();
    expect(root.dataset.desktopDragSuspended).toBe("false");
    vi.mocked(panel.getBoundingClientRect).mockReturnValue(new DOMRect(400, 0, 200, 300));
    window.dispatchEvent(new Event("resize"));
    expect(root.dataset.desktopDragSuspended).toBe("true");
  });

  it("handles a zero-sized portal container with a visible child", () => {
    const container = document.createElement("div");
    container.setAttribute("data-desktop-overlay", "");
    document.body.append(container);
    overlay({}, container);
    dispose = installDesktopDragGuard(root);
    expect(root.dataset.desktopDragSuspended).toBe("true");
  });

  it("holds the guard through outgoing motion and releases after cancellation", async () => {
    const panel = overlay();
    dispose = installDesktopDragGuard(root);
    motion(panel, "transitionrun");
    vi.mocked(panel.getBoundingClientRect).mockReturnValue(new DOMRect(2000, 0, 200, 300));
    await flush();
    expect(root.dataset.desktopDragSuspended).toBe("true");
    expect(vi.getTimerCount()).toBe(0);
    motion(panel, "transitioncancel");
    await flush();
    expect(root.dataset.desktopDragSuspended).toBe("false");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not leak a motion blocker when a portal is removed mid-animation", async () => {
    const panel = overlay({ role: "menu" }, document.body);
    dispose = installDesktopDragGuard(root);
    motion(panel, "animationstart");
    panel.remove();
    await flush();
    expect(root.dataset.desktopDragSuspended).toBe("false");
    expect(vi.getTimerCount()).toBe(0);
    dispose();
    dispose = undefined;
    expect(root.hasAttribute("data-desktop-drag-suspended")).toBe(false);
  });

  it("releases animated descendants when an overlay is hidden without unmounting", async () => {
    const panel = overlay({ role: "dialog" });
    dispose = installDesktopDragGuard(root);
    motion(panel.firstElementChild!, "animationstart");
    panel.setAttribute("aria-hidden", "true");
    await flush();
    expect(root.dataset.desktopDragSuspended).toBe("false");
    expect(vi.getTimerCount()).toBe(0);
    expect(panel.isConnected).toBe(true);
    panel.removeAttribute("aria-hidden");
    await flush();
    expect(root.dataset.desktopDragSuspended).toBe("true");
  });

  it("releases an animated portal wrapper when its last overlay child is removed", async () => {
    const wrapper = document.createElement("div");
    document.body.append(wrapper);
    const panel = overlay({ role: "menu" }, wrapper);
    dispose = installDesktopDragGuard(root);
    motion(wrapper, "animationstart");
    panel.remove();
    await flush();
    expect(root.dataset.desktopDragSuspended).toBe("false");
    expect(vi.getTimerCount()).toBe(0);
    expect(wrapper.isConnected).toBe(true);
  });

  it("does not poll a visible overlay with an infinite descendant animation", async () => {
    const panel = overlay({ role: "dialog" }, document.body);
    dispose = installDesktopDragGuard(root);
    motion(panel.firstElementChild!, "animationstart", Infinity);
    await flush();
    const scan = vi.spyOn(document, "querySelectorAll");
    await vi.advanceTimersByTimeAsync(2000);
    expect(scan).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(root.dataset.desktopDragSuspended).toBe("true");
    expect(panel.isConnected).toBe(true);
    vi.mocked(panel.getBoundingClientRect).mockReturnValue(new DOMRect(2000, 0, 200, 300));
    window.dispatchEvent(new Event("resize"));
    expect(root.dataset.desktopDragSuspended).toBe("false");
  });

  it("ignores unrelated motion completion instead of rescanning the document", async () => {
    const decoration = document.createElement("div");
    root.append(decoration);
    dispose = installDesktopDragGuard(root);
    await flush();
    const scan = vi.spyOn(document, "querySelectorAll");
    motion(decoration, "animationend");
    motion(decoration, "transitioncancel");
    await flush();
    expect(scan).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps same-named animations on the element and its pseudo-element independent", () => {
    const panel = overlay();
    dispose = installDesktopDragGuard(root);
    motion(panel, "animationstart");
    motion(panel, "animationstart", 300, "::before");
    vi.mocked(panel.getBoundingClientRect).mockReturnValue(new DOMRect(2000, 0, 200, 300));
    motion(panel, "animationend");
    expect(root.dataset.desktopDragSuspended).toBe("true");
    motion(panel, "animationend", 300, "::before");
    expect(root.dataset.desktopDragSuspended).toBe("false");
    expect(vi.getTimerCount()).toBe(0);
  });
});
