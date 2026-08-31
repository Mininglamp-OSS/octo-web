import { ChannelInfo, ChannelTypeGroup } from "wukongimjssdk";
import { ChannelTypeCommunityTopic } from "../../Service/Const";

/**
 * 群聊与其下 thread 共用的「外部」标记判定。
 *
 * 会话列表两处渲染点（紧凑群聊 Tab 的 mini badge、常规列表的紫色 Tag）都走这里，
 * 避免内联条件复制漂移。
 *
 * - 群聊（ChannelTypeGroup）：看自身 `is_external_group`
 * - Thread（ChannelTypeCommunityTopic）：thread 自己没有 `is_external_group`，
 *   改看父群的 `is_external_group`，与父群标记保持一致
 * - 其他 channelType：不显示
 *
 * 父群 channelInfo 未加载时判为非外部（fail-close，宁可短暂不显示也不错标）。
 */
export function shouldShowExternalBadge(
  channelType: number,
  channelInfo?: ChannelInfo,
  parentChannelInfo?: ChannelInfo
): boolean {
  if (channelType === ChannelTypeGroup) {
    return channelInfo?.orgData?.is_external_group === 1;
  }
  if (channelType === ChannelTypeCommunityTopic) {
    return parentChannelInfo?.orgData?.is_external_group === 1;
  }
  return false;
}
