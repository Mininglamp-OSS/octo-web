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
