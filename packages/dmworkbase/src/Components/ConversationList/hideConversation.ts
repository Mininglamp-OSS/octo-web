import type { Channel } from "wukongimjssdk";

export interface HideConversationRuntime {
  clearUnread(channel: Channel): Promise<void>;
  deleteConversation(channel: Channel): Promise<void>;
  removeLocalConversation(channel: Channel): void;
  updateFollowingUnread(channel: Channel): void;
  publishUnreadCleared(channel: Channel): void;
  reloadFollowingSidebar(): void;
}

/**
 * “不显示该会话”需要先结束旧未读，再删除最近会话。
 *
 * clearUnread 放在 deleteConversation 之前是有意的：clearUnread 会更新服务端会话状态，
 * 如果反过来调用，已经从最近页删除的会话可能被该写操作重新创建。
 */
export async function hideConversation(
  channel: Channel,
  runtime: HideConversationRuntime
): Promise<void> {
  await runtime.clearUnread(channel);
  await runtime.deleteConversation(channel);
  runtime.removeLocalConversation(channel);
  runtime.updateFollowingUnread(channel);
  runtime.publishUnreadCleared(channel);
  runtime.reloadFollowingSidebar();
}
