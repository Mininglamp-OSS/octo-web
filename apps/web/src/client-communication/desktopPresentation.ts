import type { OctoBuddyCommunicationBridge } from "./hostBridge";
import { installDesktopDragGuard } from "./desktopDragGuard";
import { DESKTOP_MOTION_EVENTS, desktopMotionKey, getDesktopMotion, isDesktopMotionActive, isDesktopMotionRunning } from "./desktopMotion";

export interface DesktopRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesktopAppearance {
  background: string;
  foreground: string;
  separator: string;
  sidebarBackground?: string;
}

/** The host converts DIP and view offsets into this renderer's CSS coordinates. */
export interface DesktopPresentation {
  version: 1;
  revision: number;
  platform: "darwin" | "win32";
  canFuse: boolean;
  headerHeight: number;
  fallbackHeight: number;
  topArea: DesktopRect | null;
  controls: DesktopRect[];
  focused: boolean;
  maximized: boolean;
  fullScreen: boolean;
  appearance?: DesktopAppearance;
}

function isRect(value: unknown): value is DesktopRect {
  if (!value || typeof value !== "object") return false;
  const rect = value as Partial<DesktopRect>;
  return [rect.x, rect.y, rect.width, rect.height].every(
    part => typeof part === "number" && Number.isFinite(part) && part >= 0 && part <= 100000,
  );
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

export function isDesktopAppearance(value: unknown): value is DesktopAppearance {
  if (!value || typeof value !== "object") return false;
  const appearance = value as Partial<DesktopAppearance>;
  return isHexColor(appearance.background) && isHexColor(appearance.foreground) && isHexColor(appearance.separator);
}

export function isDesktopPresentation(value: unknown): value is DesktopPresentation {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<DesktopPresentation>;
  return state.version === 1 &&
    (state.platform === "darwin" || state.platform === "win32") &&
    Number.isSafeInteger(state.revision) && state.revision! >= 0 &&
    typeof state.headerHeight === "number" && Number.isFinite(state.headerHeight) &&
    state.headerHeight >= 12 && state.headerHeight <= 256 &&
    typeof state.fallbackHeight === "number" && Number.isFinite(state.fallbackHeight) &&
    state.fallbackHeight >= 0 && state.fallbackHeight <= 256 &&
    [state.canFuse, state.focused, state.maximized, state.fullScreen].every(part => typeof part === "boolean") &&
    (state.topArea === null || isRect(state.topArea)) &&
    Array.isArray(state.controls) && state.controls.length <= 4 && state.controls.every(isRect);
}

export function headerInsets(rect: DesktopRect, state: DesktopPresentation): { left: number; right: number } | null {
  const top = state.topArea;
  if (!state.canFuse || !top || !rect.width || !rect.height ||
    rect.y >= top.y + top.height || rect.y + rect.height <= top.y ||
    rect.x >= top.x + top.width || rect.x + rect.width <= top.x) return null;
  let left = 0;
  let right = 0;
  for (const control of state.controls) {
    if (control.y >= rect.y + rect.height || control.y + control.height <= rect.y ||
      control.x >= rect.x + rect.width || control.x + control.width <= rect.x) continue;
    if (control.x + control.width / 2 < top.x + top.width / 2) {
      left = Math.max(left, control.x + control.width - rect.x);
    } else {
      right = Math.max(right, rect.x + rect.width - control.x);
    }
  }
  return { left, right };
}

const HEADERS = '[data-desktop-chrome="header"]';

/** Dedicated embedded-entry adapter. Never loaded by the browser or legacy Electron entry. */
export async function installDesktopPresentation(
  bridge: OctoBuddyCommunicationBridge,
  root: HTMLElement,
): Promise<(() => void) | null> {
  if (!bridge.getDesktopPresentation || !bridge.onDesktopPresentation) return null;
  let state: DesktopPresentation | undefined;
  let disposed = false;
  let frame = 0;
  const observed = new Set<HTMLElement>();
  const motions = new Map<Element, Map<string, Animation>>();
  const setProperty = (element: HTMLElement, name: string, value: string) => {
    if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
  };
  const applyAppearance = () => {
    const appearance = state && isDesktopAppearance(state.appearance) ? state.appearance : null;
    setProperty(root, "--desktop-chrome-background", appearance?.background ?? "");
    setProperty(root, "--desktop-chrome-foreground", appearance?.foreground ?? "");
    setProperty(root, "--desktop-chrome-separator", appearance?.separator ?? "");
    setProperty(root, "--desktop-sidebar-background", isHexColor(appearance?.sidebarBackground) ? appearance.sidebarBackground : "");
  };
  const update = () => {
    frame = 0;
    if (!state || disposed) return;
    root.dataset.desktopPlatform = state.platform;
    root.dataset.desktopFocused = String(state.focused);
    root.dataset.desktopFullscreen = String(state.fullScreen);
    root.dataset.desktopIntegrated = String(state.canFuse && state.topArea !== null && state.topArea.y === 0);
    setProperty(root, "--desktop-header-height", `${state.headerHeight}px`);
    applyAppearance();
    const headers = new Set(root.querySelectorAll<HTMLElement>(HEADERS));
    for (const header of observed) {
      if (!headers.has(header)) {
        resize.unobserve(header);
        observed.delete(header);
        header.removeAttribute("data-desktop-header");
        header.style.removeProperty("--desktop-safe-left");
        header.style.removeProperty("--desktop-safe-right");
      }
    }
    for (const header of headers) {
      if (!observed.has(header)) {
        observed.add(header);
        resize.observe(header);
      }
      const rect = header.getBoundingClientRect();
      const invisible = header.closest('[inert], [hidden], [aria-hidden="true"]') ||
        getComputedStyle(header).visibility === "hidden";
      const inset = invisible ? null : headerInsets(rect, state);
      if (inset) {
        if (!header.hasAttribute("data-desktop-header")) header.setAttribute("data-desktop-header", "");
        setProperty(header, "--desktop-safe-left", `${inset.left}px`);
        setProperty(header, "--desktop-safe-right", `${inset.right}px`);
      } else {
        header.removeAttribute("data-desktop-header");
        header.style.removeProperty("--desktop-safe-left");
        header.style.removeProperty("--desktop-safe-right");
      }
    }
    let moving = false;
    for (const [element, active] of motions) {
      for (const [key, animation] of active) {
        if (!isDesktopMotionActive(animation)) active.delete(key);
      }
      if (!active.size || !root.contains(element)) motions.delete(element);
      else if ([...active.values()].some(isDesktopMotionRunning)) moving = true;
    }
    if (moving) schedule();
  };
  const schedule = () => { if (!frame && !disposed) frame = requestAnimationFrame(update); };
  // ResizeObserver misses translations. Follow finite, running header motion only.
  const onMotion = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const key = desktopMotionKey(event);
    if (event.type === "transitionrun" || event.type === "animationstart") {
      if (![...root.querySelectorAll(HEADERS)].some(header => target.contains(header))) return;
      const animation = getDesktopMotion(target, event);
      if (animation) {
        const active = motions.get(target) ?? new Map<string, Animation>();
        active.set(key, animation);
        motions.set(target, active);
      }
    } else {
      const active = motions.get(target);
      if (!active?.delete(key)) return;
      if (!active.size) motions.delete(target);
    }
    schedule();
  };
  const resize = new ResizeObserver(schedule);
  const mutations = new MutationObserver(schedule);
  const accept = (next: unknown) => {
    if (!isDesktopPresentation(next) || disposed || (state && next.revision < state.revision)) return;
    state = next;
    schedule();
  };
  let off = () => {};
  let releaseDragGuard = () => {};
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    try { off(); } catch { /* host unsubscribe must not skip local cleanup */ }
    releaseDragGuard();
    cancelAnimationFrame(frame);
    resize.disconnect();
    mutations.disconnect();
    motions.clear();
    for (const event of DESKTOP_MOTION_EVENTS) root.removeEventListener(event, onMotion);
    window.removeEventListener("resize", refresh);
    delete root.dataset.desktopPlatform;
    delete root.dataset.desktopFocused;
    delete root.dataset.desktopFullscreen;
    delete root.dataset.desktopIntegrated;
    root.style.removeProperty("--desktop-header-height");
    root.style.removeProperty("--desktop-chrome-background");
    root.style.removeProperty("--desktop-chrome-foreground");
    root.style.removeProperty("--desktop-chrome-separator");
    root.style.removeProperty("--desktop-sidebar-background");
    for (const header of observed) {
      header.removeAttribute("data-desktop-header");
      header.style.removeProperty("--desktop-safe-left");
      header.style.removeProperty("--desktop-safe-right");
    }
  };
  const refresh = () => {
    schedule();
    void bridge.getDesktopPresentation?.().then(accept).catch(() => undefined);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    off = bridge.onDesktopPresentation(accept);
    const initial = await Promise.race([
      bridge.getDesktopPresentation(),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 1000); }),
    ]);
    if (!isDesktopPresentation(initial)) { dispose(); return null; }
    releaseDragGuard = installDesktopDragGuard(root);
    accept(initial);
    mutations.observe(root, {
      subtree: true, childList: true, attributes: true,
      // Classes can move a registered route without an animation (for example reduced motion).
      attributeFilter: ["data-desktop-chrome", "class", "style", "hidden", "inert", "aria-hidden"],
    });
    for (const event of DESKTOP_MOTION_EVENTS) root.addEventListener(event, onMotion);
    window.addEventListener("resize", refresh);
    return dispose;
  } catch {
    dispose();
    return null;
  } finally {
    clearTimeout(timer);
  }
}
