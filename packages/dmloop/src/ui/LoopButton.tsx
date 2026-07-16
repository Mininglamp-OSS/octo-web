import React from "react";
import { Loader2 } from "lucide-react";

type LoopButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type LoopButtonSize = "sm" | "md";

export interface LoopButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  variant?: LoopButtonVariant;
  size?: LoopButtonSize;
  icon?: React.ReactNode;
  iconPosition?: "left" | "right";
  loading?: boolean;
  block?: boolean;
  /** 原生 button type（原 Semi htmlType）。默认 button，避免误触发表单提交。 */
  htmlType?: "button" | "submit" | "reset";
}

/**
 * loop 统一按钮：原生 <button>，不依赖 Semi（Semi 默认 3px 圆角 + 各处写死背景导致按钮散乱）。
 * primary = 品牌黑 6px，hover 提亮 / active 压深（同色系，绝不跳色相）。样式全在 loopControls.css。
 */
export default function LoopButton({
  variant = "primary",
  size = "md",
  icon,
  iconPosition = "left",
  loading = false,
  block = false,
  htmlType = "button",
  disabled,
  className,
  children,
  ...rest
}: LoopButtonProps) {
  const hasLabel = children != null && children !== false;
  const cls = [
    "loop-btn",
    `loop-btn--${variant}`,
    size === "sm" && "loop-btn--sm",
    block && "loop-btn--block",
    !hasLabel && "loop-btn--icon",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const glyph = loading ? (
    <Loader2 className="loop-btn__spin" size={size === "sm" ? 13 : 14} />
  ) : (
    icon
  );
  return (
    <button type={htmlType} className={cls} disabled={disabled || loading} {...rest}>
      {iconPosition === "left" && glyph}
      {hasLabel && <span className="loop-btn__label">{children}</span>}
      {iconPosition === "right" && glyph}
    </button>
  );
}
