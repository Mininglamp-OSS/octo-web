import classNames from "classnames";
import { X } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type {
  ResizableRightPanelProps,
  ResizableRightPanelSize,
} from "./types";
import "./index.css";

const PANEL_WIDTH_VARIABLE = "--wk-width-resizable-right-panel";
const PANEL_LAYOUT_ATTRIBUTE = "data-resizable-right-panel-layout";

export function clampResizablePanelWidth(
  width: number,
  containerWidth: number,
  size: ResizableRightPanelSize
): number {
  const ratio = size.maxContainerRatio ?? 0.5;
  const dynamicMax = Math.floor(containerWidth * ratio);
  const max = Math.max(size.minWidth, Math.min(size.maxWidth, dynamicMax));
  return Math.max(size.minWidth, Math.min(max, width));
}

export function shouldUseResizablePanelOverlay(
  containerWidth: number,
  size: ResizableRightPanelSize
): boolean {
  return containerWidth < size.minWidth * 2;
}

function restoreWidth(size: ResizableRightPanelSize): number {
  try {
    const stored = Number.parseInt(
      localStorage.getItem(size.storageKey) || "",
      10
    );
    if (Number.isFinite(stored)) return stored;
  } catch {}
  return size.defaultWidth;
}

function persistWidth(key: string, width: number) {
  try {
    localStorage.setItem(key, String(width));
  } catch {}
}

const ResizableRightPanel: React.FC<ResizableRightPanelProps> = ({
  title,
  children,
  onClose,
  size,
  closeLabel,
  className,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ startX: 0, startWidth: size.defaultWidth });
  const currentWidthRef = useRef(restoreWidth(size));
  const [panelWidth, setPanelWidth] = useState(currentWidthRef.current);
  const [isDragging, setIsDragging] = useState(false);
  const [isCompact, setIsCompact] = useState(false);

  const containerWidth = useCallback(
    () => panelRef.current?.parentElement?.clientWidth || window.innerWidth,
    []
  );

  const applyWidth = useCallback((nextWidth: number) => {
    currentWidthRef.current = nextWidth;
    if (panelRef.current) panelRef.current.style.width = `${nextWidth}px`;
    panelRef.current?.parentElement?.style.setProperty(
      PANEL_WIDTH_VARIABLE,
      `${nextWidth}px`
    );
  }, []);

  const applyLayoutMode = useCallback((compact: boolean) => {
    const parent = panelRef.current?.parentElement;
    if (!parent) return;
    parent.setAttribute(PANEL_LAYOUT_ATTRIBUTE, compact ? "overlay" : "split");
  }, []);

  const endDrag = useCallback(() => {
    setIsDragging(false);
    setPanelWidth(currentWidthRef.current);
    persistWidth(size.storageKey, currentWidthRef.current);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, [size.storageKey]);

  useEffect(() => {
    const parent = panelRef.current?.parentElement;
    const updateLayout = () => {
      const width = containerWidth();
      // 分栏至少要同时容纳一个最窄面板和同宽消息区；不足时改为覆盖模式。
      const compact = shouldUseResizablePanelOverlay(width, size);
      setIsCompact(compact);
      applyLayoutMode(compact);
      if (!compact) {
        const next = clampResizablePanelWidth(
          currentWidthRef.current,
          width,
          size
        );
        setPanelWidth(next);
        applyWidth(next);
      }
    };
    updateLayout();

    const observer =
      parent && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updateLayout)
        : null;
    observer?.observe(parent as Element);
    window.addEventListener("resize", updateLayout);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateLayout);
      parent?.style.removeProperty(PANEL_WIDTH_VARIABLE);
      parent?.removeAttribute(PANEL_LAYOUT_ATTRIBUTE);
    };
  }, [applyLayoutMode, applyWidth, containerWidth, size]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (event: MouseEvent) => {
      const delta = dragRef.current.startX - event.clientX;
      applyWidth(
        clampResizablePanelWidth(
          dragRef.current.startWidth + delta,
          containerWidth(),
          size
        )
      );
    };
    const handleUp = () => endDrag();
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [applyWidth, containerWidth, endDrag, isDragging, size]);

  const startDrag = (event: React.MouseEvent) => {
    event.preventDefault();
    dragRef.current = {
      startX: event.clientX,
      startWidth: currentWidthRef.current,
    };
    setIsDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const resetWidth = () => {
    const next = clampResizablePanelWidth(
      size.defaultWidth,
      containerWidth(),
      size
    );
    applyWidth(next);
    setPanelWidth(next);
    persistWidth(size.storageKey, next);
  };

  return (
    <aside
      ref={panelRef}
      className={classNames(
        "wk-resizable-right-panel",
        isDragging && "wk-resizable-right-panel--dragging",
        isCompact && "wk-resizable-right-panel--compact",
        className
      )}
      style={isCompact ? undefined : { width: panelWidth }}
    >
      {!isCompact && (
        <div
          className="wk-resizable-right-panel__splitter"
          onMouseDown={startDrag}
          onDoubleClick={resetWidth}
          aria-hidden="true"
        >
          <div className="wk-resizable-right-panel__splitter-line" />
        </div>
      )}
      <header className="wk-resizable-right-panel__header">
        <div className="wk-resizable-right-panel__title">{title}</div>
        <button
          type="button"
          className="wk-resizable-right-panel__close"
          aria-label={closeLabel}
          onClick={onClose}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <div className="wk-resizable-right-panel__body">{children}</div>
      {isDragging && <div className="wk-resizable-right-panel__drag-overlay" />}
    </aside>
  );
};

export type {
  ResizableRightPanelProps,
  ResizableRightPanelSize,
} from "./types";

export default ResizableRightPanel;
