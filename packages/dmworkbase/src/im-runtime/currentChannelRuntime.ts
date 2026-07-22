import WKSDK from "wukongimjssdk";
import {
  addImChannelInfoListener,
  addImSubscriberChangeListener,
  deleteImChannelInfo,
  fetchImChannelInfo,
  getImChannelInfo,
  getImChannelSubscribers,
  syncImChannelSubscribers,
  type ImChannelInfoFetchResult,
  type ImChannelInfoListener,
  type ImChannelCacheRuntimeSdk,
  type ImChannelInfoLike,
  type ImChannelLike,
  type ImSubscriberChangeListener,
  type ImSubscriberLike,
} from "./channelRuntime";

function currentImRuntime() {
  return WKSDK.shared();
}

export function getCurrentImChannelInfo<
  TChannel extends ImChannelLike,
  TChannelInfo extends ImChannelInfoLike = ImChannelInfoLike
>(channel: TChannel) {
  return getImChannelInfo<TChannel, TChannelInfo>(currentImRuntime(), channel);
}

export function fetchCurrentImChannelInfo<
  TChannel extends ImChannelLike,
  TChannelInfo extends ImChannelInfoLike = ImChannelInfoLike
>(channel: TChannel): Promise<ImChannelInfoFetchResult<TChannelInfo>> {
  return fetchImChannelInfo<TChannel, TChannelInfo>(
    currentImRuntime(),
    channel
  );
}

export function deleteCurrentImChannelInfo<TChannel extends ImChannelLike>(
  channel: TChannel
) {
  deleteImChannelInfo(
    currentImRuntime() as ImChannelCacheRuntimeSdk<TChannel>,
    channel
  );
}

export function getCurrentImChannelSubscribers<
  TChannel extends ImChannelLike,
  TSubscriber = ImSubscriberLike
>(channel: TChannel) {
  return getImChannelSubscribers<TChannel, TSubscriber>(
    currentImRuntime(),
    channel
  );
}

export function syncCurrentImChannelSubscribers<
  TChannel extends ImChannelLike,
  TSubscriber = ImSubscriberLike
>(channel: TChannel) {
  return syncImChannelSubscribers<TChannel, TSubscriber>(
    currentImRuntime(),
    channel
  );
}

export function addCurrentImChannelInfoListener<
  TChannel extends ImChannelLike,
  TChannelInfo extends ImChannelInfoLike = ImChannelInfoLike
>(listener: ImChannelInfoListener<TChannelInfo>) {
  return addImChannelInfoListener<TChannel, TChannelInfo>(
    currentImRuntime(),
    listener
  );
}

export function addCurrentImSubscriberChangeListener<
  TChannel extends ImChannelLike,
  TSubscriber = ImSubscriberLike
>(listener: ImSubscriberChangeListener) {
  return addImSubscriberChangeListener<TChannel, TSubscriber>(
    currentImRuntime(),
    listener
  );
}
