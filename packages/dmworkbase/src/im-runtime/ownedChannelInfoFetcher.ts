import WKSDK, { Channel, ChannelInfo } from "wukongimjssdk";
import { captureCurrentImConversationSyncContext } from "./conversationSyncContext";
import { hasSpacePrefix, stripSpacePrefix } from "../Service/SpacePrefix";
import {
  getImChannelInfo,
  getImChannelInfoRevision,
  setImChannelInfoCache,
  notifyImChannelInfoListeners,
  trackChannelInfoFetchPromise,
} from "./channelRuntime";

export type OwnedChannelInfoFetch = (channel: Channel) => Promise<ChannelInfo | undefined>;

export function createOwnedChannelInfoFetcher(
  sdk: WKSDK,
  isOwnerCurrent: () => boolean,
): OwnedChannelInfoFetch {
  const pendingReqs = new Map<string, {
    requestId: number;
    isCurrent: () => boolean;
    promise: Promise<ChannelInfo | undefined>;
  }>();

  return (channel: Channel): Promise<ChannelInfo | undefined> => {
    const provider = sdk.config.provider;
    const callback = provider?.channelInfoCallback;
    if (!provider || !callback) return Promise.resolve(undefined);

    const channelKey = channel.getChannelKey();
    const contextIsCurrent = captureCurrentImConversationSyncContext();
    const reqIsCurrent = () =>
      isOwnerCurrent() &&
      contextIsCurrent() &&
      WKSDK.shared() === sdk &&
      sdk.config.provider === provider &&
      provider.channelInfoCallback === callback;

    if (!reqIsCurrent()) return Promise.resolve(undefined);

    const existing = pendingReqs.get(channelKey);
    if (existing?.isCurrent()) return existing.promise;

    const prevCached = getImChannelInfo(sdk, channel);
    const prevRevision = getImChannelInfoRevision(sdk, channel);
    const requestId = (existing?.requestId ?? 0) + 1;

    const canCommit = () =>
      reqIsCurrent() &&
      pendingReqs.get(channelKey)?.requestId === requestId &&
      getImChannelInfo(sdk, channel) === prevCached &&
      getImChannelInfoRevision(sdk, channel) === prevRevision;

    let accepted = false;
    let promise: Promise<ChannelInfo | undefined>;
    try {
      const raw = callback.call(provider, channel);
      promise = Promise.resolve(raw).then(
        (channelInfo) => {
          const resultCh = channelInfo?.channel;
          if (!resultCh) return undefined;
          if (!resultCh.isEqual(channel)) {
            // Accept bare-alias for Space-prefixed channels (SDK datasource
            // may return an unprefixed peer uid). Reject any other mismatch.
            const isPrefixedAlias =
              resultCh.channelType === channel.channelType &&
              hasSpacePrefix(channel.channelID) &&
              stripSpacePrefix(channel.channelID) === resultCh.channelID;
            if (!isPrefixedAlias) return undefined;
          }
          if (!canCommit()) return undefined;
          // Preserve the SDK's request-key cache behavior for a valid bare alias.
          channelInfo.channel = channel;
          setImChannelInfoCache(sdk, channelInfo);
          notifyImChannelInfoListeners(sdk, channelInfo);
          accepted = true;
          return channelInfo;
        },
        (error: unknown) => {
          if (!canCommit()) return undefined;
          throw error;
        },
      );
    } catch (syncError) {
      promise = Promise.reject(syncError);
    }

    trackChannelInfoFetchPromise(
      sdk.channelManager, channel, promise, () => accepted && reqIsCurrent(),
    );

    pendingReqs.set(channelKey, { requestId, isCurrent: reqIsCurrent, promise });
    const cleanup = () => {
      if (pendingReqs.get(channelKey)?.promise === promise) pendingReqs.delete(channelKey);
    };
    void promise.then(cleanup, cleanup);
    return promise;
  };
}
