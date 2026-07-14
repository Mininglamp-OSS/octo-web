import React, { useLayoutEffect, useRef } from "react";

export interface AutoGrowTextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> {
  value: string;
  onChange: (value: string) => void;
}

/** 原生 textarea + 自动增高：内容超出时随内容变高，不出滚动条。
 *  视觉沿用 .loop-field-textarea（白底/边框/hover/focus），配合 .loop-field-textarea--auto。 */
export default function AutoGrowTextarea({ value, onChange, className, ...rest }: AutoGrowTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 先归零再按内容撑高；min-height 由 CSS 兜底，故短内容仍保持初始高度。
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      {...rest}
    />
  );
}
