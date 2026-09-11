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

const MOTION_EVENTS = [
  "transitionrun", "transitionend", "transitioncancel",
  "animationstart", "animationend", "animationcancel",
];

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
  const motions = new Map<Element, Set<string>>();
  let disposed = false;
  let frame = 0;

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
    for (const element of motions.keys()) {
      if (!isPresented(element, view) ||
        !presented.some(overlay => overlay.contains(element) || element.contains(overlay))) {
        motions.delete(element);
      }
    }
    const suspended = motions.size > 0 || presented.some(element => isVisible(element, view));
    const value = String(suspended);
    if (root.dataset.desktopDragSuspended !== value) root.dataset.desktopDragSuspended = value;
  };
  const tick = () => {
    frame = 0;
    refresh();
    if (motions.size && !disposed) frame = view.requestAnimationFrame(tick);
  };
  const onMotion = (event: Event) => {
    const element = event.target;
    if (!(element instanceof Element)) return;
    const motion = event as TransitionEvent & AnimationEvent;
    const key = event.type.startsWith("transition") ? `t:${motion.propertyName}` : `a:${motion.animationName}`;
    if (event.type === "transitionrun" || event.type === "animationstart") {
      if (!element.closest(OVERLAYS) && !element.querySelector(OVERLAYS)) return;
      const active = motions.get(element) ?? new Set<string>();
      active.add(key);
      motions.set(element, active);
      if (!frame) frame = view.requestAnimationFrame(tick);
    } else {
      const active = motions.get(element);
      active?.delete(key);
      if (!active?.size) motions.delete(element);
    }
    refresh();
  };
  const resize = new ResizeObserver(refresh);
  // Apply the guard in the mutation microtask, before the next paint/native hit test.
  const mutations = new MutationObserver(refresh);
  mutations.observe(document.body, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ["data-desktop-overlay", "role", "open", "popover", "hidden", "inert", "aria-hidden", "class", "style"],
  });
  for (const name of MOTION_EVENTS) document.addEventListener(name, onMotion, true);
  document.addEventListener("toggle", refresh, true);
  view.addEventListener("resize", refresh);
  refresh();

  return () => {
    disposed = true;
    view.cancelAnimationFrame(frame);
    resize.disconnect();
    mutations.disconnect();
    motions.clear();
    watched.clear();
    for (const name of MOTION_EVENTS) document.removeEventListener(name, onMotion, true);
    document.removeEventListener("toggle", refresh, true);
    view.removeEventListener("resize", refresh);
    if (previous === null) root.removeAttribute("data-desktop-drag-suspended");
    else root.setAttribute("data-desktop-drag-suspended", previous);
  };
}
