export const CHAT_CONTENT_MIN_WIDTH = 432;
export const SEARCH_CONTENT_MIN_WIDTH = 320;
export const CHAT_PANEL_SPLIT_MIN_WIDTH = CHAT_CONTENT_MIN_WIDTH * 2;
export const SEARCH_PANEL_SPLIT_MIN_WIDTH =
  CHAT_CONTENT_MIN_WIDTH + SEARCH_CONTENT_MIN_WIDTH;

export type Auxiliary = boolean | "search" | "thread" | "threadPreview" | "summary";

export interface ChatLayout {
  panelLayout: "split" | "overlay";
  navigationCollapsed: boolean;
}

export function resolveChatLayout(
  width: number,
  navigationWidth: number,
  auxiliary: Auxiliary
): ChatLayout {
  const compactPanel = auxiliary === "search" || auxiliary === "thread" || auxiliary === "summary";
  // Local tools keep ordinary chat navigation; their content adapts within it.
  const localPanel = compactPanel || auxiliary === "threadPreview";
  const navigationCollapsed = localPanel
    ? width < navigationWidth + CHAT_CONTENT_MIN_WIDTH
    : width < navigationWidth + CHAT_CONTENT_MIN_WIDTH * (auxiliary ? 2 : 1);
  const contentWidth = width - (navigationCollapsed ? 0 : navigationWidth);
  const splitMin = compactPanel ? SEARCH_PANEL_SPLIT_MIN_WIDTH : CHAT_PANEL_SPLIT_MIN_WIDTH;
  return {
    navigationCollapsed,
    panelLayout: contentWidth >= splitMin ? "split" : "overlay",
  };
}

/** Coordinate the existing navigation shell without changing its route stack. */
export function observeChatLayout(
  element: HTMLElement,
  onChange: (layout: ChatLayout) => void
) {
  const shell = element.closest<HTMLElement>(".wk-layout-content");
  let auxiliary: Auxiliary = false;
  let previous = "";
  let resizeFrame = 0;
  let disposed = false;
  const update = () => {
    if (disposed) return;
    const width = (shell || element).getBoundingClientRect().width;
    if (width <= 0) return;
    const navigationWidth = shell
      ? parseFloat(getComputedStyle(shell).getPropertyValue("--wk-width-layout-content-left")) || 300
      : 0;
    const layout = resolveChatLayout(width, navigationWidth, auxiliary);
    const key = `${layout.panelLayout}:${layout.navigationCollapsed}`;
    if (shell) {
      shell.dataset.chatNavigation = layout.navigationCollapsed ? "collapsed" : "visible";
    }
    if (key !== previous) {
      previous = key;
      onChange(layout);
    }
  };
  const scheduleUpdate = () => {
    if (disposed || resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      update();
    });
  };
  const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(scheduleUpdate);
  observer?.observe(shell || element);
  if (shell) observer?.observe(element);
  // The navigation splitter writes its preferred width as a shell style.
  const styles = shell && typeof MutationObserver !== "undefined"
    ? new MutationObserver(scheduleUpdate)
    : undefined;
  styles?.observe(shell!, { attributes: true, attributeFilter: ["style"] });
  update();
  return {
    update(nextAuxiliary: Auxiliary) {
      auxiliary = nextAuxiliary;
      update();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(resizeFrame);
      observer?.disconnect();
      styles?.disconnect();
      if (shell) delete shell.dataset.chatNavigation;
    },
  };
}
