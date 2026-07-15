import React from "react";

/** loop 语义标签的浊色调色板（见 loopControls.css 的 --loop-tag-* token）。 */
export type LoopTagTone =
  | "grey"
  | "blue"
  | "green"
  | "amber"
  | "orange"
  | "red"
  | "violet"
  | "purple";

/**
 * loop 统一语义标签：取代零散的 Semi <Tag color>（默认糖果色显塑料）。
 * tone 决定浊色底/字/描边，样式全在 loopControls.css。可选前置图标（如运行中 spinner）。
 */
export default function LoopTag({
  tone = "grey",
  icon,
  className,
  style,
  children,
}: {
  tone?: LoopTagTone;
  icon?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  return (
    <span className={`loop-tag loop-tag--${tone}${className ? ` ${className}` : ""}`} style={style}>
      {icon}
      {children}
    </span>
  );
}
