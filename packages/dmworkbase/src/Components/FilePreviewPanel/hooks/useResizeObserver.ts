import { useEffect, useRef } from "react";

/**
 * 监听元素尺寸变化，回调中拿到当前宽高。
 * ResizeObserver 不可用时静默降级（不监听），不抛错。
 */
export function useResizeObserver(
  target: React.RefObject<HTMLElement | null>,
  onResize: (width: number, height: number) => void,
  deps: React.DependencyList = [],
): void {
  const cbRef = useRef(onResize);
  cbRef.current = onResize;

  useEffect(() => {
    const el = target.current;
    if (!el) return;
    if (typeof ResizeObserver === "undefined") return;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      cbRef.current(width, height);
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, ...deps]);
}

export default useResizeObserver;
