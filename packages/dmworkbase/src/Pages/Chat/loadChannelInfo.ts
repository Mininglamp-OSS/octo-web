import WKSDK, { Channel } from "wukongimjssdk";
import { getImChannelInfo, getPendingImChannelInfoFetch } from "../../im-runtime/channelRuntime";
import { getImChannelDisplayName } from "../../im-runtime/channelDisplayName";
import { captureCurrentImConversationSyncContext } from "../../im-runtime/conversationSyncContext";
import { createOwnedChannelInfoFetcher } from "../../im-runtime/ownedChannelInfoFetcher";

/** One load per page activation; failed or legacy empty cache entries are not names. */
export function loadChatChannelInfo(channel: Channel, onLoading: (loading: boolean) => void): () => void {
  const sdk = WKSDK.shared();
  const contextIsCurrent = captureCurrentImConversationSyncContext();
  let disposed = false;
  const isCurrent = () => !disposed && contextIsCurrent() && WKSDK.shared() === sdk;
  const hasName = () => !!getImChannelDisplayName(getImChannelInfo(sdk, channel));

  if (hasName()) {
    onLoading(false);
  } else {
    onLoading(true);
    const fetch = createOwnedChannelInfoFetcher(sdk, isCurrent);
    void (async () => {
      // A sidebar/VM request may already be filling the cache for this channel.
      await getPendingImChannelInfoFetch(sdk, channel);
      if (isCurrent() && !hasName()) await fetch(channel);
    })().catch(() => {
      // The title displays an unavailable state. Do not expose backend error text.
    }).finally(() => {
      if (!disposed) onLoading(false);
    });
  }
  return () => { disposed = true; };
}
