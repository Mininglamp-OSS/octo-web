import { Channel, WKSDK } from "wukongimjssdk";

/**
 * 本地添加/移除群成员成功后，主动同步订阅者列表 (octo-web#514)。
 *
 * `channelDataSource.addSubscribers` / `removeSubscribers` 只把变更写到服务端，
 * **不会**刷新 SDK 的本地成员缓存，也不会触发 `SubscriberChangeListener`。
 * 消费方（如 Conversation VM，其监听器为 MessageInput 的 @mention 候选列表供数）
 * 因此拿不到更新，直到用户刷新页面才会从 version 0 全量重拉。
 *
 * `channelManager.syncSubscribes` 会按 version 拉取增量成员（新增成员被并入缓存，
 * 被移除成员带 `is_deleted` 回来并被 `getSubscribes` 过滤掉），随后
 * `notifySubscribeChangeListeners`，让候选列表立即刷新——无需刷新页面。
 *
 * 与已有的服务端推送路径（CMD `memberUpdate`、`addMembers`/`removeMembers`
 * 系统消息）走同一个 `syncSubscribes` 入口，保持行为一致。
 *
 * 同步失败不应中断设置面板的收尾流程，故吞掉异常。
 */
export function syncSubscribersAfterMembershipChange(
  channel: Channel
): Promise<void> {
  return Promise.resolve(
    WKSDK.shared().channelManager.syncSubscribes(channel)
  )
    .then(() => undefined)
    .catch(() => undefined);
}
