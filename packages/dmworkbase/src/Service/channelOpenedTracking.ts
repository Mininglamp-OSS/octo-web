import { ChannelTypePerson, ChannelTypeGroup } from "wukongimjssdk";
import { ChannelTypeCommunityTopic } from "./Const";

// channel_opened 采集决策 —— 抽成纯函数,便于直接单测(无需挂载 ConversationList / WKSDK)。
// 本事件从 data-track 声明式改为命令式(见 PR:channel_opened→imperative),两处会话行 onClick
// 共用本 helper 构造 payload,Dap.shared.track 由调用方发。

export interface ChannelOpenedPayload {
  object_id: string;
  channel_type: "person" | "group" | "other";
  is_ai?: boolean;
}

/**
 * 会话行点击 → channel_opened payload。返回 null 表示本行不发本事件。
 *
 * - 子区行(ChannelTypeCommunityTopic)返回 null:该手势由 Pages/Chat 命令式发的
 *   subchannel_opened 覆盖,两事件按手势划分、不重叠(与旧 data-track 的 isThread 门控等价)。
 * - object_id = **原始 channelID**(遗留口径:本事件已上线,不做 stripSpacePrefix,以免二次
 *   改变已发布指标序列;跨事件 join 由查询侧自行 strip,见 DAP_EVENTS.md 开头 channel_id 约定)。
 * - channel_type:person / group / other —— 给"私聊 AI 浓度"提供分母(浓度 = is_ai=true 数 /
 *   channel_type=person 数)。
 * - is_ai **仅 person 行携带**(群/其他无"对端 AI"语义 → 不传该字段,空值非 false)。isAiPeer 由
 *   调用方用 isMessageAuthorAi 同一判据算(robot flag + octoAssistantUids + SYSTEM_BOTS);缓存
 *   未拉到时退化 false → 该属性是下限而非精确计数(与既有消息类 is_ai 事件口径一致)。
 */
export function channelOpenedTrackPayload(
  channel: { channelType: number; channelID: string },
  isAiPeer: boolean
): ChannelOpenedPayload | null {
  if (channel.channelType === ChannelTypeCommunityTopic) return null;
  const channelType: ChannelOpenedPayload["channel_type"] =
    channel.channelType === ChannelTypePerson
      ? "person"
      : channel.channelType === ChannelTypeGroup
        ? "group"
        : "other";
  const payload: ChannelOpenedPayload = {
    object_id: channel.channelID,
    channel_type: channelType,
  };
  if (channelType === "person") {
    payload.is_ai = isAiPeer;
  }
  return payload;
}
