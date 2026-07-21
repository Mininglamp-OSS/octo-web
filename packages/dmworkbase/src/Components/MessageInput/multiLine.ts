// 主消息输入框「是否切多行」判定的纯函数收口。
// 组字期（view.composing===true）绝不改布局：外层 flex row→column 或
// inputbox width 突变会中止 IME composition、关掉浮层（octo-web#531）。
// composing 时返回 previous 维持原状；补算靠 compositionend 后 ProseMirror
// 派 update 触发 onUpdate（此时 composing 已复位）时天然完成。

export const MULTILINE_TEXT_THRESHOLD = 50;

export interface ShouldEnableMultiLineArgs {
  text: string;
  hasMultipleParagraphs: boolean;
  hasNewline: boolean;
  hasAttachments: boolean;
  composing: boolean;
  previous: boolean;
}

export function shouldEnableMultiLine({
  text,
  hasMultipleParagraphs,
  hasNewline,
  hasAttachments,
  composing,
  previous,
}: ShouldEnableMultiLineArgs): boolean {
  if (composing) return previous;
  return (
    hasMultipleParagraphs ||
    hasNewline ||
    hasAttachments ||
    text.length > MULTILINE_TEXT_THRESHOLD
  );
}
