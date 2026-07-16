import React, { useCallback, useEffect, useRef, useState } from "react";

/**
 * 单行省略文本：仅当文本被真正截断时，hover 显示原生 title 全名；完整显示则不挂 title。
 * 用原生 title（而非 Semi Tooltip）：Tooltip 会 cloneElement 抢 child ref，和溢出测量的 ref 冲突，
 * 会导致测量失效/条件包裹抖动；原生 title 无结构变化、ResizeObserver 常驻，窄宽下也稳定。
 */
export default function EllipsisText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [truncated, setTruncated] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (el) setTruncated(el.scrollWidth > el.clientWidth + 1);
  }, []);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, measure]);

  return (
    <span
      ref={ref}
      className={`loop-ellipsis-1${className ? ` ${className}` : ""}`}
      title={truncated ? text : undefined}
    >
      {text}
    </span>
  );
}
