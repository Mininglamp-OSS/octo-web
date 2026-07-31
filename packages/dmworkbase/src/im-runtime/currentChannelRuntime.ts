import WKSDK from "wukongimjssdk";
import {
  addImChannelInfoListener,
  addImSubscriberChangeListener,
  deleteImChannelInfo,
  fetchImChannelInfo,
  getImChannelInfo,
  getImChannelLocallyRemovedSubscriberUids,
  getImChannelSubscriberOfMe,
  getImChannelSubscribers,
  clearImChannelSubscribersLocallyRemoved,
  notifyImChannelInfoListeners,
  notifyImSubscriberChangeListeners,
  markImChannelSubscribersLocallyRemoved,
  setImChannelInfoCache,
  setImChannelSubscribersCache,
  syncImChannelSubscribers,
  type ImChannelInfoFetchResult,
  type ImChannelInfoListener,
  type ImChannelCacheRuntimeSdk,
  type ImChannelInfoLike,
  type ImChannelCacheKeyLike,
  type ImChannelLike,
  type ImChannelRuntimeSdk,
  type ImChannelSubscribersRuntimeSdk,
  type ImSubscribeCacheRuntimeSdk,
  type ImSubscriberChangeListener,
  type ImSubscriberLike,
} from "./channelRuntime";

function currentImRuntime() {
  return WKSDK.shared();
}

function currentImChannelRuntime<
  TChannel extends ImChannelLike,
  TChannelInfo extends ImChannelInfoLike
>() {
  return currentImRuntime() as unknown as ImChannelRuntimeSdk<
    TChannel,
    TChannelInfo
  >;
}

function currentImChannelCacheRuntime<TChannel extends ImChannelLike>() {
  return currentImRuntime() as unknown as ImChannelCacheRuntimeSdk<TChannel>;
}

function currentImChannelSubscribersRuntime<
  TChannel extends ImChannelLike,
  TSubscriber extends ImSubscriberLike
>() {
  return currentImRuntime() as unknown as ImChannelSubscribersRuntimeSdk<
    TChannel,
    TSubscriber
  >;
}

function currentImSubscribeCacheRuntime<
  TSubscriber extends ImSubscriberLike
>() {
  return currentImRuntime() as unknown as ImSubscribeCacheRuntimeSdk<TSubscriber>;
}

export function getCurrentImChannelInfo<
  TChannel extends ImChannelLike,
  TChannelInfo extends ImChannelInfoLike = ImChannelInfoLike
>(channel: TChannel) {
  return getImChannelInfo<TChannel, TChannelInfo>(
    currentImChannelRuntime<TChannel, TChannelInfo>(),
    channel
  );
}

export function fetchCurrentImChannelInfo<
  TChannel extends ImChannelLike,
  TChannelInfo extends ImChannelInfoLike = ImChannelInfoLike
>(channel: TChannel): Promise<ImChannelInfoFetchResult<TChannelInfo>> {
  return fetchImChannelInfo<TChannel, TChannelInfo>(
    currentImChannelRuntime<TChannel, TChannelInfo>(),
    channel
  );
}

export function deleteCurrentImChannelInfo<TChannel extends ImChannelLike>(
  channel: TChannel
) {
  deleteImChannelInfo(currentImChannelCacheRuntime<TChannel>(), channel);
}

export function setCurrentImChannelInfoCache<
  TChannel extends ImChannelLike,
  TChannelInfo extends ImChannelInfoLike = ImChannelInfoLike
>(channelInfo: TChannelInfo) {
  setImChannelInfoCache<TChannel, TChannelInfo>(
    currentImChannelRuntime<TChannel, TChannelInfo>(),
    channelInfo
  );
}

export function notifyCurrentImChannelInfoListeners<
  TChannel extends ImChannelLike,
  TChannelInfo extends ImChannelInfoLike = ImChannelInfoLike
>(channelInfo: TChannelInfo) {
  notifyImChannelInfoListeners<TChannel, TChannelInfo>(
    currentImChannelRuntime<TChannel, TChannelInfo>(),
    channelInfo
  );
}

export function getCurrentImChannelSubscribers<
  TChannel extends ImChannelLike,
  TSubscriber extends ImSubscriberLike = ImSubscriberLike
>(channel: TChannel) {
  return getImChannelSubscribers<TChannel, TSubscriber>(
    currentImChannelSubscribersRuntime<TChannel, TSubscriber>(),
    channel
  );
}

export function getCurrentImChannelSubscriberOfMe<
  TChannel extends ImChannelLike,
  TSubscriber extends ImSubscriberLike = ImSubscriberLike
>(channel: TChannel) {
  return getImChannelSubscriberOfMe<TChannel, TSubscriber>(
    currentImChannelSubscribersRuntime<TChannel, TSubscriber>(),
    channel
  );
}

export function setCurrentImChannelSubscribersCache<
  TChannel extends ImChannelCacheKeyLike,
  TSubscriber extends ImSubscriberLike = ImSubscriberLike
>(channel: TChannel, subscribers: TSubscriber[]) {
  setImChannelSubscribersCache<TChannel, TSubscriber>(
    currentImSubscribeCacheRuntime<TSubscriber>(),
    channel,
    subscribers
  );
}

export function markCurrentImChannelSubscribersLocallyRemoved<
  TChannel extends ImChannelLike
>(channel: TChannel, uids: string[]) {
  markImChannelSubscribersLocallyRemoved(channel, uids);
}

export function clearCurrentImChannelSubscribersLocallyRemoved<
  TChannel extends ImChannelLike
>(channel: TChannel, uids: string[]) {
  clearImChannelSubscribersLocallyRemoved(channel, uids);
}

export function getCurrentImChannelLocallyRemovedSubscriberUids<
  TChannel extends ImChannelLike
>(channel: TChannel) {
  return getImChannelLocallyRemovedSubscriberUids(channel);
}

export function syncCurrentImChannelSubscribers<
  TChannel extends ImChannelLike,
  TSubscriber extends ImSubscriberLike = ImSubscriberLike
>(channel: TChannel) {
  return syncImChannelSubscribers<TChannel, TSubscriber>(
    currentImChannelSubscribersRuntime<TChannel, TSubscriber>(),
    channel
  );
}

export function addCurrentImChannelInfoListener<
  TChannel extends ImChannelLike,
  TChannelInfo extends ImChannelInfoLike = ImChannelInfoLike
>(listener: ImChannelInfoListener<TChannelInfo>) {
  return addImChannelInfoListener<TChannel, TChannelInfo>(
    currentImChannelRuntime<TChannel, TChannelInfo>(),
    listener
  );
}

export function addCurrentImSubscriberChangeListener<
  TChannel extends ImChannelLike,
  TSubscriber extends ImSubscriberLike = ImSubscriberLike
>(listener: ImSubscriberChangeListener) {
  return addImSubscriberChangeListener<TChannel, TSubscriber>(
    currentImChannelSubscribersRuntime<TChannel, TSubscriber>(),
    listener
  );
}

export function notifyCurrentImSubscriberChangeListeners<
  TChannel extends ImChannelLike,
  TSubscriber extends ImSubscriberLike = ImSubscriberLike
>(channel: TChannel) {
  notifyImSubscriberChangeListeners<TChannel, TSubscriber>(
    currentImChannelSubscribersRuntime<TChannel, TSubscriber>(),
    channel
  );
}
