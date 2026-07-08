import { MessageContent } from "wukongimjssdk";
import { MessageContentTypeConst } from "../../Service/Const";
import { t } from "../../i18n";
import { InteractiveCardPayload } from "./types";

/**
 * 从 unknown 安全取字符串，非字符串归一为默认值（SDK decodeJSON 签名为 any，
 * 内部一律当 unknown 处理，不信任任何字段类型）。
 */
function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/** 从 unknown 安全取普通对象（AC 树根），非对象归一为空对象。 */
function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/**
 * InteractiveCard(=17) 消息正文（仅接收渲染；波 1 web 不发送 type-17）。
 *
 * payload 信封（权威见 octo-server pkg/cardmsg）：
 *   { type:17, card:{...AdaptiveCard}, plain, card_version:"1.5", profile:"octo/v1" }
 *   - card   为 Adaptive Cards octo/v1 子集，渲染时逐节点守卫，不在此强解；
 *   - plain  为服务端权威派生纯文本，供 digest / 引用预览 / 复制 / 兜底 / 不可信发送者展示；
 *   - profile / card_version 供客户端协商，不认则整卡降级 plain。
 *
 * 安全red line：客户端不重算 plain 当权威；未知字段必须容忍。
 */
export class InteractiveCardContent extends MessageContent {
  card: Record<string, unknown> = {};
  plain = "";
  cardVersion = "";
  profile = "";
  /** P2 tolerant-only，波 1 不读取行为，仅保留避免丢字段。 */
  cardSeq?: number;
  transient?: boolean;

  decodeJSON(content: any) {
    // 签名受 SDK 约束为 any；下方一律按 unknown 逐字段守卫收窄。
    const raw = content as Record<string, unknown> | null | undefined;
    this.card = asRecord(raw?.card);
    this.plain = asString(raw?.plain);
    this.cardVersion = asString(raw?.card_version);
    this.profile = asString(raw?.profile);
    if (typeof raw?.card_seq === "number") this.cardSeq = raw.card_seq;
    if (typeof raw?.transient === "boolean") this.transient = raw.transient;
  }

  encodeJSON(): any {
    // 波 1 web 不构造发送，仅为对称与本地回显保留；容忍字段一并带出，避免丢字段（与解码对称）。
    const out: Partial<InteractiveCardPayload> = {
      card: this.card,
      plain: this.plain,
      card_version: this.cardVersion,
      profile: this.profile,
    };
    if (this.cardSeq !== undefined) out.card_seq = this.cardSeq;
    if (this.transient !== undefined) out.transient = this.transient;
    return out;
  }

  get contentType() {
    return MessageContentTypeConst.interactiveCard;
  }

  /**
   * 引用预览 / 会话摘要文本：优先服务端权威 plain；为空回退本地化占位。
   * 不本地遍历 card 重算——plain 是服务端权威派生源。
   */
  get conversationDigest() {
    if (this.plain.trim() !== "") {
      return this.plain;
    }
    return t("base.message.digest.interactiveCard");
  }
}

export default InteractiveCardContent;
