import type { ImChannelLike } from "./channelRuntime";

export interface ImConversationManagerRuntime<
  TChannel extends ImChannelLike = ImChannelLike,
  TConversation = any
> {
  createEmptyConversation?: (channel: TChannel) => TConversation | undefined;
  findConversation: (channel: TChannel) => TConversation | undefined;
  notifyConversationListeners: (
    conversation: TConversation,
    action: unknown
  ) => void;
  removeConversation: (channel: TChannel) => void;
  syncExtra: () => void;
}

export interface ImConversationRuntimeSdk<
  TChannel extends ImChannelLike = ImChannelLike,
  TConversation = any
> {
  conversationManager: ImConversationManagerRuntime<TChannel, TConversation>;
}

export function findImConversation<
  TChannel extends ImChannelLike,
  TConversation = any
>(
  sdk: ImConversationRuntimeSdk<TChannel, TConversation>,
  channel: TChannel
) {
  return sdk.conversationManager.findConversation(channel);
}

export function createEmptyImConversation<
  TChannel extends ImChannelLike,
  TConversation = any
>(sdk: ImConversationRuntimeSdk<TChannel, TConversation>, channel: TChannel) {
  return sdk.conversationManager.createEmptyConversation?.(channel);
}

export function removeImConversation<TChannel extends ImChannelLike>(
  sdk: ImConversationRuntimeSdk<TChannel>,
  channel: TChannel
) {
  sdk.conversationManager.removeConversation(channel);
}

export function notifyImConversationListeners<TConversation>(
  sdk: ImConversationRuntimeSdk<ImChannelLike, TConversation>,
  conversation: TConversation,
  action: unknown
) {
  sdk.conversationManager.notifyConversationListeners(conversation, action);
}

export function syncImConversationExtra(sdk: ImConversationRuntimeSdk) {
  sdk.conversationManager.syncExtra();
}
