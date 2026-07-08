import { negotiate } from "./guards";
import { classifyCardSender, isTrustedCardSender } from "./senderTrust";
import { CARD_PROFILE_OCTO_V2 } from "./types";
import { validateCardForOcto } from "./validateCardForOcto";

/**
 * 卡片主体渲染决策（纯策略，独立于 SDK 挂载）。集中兜底，对齐服务端
 * 「无 per-element fallback」契约，便于单测覆盖整条闸口而无需挂载整个 Cell。
 *
 *   1. sender trust gate：非可信 / pending → plain 纯文本；
 *   2. profile/version 协商：不支持 → plain + 「需更新客户端」提示（hint）；
 *   3. octo 预校验（validateCardForOcto）：白名单/结构/URL/预算/D1 任一违规 → 整卡退 plain。
 *      通过则交给官方 AdaptiveCards SDK 渲染（挂载由 Cell 负责）。
 *      octo/v2 → allowInteractive，放开 Input.* / Action.Submit（渲染层）。
 *
 * 说明：SDK 默认逐元素 fallback，不满足 octo 整卡降级契约，故渲染前先走 validate；
 * `kind:"card"` 只携带**已通过校验**的 card 与两个能力位，具体 DOM 渲染由 Cell 用 SDK 完成。
 *   - allowInteractive：profile 派生，是否**渲染** Input.* / Submit；
 *   - interactive：sender 派生，是否可**提交**（仅 bot 卡开放交互；webhook 卡展示-only）。
 */
export type CardDecision =
  | { kind: "plain" }
  | { kind: "hint" }
  | {
      kind: "card";
      card: Record<string, unknown>;
      allowInteractive: boolean;
      interactive: boolean;
    };

export interface DecideCardInput {
  fromUID: string | undefined;
  profile: string;
  cardVersion: string;
  card: Record<string, unknown>;
}

export function decideCardBody(input: DecideCardInput): CardDecision {
  // 1. sender trust gate：仅 webhook / bot 可信；其余 fail-closed 渲 plain。
  const trust = classifyCardSender(input.fromUID);
  if (!isTrustedCardSender(trust)) {
    return { kind: "plain" };
  }

  // 2. profile / card_version 协商：不支持 → plain + 更新提示。
  if (!negotiate(input.profile, input.cardVersion).ok) {
    return { kind: "hint" };
  }

  // 3. octo 预校验（整卡降级守门）。通过才交 SDK 渲染。
  const allowInteractive = input.profile === CARD_PROFILE_OCTO_V2;
  if (!validateCardForOcto(input.card, { allowInteractive }).ok) {
    return { kind: "plain" };
  }
  // 交互（提交）仅对 bot-sender 卡开放；webhook 卡展示-only（无事件消费端）。
  return {
    kind: "card",
    card: input.card,
    allowInteractive,
    interactive: trust === "bot",
  };
}

