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

const pendingChannelInfoFetches = new WeakMap<
  object,
  Map<string, Promise<ImChannelInfoFetchResult<ImChannelInfoLike>>>
>();

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

const LOCALLY_REMOVED_SUBSCRIBER_TTL_MS = 30 * 1000;
const locallyRemovedSubscriberUids = new Map<string, Map<string, number>>();

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
  const key = channelKey(channel);
  const removed = locallyRemovedSubscriberUids.get(key);
  if (!removed || removed.size === 0) return undefined;

  const now = Date.now();
  removed.forEach((expiresAt, uid) => {
    if (expiresAt <= now) {
      removed.delete(uid);
    }
  });
  if (removed.size === 0) {
    locallyRemovedSubscriberUids.delete(key);
    return undefined;
  }
  return new Set(removed.keys());
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
  const promise = Promise.resolve(
    sdk.channelManager.fetchChannelInfo(channel)
  ).then((channelInfo) => {
    return channelInfo || sdk.channelManager.getChannelInfo(channel);
  });

  // The SDK dedupes by channelKey but gives later callers no handle to the
  // original request. Keep the first promise observable without changing any
  // caller's return timing, so successful writes can repair a late stale read.
  const manager = sdk.channelManager as object;
  let pendingByChannel = pendingChannelInfoFetches.get(manager);
  if (!pendingByChannel) {
    pendingByChannel = new Map();
    pendingChannelInfoFetches.set(manager, pendingByChannel);
  }

  const key = channelKey(channel);
  if (!pendingByChannel.has(key)) {
    pendingByChannel.set(
      key,
      promise as Promise<ImChannelInfoFetchResult<ImChannelInfoLike>>
    );
    void promise
      .finally(() => {
        if (pendingByChannel?.get(key) === promise) {
          pendingByChannel.delete(key);
        }
      })
      .catch(() => undefined);
  }

  return promise;
}

export function getPendingImChannelInfoFetch<
  TChannel extends ImChannelLike,
  TChannelInfo extends ImChannelInfoLike
>(sdk: ImChannelRuntimeSdk<TChannel, TChannelInfo>, channel: TChannel) {
  return pendingChannelInfoFetches
    .get(sdk.channelManager as object)
    ?.get(channelKey(channel)) as
    | Promise<ImChannelInfoFetchResult<TChannelInfo>>
    | undefined;
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
  const expiresAt = Date.now() + LOCALLY_REMOVED_SUBSCRIBER_TTL_MS;
  const removed =
    locallyRemovedSubscriberUids.get(key) || new Map<string, number>();
  nextUids.forEach((uid) => removed.set(uid, expiresAt));
  locallyRemovedSubscriberUids.set(key, removed);
}

export function clearImChannelSubscribersLocallyRemoved<
  TChannel extends ImChannelLike
>(channel: TChannel, uids: string[]) {
  const removed = locallyRemovedSubscriberUids.get(channelKey(channel));
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
