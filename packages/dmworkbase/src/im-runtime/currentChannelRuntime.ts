import WKSDK from "wukongimjssdk";
import {
  addImChannelInfoListener,
  addImSubscriberChangeListener,
  deleteImChannelInfo,
  fetchImChannelInfo,
  getImChannelInfo,
  getImChannelSubscriberOfMe,
  getImChannelSubscribers,
  notifyImChannelInfoListeners,
  notifyImSubscriberChangeListeners,
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
  TSubscriber
>() {
  return currentImRuntime() as unknown as ImChannelSubscribersRuntimeSdk<
    TChannel,
    TSubscriber
  >;
}

function currentImSubscribeCacheRuntime<TSubscriber>() {
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
  deleteImChannelInfo(
    currentImChannelCacheRuntime<TChannel>(),
    channel
  );
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
  TSubscriber = ImSubscriberLike
>(channel: TChannel) {
  return getImChannelSubscribers<TChannel, TSubscriber>(
    currentImChannelSubscribersRuntime<TChannel, TSubscriber>(),
    channel
  );
}

export function getCurrentImChannelSubscriberOfMe<
  TChannel extends ImChannelLike,
  TSubscriber = ImSubscriberLike
>(channel: TChannel) {
  return getImChannelSubscriberOfMe<TChannel, TSubscriber>(
    currentImChannelSubscribersRuntime<TChannel, TSubscriber>(),
    channel
  );
}

export function setCurrentImChannelSubscribersCache<
  TChannel extends ImChannelCacheKeyLike,
  TSubscriber = ImSubscriberLike
>(channel: TChannel, subscribers: TSubscriber[]) {
  setImChannelSubscribersCache<TChannel, TSubscriber>(
    currentImSubscribeCacheRuntime<TSubscriber>(),
    channel,
    subscribers
  );
}

export function syncCurrentImChannelSubscribers<
  TChannel extends ImChannelLike,
  TSubscriber = ImSubscriberLike
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
  TSubscriber = ImSubscriberLike
>(listener: ImSubscriberChangeListener) {
  return addImSubscriberChangeListener<TChannel, TSubscriber>(
    currentImChannelSubscribersRuntime<TChannel, TSubscriber>(),
    listener
  );
}

export function notifyCurrentImSubscriberChangeListeners<
  TChannel extends ImChannelLike,
  TSubscriber = ImSubscriberLike
>(channel: TChannel) {
  notifyImSubscriberChangeListeners<TChannel, TSubscriber>(
    currentImChannelSubscribersRuntime<TChannel, TSubscriber>(),
    channel
  );
}
