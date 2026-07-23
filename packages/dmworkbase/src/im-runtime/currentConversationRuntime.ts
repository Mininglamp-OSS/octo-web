import WKSDK from "wukongimjssdk";

import type { ImChannelLike } from "./channelRuntime";
import {
  findImConversation,
  notifyImConversationListeners,
  removeImConversation,
  syncImConversationExtra,
  type ImConversationRuntimeSdk,
} from "./conversationRuntime";

function currentImRuntime() {
  return WKSDK.shared();
}

function currentImConversationRuntime<
  TChannel extends ImChannelLike = ImChannelLike,
  TConversation = any
>() {
  return currentImRuntime() as unknown as ImConversationRuntimeSdk<
    TChannel,
    TConversation
  >;
}

export function findCurrentImConversation<
  TChannel extends ImChannelLike,
  TConversation = any
>(channel: TChannel) {
  return findImConversation<TChannel, TConversation>(
    currentImConversationRuntime<TChannel, TConversation>(),
    channel
  );
}

export function removeCurrentImConversation<TChannel extends ImChannelLike>(
  channel: TChannel
) {
  removeImConversation(
    currentImConversationRuntime<TChannel>(),
    channel
  );
}

export function notifyCurrentImConversationListeners<TConversation>(
  conversation: TConversation,
  action: unknown
) {
  notifyImConversationListeners(
    currentImConversationRuntime<ImChannelLike, TConversation>(),
    conversation,
    action
  );
}

export function syncCurrentImConversationExtra() {
  syncImConversationExtra(currentImConversationRuntime());
}

// 直读真实 SDK 的 conversationManager.conversations 字段,绕过 seam 接口:
// 真实 WKSDK 的 conversationManager 只暴露 conversations 字段,没有
// getConversations() 方法,所以走 ImConversationRuntimeSdk 接口那条路对真实 SDK
// 只会拿到空。这里刻意直读字段。?? [] 与旧调用点语义保持一致。
export function getCurrentImConversationsDirectly<
  TConversation = any
>(): TConversation[] {
  const sdk = currentImRuntime() as any;
  return (sdk?.conversationManager?.conversations as TConversation[]) ?? [];
}
