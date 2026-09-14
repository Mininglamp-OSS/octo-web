import { DESKTOP_MOTION_EVENTS, desktopMotionKey, getDesktopMotion, isDesktopMotionActive } from "./desktopMotion";

const OVERLAYS = [
  "[data-desktop-overlay]",
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="tooltip"]',
  "dialog[open]",
  "[popover]",
].join(",");

function isPresented(element: Element, view: Window): boolean {
  if (!element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  for (let parent: Element | null = element; parent; parent = parent.parentElement) {
    const style = view.getComputedStyle(parent);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
  }
  return true;
}

function isVisible(element: Element, view: Window): boolean {
  if (!isPresented(element, view)) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    return rect.right > 0 && rect.bottom > 0 && rect.left < view.innerWidth && rect.top < view.innerHeight;
  }
  // A portal or display:contents container can have no box of its own.
  return Array.from(element.children).some(child => isVisible(child, view));
}

/** One guard per embedded document, including portals outside the React root. */
export function installDesktopDragGuard(root: HTMLElement): () => void {
  const document = root.ownerDocument;
  const view = document.defaultView!;
  const previous = root.getAttribute("data-desktop-drag-suspended");
  const watched = new Set<Element>();
  const motions = new Map<Element, Map<string, Animation>>();
  let disposed = false;

  const refresh = () => {
    if (disposed) return;
    const overlays = new Set(document.querySelectorAll(OVERLAYS));
    for (const element of watched) {
      if (!overlays.has(element)) {
        resize.unobserve(element);
        watched.delete(element);
      }
    }
    for (const element of overlays) {
      if (!watched.has(element)) {
        watched.add(element);
        resize.observe(element);
      }
    }
    const presented = [...overlays].filter(element => isPresented(element, view));
    for (const [element, active] of motions) {
      for (const [key, animation] of active) {
        if (!isDesktopMotionActive(animation)) active.delete(key);
      }
      if (!active.size || !isPresented(element, view) ||
        !presented.some(overlay => overlay.contains(element) || element.contains(overlay))) {
        motions.delete(element);
      }
    }
    const suspended = motions.size > 0 || presented.some(element => isVisible(element, view));
    const value = String(suspended);
    if (root.dataset.desktopDragSuspended !== value) root.dataset.desktopDragSuspended = value;
  };
  const onMotion = (event: Event) => {
    const element = event.target;
    if (!(element instanceof Element)) return;
    const key = desktopMotionKey(event);
    if (event.type === "transitionrun" || event.type === "animationstart") {
      if (!element.closest(OVERLAYS) && !element.querySelector(OVERLAYS)) return;
      const animation = getDesktopMotion(element, event);
      if (animation) {
        const active = motions.get(element) ?? new Map<string, Animation>();
        active.set(key, animation);
        motions.set(element, active);
      }
    } else {
      const active = motions.get(element);
      if (!active?.delete(key)) return;
      if (!active.size) motions.delete(element);
    }
    // Motion holds the guard until completion; intermediate geometry cannot change it.
    refresh();
  };
  const resize = new ResizeObserver(refresh);
  // Apply the guard in the mutation microtask, before the next paint/native hit test.
  const mutations = new MutationObserver(refresh);
  mutations.observe(document.body, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ["data-desktop-overlay", "role", "open", "popover", "hidden", "inert", "aria-hidden", "class", "style"],
  });
  for (const name of DESKTOP_MOTION_EVENTS) document.addEventListener(name, onMotion, true);
  document.addEventListener("toggle", refresh, true);
  view.addEventListener("resize", refresh);
  refresh();

  return () => {
    disposed = true;
    resize.disconnect();
    mutations.disconnect();
    motions.clear();
    watched.clear();
    for (const name of DESKTOP_MOTION_EVENTS) document.removeEventListener(name, onMotion, true);
    document.removeEventListener("toggle", refresh, true);
    view.removeEventListener("resize", refresh);
    if (previous === null) root.removeAttribute("data-desktop-drag-suspended");
    else root.setAttribute("data-desktop-drag-suspended", previous);
  };
}
