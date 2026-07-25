import WKSDK, { Channel, ChannelTypePerson } from "wukongimjssdk";
import { isIncomingWebhookSender } from "../../Service/IncomingWebhook";
import { fetchImChannelInfo, getImChannelInfo } from "../../im-runtime/channelRuntime";

/**
 * InteractiveCard(=17) 发送者信任分类（render gate）。
 *
 * 协议契约（非 UI 细节）：type-17 的 sync/拉取路径服务端原样透传，不替客户端遮蔽；
 * direct-socket 写入可绕过 HTTP ingress，残余防线就是客户端 render gate。
 * 因此「是否渲染结构卡」必须由前端 **fail-closed** 判定：
 *   - webhook（fromUID 前缀 iwh_，由连接鉴权绑定、不可伪造）→ 同步就地信任；
 *   - bot（Person ChannelInfo.orgData.robot === 1）→ 信任；
 *   - 普通用户 → 永不渲染结构卡，退 plain；
 *   - channelInfo 未命中（pending）→ fail-closed 先退 plain，拉取后由基类 listener 重渲。
 *
 * 与服务端 `cardtrust` 口径一致：信任 = ExistRobot OR from_uid 前缀 iwh_。
 */
export type CardSenderTrust = "webhook" | "bot" | "human" | "pending";

/**
 * 分类发送者信任级别。纯读操作，无副作用（不触发 fetch）；
 * pending 的 fetch 由调用方（Cell 生命周期）驱动，避免在 render 中产生副作用。
 */
export function classifyCardSender(
  fromUID: string | undefined
): CardSenderTrust {
  // webhook 优先：iwh_ 前缀是服务端权威信号，同步可判，无需异步等 channelInfo。
  if (isIncomingWebhookSender(fromUID)) {
    return "webhook";
  }
  // 无发送者：无法建立信任，也无从 fetch，直接判 human（不渲结构卡）。
  if (!fromUID) {
    return "human";
  }
  const info = getImChannelInfo(
    WKSDK.shared(),
    new Channel(fromUID, ChannelTypePerson)
  );
  // cache miss：fail-closed。返回 pending，调用方负责 fetch + 到达后重渲。
  if (!info) {
    return "pending";
  }
  return info.orgData?.robot === 1 ? "bot" : "human";
}

/** 是否可渲染结构卡。仅 webhook / bot 可信；human / pending 一律退 plain。 */
export function isTrustedCardSender(trust: CardSenderTrust): boolean {
  return trust === "webhook" || trust === "bot";
}

/** pending 时需主动拉取发送者 channelInfo；到达后由 MessageCell 基类 listener 重渲。 */
export function fetchSenderChannelInfo(fromUID: string): void {
  void fetchImChannelInfo(
    WKSDK.shared(),
    new Channel(fromUID, ChannelTypePerson)
  );
}
