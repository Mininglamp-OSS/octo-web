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
  TSubscriber extends ImSubscriberLike = ImSubscriberLike
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
  TSubscriber extends ImSubscriberLike = ImSubscriberLike
> {
  channelManager: {
    subscribeCacheMap: Map<string, TSubscriber[]>;
  };
}

const locallyRemovedSubscriberUids = new Map<string, Set<string>>();

function channelKey(channel: ImChannelLike) {
  const maybeCacheKey = channel as Partial<ImChannelCacheKeyLike>;
  return maybeCacheKey.getChannelKey
    ? maybeCacheKey.getChannelKey()
    : `${channel.channelType}@${channel.channelID}`;
}

function validUids(uids: Array<string | undefined>) {
  return uids.filter((uid): uid is string => !!uid);
}

function removedUidSet(channel: ImChannelLike) {
  return locallyRemovedSubscriberUids.get(channelKey(channel));
}

function filterLocallyRemovedSubscribers<
  TChannel extends ImChannelLike,
  TSubscriber extends ImSubscriberLike
>(channel: TChannel, subscribers: TSubscriber[]) {
  const removed = removedUidSet(channel);
  if (!removed || removed.size === 0) return subscribers;

  const filtered = subscribers.filter(
    (subscriber) => !removed.has(subscriber?.uid || "")
  );
  return filtered.length === subscribers.length ? subscribers : filtered;
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
  TSubscriber extends ImSubscriberLike = ImSubscriberLike
>(
  sdk: ImChannelSubscribersRuntimeSdk<TChannel, TSubscriber>,
  channel: TChannel
) {
  return filterLocallyRemovedSubscribers(
    channel,
    sdk.channelManager.getSubscribes(channel) || []
  );
}

export function getImChannelSubscriberOfMe<
  TChannel extends ImChannelLike,
  TSubscriber extends ImSubscriberLike = ImSubscriberLike
>(
  sdk: ImChannelSubscribersRuntimeSdk<TChannel, TSubscriber>,
  channel: TChannel
) {
  return sdk.channelManager.getSubscribeOfMe(channel);
}

export function syncImChannelSubscribers<
  TChannel extends ImChannelLike,
  TSubscriber extends ImSubscriberLike = ImSubscriberLike
>(
  sdk: ImChannelSubscribersRuntimeSdk<TChannel, TSubscriber>,
  channel: TChannel
) {
  return Promise.resolve(sdk.channelManager.syncSubscribes(channel));
}

export function getImSubscribeCacheMap<
  TSubscriber extends ImSubscriberLike = ImSubscriberLike
>(sdk: ImSubscribeCacheRuntimeSdk<TSubscriber>) {
  return sdk.channelManager.subscribeCacheMap;
}

export function getImChannelSubscribersCacheRaw<
  TChannel extends ImChannelCacheKeyLike,
  TSubscriber extends ImSubscriberLike = ImSubscriberLike
>(sdk: ImSubscribeCacheRuntimeSdk<TSubscriber>, channel: TChannel) {
  return sdk.channelManager.subscribeCacheMap.get(channel.getChannelKey());
}

export function setImChannelSubscribersCache<
  TChannel extends ImChannelCacheKeyLike,
  TSubscriber extends ImSubscriberLike = ImSubscriberLike
>(
  sdk: ImSubscribeCacheRuntimeSdk<TSubscriber>,
  channel: TChannel,
  subscribers: TSubscriber[]
) {
  sdk.channelManager.subscribeCacheMap.set(
    channel.getChannelKey(),
    subscribers
  );
}

export function markImChannelSubscribersLocallyRemoved<
  TChannel extends ImChannelLike
>(channel: TChannel, uids: string[]) {
  const nextUids = validUids(uids);
  if (nextUids.length === 0) return;
  const key = channelKey(channel);
  const removed = locallyRemovedSubscriberUids.get(key) || new Set<string>();
  nextUids.forEach((uid) => removed.add(uid));
  locallyRemovedSubscriberUids.set(key, removed);
}

export function clearImChannelSubscribersLocallyRemoved<
  TChannel extends ImChannelLike
>(channel: TChannel, uids: string[]) {
  const removed = removedUidSet(channel);
  if (!removed) return;
  validUids(uids).forEach((uid) => removed.delete(uid));
  if (removed.size === 0) {
    locallyRemovedSubscriberUids.delete(channelKey(channel));
  }
}

export function getImChannelLocallyRemovedSubscriberUids<
  TChannel extends ImChannelLike
>(channel: TChannel) {
  return Array.from(removedUidSet(channel) || []);
}

export function addImSubscriberChangeListener<
  TChannel extends ImChannelLike,
  TSubscriber extends ImSubscriberLike = ImSubscriberLike
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
  TSubscriber extends ImSubscriberLike = ImSubscriberLike
>(
  sdk: ImChannelSubscribersRuntimeSdk<TChannel, TSubscriber>,
  channel: TChannel
) {
  sdk.channelManager.notifySubscribeChangeListeners(channel);
}

export function patchImChannelInfoOrgData<
  TChannelInfo extends ImChannelInfoLike
>(channelInfo: TChannelInfo, patch: Record<string, any>) {
  channelInfo.orgData = {
    ...(channelInfo.orgData || {}),
    ...patch,
  };
  return channelInfo;
}
