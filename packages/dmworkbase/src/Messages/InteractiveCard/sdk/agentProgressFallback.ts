/**
 * 兜底降级的 DOM 叠加：卡片被客户端判定为「已完成（未收到显式终态）」时，在 SDK 渲出的
 * progress 卡上就地把运行中步骤的沙漏 ⏳ 换成 ⚠️，并给 timeline 容器打标记类，供样式弱化
 * 进行中视觉。**只叠加展示，不改消息数据**；每次 SDK 重挂载后由 Cell 重新调用。
 */

const RUNNING_STEP_GLYPH = "⏳";
const FALLBACK_STEP_GLYPH = "⚠️";
export const AGENT_PROGRESS_FALLBACK_CLASS =
  "wk-interactive-card-progress--fallback";

export function applyAgentProgressFallbackVisual(target: HTMLElement): void {
  const timeline = target.querySelector<HTMLElement>("#timeline_detail");
  if (!timeline) return;
  timeline.classList.add(AGENT_PROGRESS_FALLBACK_CLASS);

  const walker = target.ownerDocument.createTreeWalker(
    timeline,
    NodeFilter.SHOW_TEXT
  );
  const pending: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue && node.nodeValue.includes(RUNNING_STEP_GLYPH)) {
      pending.push(node as Text);
    }
  }
  for (const textNode of pending) {
    textNode.nodeValue = textNode
      .nodeValue!.split(RUNNING_STEP_GLYPH)
      .join(FALLBACK_STEP_GLYPH);
  }
}

export default applyAgentProgressFallbackVisual;
