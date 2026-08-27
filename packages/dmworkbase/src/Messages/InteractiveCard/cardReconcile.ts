/**
 * InteractiveCardCell 挂载卡片的 reconcile 决策（纯函数，便于单测，避免依赖重型组件图）。
 *
 * 核心不变量：`renderedKey` 只表达真实 card 内容/渲染 profile——**本地兜底标记
 * (localFallbackApplied) 不进 key**。否则仅本地 banner 翻转（没有新 card frame 到达）会被判成
 * 「新帧到达」，走重挂载 + 重置交互态分支，折叠用户已展开的 timeline 并静默作废在飞的
 * Action.Submit（评审 P1）。兜底标记作为独立第二维度：false → true 只叠加视觉，保护交互态；
 * true → false 必须重挂载，因为兜底 DOM 会把 ⏳ 原地改成 ⚠️，无法可靠逆向恢复。
 */
export type CardReconcileAction = "noop" | "fallback-only" | "remount";

/** 构造挂载卡片的内容指纹。**刻意不含 fallbackFinalized**（见模块头注释）。 */
export function buildRenderedCardKey(
  renderProfile: string,
  allowInteractive: boolean,
  card: Record<string, unknown>
): string {
  return `${renderProfile}:${allowInteractive ? "v2" : "v1"}:${JSON.stringify(
    card
  )}`;
}

/**
 * 决策本次 sync 应做什么：
 *   - "remount"       —— 内容变化，或兜底 true → false：重建权威 DOM、重置交互态；
 *   - "fallback-only" —— 内容不变、兜底 false → true：只叠加 banner，保留交互态；
 *   - "noop"          —— 内容与兜底态都未变：无操作。
 */
export function classifyCardReconcile(
  prevKey: string | null,
  prevFallbackFinalized: boolean,
  nextKey: string,
  nextFallbackFinalized: boolean
): CardReconcileAction {
  if (nextKey !== prevKey) return "remount";
  if (!prevFallbackFinalized && nextFallbackFinalized) return "fallback-only";
  if (prevFallbackFinalized && !nextFallbackFinalized) return "remount";
  return "noop";
}
