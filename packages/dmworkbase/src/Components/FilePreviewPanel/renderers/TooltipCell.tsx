import React, { useCallback, useRef, useState, useEffect, memo } from "react";
import { Tooltip } from "@octo/ui";
import "./TooltipCell.css";

interface TooltipCellProps {
  content: React.ReactNode;
}

/**
 * 单元格 Tooltip 组件
 * 当内容被截断时，hover 显示完整内容
 * 使用 React.memo 优化虚拟表格中的重复渲染
 */
export const TooltipCell = memo(function TooltipCell({ content }: TooltipCellProps) {
  const ref = useRef<HTMLDivElement>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  // 内容是否非空（排除 null/undefined 以及空白字符串）
  const hasContent =
    content !== null &&
    content !== undefined &&
    !(typeof content === "string" && content.trim() === "");

  const checkTruncation = useCallback(() => {
    if (ref.current) {
      setIsTruncated(ref.current.scrollWidth > ref.current.clientWidth);
    }
  }, []);

  const setCellRef = useCallback((node: HTMLDivElement | null) => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    ref.current = node;
    if (!node) return;

    if (typeof ResizeObserver !== "undefined") {
      resizeObserverRef.current = new ResizeObserver(checkTruncation);
      resizeObserverRef.current.observe(node);
    }
  }, [checkTruncation]);

  useEffect(() => {
    checkTruncation();
  }, [content, checkTruncation]);

  useEffect(() => {
    window.addEventListener("resize", checkTruncation);
    return () => {
      resizeObserverRef.current?.disconnect();
      window.removeEventListener("resize", checkTruncation);
    };
  }, [checkTruncation]);

  const cellContent = (
    <div
      ref={setCellRef}
      className="wk-excel-tooltip-cell"
    >
      {content}
    </div>
  );

  if (!isTruncated || !hasContent) return cellContent;

  return <Tooltip content={content}>{cellContent}</Tooltip>;
});
