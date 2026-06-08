import React, { useRef, useState, useEffect, useCallback, memo } from "react";
import { Tooltip } from "@douyinfe/semi-ui";
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
  const [visible, setVisible] = useState(false);

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
    window.addEventListener("resize", checkTruncation);
    return () => window.removeEventListener("resize", checkTruncation);
  }, [content]);

  // NOTE: 这里刻意使用 trigger="custom" 而非 trigger="hover"。
  // hover 模式下 semi 会用内部状态挂载浮层，绕过受控的 visible，
  // 当内容为空时会出现一个空的深色气泡（"乌云"）。改为受控后，
  // 仅当元素确实溢出且有内容时才显示浮层。
  const handleMouseEnter = useCallback(() => {
    const el = ref.current;
    if (el && el.scrollWidth > el.clientWidth && hasContent) {
      setVisible(true);
    }
  }, [hasContent]);

  const handleMouseLeave = useCallback(() => {
    setVisible(false);
  }, []);

  const cellContent = (
    <div
      ref={ref}
      className="wk-excel-tooltip-cell"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {content}
    </div>
  );

  // 未截断或无内容时，直接返回裸单元格，不挂载 Tooltip，杜绝空气泡
  if (!isTruncated || !hasContent) {
    return cellContent;
  }

  return (
    <Tooltip content={content} position="top" trigger="custom" visible={visible} showArrow>
      {cellContent}
    </Tooltip>
  );
});
