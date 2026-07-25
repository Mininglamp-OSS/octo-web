import { negotiate } from "./guards";
import { classifyCardSender, isTrustedCardSender } from "./senderTrust";
import { CARD_PROFILE_OCTO_V2 } from "./types";
import { validateCardForOcto } from "./validateCardForOcto";
import {
  resolveCardRenderProfile,
  type ResolvedCardRenderProfile,
} from "./renderProfile";

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
 *   - interactive：sender 派生，是否可**提交**（仅原始 bot 卡开放交互；webhook/转发卡展示-only）。
 *
 * 安全（信任边界）：**信任仅从服务端权威信封 `message.fromUID` 派生**。payload 里的
 * `forwarded_from_uid` 由客户端写入、不受服务端归属校验，任何普通用户都能通过
 * direct-socket 写入伪造 `forwarded_from_uid:"iwh_x"` 的裸 type-17 包，让本地 iwh_
 * 前缀检查误判为 webhook 信任。故 render gate 不再据该字段回落信任，只以直连发送者
 * 定信任级别；转发的展示型卡在接收端一律 fail-closed 渲 plain（服务端 `plain` 权威派生），
 * 待服务端对 type-17 转发做归属背书后再放开该路径。参见 IncomingWebhook.webhookFromOfMessage
 * 中同款「fromUID 前置门控，不采信 payload.from」的实现口径。
 */
export type CardDecision =
  | { kind: "plain" }
  | { kind: "hint" }
  | {
      kind: "card";
      card: Record<string, unknown>;
      allowInteractive: boolean;
      interactive: boolean;
      renderProfile: ResolvedCardRenderProfile;
    };

export interface DecideCardInput {
  fromUID: string | undefined;
  /**
   * 逐条转发时 payload 写入的原始可信来源 UID。**不参与信任决策**（详见文件头注释），
   * 仅为线协议兼容 / 未来服务端背书转发时的过渡字段。
   */
  forwardedFromUID?: string;
  profile: string;
  renderProfile?: string;
  cardVersion: string;
  card: Record<string, unknown>;
}

export function decideCardBody(input: DecideCardInput): CardDecision {
  // 1. sender trust gate：仅 webhook / bot 可信；其余 fail-closed 渲 plain。
  // 信任只从服务端权威信封 fromUID 派生，不接受 payload 里的 forwarded_from_uid 回落。
  const trust = classifyCardSender(input.fromUID);
  if (!isTrustedCardSender(trust)) {
    return { kind: "plain" };
  }

  // 2. Render Profile 协商：缺失走 legacy，未知非空值提示升级。
  const renderProfile = resolveCardRenderProfile(input.renderProfile ?? "");
  if (!renderProfile.ok) {
    return { kind: "hint" };
  }

  // 3. Wire profile / card_version 协商：不支持 → plain + 更新提示。
  if (!negotiate(input.profile, input.cardVersion).ok) {
    return { kind: "hint" };
  }

  // 4. octo 预校验（整卡降级守门）。通过才交 SDK 渲染。
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
    renderProfile: renderProfile.profile,
  };
}
