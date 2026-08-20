import React, { useRef, useState, useEffect, memo } from "react";
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
  const [isTruncated, setIsTruncated] = useState(false);

  // 内容是否非空（排除 null/undefined 以及空白字符串）
  const hasContent =
    content !== null &&
    content !== undefined &&
    !(typeof content === "string" && content.trim() === "");

  useEffect(() => {
    const checkTruncation = () => {
      if (ref.current) {
        setIsTruncated(ref.current.scrollWidth > ref.current.clientWidth);
      }
    };

    checkTruncation();
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(checkTruncation);
    if (ref.current) resizeObserver?.observe(ref.current);
    window.addEventListener("resize", checkTruncation);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", checkTruncation);
    };
  }, [content]);

  const cellContent = (
    <div
      ref={ref}
      className="wk-excel-tooltip-cell"
    >
      {content}
    </div>
  );

  return (
    <Tooltip content={content} isDisabled={!isTruncated || !hasContent}>
      {cellContent}
    </Tooltip>
  );
});
