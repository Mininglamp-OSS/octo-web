export interface ImChannelLike {
  channelID: string;
  channelType: number;
}

export interface ImChannelCacheKeyLike extends ImChannelLike {
  getChannelKey: () => string;
}

export interface ImChannelInfoLike {
  channel: ImChannelLike;
  title?: string;
  logo?: string;
  orgData?: Record<string, any>;
  [key: string]: any;
}

export type ImChannelInfoListener<TChannelInfo = ImChannelInfoLike> = (
  channelInfo: TChannelInfo
) => void;

export type ImChannelInfoFetchResult<TChannelInfo> =
  | TChannelInfo
  | undefined
  | void;

export interface ImChannelManagerRuntime<
  TChannel extends ImChannelLike = ImChannelLike,
  TChannelInfo extends ImChannelInfoLike = ImChannelInfoLike
> {
  getChannelInfo: (channel: TChannel) => TChannelInfo | undefined;
  fetchChannelInfo: (
    channel: TChannel
  ) =>
    | Promise<ImChannelInfoFetchResult<TChannelInfo>>
    | ImChannelInfoFetchResult<TChannelInfo>;
  setChannleInfoForCache: (channelInfo: TChannelInfo) => void;
  notifyListeners: (channelInfo: TChannelInfo) => void;
  addListener: (listener: ImChannelInfoListener<TChannelInfo>) => void;
  removeListener: (listener: ImChannelInfoListener<TChannelInfo>) => void;
}

export interface ImChannelRuntimeSdk<
  TChannel extends ImChannelLike = ImChannelLike,
  TChannelInfo extends ImChannelInfoLike = ImChannelInfoLike
> {
  channelManager: ImChannelManagerRuntime<TChannel, TChannelInfo>;
}

export interface ImChannelCacheRuntimeSdk<
  TChannel extends ImChannelLike = ImChannelLike
> {
  channelManager: {
    deleteChannelInfo: (channel: TChannel) => void;
  };
}

export interface ImSubscriberLike {
  uid?: string;
  [key: string]: any;
}

export type ImSubscriberChangeListener = (event: any) => void;

export interface ImChannelSubscribersRuntimeSdk<
  TChannel extends ImChannelLike = ImChannelLike,
  TSubscriber = ImSubscriberLike
> {
  channelManager: {
    getSubscribes: (channel: TChannel) => TSubscriber[] | undefined | null;
    getSubscribeOfMe: (channel: TChannel) => TSubscriber | null | undefined;
    syncSubscribes: (channel: TChannel) => Promise<void> | void;
    addSubscriberChangeListener: (listener: ImSubscriberChangeListener) => void;
    removeSubscriberChangeListener: (
      listener: ImSubscriberChangeListener
    ) => void;
    notifySubscribeChangeListeners: (channel: TChannel) => void;
  };
}

export interface ImSubscribeCacheRuntimeSdk<
  TSubscriber = ImSubscriberLike
> {
  channelManager: {
    subscribeCacheMap: Map<string, TSubscriber[]>;
  };
}

export function getImChannelInfo<
  TChannel extends ImChannelLike,
  TChannelInfo extends ImChannelInfoLike
>(sdk: ImChannelRuntimeSdk<TChannel, TChannelInfo>, channel: TChannel) {
  return sdk.channelManager.getChannelInfo(channel);
}

export function fetchImChannelInfo<
  TChannel extends ImChannelLike,
  TChannelInfo extends ImChannelInfoLike
>(sdk: ImChannelRuntimeSdk<TChannel, TChannelInfo>, channel: TChannel) {
  return Promise.resolve(sdk.channelManager.fetchChannelInfo(channel)).then(
    (channelInfo) => {
      return channelInfo || sdk.channelManager.getChannelInfo(channel);
    }
  );
}

export function setImChannelInfoCache<
  TChannel extends ImChannelLike,
  TChannelInfo extends ImChannelInfoLike
>(sdk: ImChannelRuntimeSdk<TChannel, TChannelInfo>, channelInfo: TChannelInfo) {
  sdk.channelManager.setChannleInfoForCache(channelInfo);
}

export function notifyImChannelInfoListeners<
  TChannel extends ImChannelLike,
  TChannelInfo extends ImChannelInfoLike
>(sdk: ImChannelRuntimeSdk<TChannel, TChannelInfo>, channelInfo: TChannelInfo) {
  sdk.channelManager.notifyListeners(channelInfo);
}

export function addImChannelInfoListener<
  TChannel extends ImChannelLike,
  TChannelInfo extends ImChannelInfoLike
>(
  sdk: ImChannelRuntimeSdk<TChannel, TChannelInfo>,
  listener: ImChannelInfoListener<TChannelInfo>
) {
  sdk.channelManager.addListener(listener);
  return () => {
    sdk.channelManager.removeListener(listener);
  };
}

export function deleteImChannelInfo<TChannel extends ImChannelLike>(
  sdk: ImChannelCacheRuntimeSdk<TChannel>,
  channel: TChannel
) {
  sdk.channelManager.deleteChannelInfo(channel);
}

export function getImChannelSubscribers<
  TChannel extends ImChannelLike,
  TSubscriber = ImSubscriberLike
>(
  sdk: ImChannelSubscribersRuntimeSdk<TChannel, TSubscriber>,
  channel: TChannel
) {
  return sdk.channelManager.getSubscribes(channel) || [];
}

export function getImChannelSubscriberOfMe<
  TChannel extends ImChannelLike,
  TSubscriber = ImSubscriberLike
>(
  sdk: ImChannelSubscribersRuntimeSdk<TChannel, TSubscriber>,
  channel: TChannel
) {
  return sdk.channelManager.getSubscribeOfMe(channel);
}

export function syncImChannelSubscribers<
  TChannel extends ImChannelLike,
  TSubscriber = ImSubscriberLike
>(
  sdk: ImChannelSubscribersRuntimeSdk<TChannel, TSubscriber>,
  channel: TChannel
) {
  return Promise.resolve(sdk.channelManager.syncSubscribes(channel));
}

export function getImSubscribeCacheMap<TSubscriber = ImSubscriberLike>(
  sdk: ImSubscribeCacheRuntimeSdk<TSubscriber>
) {
  return sdk.channelManager.subscribeCacheMap;
}

export function setImChannelSubscribersCache<
  TChannel extends ImChannelCacheKeyLike,
  TSubscriber = ImSubscriberLike
>(
  sdk: ImSubscribeCacheRuntimeSdk<TSubscriber>,
  channel: TChannel,
  subscribers: TSubscriber[]
) {
  sdk.channelManager.subscribeCacheMap.set(channel.getChannelKey(), subscribers);
}

export function addImSubscriberChangeListener<
  TChannel extends ImChannelLike,
  TSubscriber = ImSubscriberLike
>(
  sdk: ImChannelSubscribersRuntimeSdk<TChannel, TSubscriber>,
  listener: ImSubscriberChangeListener
) {
  sdk.channelManager.addSubscriberChangeListener(listener);
  return () => {
    sdk.channelManager.removeSubscriberChangeListener(listener);
  };
}

export function notifyImSubscriberChangeListeners<
  TChannel extends ImChannelLike,
  TSubscriber = ImSubscriberLike
>(sdk: ImChannelSubscribersRuntimeSdk<TChannel, TSubscriber>, channel: TChannel) {
  sdk.channelManager.notifySubscribeChangeListeners(channel);
}

export function patchImChannelInfoOrgData<
  TChannelInfo extends ImChannelInfoLike
>(
  channelInfo: TChannelInfo,
  patch: Record<string, any>
) {
  channelInfo.orgData = {
    ...(channelInfo.orgData || {}),
    ...patch,
  };
  return channelInfo;
}
