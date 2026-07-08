import React from "react";
import { RenderBudget, negotiate } from "./guards";
import { renderCard } from "./renderer/ACRenderer";
import { classifyCardSender, isTrustedCardSender } from "./senderTrust";

/**
 * 卡片主体渲染决策（纯策略，独立于 JSX 外层）。集中兜底，对齐服务端
 * 「无 per-element fallback」契约，便于单测覆盖整条闸口而无需挂载整个 Cell。
 *
 *   1. sender trust gate：非可信 / pending → plain 纯文本；
 *   2. profile/version 协商：不支持 → plain + 「需更新客户端」提示（hint）；
 *   3. AC 静态渲染：渲染器抛错 / 越界 → 整卡退 plain。
 */
export type CardDecision =
  | { kind: "plain" }
  | { kind: "hint" }
  | { kind: "card"; node: React.ReactElement };

export interface DecideCardInput {
  fromUID: string | undefined;
  profile: string;
  cardVersion: string;
  card: Record<string, unknown>;
}

export function decideCardBody(input: DecideCardInput): CardDecision {
  // 1. sender trust gate：仅 webhook / bot 可信；其余 fail-closed 渲 plain。
  if (!isTrustedCardSender(classifyCardSender(input.fromUID))) {
    return { kind: "plain" };
  }

  // 2. profile / card_version 协商：不支持 → plain + 更新提示。
  if (!negotiate(input.profile, input.cardVersion).ok) {
    return { kind: "hint" };
  }

  // 3. AC 静态渲染。未知元素/动作、结构损坏、深/宽越界抛 CardRenderError → 整卡退 plain。
  try {
    const budget = new RenderBudget();
    const node = renderCard(input.card, budget);
    if (budget.exceeded) return { kind: "plain" };
    return { kind: "card", node };
  } catch {
    return { kind: "plain" };
  }
}
