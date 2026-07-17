import { useEffect } from "react";

export function useOutsideDismiss(
  open: boolean,
  getContainers: () => Array<HTMLElement | null | undefined>,
  onDismiss: () => void,
  shouldIgnoreTarget?: (target: Node) => boolean
) {
  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (getContainers().some((element) => element?.contains(target))) {
        return;
      }
      if (shouldIgnoreTarget?.(target)) return;
      onDismiss();
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointerDown, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener(
        "pointerdown",
        closeOnOutsidePointerDown,
        true
      );
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [getContainers, onDismiss, open, shouldIgnoreTarget]);
}
